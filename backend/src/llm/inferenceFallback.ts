import { InferenceProviderError } from './providers/types.js';

const TRANSIENT_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export function isTransientInferenceFailure(error: unknown): boolean {
  if (error instanceof InferenceProviderError) {
    return TRANSIENT_STATUS.has(error.status);
  }
  if (!(error instanceof Error)) return false;
  if (error.name === 'AbortError' || error.name === 'TimeoutError') return true;
  const msg = error.message.toLowerCase();
  return (
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    msg.includes('fetch failed') ||
    msg.includes('econnreset') ||
    msg.includes('econnrefused') ||
    msg.includes('socket hang up')
  );
}

export function openrouterFallbackModel(_exoraModel?: string): string {
  return 'openrouter/openai/gpt-4o-mini';
}

export function exoraFallbackEnabled(): boolean {
  const flag = process.env.EXORA_FALLBACK_TO_OPENROUTER?.trim().toLowerCase();
  if (flag === '0' || flag === 'false' || flag === 'off') return false;
  return true;
}
