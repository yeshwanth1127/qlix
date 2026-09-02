import {
  chatCompletion,
  LLM_APPLICATION_IDS,
  type LlmProviderId,
} from '../llm/inferenceRouter.js';
import { getPlanConfig } from '../billings/lib/subscriptionPlans.js';
import { prisma } from '../lib/prisma.js';
import { type PermissionScope } from './agents.types.js';
import { FORCE_JIT_SCOPES } from './jit.js';
import { getBuildableScopes, reconcileRuntimeWithScopes, type ScopeDef } from './scopeCatalog.js';
import { buildAgentToolSchema, buildTeamToolSchema, buildSystemPrompt } from './nlCapabilities.js';
import type { AgentCreationPlan, NLAgentSpec, NLWorkerSpec } from './nlTypes.js';
import {
  enrichCompetitorResearchPlan,
  enrichJobApplyPlan,
  enrichCrmPlan,
  enrichSchedulePlan,
  enrichCloudPreferPlan,
  stripScheduleUnlessIntent,
} from './nlPlanEnrichment.js';
import { selectNlPromptPacks } from './nlPromptPacks.js';
import { filterScopesForBuilderPrompt } from './nlScopeFilter.js';
import { withDefaultAgentScopes } from './defaultAgentScopes.js';
import { applyStageKindPacksToPlan, isStageKind, parseStageChannels, parseStageKinds } from '../teams/stageKind.js';

const DEFAULT_BUILDER_MODEL = 'openrouter/openai/gpt-4o-mini';
const DEFAULT_AGENT_MODEL = 'exora/exora-general';

function defaultAgentModel(): string {
  return DEFAULT_AGENT_MODEL;
}

function providerForModel(model: string): LlmProviderId {
  return model.toLowerCase().startsWith('exora/') ? 'exora' : 'openrouter';
}

async function planAllowedTiersForOrg(orgId: string | null): Promise<string[]> {
  if (!orgId) return getPlanConfig('free').allowedModelTiers;
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { plan: true },
  });
  return getPlanConfig(org?.plan ?? 'free').allowedModelTiers;
}

function sanitizeScopes(raw: unknown, allowed: Set<string>): PermissionScope[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((s): s is PermissionScope => typeof s === 'string' && allowed.has(s));
}

export function sanitizeAgentSpec(rawInput: unknown, fallbackName: string, allowed: Set<string>): NLAgentSpec {
  // The model can emit null / non-object entries; coerce so we never deref null.
  const raw: Record<string, unknown> =
    rawInput && typeof rawInput === 'object' ? (rawInput as Record<string, unknown>) : {};
  let permissionScopes = sanitizeScopes(raw.permissionScopes, allowed);
  // The model often gives pure orchestrators / text-only writers zero scopes, but the
  // create-agent API requires at least one. Fall back to the most benign available scope.
  if (permissionScopes.length === 0) {
    const fallback = allowed.has('web.read') ? 'web.read' : [...allowed][0];
    if (fallback) permissionScopes = [fallback as PermissionScope];
  }
  // Always-on default (brain.query) — schedule scopes are intent-based via enrichment.
  permissionScopes = withDefaultAgentScopes(permissionScopes);
  const rawJit = sanitizeScopes(raw.jitScopes, allowed);
  const scopeSet = new Set(permissionScopes);
  const jitScopes = [
    ...new Set([
      ...rawJit.filter((s) => scopeSet.has(s)),
      ...(FORCE_JIT_SCOPES as PermissionScope[]).filter((s) => scopeSet.has(s)),
    ]),
  ];

  let runtime = ['cloud', 'hybrid', 'local'].includes(raw.runtime as string)
    ? (raw.runtime as 'cloud' | 'hybrid' | 'local')
    : 'cloud';
  runtime = reconcileRuntimeWithScopes(runtime, permissionScopes);

  let llmMode: 'proxy' | 'direct' = 'proxy';
  let localInferenceMode: 'local_llm' | 'cloud_api' | null = null;

  if (runtime === 'cloud' || runtime === 'hybrid') {
    llmMode = 'proxy';
    localInferenceMode = null;
  } else {
    llmMode = raw.llmMode === 'direct' ? 'direct' : 'proxy';
    localInferenceMode =
      raw.localInferenceMode === 'local_llm' ? 'local_llm'
      : raw.localInferenceMode === 'cloud_api' ? 'cloud_api'
      : 'cloud_api';
  }

  let model =
    typeof raw.model === 'string' && raw.model.trim() ? raw.model.trim() : defaultAgentModel();
  // Cloud/hybrid: keep namespaced Exora/OpenRouter models; else force Exora General.
  if (runtime === 'cloud' || runtime === 'hybrid') {
    const lower = model.toLowerCase();
    const keep =
      lower.includes('qlix/auto') ||
      lower.startsWith('exora/') ||
      lower.startsWith('openrouter/');
    if (!keep) {
      model = defaultAgentModel();
    } else if (lower === 'exora-general') {
      model = DEFAULT_AGENT_MODEL;
    }
  }

  return {
    name: String(raw.name ?? fallbackName).slice(0, 120),
    description: String(raw.description ?? '').slice(0, 10000),
    permissionScopes,
    jitScopes,
    runtime,
    model,
    llmMode,
    localInferenceMode,
    rationale: String(raw.rationale ?? ''),
  };
}

