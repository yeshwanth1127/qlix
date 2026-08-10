import type { InferenceChatRequest } from '../inferenceSchemas.js';
import { openRouterChatCompletion, OpenRouterConfigError, OpenRouterRequestError } from '../openrouterClient.js';
import { openRouterChatCompletionStream } from '../openRouterStream.js';
import type {
  ChatCompletionOptions,
  ChatCompletionResult,
  InferenceProvider,
  StreamDeltaHandler,
} from './types.js';
import { InferenceConfigError, InferenceProviderError } from './types.js';

function normalizeError(error: unknown): never {
  if (error instanceof OpenRouterConfigError) {
    throw new InferenceConfigError('openrouter', error.message);
  }
  if (error instanceof OpenRouterRequestError) {
    throw new InferenceProviderError('openrouter', error.status, error.message);
  }
  throw error;
}

async function chatCompletion(
  request: InferenceChatRequest,
  options: ChatCompletionOptions,
): Promise<ChatCompletionResult> {
  try {
    return await openRouterChatCompletion(request, {
      timeoutMs: options.timeoutMs,
      retries: options.retries,
      planAllowedTiers: options.planAllowedTiers,
    });
  } catch (error: unknown) {
    return normalizeError(error);
  }
}

async function chatCompletionStream(
  request: InferenceChatRequest,
  onDelta: StreamDeltaHandler,
  options: ChatCompletionOptions,
): Promise<{ content: string; finishReason: string | null }> {
  try {
    return await openRouterChatCompletionStream(request, onDelta, {
      timeoutMs: options.timeoutMs,
      signal: options.signal,
      planAllowedTiers: options.planAllowedTiers,
    });
  } catch (error: unknown) {
    return normalizeError(error);
  }
}

export const openrouterProvider: InferenceProvider = {
  id: 'openrouter',
  chatCompletion,
  chatCompletionStream,
};
