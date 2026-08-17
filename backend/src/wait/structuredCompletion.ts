/**
 * Small structured prompts (pick columns, extract fields) shared by the wait side effects.
 *
 * These run on whatever model the surrounding request is already routed to, so a run pinned to
 * a specific model does not quietly execute half its inference somewhere else. The workspace
 * default is only used when the caller has no model to offer.
 *
 * The router only falls back to OpenRouter when the primary provider *throws*. Exora answers
 * these short JSON-only prompts with an empty body and a 200, which no fallback ever sees — so
 * the caller silently degrades to its defaults. Treat a blank answer as a failure and retry
 * once, otherwise these features look wired up while never actually running.
 */
import {
  chatCompletion,
  defaultLlmProvider,
  defaultModelForProvider,
  isLlmProviderConfigured,
  providerForModel,
} from '../llm/inferenceRouter.js';
import { exoraFallbackEnabled, openrouterFallbackModel } from '../llm/inferenceFallback.js';

export async function completeStructured(input: {
  system: string;
  user: string;
  applicationId: string;
  label: string;
  /** Model the surrounding run is using. Falls back to the workspace default when absent. */
  model?: string | null;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}): Promise<string> {
  const requested = input.model?.trim() || null;
  const provider = providerForModel(requested) ?? defaultLlmProvider();
  const model = requested ?? defaultModelForProvider(provider);

  const request = {
    messages: [
      { role: 'system' as const, content: input.system },
      { role: 'user' as const, content: input.user },
    ],
    temperature: input.temperature ?? 0.2,
    max_tokens: input.maxTokens ?? 200,
    stream: false as const,
  };
  const options = {
    applicationId: input.applicationId,
    timeoutMs: input.timeoutMs ?? 15_000,
    retries: 1,
  };

  let primaryContent = '';
  if (isLlmProviderConfigured(provider)) {
    try {
      const result = await chatCompletion({ ...request, model }, { ...options, provider });
      primaryContent = String(result.content ?? '').trim();
    } catch (err) {
      console.warn(
        `[${input.label}] inference failed on ${model}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  if (primaryContent) return primaryContent;

  // A blank answer from Exora is not an error the router can see; retry once on OpenRouter.
  const canFallback =
    provider === 'exora' && exoraFallbackEnabled() && isLlmProviderConfigured('openrouter');
  if (!canFallback) return '';

  const fallbackModel = openrouterFallbackModel(model);
  try {
    const result = await chatCompletion(
      { ...request, model: fallbackModel },
      { ...options, provider: 'openrouter' },
    );
    return String(result.content ?? '').trim();
  } catch (err) {
    console.warn(
      `[${input.label}] fallback inference failed on ${fallbackModel}:`,
      err instanceof Error ? err.message : err,
    );
    return '';
  }
}
