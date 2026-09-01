import { BrainQueryService } from '../aiBrain/brainQuery.service.js';
import {
  assertStandardAgentCanQueryBrain,
  BrainNotProvisionedError,
  BrainQueryForbiddenError,
  BrainWrongOrgError,
} from '../aiBrain/agentBrainAccess.js';
import { prisma } from '../lib/prisma.js';

export interface BrainContextCitation {
  collectionId: string;
  collectionName: string;
  documentId: string;
  documentTitle: string;
  chunkOrdinal: number;
  excerpt: string;
}

export interface BrainContextLoad {
  text: string;
  citations: BrainContextCitation[];
  empty: boolean;
  failed: boolean;
}

/** Cheap source stamp so a pack cache misses after Brain ingest, not after every poll. */
export async function brainKnowledgeSourceVersion(orgId: string | null): Promise<string> {
  if (!orgId) return 'none';
  try {
    const latest = await prisma.brainKnowledgeDocument.findFirst({
      where: { orgId },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, updatedAt: true },
    });
    if (!latest) return 'empty';
    return `${latest.id}:${latest.updatedAt.toISOString()}`;
  } catch (error) {
    console.error(
      '[context-pack] brain source version failed',
      error instanceof Error ? error.message : error,
    );
    return `unversioned:${Date.now()}`;
  }
}

/**
 * Retrieve the same agent-budget Brain block the runner used to prepend.
 * Failures are owned by the caller so poll never blocks on Brain.
 */
export async function loadBrainContextForAgentRun(input: {
  agentId: string;
  userId: string;
  orgId: string | null;
  question: string;
  runId?: string;
}): Promise<BrainContextLoad> {
  const empty: BrainContextLoad = { text: '', citations: [], empty: true, failed: false };
  if (!input.orgId || !input.question.trim()) {
    return { ...empty, failed: true };
  }
  try {
    const access = await assertStandardAgentCanQueryBrain(input.agentId, input.orgId);
    const result = await new BrainQueryService().queryBrain({
      userId: input.userId,
      orgId: input.orgId,
      brainAgentId: access.brainAgentId,
      brainModel: access.brainModel,
      question: input.question,
      auditSurface: 'agent_tool',
      callingAgentId: input.agentId,
      contextOnly: true,
      agentContextBudget: true,
      writeAudit: true,
      runId: input.runId,
    });
    const text = typeof result.contextBlock === 'string' ? result.contextBlock.trim() : '';
    const citations = Array.isArray(result.citations) ? result.citations : [];
    return { text, citations, empty: text.length === 0, failed: false };
  } catch (error) {
    if (
      error instanceof BrainQueryForbiddenError
      || error instanceof BrainNotProvisionedError
      || error instanceof BrainWrongOrgError
    ) {
      return { ...empty, failed: true };
    }
    console.error('[context-pack] brain load failed', error instanceof Error ? error.message : error);
    return { ...empty, failed: true };
  }
}
