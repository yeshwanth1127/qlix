import { randomUUID } from 'node:crypto';
import {
  CONTEXT_PACK_CONTRACT_VERSION,
  estimateContextTokens,
  extractContextRefs,
  parseContextPack,
  type ContextPack,
  type ContextPackComponent,
  type ContextPackReference,
} from './contextContracts.js';
import { createContextObject } from './contextPlane.service.js';
import {
  formatRetrievalHitsForPack,
  normalizeRetrievalQuery,
  rankRetrievalHits,
  type RetrievalCandidate,
} from './scopedRetrieval.js';

export const DEFAULT_MAX_INLINE_TOKENS = 2_500;
export const DEFAULT_MAX_REFERENCES = 20;
const MAX_TASK_TOKENS = 8_000;
const MEMORY_INLINE_BUDGET_TOKENS = 1_200;
const BRAIN_INLINE_BUDGET_TOKENS = 600;
const COMPACT_MEMORY_CHARS = 800;
const COMPACT_BRAIN_CHARS = 800;

export interface CompileContextPackInput {
  orgId?: string | null;
  agentId?: string | null;
  runId: string;
  goal: string;
  taskText: string;
  memoryText?: string | null;
  brainText?: string | null;
  /** True when this dispatch requested Brain and the Resolver already retrieved it. */
  brainOwned?: boolean;
  brainCitations?: unknown;
  priorResultRefs?: Array<{ ref: string; summary: string }>;
  sources?: string[];
  grantedScopes?: readonly string[];
  /** Already-loaded candidates; ranked only after deterministic ACL/source/time filters. */
  retrievalCandidates?: RetrievalCandidate[];
  maxInlineTokens?: number;
  maxReferences?: number;
}

function compactText(text: string, maxChars: number, kind: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  const head = trimmed.slice(0, maxChars).replace(/\s+\S*$/, '').trim();
  return `${head}… [full ${kind} available via context_get]`;
}

function pushInline(
  inline: ContextPackComponent[],
  component: string,
  text: string,
  remaining: { tokens: number },
  hardCap = remaining.tokens,
): void {
  const clipped = text.trim();
  if (!clipped) return;
  const tokens = Math.min(estimateContextTokens(clipped), hardCap);
  if (tokens <= 0) return;
  inline.push({ component, tokens, text: clipped });
  remaining.tokens = Math.max(0, remaining.tokens - tokens);
}

