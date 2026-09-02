import { z } from 'zod';
import { appendBrainActionLog } from '../aiBrain/brainAudit.service.js';
import { BrainKnowledgeService } from '../aiBrain/brainKnowledge.service.js';
import {
  executeBrainTool,
  GTM_DISCOVERY_PLAN_BRAIN_TOOL_DEFINITIONS,
} from '../aiBrain/brainTools.js';
import { BrainProposalService } from '../aiBrain/brainProposal.service.js';
import { BrainQueryService } from '../aiBrain/brainQuery.service.js';
import {
  chatCompletion,
  LLM_APPLICATION_IDS,
} from '../llm/inferenceRouter.js';
import type { InferenceToolCall } from '../llm/providers/types.js';
import { prisma } from '../lib/prisma.js';
import { roleCan } from '../lib/orgPermissions.js';
import {
  bootstrapGtmKnowledge,
  resolveGtmCollectionIds,
} from './gtmKnowledge.service.js';
import type { GtmIdeaPayload } from './discoveryFoundation.service.js';
import {
  allowedAgentSlugs,
  mergePlanAgentsWithRecommendations,
  recommendGtmAgents,
  type GtmAgentRecommendation,
} from './gtmAgentRecommendation.service.js';

const PLAN_GENERATION_MODEL = 'openrouter/openai/gpt-4o-mini';
const PLAN_GENERATION_TIMEOUT_MS = 90_000;
const STALE_GENERATING_MS = 3 * 60 * 1000;

const matchReasonSchema = z.object({
  code: z.string().trim().min(1).max(40),
  label: z.string().trim().min(1).max(240),
});

const suggestedAgentV2Schema = z.object({
  roleSlug: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(120),
  reason: z.string().trim().min(1).max(1000),
  tier: z.enum(['primary', 'secondary']).optional(),
  score: z.number().int().min(0).max(100).optional(),
  matchReasons: z.array(matchReasonSchema).optional(),
});

export const discoveryPlanContentV1Schema = z.object({
  schemaVersion: z.literal('gtm.discovery_plan.v1'),
  summary: z.string().trim().min(1).max(4000),
  focus: z.object({
    audience: z.string().trim().min(1).max(2000),
    reasons: z.array(z.string().trim().min(1).max(1000)).min(1).max(5),
    openQuestions: z.array(z.string().trim().min(1).max(1000)).max(8).default([]),
  }),
  suggestedAgents: z.array(z.object({
    roleSlug: z.string().trim().min(1).max(80),
    label: z.string().trim().min(1).max(120),
    reason: z.string().trim().min(1).max(1000),
  })).min(1).max(3),
  tools: z.array(z.object({
    capabilityId: z.enum(['research', 'crm', 'email']),
    priority: z.enum(['now', 'later', 'optional']),
    reason: z.string().trim().min(1).max(1000),
  })).min(1).max(5),
  planSteps: z.array(z.object({
    title: z.string().trim().min(1).max(240),
    why: z.string().trim().min(1).max(1000),
    effort: z.enum(['small', 'medium']),
  })).min(3).max(7),
  hypotheses: z.array(z.object({
    kind: z.string().trim().min(1).max(40),
    statement: z.string().trim().min(1).max(1000),
  })).min(2).max(5),
});

export const discoveryPlanContentV2Schema = discoveryPlanContentV1Schema.extend({
  schemaVersion: z.literal('gtm.discovery_plan.v2'),
  suggestedAgents: z.array(suggestedAgentV2Schema).min(1).max(3),
});

export const discoveryPlanContentSchema = z.union([discoveryPlanContentV1Schema, discoveryPlanContentV2Schema]);

export type DiscoveryPlanContent = z.infer<typeof discoveryPlanContentV2Schema>;
export type DiscoveryPlanContentV2 = DiscoveryPlanContent;
export type DiscoveryPlanContentV1 = z.infer<typeof discoveryPlanContentV1Schema>;

export class GtmDiscoveryPlanError extends Error {
  constructor(message: string, readonly code: 'forbidden' | 'not_found' | 'invalid' | 'brain_required') {
    super(message);
    this.name = 'GtmDiscoveryPlanError';
  }
}

export function formatGtmIdeaMarkdown(version: number, content: GtmIdeaPayload): string {
  return [
    `# Founder discovery answers (v${version})`,
    '',
    '## Business idea',
    content.idea,
    '',
    '## Problem',
    content.problem || '_Not specified_',
    '',
    '## Who experiences it',
    content.audience || '_Not specified_',
    '',
    '## How to solve',
    content.solution || '_Not specified_',
    '',
    '## Expected outcome',
    content.outcome || '_Not specified_',
    '',
    '## Constraints',
    content.constraints || '_Not specified_',
  ].join('\n');
}

