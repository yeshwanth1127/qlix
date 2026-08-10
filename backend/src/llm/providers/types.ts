import type { InferenceChatRequest } from '../inferenceSchemas.js';

export type LlmProviderId = 'exora' | 'openrouter';

export interface InferenceToolCall {
  id: string;
  type: string;
  function: { name: string; arguments: string };
}

export interface InferenceUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cost?: number;
  total_cost?: number;
  prompt_tokens_details?: { cached_tokens?: number };
}

export interface ChatCompletionResult {
  content: string;
  toolCalls: InferenceToolCall[] | null;
  finishReason: string | null;
  usage?: InferenceUsage;
  provider?: string | null;
}

export type StreamDeltaHandler = (delta: {
  text?: string;
  finishReason?: string | null;
}) => void;

export interface ChatCompletionOptions {
  timeoutMs?: number;
  retries?: number;
  signal?: AbortSignal;
  planAllowedTiers?: string[];
  applicationId: string;
}

export interface InferenceProvider {
  readonly id: LlmProviderId;
  chatCompletion(
    request: InferenceChatRequest,
    options: ChatCompletionOptions,
  ): Promise<ChatCompletionResult>;
  chatCompletionStream(
    request: InferenceChatRequest,
    onDelta: StreamDeltaHandler,
    options: ChatCompletionOptions,
  ): Promise<{ content: string; finishReason: string | null }>;
}

export class InferenceConfigError extends Error {
  readonly provider: LlmProviderId;

  constructor(provider: LlmProviderId, message: string) {
    super(message);
    this.provider = provider;
  }
}

export class InferenceProviderError extends Error {
  readonly provider: LlmProviderId;
  readonly status: number;

  constructor(provider: LlmProviderId, status: number, message: string) {
    super(message);
    this.provider = provider;
    this.status = status;
  }
}
