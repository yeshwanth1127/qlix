import {
  chatCompletion,
  LLM_APPLICATION_IDS,
  modelForProvider,
  type LlmProviderId,
} from '../llm/inferenceRouter.js';
import type { InferenceToolCall } from '../llm/providers/types.js';
import { BrainQueryService, type BrainQueryCitation } from './brainQuery.service.js';
import { appendBrainActionLog } from './brainAudit.service.js';
import {
  BRAIN_COGNITIVE_SYSTEM_PROMPT,
  BRAIN_TOOL_DEFINITIONS,
  executeBrainTool,
} from './brainTools.js';
import { BrainProposalService, type BrainProposalDTO } from './brainProposal.service.js';

const MAX_ROUNDS = 6;
const HISTORY_TURNS = 12;

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
  }): Promise<BrainAgentLoopResult> {
    const provider: LlmProviderId = input.brainModel.toLowerCase().startsWith('exora/')
      ? 'exora'
      : 'openrouter';
    const model = modelForProvider(input.brainModel, provider);

    const messages: LoopMessage[] = [{ role: 'system', content: BRAIN_COGNITIVE_SYSTEM_PROMPT }];

    const history = (input.history ?? []).slice(-HISTORY_TURNS);
    for (const turn of history) {
      if (turn.role === 'user') {
        messages.push({ role: 'user', content: turn.content });
      } else if (turn.role === 'brain' || turn.role === 'assistant') {
        messages.push({ role: 'assistant', content: turn.content });
      }
    }
    messages.push({ role: 'user', content: input.question });

    const citations: BrainQueryCitation[] = [];
    let latestProposal: BrainProposalDTO | null = null;
    let promptTokens = 0;
    let completionTokens = 0;
    let totalCost = 0;
    let finalAnswer = '';

    for (let round = 0; round < MAX_ROUNDS; round++) {
      const llmResult = await chatCompletion(
        {
          model,
          messages: messages as unknown as Parameters<typeof chatCompletion>[0]['messages'],
          temperature: 0.3,
          max_tokens: 2048,
          stream: false,
          tools: BRAIN_TOOL_DEFINITIONS,
          tool_choice: 'auto',
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
      actionType: 'brain.query',
      payload: {
        description: `Cognitive query: "${input.question.slice(0, 100)}"`,
        model,
        proposalId: latestProposal?.id ?? null,
        citations: citations.length,
        toolLoop: true,
      },
      status: 'success',
      riskLevel: latestProposal ? 'medium' : 'low',
    });

    return { answer: finalAnswer, citations, proposal: latestProposal };
  }
}
