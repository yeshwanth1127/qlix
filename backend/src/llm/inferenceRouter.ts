import type { InferenceChatRequest } from './inferenceSchemas.js';
import { exoraGatewayProvider } from './providers/exoraGatewayClient.js';
import { openrouterProvider } from './providers/openrouterProvider.js';
import type {
  ChatCompletionOptions,
  ChatCompletionResult,
  InferenceProvider,
  LlmProviderId,
  StreamDeltaHandler,
} from './providers/types.js';
import { InferenceConfigError } from './providers/types.js';
import {
  exoraFallbackEnabled,
  isTransientInferenceFailure,
  openrouterFallbackModel,
} from './inferenceFallback.js';

export const LLM_APPLICATION_IDS = {
  agentInference: 'qlix-agent-inference',
  aiBrain: 'qlix-ai-brain',
  nlBuilder: 'qlix-nl-builder',
  agentMemory: 'qlix-agent-memory',
  whatsappRouter: 'qlix-whatsapp-router',
  replyInterest: 'qlix-reply-interest',
  lunaTeams: 'qlix-luna-teams',
} as const;

const providers: Record<LlmProviderId, InferenceProvider> = {
  exora: exoraGatewayProvider,
  openrouter: openrouterProvider,
};

export function defaultLlmProvider(): LlmProviderId {
  const configured = process.env.QLIX_DEFAULT_LLM_PROVIDER?.trim().toLowerCase();
  if (configured === 'exora' || configured === 'openrouter') return configured;
  // Preserve existing deployments until the Exora key is configured.
  return process.env.EXORA_LLM_API_KEY?.trim() ? 'exora' : 'openrouter';
}

export function parseLlmProvider(value: unknown): LlmProviderId {
  return value === 'exora' ? 'exora' : 'openrouter';
}

/**
 * Provider implied by a fully-qualified model id ("exora/…", "openrouter/…").
 * Null when the id carries no prefix, so callers can fall back to their own default.
 */
export function providerForModel(model: string | null | undefined): LlmProviderId | null {
  const trimmed = model?.trim().toLowerCase();
  if (!trimmed) return null;
  if (trimmed.startsWith('exora/')) return 'exora';
  if (trimmed.startsWith('openrouter/')) return 'openrouter';
  return null;
}

export function isLlmProviderConfigured(provider: LlmProviderId): boolean {
  if (provider === 'exora') {
    const enabled = process.env.EXORA_LLM_ENABLED?.trim().toLowerCase();
    return enabled !== 'false' && enabled !== '0' && Boolean(process.env.EXORA_LLM_API_KEY?.trim());
  }
  return Boolean(process.env.OPENROUTER_API_KEY?.trim());
}

export function assertLlmProviderConfigured(provider: LlmProviderId): void {
  if (isLlmProviderConfigured(provider)) return;
  const keyName = provider === 'exora' ? 'EXORA_LLM_API_KEY' : 'OPENROUTER_API_KEY';
  throw new InferenceConfigError(provider, `${keyName} is required for ${provider} inference`);
}

export function defaultModelForProvider(provider: LlmProviderId): string {
  if (provider === 'exora') {
    const model = process.env.EXORA_LLM_DEFAULT_MODEL?.trim() || 'exora-general';
    return model.startsWith('exora/') ? model : `exora/${model}`;
  }
  return 'openrouter/qlix/auto';
}

export function modelForProvider(model: string, provider: LlmProviderId): string {
  const trimmed = model.trim();
  if (provider === 'exora') {
    return trimmed.toLowerCase().startsWith('exora/')
      ? trimmed
      : defaultModelForProvider('exora');
  }
  return trimmed.toLowerCase().startsWith('openrouter/')
    ? trimmed
    : defaultModelForProvider('openrouter');
}

export interface RoutedChatOptions extends Omit<ChatCompletionOptions, 'applicationId'> {
  provider?: LlmProviderId;
  applicationId: string;
}

async function withOpenRouterFallback<T>(
  provider: LlmProviderId,
  request: InferenceChatRequest,
  run: (activeProvider: LlmProviderId, model: string) => Promise<T>,
): Promise<T> {
  const model = modelForProvider(request.model, provider);
  try {
    return await run(provider, model);
  } catch (error) {
    if (
      provider !== 'exora' ||
      !exoraFallbackEnabled() ||
      !isLlmProviderConfigured('openrouter') ||
      !isTransientInferenceFailure(error)
    ) {
      throw error;
    }
    const fallbackModel = openrouterFallbackModel(request.model);
    const detail =
      error instanceof Error ? error.message : String(error);
    console.warn(
      `[inference] exora failed (${detail}); falling back to openrouter model=${fallbackModel}`,
    );
    return run('openrouter', fallbackModel);
  }
}

export async function chatCompletion(
  request: InferenceChatRequest,
  options: RoutedChatOptions,
): Promise<ChatCompletionResult> {
  const provider = options.provider ?? defaultLlmProvider();
  assertLlmProviderConfigured(provider);
  return withOpenRouterFallback(provider, request, (active, model) => {
    if (active !== provider) assertLlmProviderConfigured(active);
    return providers[active].chatCompletion({ ...request, model }, options);
  });
}

export async function chatCompletionStream(
  request: InferenceChatRequest,
  onDelta: StreamDeltaHandler,
  options: RoutedChatOptions,
): Promise<{ content: string; finishReason: string | null }> {
  const provider = options.provider ?? defaultLlmProvider();
  assertLlmProviderConfigured(provider);
  return withOpenRouterFallback(provider, request, (active, model) => {
    if (active !== provider) assertLlmProviderConfigured(active);
    return providers[active].chatCompletionStream(
      { ...request, model },
      onDelta,
      options,
    );
  });
}

export type {
  ChatCompletionResult,
  InferenceUsage,
  LlmProviderId,
  StreamDeltaHandler,
} from './providers/types.js';
export { InferenceConfigError, InferenceProviderError } from './providers/types.js';