export function sanitizeWorkerSpec(rawInput: unknown, index: number, allowed: Set<string>): NLWorkerSpec {
  const raw: Record<string, unknown> =
    rawInput && typeof rawInput === 'object' ? (rawInput as Record<string, unknown>) : {};
  const base = sanitizeAgentSpec(raw, `Worker ${index + 1}`, allowed);
  return {
    ...base,
    role: String(raw.role ?? 'worker').slice(0, 80),
    stageOrder: typeof raw.stageOrder === 'number' && raw.stageOrder > 0 ? Math.floor(raw.stageOrder) : index + 1,
    stageKind: isStageKind(raw.stageKind) ? raw.stageKind : undefined,
    alsoKinds: parseStageKinds(raw.alsoKinds),
    channels: parseStageChannels(raw.channels),
  };
}

export class NLParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NLParseError';
  }
}

/**
 * Parse planning tool arguments while tolerating formats some compatible
 * providers occasionally return (Markdown fences or a JSON-encoded string).
 */
export function parsePlanningToolArguments(raw: string): unknown {
  const trimmed = raw.trim();
  const candidates = [trimmed];
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced?.[1]) candidates.push(fenced[1].trim());

  const objectStart = trimmed.indexOf('{');
  const objectEnd = trimmed.lastIndexOf('}');
  if (objectStart >= 0 && objectEnd > objectStart) {
    candidates.push(trimmed.slice(objectStart, objectEnd + 1));
  }

  for (const candidate of new Set(candidates)) {
    if (!candidate) continue;
    try {
      let parsed: unknown = JSON.parse(candidate);
      // A few OpenAI-compatible providers double-encode tool arguments.
      if (typeof parsed === 'string') parsed = JSON.parse(parsed);
      return parsed;
    } catch {
      // Try the next safe representation before asking the model to repair it.
    }
  }

  throw new NLParseError('Tool call arguments were not valid JSON');
}

