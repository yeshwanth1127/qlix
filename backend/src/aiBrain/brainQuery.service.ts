import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { openRouterChatCompletion, openrouterEmbeddings } from '../llm/openrouterClient.js';
import { normalizeQlixInferenceModelId } from '../llm/modelPolicy.js';
import { appendBrainActionLog, type BrainAuditSurface } from './brainAudit.service.js';

const EMBEDDING_MODEL = 'openai/text-embedding-3-small';
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
 * Default system prompt for every brain query (console "Ask" tab, orb chat widget,
 * and agent-to-agent brain access all funnel through queryBrain below).
 * Kept server-side, not client-editable, so it can't be overridden from the UI.
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
): Prisma.BrainKnowledgeChunkWhereInput {
  const base: Prisma.BrainKnowledgeChunkWhereInput = {
    orgId,
    embeddingModel: { not: null },
  };
  if (collectionIds && collectionIds.length > 0) {
    base.document = { collectionId: { in: collectionIds } };
  }
  return base;
}

export class BrainQueryService {
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
    await prisma.brainUsage.create({
      data: {
        brainAgentId: input.brainAgentId,
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

  /** Called after ingest — fire-and-forget from ingest handler. */
  async embedAndStoreChunks(orgId: string, documentId: string): Promise<void> {
    const chunks = await prisma.brainKnowledgeChunk.findMany({
      where: { documentId, orgId, embeddingModel: null },
    });

    for (const chunk of chunks) {
      try {
        const result = await openrouterEmbeddings(chunk.textContent, EMBEDDING_MODEL);
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
    topK?: number;
  }): Promise<ScoredChunk[]> {
    const topK = input.topK ?? TOP_K;
    const where = chunkWhere(input.orgId, input.collectionIds);
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
      return `[${i + 1}] Collection: "${col.name}" | Document: "${doc.title}"\n${s.chunk.textContent}`;
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
    /** When false, skip appendBrainActionLog (caller logs separately). */
    writeAudit?: boolean;
  }): Promise<{ answer: string; citations: BrainQueryCitation[]; contextBlock?: string }> {
    const queryResult = await openrouterEmbeddings(input.question, EMBEDDING_MODEL);
    const embeddingPromptTokens = Number(queryResult.usage?.prompt_tokens) || 0;
    const embeddingTotalTokens = Number(queryResult.usage?.total_tokens) || embeddingPromptTokens;
    const embeddingCost = Number(queryResult.usage?.total_cost ?? queryResult.usage?.cost) || 0;
    const scored = await this.retrieveTopChunks({
      orgId: input.orgId,
      questionEmbedding: queryResult.embedding,
      collectionIds: input.collectionIds,
    });

    if (scored.length === 0) {
      const any = await prisma.brainKnowledgeChunk.count({
        where: chunkWhere(input.orgId, input.collectionIds),
      });
      if (any === 0) {
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

    const contextBlocks = this.buildContextBlocks(scored);
    const contextBlock = contextBlocks.join('\n\n---\n\n');
    const citations = this.toCitations(scored);
    const model = normalizeQlixInferenceModelId(input.brainModel);

    if (input.contextOnly) {
      // Agent-run context: trim to the strongest few chunks. The full citation list is
      // still returned (and audited) so the UI and audit trail are unchanged — only
      // what gets prepended to the model's prompt shrinks.
      const trimmed = scored.slice(0, AGENT_CONTEXT_TOP_K).map((s) => ({
        ...s,
        chunk: {
          ...s.chunk,
          textContent:
            s.chunk.textContent.length > AGENT_CONTEXT_CHUNK_CHARS
              ? `${s.chunk.textContent.slice(0, AGENT_CONTEXT_CHUNK_CHARS)}…`
              : s.chunk.textContent,
        },
      }));
      const agentContextBlock = this.buildContextBlocks(trimmed).join('\n\n---\n\n');
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
            chunksInjected: trimmed.length,
            contextOnly: true,
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
        contextBlock: agentContextBlock,
      };
    }

    const systemPrompt = [BRAIN_SYSTEM_PROMPT, '', 'Retrieved context:', contextBlock].join('\n');

    const llmResult = await openRouterChatCompletion({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: input.question },
      ],
      temperature: 0.2,
      max_tokens: 1024,
      stream: false,
    });

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