function normalizePlanContent(
  raw: DiscoveryPlanContentV1 | DiscoveryPlanContentV2,
  recommendations: GtmAgentRecommendation[],
): DiscoveryPlanContent {
  const mergedAgents = mergePlanAgentsWithRecommendations(raw.suggestedAgents, recommendations).map((agent) => ({
    roleSlug: agent.roleSlug,
    label: agent.label,
    reason: agent.reason,
    tier: agent.tier,
    score: agent.score,
    matchReasons: agent.matchReasons,
  }));

  return discoveryPlanContentV2Schema.parse({
    ...raw,
    schemaVersion: 'gtm.discovery_plan.v2',
    suggestedAgents: mergedAgents,
  });
}

function planDto(row: {
  id: string;
  ideaVersion: number;
  version: number;
  status: string;
  content: unknown;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    ideaVersion: row.ideaVersion,
    version: row.version,
    status: row.status,
    content: row.content,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getLatestDiscoveryPlan(orgId: string) {
  const row = await prisma.gtmDiscoveryPlan.findFirst({
    where: { orgId },
    orderBy: { version: 'desc' },
  });
  if (!row) return null;

  if (row.status === 'generating' && Date.now() - row.updatedAt.getTime() > STALE_GENERATING_MS) {
    const stale = await prisma.gtmDiscoveryPlan.update({
      where: { id: row.id },
      data: {
        status: 'failed',
        errorMessage: 'Plan generation timed out or was interrupted. Tap Regenerate to try again.',
      },
    });
    return planDto(stale);
  }

  return planDto(row);
}

function buildDiscoveryPlanQuestion(
  content: GtmIdeaPayload,
  version: number,
  recommendations: GtmAgentRecommendation[],
): string {
  const agentLines = recommendations.map((r) =>
    `- ${r.roleSlug} (${r.tier}, score ${r.score}): ${r.matchReasons.map((m) => m.label).join('; ')}`,
  ).join('\n');
  return [
    'Draft a personalized GTM starter dashboard from the founder answers below.',
    'Use only what is stated or reasonably inferred. Mark unknowns in openQuestions.',
    'Call propose_gtm_discovery_plan exactly once with the full structured payload.',
    'Use ONLY these roleSlug values for suggestedAgents:',
    agentLines,
    '',
    `Idea version: ${version}`,
    `Business idea: ${content.idea}`,
    `Problem: ${content.problem || '(unknown)'}`,
    `Audience: ${content.audience || '(unknown)'}`,
    `Solution: ${content.solution || '(unknown)'}`,
    `Expected outcome: ${content.outcome || '(unknown)'}`,
    `Constraints: ${content.constraints || '(unknown)'}`,
  ].join('\n');
}

export function buildDiscoveryPlanSystemPrompt(recommendations: GtmAgentRecommendation[]): string {
  const slugs = recommendations.map((r) => r.roleSlug).join(', ');
  return [
    'You are drafting a personalized GTM starter dashboard for a founder who just confirmed six discovery answers.',
    'Ground recommendations in the founder answers only.',
    'Do not invent customer names, revenue, traction, or market size.',
    `You may ONLY use these roleSlug values: ${slugs}.`,
    'Include every recommended role in suggestedAgents with a human reason paraphrasing the match reasons.',
    'Set schemaVersion to gtm.discovery_plan.v2.',
    'For tools, use capabilityId research, crm, or email with priority now, later, or optional.',
    'Email is discovery-only blocked — mark it later unless the founder explicitly needs send now.',
    'You must call propose_gtm_discovery_plan once with the complete dashboard JSON.',
    'Include at least 3 planSteps and 2 hypotheses.',
  ].join('\n');
}

export const GTM_DISCOVERY_PLAN_SYSTEM_PROMPT = buildDiscoveryPlanSystemPrompt(
  recommendGtmAgents({
    content: {
      idea: '', problem: '', audience: '', solution: '', outcome: '', constraints: '',
    },
  }),
);

export async function ingestGtmIdeaToBrain(input: {
  orgId: string;
  userId: string;
  role: string;
  brainAgentId: string;
  ideaVersion: number;
  content: GtmIdeaPayload;
}): Promise<{ documentId: string }> {
  if (!roleCan(input.role, 'manage_brain')) {
    throw new GtmDiscoveryPlanError('Only organization owners and admins can sync discovery answers to the Brain.', 'forbidden');
  }

  const collectionIds = await resolveGtmCollectionIds(input.orgId, ['company_positioning']);
  let collectionId = collectionIds[0];
  if (!collectionId) {
    await bootstrapGtmKnowledge({
      orgId: input.orgId,
      userId: input.userId,
      role: input.role,
      brainAgentId: input.brainAgentId,
    });
    const refreshed = await resolveGtmCollectionIds(input.orgId, ['company_positioning']);
    collectionId = refreshed[0];
  }
  if (!collectionId) {
    throw new GtmDiscoveryPlanError('GTM company positioning collection is missing.', 'invalid');
  }

  const knowledge = new BrainKnowledgeService();
  const title = `Founder discovery answers (v${input.ideaVersion})`;
  const bodyText = formatGtmIdeaMarkdown(input.ideaVersion, input.content);
  const ingested = await knowledge.ingestDocument({
    orgId: input.orgId,
    userId: input.userId,
    role: input.role,
    brainAgentId: input.brainAgentId,
    collectionId,
    title,
    bodyText,
    sourceUri: `gtm://idea/v${input.ideaVersion}`,
    markReviewed: true,
  });

  await appendBrainActionLog({
    brainAgentId: input.brainAgentId,
    userId: input.userId,
    actionType: 'brain.gtm_idea_ingest',
    payload: {
      description: `Ingested founder discovery answers v${input.ideaVersion} into GTM Brain`,
      documentId: ingested.id,
      ideaVersion: input.ideaVersion,
      collectionId,
    },
    status: 'success',
    riskLevel: 'low',
  });

  return { documentId: ingested.id };
}

async function generateDiscoveryPlanContent(input: {
  orgId: string;
  userId: string;
  brainAgentId: string;
  content: GtmIdeaPayload;
  ideaVersion: number;
}): Promise<DiscoveryPlanContent> {
  const recommendations = recommendGtmAgents({ content: input.content });
  const allowedSlugs = allowedAgentSlugs(recommendations);
  let capturedPlan: DiscoveryPlanContent | null = null;
  const queryService = new BrainQueryService();
  const proposals = new BrainProposalService();
  const toolContext = {
    userId: input.userId,
    orgId: input.orgId,
    brainAgentId: input.brainAgentId,
    queryService,
    proposals,
    proposeGtmDiscoveryPlan: async (plan: Record<string, unknown>) => {
      const parsed = discoveryPlanContentSchema.safeParse(plan);
      if (!parsed.success) {
        const detail = parsed.error.issues.map((issue) => issue.message).join('; ');
        throw new GtmDiscoveryPlanError(`Brain returned an invalid discovery plan: ${detail}`, 'invalid');
      }
      for (const agent of parsed.data.suggestedAgents) {
        if (!allowedSlugs.has(agent.roleSlug)) {
          throw new GtmDiscoveryPlanError(`Agent role slug not in recommendations: ${agent.roleSlug}`, 'invalid');
        }
      }
      capturedPlan = normalizePlanContent(parsed.data, recommendations);
      return { ok: true as const };
    },
  };

  type ChatMessage =
    | { role: 'system'; content: string }
    | { role: 'user'; content: string }
    | { role: 'assistant'; content: string | null; tool_calls?: InferenceToolCall[] }
    | { role: 'tool'; tool_call_id: string; content: string };

  const messages: ChatMessage[] = [
    { role: 'system', content: buildDiscoveryPlanSystemPrompt(recommendations) },
    { role: 'user', content: buildDiscoveryPlanQuestion(input.content, input.ideaVersion, recommendations) },
  ];

  const tools = [...GTM_DISCOVERY_PLAN_BRAIN_TOOL_DEFINITIONS];

  for (let round = 0; round < 2; round += 1) {
    const llmResult = await chatCompletion(
      {
        model: PLAN_GENERATION_MODEL,
        messages,
        temperature: 0.2,
        max_tokens: 4096,
        stream: false,
        tools,
        tool_choice: { type: 'function', function: { name: 'propose_gtm_discovery_plan' } },
      },
      { provider: 'openrouter', applicationId: LLM_APPLICATION_IDS.aiBrain },
    );

    const toolCalls = llmResult.toolCalls;
    if (toolCalls?.length) {
      messages.push({
        role: 'assistant',
        content: llmResult.content || null,
        tool_calls: toolCalls,
      });

      for (const call of toolCalls) {
        const toolResult = await executeBrainTool(call.function.name, call.function.arguments, toolContext);
        messages.push({ role: 'tool', tool_call_id: call.id, content: toolResult.content });
      }

      if (capturedPlan) return capturedPlan;
    }

    const text = (llmResult.content ?? '').trim();
    if (text) {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsedJson = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
          await toolContext.proposeGtmDiscoveryPlan(parsedJson);
          if (capturedPlan) return capturedPlan;
        } catch {
          // fall through to retry
        }
      }
    }
  }

  if (!capturedPlan) {
    throw new GtmDiscoveryPlanError('Brain did not return a discovery plan.', 'invalid');
  }
  return capturedPlan;
}

