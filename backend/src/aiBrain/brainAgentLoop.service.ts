import {
  chatCompletion,
  LLM_APPLICATION_IDS,
  modelForProvider,
  type LlmProviderId,
} from '../llm/inferenceRouter.js';
import type { InferenceToolCall } from '../llm/providers/types.js';
import { BrainQueryService, type BrainQueryCitation, type BrainDocumentRetrievalFilter } from './brainQuery.service.js';
import { appendBrainActionLog, type BrainActionType } from './brainAudit.service.js';
import {
  BRAIN_COGNITIVE_SYSTEM_PROMPT,
  BRAIN_TOOL_DEFINITIONS,
  executeBrainTool,
  type BrainToolContext,
} from './brainTools.js';
import { BrainProposalService, type BrainProposalDTO } from './brainProposal.service.js';

const MAX_ROUNDS = 6;
const HISTORY_TURNS = 12;

/** Heuristic: force a knowledge tool when auto-retrieval missed but the user asked about docs. */
function looksLikeKnowledgeQuestion(question: string): boolean {
  const s = question.toLowerCase();
  return /\b(doc|docs|document|documents|knowledge|policy|policies|handbook|upload|uploaded|faq|ingest|collection|summar|summary|what(?:'s| is| are).{0,40}\babout|read (?:the |my )?doc|find|search)\b/.test(
    s,
  );
}

type LoopMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: InferenceToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface BrainAgentLoopResult {
  answer: string;
  citations: BrainQueryCitation[];
  proposal: BrainProposalDTO | null;
}

export class BrainAgentLoopService {
  constructor(
    private readonly queryService = new BrainQueryService(),
    private readonly proposals = new BrainProposalService(),
  ) {}

  async run(input: {
    userId: string;
    orgId: string;
    brainAgentId: string;
    brainModel: string;
    question: string;
    conversationId?: string | null;
    history?: readonly { role: string; content: string }[];
    retrievalFilter?: BrainDocumentRetrievalFilter;
    systemPromptAppend?: string;
    extraTools?: ReadonlyArray<{
      type: 'function';
      function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
      };
    }>;
    toolContext?: Partial<BrainToolContext>;
    auditActionType?: BrainActionType;
  }): Promise<BrainAgentLoopResult> {
    const provider: LlmProviderId = input.brainModel.toLowerCase().startsWith('exora/')
      ? 'exora'
      : 'openrouter';
    const model = modelForProvider(input.brainModel, provider);

    const messages: LoopMessage[] = [{
      role: 'system',
      content: input.systemPromptAppend
        ? `${BRAIN_COGNITIVE_SYSTEM_PROMPT}\n\n${input.systemPromptAppend}`
        : BRAIN_COGNITIVE_SYSTEM_PROMPT,
    }];

    const history = (input.history ?? []).slice(-HISTORY_TURNS);
    for (const turn of history) {
      if (turn.role === 'user') {
        messages.push({ role: 'user', content: turn.content });
      } else if (turn.role === 'brain' || turn.role === 'assistant') {
        messages.push({ role: 'assistant', content: turn.content });
      }
    }

    // Always retrieve knowledge for this turn. Models often skip knowledge_search under
    // tool_choice=auto and then falsely claim they cannot access uploaded docs.
    const citations: BrainQueryCitation[] = [];
    let autoRetrieved = false;
    try {
      const primed = await this.queryService.queryBrain({
        userId: input.userId,
        orgId: input.orgId,
        brainAgentId: input.brainAgentId,
        brainModel: input.brainModel,
        question: input.question,
        contextOnly: true,
        agentContextBudget: false,
        writeAudit: false,
        retrievalFilter: input.retrievalFilter,
      });
      if (primed.citations.length > 0 && primed.contextBlock?.trim()) {
        autoRetrieved = true;
        for (const c of primed.citations) {
          citations.push(c);
        }
        messages.push({
          role: 'system',
          content: [
            'Retrieved knowledge for this user message (already searched — answer from this when relevant; cite with [n]):',
            primed.contextBlock,
          ].join('\n\n'),
        });
      } else {
        messages.push({
          role: 'system',
          content:
            primed.answer?.trim() ||
            'Retrieved knowledge: no matching chunks for this message. You may still call list_knowledge or knowledge_search with a different query.',
        });
      }
    } catch (err) {
      console.error(
        '[brainAgentLoop] auto knowledge retrieve failed:',
        err instanceof Error ? err.message : err,
      );
      messages.push({
        role: 'system',
        content:
          'Automatic knowledge retrieval failed for this turn. Call knowledge_search or list_knowledge before answering document questions.',
      });
    }

    messages.push({ role: 'user', content: input.question });

    let latestProposal: BrainProposalDTO | null = null;
    let promptTokens = 0;
    let completionTokens = 0;
    let totalCost = 0;
    let finalAnswer = '';

    const tools = [...BRAIN_TOOL_DEFINITIONS, ...(input.extraTools ?? [])];

    for (let round = 0; round < MAX_ROUNDS; round++) {
      const llmResult = await chatCompletion(
        {
          model,
          messages: messages as unknown as Parameters<typeof chatCompletion>[0]['messages'],
          temperature: 0.3,
          max_tokens: 2048,
          stream: false,
          tools,
          tool_choice:
            round === 0 && !autoRetrieved && looksLikeKnowledgeQuestion(input.question)
              ? 'required'
              : 'auto',
        },
        {
          provider,
          applicationId: LLM_APPLICATION_IDS.aiBrain,
        },
      );

      promptTokens += Number(llmResult.usage?.prompt_tokens) || 0;
      completionTokens += Number(llmResult.usage?.completion_tokens) || 0;
      totalCost += Number(llmResult.usage?.total_cost ?? llmResult.usage?.cost) || 0;

      const toolCalls = llmResult.toolCalls;
      if (!toolCalls?.length) {
        finalAnswer = (llmResult.content || '').trim();
        break;
      }

      messages.push({
        role: 'assistant',
        content: llmResult.content || null,
        tool_calls: toolCalls,
      });

      for (const call of toolCalls) {
        try {
          const toolResult = await executeBrainTool(call.function.name, call.function.arguments, {
            userId: input.userId,
            orgId: input.orgId,
            brainAgentId: input.brainAgentId,
            conversationId: input.conversationId,
            queryService: this.queryService,
            proposals: this.proposals,
            retrievalFilter: input.retrievalFilter,
            ...input.toolContext,
          });
          if (toolResult.citations?.length) {
            for (const c of toolResult.citations) {
              const key = `${c.documentId}:${c.chunkOrdinal}`;
              if (!citations.some((x) => `${x.documentId}:${x.chunkOrdinal}` === key)) {
                citations.push(c);
              }
            }
          }
          if (toolResult.proposal) latestProposal = toolResult.proposal;
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: toolResult.content,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Tool failed';
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify({ error: message }),
          });
        }
      }
    }

    if (!finalAnswer) {
      finalAnswer = latestProposal
        ? 'I drafted an agent plan for you. Review the proposal card and confirm to create — nothing has been deployed yet.'
        : 'I could not finish that request. Try again with a clearer question.';
    }

    await this.queryService.recordUsagePublic({
      brainAgentId: input.brainAgentId,
      userId: input.userId,
      orgId: input.orgId,
      model,
      provider,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      totalCostUsd: totalCost,
    });

    await appendBrainActionLog({
      brainAgentId: input.brainAgentId,
      userId: input.userId,
      actionType: input.auditActionType ?? 'brain.query',
      payload: {
        description: `Cognitive query: "${input.question.slice(0, 100)}"`,
        model,
        proposalId: latestProposal?.id ?? null,
        citations: citations.length,
        toolLoop: true,
        autoRetrieved,
      },
      status: 'success',
      riskLevel: latestProposal ? 'medium' : 'low',
    });

    return { answer: finalAnswer, citations, proposal: latestProposal };
  }
}
