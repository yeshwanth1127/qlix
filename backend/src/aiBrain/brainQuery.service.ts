import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import {
  chatCompletion,
  LLM_APPLICATION_IDS,
  modelForProvider,
  type LlmProviderId,
} from '../llm/inferenceRouter.js';
import { createEmbedding } from '../llm/providers/embeddingClient.js';
import { appendBrainActionLog, type BrainAuditSurface } from './brainAudit.service.js';
import { DEFAULT_RETRIEVAL_MIN_SCORE } from '../context/scopedRetrieval.js';

const TOP_K = 5;
/**
 * Chunks injected into an agent run's context, as opposed to answered in the console.
 * Chunks are 2000 chars, so 5 of them was ~2.5k tokens prepended to the prompt and
 * re-sent on every round of the tool loop. The top 2 carry nearly all the relevant
 * signal; the rest were mostly padding. Console "Ask" still synthesises over TOP_K.
 */
const AGENT_CONTEXT_TOP_K = Math.max(
  1,
  Number(process.env.QLIX_BRAIN_AGENT_TOP_K || '2'),
);
/** Per-chunk cap for agent context so one huge chunk can't blow the budget. */
const AGENT_CONTEXT_CHUNK_CHARS = Math.max(
  200,
  Number(process.env.QLIX_BRAIN_AGENT_CHUNK_CHARS || '1200'),
);
const BATCH_SIZE = Math.max(200, Number(process.env.BRAIN_QUERY_BATCH_SIZE || '2000'));

/**
 * FAQ-grounded prompt for one-shot synthesis / legacy paths.
 * Interactive console/orb chat uses the cognitive tool loop
 * (`brainAgentLoop.service.ts` + `BRAIN_COGNITIVE_SYSTEM_PROMPT`) instead.
 * Kept server-side, not client-editable.
 */
const BRAIN_SYSTEM_PROMPT = [
  "You are exa — this organization's private knowledge assistant, built on its indexed documents and data.",
  'Answer the question using ONLY the retrieved knowledge chunks below; never rely on outside or prior knowledge.',
  "If the retrieved chunks don't contain the answer, say so plainly instead of guessing.",
  'Cite the chunks you relied on inline using their bracket number, e.g. [1], [2].',
  'Keep answers concise and conversational, as if replying in a chat.',
].join('\n');

function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export interface BrainQueryCitation {
  collectionId: string;
  collectionName: string;
  documentId: string;
  documentTitle: string;
  chunkOrdinal: number;
  excerpt: string;
}

type ScoredChunk = {
  chunk: {
    id: string;
    documentId: string;
    ordinal: number;
    textContent: string;
    document: {
      title: string;
      collectionId: string;
      collection: { name: string };
    };
  };
  score: number;
};

function chunkWhere(
  orgId: string,
  collectionIds?: string[],
  updatedAfter?: Date,
): Prisma.BrainKnowledgeChunkWhereInput {
  const documentFilter: Prisma.BrainKnowledgeDocumentWhereInput = {};
  if (collectionIds && collectionIds.length > 0) {
    documentFilter.collectionId = { in: collectionIds };
  }
  if (updatedAfter) {
    documentFilter.updatedAt = { gte: updatedAfter };
  }
  return {
    orgId,
    embeddingModel: { not: null },
    ...(Object.keys(documentFilter).length > 0 ? { document: documentFilter } : {}),
  };
}

export class BrainQueryService {
  async recordUsagePublic(input: {
    brainAgentId: string;
    userId: string;
    orgId: string;
    model: string;
    provider?: string | null;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    totalCostUsd: number;
  }): Promise<void> {
    const agent = await prisma.agent.findUnique({
      where: { id: input.brainAgentId },
      select: { name: true },
    });
    const agentName = agent?.name?.trim() || input.brainAgentId;
    await prisma.brainUsage.create({
      data: {
        brainAgentId: input.brainAgentId,
        agentKey: input.brainAgentId,
        agentName,
        userId: input.userId,
        orgId: input.orgId,
        model: input.model,
        provider: input.provider ?? null,
        promptTokens: input.promptTokens,
        completionTokens: input.completionTokens,
        totalTokens: input.totalTokens,
        totalCostUsd: input.totalCostUsd,
      },
    });
  }

  private async recordUsage(input: {
    brainAgentId: string;
    userId: string;
    orgId: string;
    model: string;
    provider?: string | null;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    totalCostUsd: number;
  }): Promise<void> {
    await this.recordUsagePublic(input);
  }

  /** Called after ingest — fire-and-forget from ingest handler. */
  async embedAndStoreChunks(orgId: string, documentId: string): Promise<void> {
    const chunks = await prisma.brainKnowledgeChunk.findMany({
      where: { documentId, orgId, embeddingModel: null },
    });

    for (const chunk of chunks) {
      try {
        const result = await createEmbedding(chunk.textContent);
        await prisma.brainKnowledgeChunk.update({
          where: { id: chunk.id },
          data: { embeddingModel: result.model, embeddingVec: result.embedding },
        });
      } catch (err) {
        console.error(`[brainQuery] Failed to embed chunk ${chunk.id}:`, err instanceof Error ? err.message : err);
      }
    }

    await prisma.brainKnowledgeDocument.update({
      where: { id: documentId },
      data: { ingestStatus: 'ready' },
    }).catch(() => {});
  }