export async function parseAgentCreationPrompt(
  userPrompt: string,
  orgId: string | null,
  model?: string,
  /** Natural-language intent for scope filtering/enrichment (omit to use userPrompt). */
  scopeIntent?: string,
): Promise<AgentCreationPlan> {
  const resolvedModel = model?.trim() || DEFAULT_BUILDER_MODEL;
  const provider = providerForModel(resolvedModel);
  const planAllowedTiers = await planAllowedTiersForOrg(orgId);
  const intentText = (scopeIntent?.trim() || userPrompt).slice(0, 5000);

  // Offer every scope enabled for this org (base + connector-gated), even if the
  // connector isn't linked yet — the link is verified at run time, not build time.
  // Skills-page-disabled scopes are still excluded.
  const availableScopes: ScopeDef[] = await getBuildableScopes(orgId);
  const allowed = new Set<string>(availableScopes.map((s) => s.id));
  const promptScopes = filterScopesForBuilderPrompt(intentText, availableScopes);
  const packs = selectNlPromptPacks(intentText);

  const request = {
    model: resolvedModel,
    messages: [
      { role: 'system' as const, content: buildSystemPrompt(promptScopes, packs) },
      { role: 'user' as const, content: userPrompt.slice(0, 5000) },
    ],
    temperature: 0.1,
    max_tokens: 2048,
    stream: false,
    tools: [buildAgentToolSchema(availableScopes), buildTeamToolSchema(availableScopes)],
    tool_choice: 'required' as const,
  };
  const options = {
    provider,
    applicationId: LLM_APPLICATION_IDS.nlBuilder,
    // Keep the builder's provider wait within one predictable 150-second window.
    timeoutMs: 150_000,
    retries: 0,
    planAllowedTiers,
  };

  let result = await chatCompletion(request, options);
  let toolCall = result.toolCalls?.[0];
  let args: unknown;

  if (toolCall) {
    try {
      args = parsePlanningToolArguments(toolCall.function.arguments);
    } catch {
      // A single bounded repair attempt handles transient malformed tool output.
    }
  }

  if (!toolCall || args === undefined) {
    // Retry with the known builder model as well as stricter instructions. A
    // user-selected model that lacks reliable native tool calling should not
    // make the whole builder unusable.
    const repairModel = DEFAULT_BUILDER_MODEL;
    result = await chatCompletion(
      {
        ...request,
        model: repairModel,
        max_tokens: 4096,
        messages: [
          ...request.messages,
          {
            role: 'system' as const,
            content:
              'Your previous response did not contain a planning tool call with valid JSON arguments. ' +
              'Call exactly one of plan_single_agent or plan_team now. The tool arguments must be one ' +
              'complete JSON object. Do not return the arguments as plain text, Markdown, or a code fence.',
          },
        ],
      },
      { ...options, provider: providerForModel(repairModel) },
    );
    toolCall = result.toolCalls?.[0];
    if (!toolCall) {
      throw new NLParseError('Model did not call a planning tool after one repair attempt');
    }
    try {
      args = parsePlanningToolArguments(toolCall.function.arguments);
    } catch {
      throw new NLParseError(
        'The builder model returned invalid planning data twice. Please retry or choose another model.',
      );
    }
  }

  if (typeof args !== 'object' || args === null) {
    throw new NLParseError('Tool call arguments had unexpected type');
  }

  const obj = args as Record<string, unknown>;

  let plan: AgentCreationPlan;

  if (toolCall.function.name === 'plan_single_agent') {
    const agentRaw = obj.agent as Record<string, unknown> | undefined;
    if (!agentRaw || typeof agentRaw !== 'object') {
      throw new NLParseError('plan_single_agent: missing agent field');
    }
    plan = {
      type: 'single',
      agent: sanitizeAgentSpec(agentRaw, 'My Agent', allowed),
      rationale: String(obj.rationale ?? ''),
    };
  } else if (toolCall.function.name === 'plan_team') {
    const teamRaw = obj.team as Record<string, unknown> | undefined;
    if (!teamRaw || typeof teamRaw !== 'object') {
      throw new NLParseError('plan_team: missing team field');
    }

    const supervisorRaw = teamRaw.supervisor as Record<string, unknown> | undefined;
    if (!supervisorRaw || typeof supervisorRaw !== 'object') {
      throw new NLParseError('plan_team: missing supervisor');
    }

    const workersRaw = (Array.isArray(teamRaw.workers) ? teamRaw.workers : []).filter(
      (w) => w && typeof w === 'object',
    );
    const configRaw = (teamRaw.config ?? {}) as Record<string, unknown>;

    plan = {
      type: 'team',
      rationale: String(obj.rationale ?? ''),
      team: {
        name: String(teamRaw.name ?? 'My Team').slice(0, 120),
        description: String(teamRaw.description ?? '').slice(0, 10000),
        supervisor: sanitizeAgentSpec(supervisorRaw, 'Supervisor', allowed),
        workers: workersRaw.map((w, i) => sanitizeWorkerSpec(w as Record<string, unknown>, i, allowed)),
        config: {
          maxParallelWorkers: typeof configRaw.maxParallelWorkers === 'number' ? configRaw.maxParallelWorkers : 3,
          subtaskTimeoutMs: typeof configRaw.subtaskTimeoutMs === 'number' ? configRaw.subtaskTimeoutMs : 180_000,
          retryPolicy: ['none', 'once', 'twice'].includes(configRaw.retryPolicy as string)
            ? (configRaw.retryPolicy as 'none' | 'once' | 'twice')
            : 'once',
        },
      },
    };
  } else {
    throw new NLParseError(`Unexpected tool name: ${toolCall.function.name}`);
  }

  const jobEnriched = enrichJobApplyPlan(intentText, plan, allowed);
  const competitorEnriched = enrichCompetitorResearchPlan(intentText, jobEnriched, allowed);
  const crmEnriched = enrichCrmPlan(intentText, competitorEnriched, allowed);
  const scheduleEnriched = enrichSchedulePlan(intentText, crmEnriched, allowed);
  // Last: honor cloud-hosted / cloud docs (create_xlsx sandbox) by stripping hybrid-only scopes.
  const cloudEnriched = enrichCloudPreferPlan(intentText, scheduleEnriched, allowed);
  return applyStageKindPacksToPlan(stripScheduleUnlessIntent(intentText, cloudEnriched), allowed);
}

