export class ModelPolicyError extends Error {
  constructor(message: string) {
    super(message);
  }
}

import type { LlmProviderId } from './providers/types.js';

function allowedModelPrefixes(provider: LlmProviderId): string[] {
  const raw =
    provider === 'exora'
      ? process.env.EXORA_ALLOWED_MODEL_PREFIXES?.trim()
      : process.env.OPENROUTER_ALLOWED_MODEL_PREFIXES?.trim();
  if (!raw) return [`${provider}/`];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Infer gateway from a canonical qlix model id (`exora/...` vs `openrouter/...`). */
export function llmProviderFromModelId(model: string): LlmProviderId {
  return model.trim().toLowerCase().startsWith('exora/') ? 'exora' : 'openrouter';
}

/** Prefix OpenRouter-style ids (`provider/model`) so policy + proxy agree on one canonical form. */
export function normalizeQlixInferenceModelId(
  raw: string,
  provider: LlmProviderId = 'openrouter',
): string {
  const t = raw.trim();
  if (!t) return t;
  const lower = t.toLowerCase();
  if (lower.startsWith('openrouter/') || lower.startsWith('exora/')) return t;
  return `${provider}/${t}`;
}

export function assertModelAllowed(model: string, provider?: LlmProviderId): void {
  const normalized = model.trim().toLowerCase();
  // Auto virtual models are resolved before OpenRouter; always allow.
  if (
    normalized === 'openrouter/qlix/auto' ||
    normalized === 'openrouter/qlix/auto-economy' ||
    normalized === 'openrouter/qlix/auto-standard' ||
    normalized === 'exora/qlix/auto' ||
    normalized === 'exora/qlix/auto-economy' ||
    normalized === 'exora/qlix/auto-standard' ||
    normalized === 'qlix/auto' ||
    normalized === 'openrouter/free' ||
    normalized === 'openrouter/openrouter/free'
  ) {
    return;
  }
  // Prefer the model's own namespace when present so an Exora-provisioned agent can
  // still run an OpenRouter override (team-run model picker) and vice versa.
  let resolvedProvider: LlmProviderId;
  if (normalized.startsWith('exora/')) resolvedProvider = 'exora';
  else if (normalized.startsWith('openrouter/')) resolvedProvider = 'openrouter';
  else resolvedProvider = provider ?? 'openrouter';
  const prefixes = allowedModelPrefixes(resolvedProvider).map((p) => p.toLowerCase());
  if (!prefixes.some((prefix) => normalized.startsWith(prefix))) {
    throw new ModelPolicyError(
      `Model "${model}" is not allowed. Allowed prefixes: ${prefixes.join(', ')}`,
    );
  }
}