async function runDiscoveryPlanGeneration(input: {
  orgId: string;
  userId: string;
  role: string;
  brainAgentId: string;
  brainModel: string;
  planId: string;
  ideaVersion: number;
  content: GtmIdeaPayload;
}): Promise<void> {
  try {
    await prisma.gtmDiscoveryPlan.update({
      where: { id: input.planId },
      data: { updatedAt: new Date() },
    });

    const capturedPlan = await Promise.race([
      generateDiscoveryPlanContent({
        orgId: input.orgId,
        userId: input.userId,
        brainAgentId: input.brainAgentId,
        content: input.content,
        ideaVersion: input.ideaVersion,
      }),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Plan generation timed out after 90 seconds.')), PLAN_GENERATION_TIMEOUT_MS);
      }),
    ]);

    await prisma.gtmDiscoveryPlan.update({
      where: { id: input.planId },
      data: {
        status: 'ready',
        content: capturedPlan,
        errorMessage: null,
      },
    });

    await appendBrainActionLog({
      brainAgentId: input.brainAgentId,
      userId: input.userId,
      actionType: 'gtm.discovery_plan_generate',
      payload: {
        description: `Discovery plan v${input.ideaVersion} ready`,
        planId: input.planId,
        ideaVersion: input.ideaVersion,
        status: 'ready',
      },
      status: 'success',
      riskLevel: 'low',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Discovery plan generation failed.';
    await prisma.gtmDiscoveryPlan.update({
      where: { id: input.planId },
      data: { status: 'failed', errorMessage: message },
    });
    await appendBrainActionLog({
      brainAgentId: input.brainAgentId,
      userId: input.userId,
      actionType: 'gtm.discovery_plan_generate',
      payload: {
        description: 'Discovery plan generation failed',
        planId: input.planId,
        ideaVersion: input.ideaVersion,
        status: 'failed',
        error: message,
      },
      status: 'flagged',
      riskLevel: 'medium',
    });
  }
}