/**
 * Sanitize a model- or API-provided creation plan against org-buildable scopes.
 * Accepts `{ type: 'single'|'team', ... }` or `{ kind: 'single'|'team', ... }`.
 */
export async function sanitizeCreationPlan(
  raw: unknown,
  orgId: string | null,
): Promise<AgentCreationPlan> {
  if (!raw || typeof raw !== 'object') {
    throw new NLParseError('Creation plan must be an object');
  }
  const obj = raw as Record<string, unknown>;
  const kind = String(obj.type ?? obj.kind ?? '');
  const availableScopes = await getBuildableScopes(orgId);
  const allowed = new Set<string>(availableScopes.map((s) => s.id));
  const rationale = String(obj.rationale ?? '');

  if (kind === 'single') {
    const agentRaw = obj.agent;
    if (!agentRaw || typeof agentRaw !== 'object') {
      throw new NLParseError('single plan: missing agent');
    }
    return {
      type: 'single',
      agent: sanitizeAgentSpec(agentRaw, 'Proposed Agent', allowed),
      rationale,
    };
  }

  if (kind === 'team') {
    const teamRaw = (obj.team && typeof obj.team === 'object' ? obj.team : obj) as Record<string, unknown>;
    const supervisorRaw = teamRaw.supervisor;
    if (!supervisorRaw || typeof supervisorRaw !== 'object') {
      throw new NLParseError('team plan: missing supervisor');
    }
    const workersRaw = (Array.isArray(teamRaw.workers) ? teamRaw.workers : []).filter(
      (w) => w && typeof w === 'object',
    );
    const configRaw = (teamRaw.config ?? {}) as Record<string, unknown>;
    return applyStageKindPacksToPlan({
      type: 'team',
      rationale,
      team: {
        name: String(teamRaw.name ?? 'Proposed Team').slice(0, 120),
        description: String(teamRaw.description ?? '').slice(0, 10000),
        supervisor: sanitizeAgentSpec(supervisorRaw, 'Supervisor', allowed),
        workers: workersRaw.map((w, i) => sanitizeWorkerSpec(w, i, allowed)),
        config: {
          maxParallelWorkers:
            typeof configRaw.maxParallelWorkers === 'number' ? configRaw.maxParallelWorkers : 3,
          subtaskTimeoutMs:
            typeof configRaw.subtaskTimeoutMs === 'number' ? configRaw.subtaskTimeoutMs : 180_000,
          retryPolicy: ['none', 'once', 'twice'].includes(configRaw.retryPolicy as string)
            ? (configRaw.retryPolicy as 'none' | 'once' | 'twice')
            : 'once',
        },
      },
    }, allowed);
  }

  throw new NLParseError(`Creation plan kind must be single or team (got "${kind}")`);
}