  /**
   * Iterates org chunks in batches and keeps global top-K by cosine similarity (memory-bounded vs loading all rows).
   */
  async retrieveTopChunks(input: {
    orgId: string;
    questionEmbedding: number[];
    collectionIds?: string[];
    updatedAfter?: Date;
    topK?: number;
  }): Promise<ScoredChunk[]> {
    const topK = input.topK ?? TOP_K;
    const where = chunkWhere(input.orgId, input.collectionIds, input.updatedAfter);
    let top: ScoredChunk[] = [];
    let skip = 0;

    for (;;) {
      const batch = await prisma.brainKnowledgeChunk.findMany({
        where,
        skip,
        take: BATCH_SIZE,
        orderBy: { id: 'asc' },
        select: {
          id: true,
          documentId: true,
          ordinal: true,
          textContent: true,
          embeddingVec: true,
          document: {
            select: {
              title: true,
              collectionId: true,
              collection: { select: { name: true } },
            },
          },
        },
      });
      if (batch.length === 0) break;

      for (const row of batch) {
        const vec = row.embeddingVec;
        if (!Array.isArray(vec)) continue;
        const score = cosineSimilarity(input.questionEmbedding, vec as number[]);
        const chunk = {
          id: row.id,
          documentId: row.documentId,
          ordinal: row.ordinal,
          textContent: row.textContent,
          document: row.document,
        };
        top.push({ chunk, score });
        top.sort((a, b) => b.score - a.score);
        if (top.length > topK) top = top.slice(0, topK);
      }
      skip += batch.length;
    }

    return top;
  }

  buildContextBlocks(scored: ScoredChunk[]): string[] {
    return scored.map((s, i) => {
      const doc = s.chunk.document;
      const col = doc.collection;
      return `[${i + 1}] Collection: "${col.name}" | Document: "${doc.title}" | documentId: ${s.chunk.documentId}\n${s.chunk.textContent}`;
    });
  }

  toCitations(scored: ScoredChunk[]): BrainQueryCitation[] {
    return scored.map((s) => ({
      collectionId: s.chunk.document.collectionId,
      collectionName: s.chunk.document.collection.name,
      documentId: s.chunk.documentId,
      documentTitle: s.chunk.document.title,
      chunkOrdinal: s.chunk.ordinal,
      excerpt: s.chunk.textContent.slice(0, 400),
    }));
  }