export async function startDiscoveryPlanPipeline(input: {
  orgId: string;
  userId: string;
  role: string;
  brainAgentId: string;
  brainModel: string;
  ideaVersion: number;
  content: GtmIdeaPayload;
}) {
  await ingestGtmIdeaToBrain({
    orgId: input.orgId,
    userId: input.userId,
    role: input.role,
    brainAgentId: input.brainAgentId,
    ideaVersion: input.ideaVersion,
    content: input.content,
  });

  const latest = await prisma.gtmDiscoveryPlan.findFirst({
    where: { orgId: input.orgId },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  const plan = await prisma.gtmDiscoveryPlan.create({
    data: {
      orgId: input.orgId,
      ideaVersion: input.ideaVersion,
      version: (latest?.version ?? 0) + 1,
      status: 'generating',
      createdBy: input.userId,
    },
  });

  void runDiscoveryPlanGeneration({ ...input, planId: plan.id }).catch(async (error) => {
    const message = error instanceof Error ? error.message : 'Discovery plan generation failed.';
    console.error('[gtmDiscoveryPlan] unhandled generation error:', message);
    await prisma.gtmDiscoveryPlan.updateMany({
      where: { id: plan.id, status: 'generating' },
      data: { status: 'failed', errorMessage: message },
    }).catch(() => undefined);
  });
  return planDto(plan);
}

export async function regenerateDiscoveryPlan(input: {
  orgId: string;
  userId: string;
  role: string;
  brainAgentId: string;
  brainModel: string;
}) {
  if (!roleCan(input.role, 'manage_brain')) {
    throw new GtmDiscoveryPlanError('Only organization owners and admins can regenerate the discovery plan.', 'forbidden');
  }

  const idea = await prisma.gtmIdea.findFirst({
    where: { orgId: input.orgId, status: 'active' },
    orderBy: { version: 'desc' },
  });
  if (!idea) {
    throw new GtmDiscoveryPlanError('Complete the six discovery questions first.', 'not_found');
  }

  const content = idea.content as GtmIdeaPayload;
  return startDiscoveryPlanPipeline({
    orgId: input.orgId,
    userId: input.userId,
    role: input.role,
    brainAgentId: input.brainAgentId,
    brainModel: input.brainModel,
    ideaVersion: idea.version,
    content,
  });
}