/** Deterministic Context Pack for one AgentRun or Team dispatch. */
export async function compileContextPack(input: CompileContextPackInput): Promise<ContextPack> {
  const maxInlineTokens = Math.max(400, input.maxInlineTokens ?? DEFAULT_MAX_INLINE_TOKENS);
  const maxReferences = Math.max(1, input.maxReferences ?? DEFAULT_MAX_REFERENCES);
  const remaining = { tokens: maxInlineTokens };
  const inline: ContextPackComponent[] = [];
  const references: ContextPackReference[] = [];
  const omitted: Array<{ component: string; reason: string }> = [
    { component: 'full_transcript', reason: 'not required by dispatch' },
  ];

  const taskText = input.taskText.trim();
  if (taskText) {
    const taskTokens = Math.min(estimateContextTokens(taskText), MAX_TASK_TOKENS);
    inline.push({ component: 'task', tokens: taskTokens, text: taskText.slice(0, MAX_TASK_TOKENS * 4) });
  }

  const memoryText = input.memoryText?.trim() || '';
  if (memoryText) {
    const memoryTokens = estimateContextTokens(memoryText);
    const memoryBudget = Math.min(MEMORY_INLINE_BUDGET_TOKENS, remaining.tokens);
    if (memoryTokens <= memoryBudget) {
      pushInline(inline, 'memory', memoryText, remaining, memoryBudget);
    } else {
      const summary = compactText(memoryText, COMPACT_MEMORY_CHARS, 'memory');
      pushInline(inline, 'memory_summary', summary, remaining, memoryBudget);
      if (input.orgId && input.agentId) {
        const stored = await createContextObject({
          orgId: input.orgId,
          kind: 'memory',
          sourceType: 'agent_memory',
          sourceId: input.runId,
          content: { text: memoryText },
          summary: { chars: memoryText.length, preview: summary.slice(0, 320) },
          metadata: { agentId: input.agentId, runId: input.runId },
          allowedAgentIds: [input.agentId],
        });
        references.push({
          ref: stored.ref,
          component: 'memory',
          summary: `Durable memory (${memoryText.length} chars)`,
          tokens: estimateContextTokens(summary),
        });
      } else {
        omitted.push({ component: 'memory', reason: 'exceeded inline budget and could not persist a reference' });
      }
    }
  } else {
    omitted.push({ component: 'memory', reason: 'no durable memory for this dispatch' });
  }

  const prior = (input.priorResultRefs ?? []).slice(0, maxReferences);
  for (const item of prior) {
    if (!item.ref.startsWith('ctx:')) continue;
    references.push({
      ref: item.ref,
      component: 'prior_result',
      summary: item.summary.replace(/\s+/g, ' ').trim().slice(0, 320),
      tokens: 0,
    });
  }

  const discovered = extractContextRefs(taskText)
    .filter((ref) => !references.some((item) => item.ref === ref))
    .slice(0, Math.max(0, maxReferences - references.length));
  for (const ref of discovered) {
    references.push({
      ref,
      component: 'prior_result',
      summary: 'Context reference from dispatch',
      tokens: 0,
    });
  }

  if (input.brainOwned) {
    const brainText = input.brainText?.trim() || '';
    if (!brainText) {
      omitted.push({ component: 'brain', reason: 'owned_empty' });
    } else {
      const brainTokens = estimateContextTokens(brainText);
      const brainBudget = Math.min(BRAIN_INLINE_BUDGET_TOKENS, remaining.tokens);
      const citations = input.brainCitations;
      if (brainTokens <= brainBudget) {
        inline.push({
          component: 'brain',
          tokens: brainTokens,
          text: brainText,
          ...(citations !== undefined ? { data: { citations } } : {}),
        });
        remaining.tokens = Math.max(0, remaining.tokens - brainTokens);
      } else {
        const summary = compactText(brainText, COMPACT_BRAIN_CHARS, 'brain');
        pushInline(inline, 'brain_summary', summary, remaining, brainBudget);
        if (input.orgId && input.agentId) {
          const stored = await createContextObject({
            orgId: input.orgId,
            kind: 'knowledge',
            sourceType: 'brain_context',
            sourceId: input.runId,
            content: { text: brainText, citations: citations ?? [] },
            summary: { chars: brainText.length, preview: summary.slice(0, 320) },
            metadata: { agentId: input.agentId, runId: input.runId },
            allowedAgentIds: [input.agentId],
          });
          references.push({
            ref: stored.ref,
            component: 'brain',
            summary: `Org Brain (${brainText.length} chars)`,
            tokens: estimateContextTokens(summary),
          });
        } else {
          omitted.push({ component: 'brain', reason: 'owned_exceeded_budget' });
        }
      }
    }
  } else if (!input.sources?.includes('run.brain')) {
    omitted.push({ component: 'brain', reason: 'not enabled for this dispatch; runner may prepend if useBrain' });
  } else {
    omitted.push({ component: 'brain', reason: 'runner_fallback' });
  }

  if (input.retrievalCandidates && input.retrievalCandidates.length > 0 && input.orgId && input.agentId) {
    const retrievalQuery = normalizeRetrievalQuery({
      orgId: input.orgId,
      agentId: input.agentId,
      grantedScopes: input.grantedScopes ?? [],
      allowedSources: ['brain', 'context_object'],
      task: input.taskText,
      maxTokens: remaining.tokens,
    });
    const ranked = rankRetrievalHits(input.retrievalCandidates, retrievalQuery);
    const packed = formatRetrievalHitsForPack(ranked.hits);
    if (packed) {
      pushInline(inline, 'retrieval', packed, remaining);
      for (const hit of ranked.hits) {
        if (!hit.ref || references.some((item) => item.ref === hit.ref)) continue;
        if (references.length >= maxReferences) break;
        references.push({
          ref: hit.ref,
          component: 'retrieval',
          summary: hit.title.slice(0, 320),
          tokens: 0,
        });
      }
    }
    if (ranked.outOfScope > 0 || ranked.droppedBelowThreshold > 0) {
      omitted.push({
        component: 'retrieval',
        reason: 'additional in-scope hits omitted; use context_search',
      });
    }
  } else {
    omitted.push({
      component: 'retrieval',
      reason: 'not requested for this dispatch; use context_search when in scope',
    });
  }

  const pack = parseContextPack({
    contractVersion: CONTEXT_PACK_CONTRACT_VERSION,
    packId: `ctxpack_${input.runId}_${randomUUID().slice(0, 8)}`,
    snapshotVersion: 1,
    goal: input.goal.slice(0, 2_000),
    inline,
    references,
    omitted,
    estimatedTokens: inline.reduce((sum, item) => sum + item.tokens, 0),
  });
  return pack;
}

export function contextPackComponentTokens(pack: ContextPack): Record<string, number> {
  const tokens: Record<string, number> = {};
  for (const item of pack.inline) {
    tokens[item.component] = (tokens[item.component] ?? 0) + item.tokens;
  }
  return tokens;
}