  async queryBrain(input: {
    userId: string;
    orgId: string;
    brainAgentId: string;
    brainModel: string;
    question: string;
    collectionIds?: string[];
    auditSurface?: BrainAuditSurface;
    callingAgentId?: string;
    /** When true, skip final LLM synthesis — only retrieve and return structured context + empty answer. */
    contextOnly?: boolean;
    /**
     * When contextOnly, apply the tighter agent-run prompt budget (top-K + char trim).
     * Console / cognitive `knowledge_search` should pass false so Exa sees full TOP_K chunks.
     * Defaults to true for backward compatibility with agent runners.
     */
    agentContextBudget?: boolean;
    /** Override retrieval top-K (defaults to TOP_K, or AGENT_CONTEXT_TOP_K when agentContextBudget). */
    topK?: number;
    /** When false, skip appendBrainActionLog (caller logs separately). */
    writeAudit?: boolean;
    /** Drop cosine hits below this after org/collection/time filters. */
    minScore?: number;
    updatedAfter?: Date;
    /** AgentRun that triggered this retrieval so Layer 5 can join Brain to the same trace. */
    runId?: string;
  }): Promise<{ answer: string; citations: BrainQueryCitation[]; contextBlock?: string }> {
    const queryResult = await createEmbedding(input.question);
    const embeddingPromptTokens = Number(queryResult.usage?.prompt_tokens) || 0;
    const embeddingTotalTokens = Number(queryResult.usage?.total_tokens) || embeddingPromptTokens;
    const embeddingCost = Number(queryResult.usage?.total_cost ?? queryResult.usage?.cost) || 0;
    const scored = await this.retrieveTopChunks({
      orgId: input.orgId,
      questionEmbedding: queryResult.embedding,
      collectionIds: input.collectionIds,
      updatedAfter: input.updatedAfter,
      topK: input.topK ?? TOP_K,
    });
    const applyAgentBudget = input.contextOnly && input.agentContextBudget !== false;
    const minScore = input.minScore ?? (applyAgentBudget ? DEFAULT_RETRIEVAL_MIN_SCORE : 0);
    const relevant = minScore > 0 ? scored.filter((item) => item.score >= minScore) : scored;

    if (scored.length === 0 || relevant.length === 0) {
      const any = await prisma.brainKnowledgeChunk.count({
        where: chunkWhere(input.orgId, input.collectionIds, input.updatedAfter),
      });
      if (scored.length === 0 && any === 0) {
        await this.recordUsage({
          brainAgentId: input.brainAgentId,
          userId: input.userId,
          orgId: input.orgId,
          model: queryResult.model,
          promptTokens: embeddingPromptTokens,
          completionTokens: 0,
          totalTokens: embeddingTotalTokens,
          totalCostUsd: embeddingCost,
        });
        return {
          answer:
            'No embedded knowledge found. Ingest documents first — embeddings process in the background after ingest.',
          citations: [],
          contextBlock: '',
        };
      }
      await this.recordUsage({
        brainAgentId: input.brainAgentId,
        userId: input.userId,
        orgId: input.orgId,
        model: queryResult.model,
        promptTokens: embeddingPromptTokens,
        completionTokens: 0,
        totalTokens: embeddingTotalTokens,
        totalCostUsd: embeddingCost,
      });
      return {
        answer: 'No relevant knowledge found for your question.',
        citations: [],
        contextBlock: '',
      };
    }

    const contextBlocks = this.buildContextBlocks(relevant);
    const contextBlock = contextBlocks.join('\n\n---\n\n');
    const citations = this.toCitations(relevant);
    const provider: LlmProviderId = input.brainModel.toLowerCase().startsWith('exora/')
      ? 'exora'
      : 'openrouter';
    const model = modelForProvider(input.brainModel, provider);

    if (input.contextOnly) {
      const injected = applyAgentBudget
        ? relevant.slice(0, AGENT_CONTEXT_TOP_K).map((s) => ({
            ...s,
            chunk: {
              ...s.chunk,
              textContent:
                s.chunk.textContent.length > AGENT_CONTEXT_CHUNK_CHARS
                  ? `${s.chunk.textContent.slice(0, AGENT_CONTEXT_CHUNK_CHARS)}…`
                  : s.chunk.textContent,
            },
          }))
        : relevant;
      const injectedBlock = this.buildContextBlocks(injected).join('\n\n---\n\n');
      await this.recordUsage({
        brainAgentId: input.brainAgentId,
        userId: input.userId,
        orgId: input.orgId,
        model: queryResult.model,
        promptTokens: embeddingPromptTokens,
        completionTokens: 0,
        totalTokens: embeddingTotalTokens,
        totalCostUsd: embeddingCost,
      });
      if (input.writeAudit !== false) {
        await appendBrainActionLog({
          brainAgentId: input.brainAgentId,
          userId: input.userId,
          actionType: 'brain.query',
          payload: {
            description: `Brain retrieval (context-only): "${input.question.slice(0, 100)}"`,
            chunksRetrieved: scored.length,
            chunksInjected: injected.length,
            chunksDroppedBelowThreshold: Math.max(0, scored.length - relevant.length),
            minScore,
            contextOnly: true,
            agentContextBudget: applyAgentBudget,
            ...(input.runId ? { runId: input.runId } : {}),
          },
          status: 'success',
          riskLevel: 'low',
          auditSurface: input.auditSurface ?? 'console',
          callingAgentId: input.callingAgentId,
        });
      }
      return {
        answer: '',
        citations,
        contextBlock: injectedBlock,
      };
    }

    const systemPrompt = [BRAIN_SYSTEM_PROMPT, '', 'Retrieved context:', contextBlock].join('\n');

    const llmResult = await chatCompletion(
      {
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: input.question },
        ],
        temperature: 0.2,
        max_tokens: 1024,
        stream: false,
      },
      {
        provider,
        applicationId: LLM_APPLICATION_IDS.aiBrain,
      },
    );

    const completionPromptTokens = Number(llmResult.usage?.prompt_tokens) || 0;
    const completionTokens = Number(llmResult.usage?.completion_tokens) || 0;
    const completionTotalTokens =
      Number(llmResult.usage?.total_tokens) || completionPromptTokens + completionTokens;
    const completionCost = Number(llmResult.usage?.total_cost ?? llmResult.usage?.cost) || 0;
    await this.recordUsage({
      brainAgentId: input.brainAgentId,
      userId: input.userId,
      orgId: input.orgId,
      model,
      provider: llmResult.provider,
      promptTokens: embeddingPromptTokens + completionPromptTokens,
      completionTokens,
      totalTokens: embeddingTotalTokens + completionTotalTokens,
      totalCostUsd: embeddingCost + completionCost,
    });

    if (input.writeAudit !== false) {
      await appendBrainActionLog({
        brainAgentId: input.brainAgentId,
        userId: input.userId,
        actionType: 'brain.query',
        payload: {
          description: `Queried brain: "${input.question.slice(0, 100)}"`,
          chunksRetrieved: scored.length,
          model,
          contextOnly: false,
          ...(input.runId ? { runId: input.runId } : {}),
        },
        status: 'success',
        riskLevel: 'low',
        auditSurface: input.auditSurface ?? 'console',
        callingAgentId: input.callingAgentId,
      });
    }

    return { answer: llmResult.content, citations, contextBlock };
  }
}
