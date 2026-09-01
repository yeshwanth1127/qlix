import { BrainQueryService } from '../aiBrain/brainQuery.service.js';
import {
  assertStandardAgentCanQueryBrain,
} from '../aiBrain/agentBrainAccess.js';
import { prisma } from '../lib/prisma.js';
import { formatContextRef } from './contextPlane.service.js';
import {
  lexicalOverlapScore,
  normalizeRetrievalQuery,
  rankRetrievalHits,
  type RetrievalCandidate,
  type RetrievalHit,
  type RetrievalQuery,
  type RetrievalSource,
} from './scopedRetrieval.js';

const OBJECT_SCAN_LIMIT = 200;
const OBJECT_KINDS = ['memory', 'knowledge', 'team_result'];
const BRAIN_SEARCH_SCORE = 0.45;

export interface SearchScopedContextInput {
  orgId: string;
  agentId: string;
  userId: string;
  grantedScopes: readonly string[];
  task: string;
  allowedSources?: readonly string[];
  collectionIds?: readonly string[];
  updatedAfter?: Date | null;
  maxItems?: number;
  maxTokens?: number;
}

function objectText(content: unknown, summary: unknown): string {
  if (typeof content === 'string') return content;
  if (content && typeof content === 'object' && !Array.isArray(content)) {
    const record = content as Record<string, unknown>;
    if (typeof record.text === 'string' && record.text.trim()) return record.text;
  }
  const parts = [summary, content].map((value) => {
    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  });
  return parts.join(' ').slice(0, 8_000);
}

function objectTitle(kind: string, summary: unknown, sourceId: string | null): string {
  if (summary && typeof summary === 'object' && !Array.isArray(summary)) {
    const record = summary as Record<string, unknown>;
    for (const key of ['agentName', 'role', 'preview']) {
      const value = record[key];
      if (typeof value === 'string' && value.trim()) return value.slice(0, 120);
    }
  }
  return sourceId ? `${kind}:${sourceId}` : kind;
}

async function loadBrainCandidates(input: SearchScopedContextInput): Promise<RetrievalCandidate[]> {
  if (!input.grantedScopes.includes('brain.query')) return [];
  try {
    const access = await assertStandardAgentCanQueryBrain(input.agentId, input.orgId);
    const result = await new BrainQueryService().queryBrain({
      userId: input.userId,
      orgId: input.orgId,
      brainAgentId: access.brainAgentId,
      brainModel: access.brainModel,
      question: input.task,
      collectionIds: input.collectionIds ? [...input.collectionIds] : undefined,
      updatedAfter: input.updatedAfter ?? undefined,
      auditSurface: 'agent_tool',
      callingAgentId: input.agentId,
      contextOnly: true,
      agentContextBudget: true,
      writeAudit: true,
    });
    return (result.citations ?? []).map((citation, index) => ({
      source: 'brain' as const,
      id: `${citation.documentId}:${citation.chunkOrdinal}:${index}`,
      orgId: input.orgId,
      allowedAgentIds: [],
      collectionId: citation.collectionId,
      title: citation.documentTitle,
      text: citation.excerpt,
      score: Math.max(BRAIN_SEARCH_SCORE, 1 - index * 0.05),
    }));
  } catch {
    return [];
  }
}

async function loadObjectCandidates(query: RetrievalQuery): Promise<RetrievalCandidate[]> {
  const rows = await prisma.contextObject.findMany({
    where: {
      orgId: query.orgId,
      kind: { in: [...OBJECT_KINDS] },
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      ...(query.updatedAfter ? { createdAt: { gte: query.updatedAfter } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: OBJECT_SCAN_LIMIT,
  });
  return rows.map((row) => {
    const text = objectText(row.content, row.summary);
    return {
      source: 'context_object' as const,
      id: row.id,
      orgId: row.orgId,
      allowedAgentIds: row.allowedAgentIds,
      readScopes: row.readScopes,
      title: objectTitle(row.kind, row.summary, row.sourceId),
      text,
      score: lexicalOverlapScore(query.task, text),
      ref: formatContextRef(row.id, row.version, row.contentHash),
    };
  });
}

/**
 * Tenant/principal/source filters first, then Brain cosine or lexical rank.
 * Brain usage is recorded only when `brain` is an allowed source and `brain.query` is granted.
 */
export async function searchScopedContext(input: SearchScopedContextInput): Promise<{
  hits: RetrievalHit[];
  droppedBelowThreshold: number;
  outOfScope: number;
  sources: RetrievalSource[];
}> {
  const canBrain = input.grantedScopes.includes('brain.query');
  const requested = (input.allowedSources ?? ['brain', 'context_object'])
    .filter((source): source is RetrievalSource => source === 'brain' || source === 'context_object');
  const allowedSources = requested.filter((source) => source !== 'brain' || canBrain);
  const query = normalizeRetrievalQuery({
    orgId: input.orgId,
    agentId: input.agentId,
    grantedScopes: input.grantedScopes,
    allowedSources,
    task: input.task,
    collectionIds: input.collectionIds,
    updatedAfter: input.updatedAfter,
    maxItems: input.maxItems,
    maxTokens: input.maxTokens,
  });

  const candidates: RetrievalCandidate[] = [];
  if (query.allowedSources.includes('context_object')) {
    candidates.push(...await loadObjectCandidates(query));
  }
  if (query.allowedSources.includes('brain') && canBrain) {
    candidates.push(...await loadBrainCandidates(input));
  }

  const ranked = rankRetrievalHits(candidates, query);
  return {
    hits: ranked.hits,
    droppedBelowThreshold: ranked.droppedBelowThreshold,
    outOfScope: ranked.outOfScope,
    sources: [...query.allowedSources] as RetrievalSource[],
  };
}
