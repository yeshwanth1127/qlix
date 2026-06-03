export class ModelPolicyError extends Error {
  constructor(message: string) {
    super(message);
  }
}

function allowedModelPrefixes(): string[] {
  const raw = process.env.OPENROUTER_ALLOWED_MODEL_PREFIXES?.trim();
  if (!raw) return ['openrouter/'];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Prefix OpenRouter-style ids (`provider/model`) so policy + proxy agree on one canonical form. */
export function normalizeQlixInferenceModelId(raw: string): string {
  const t = raw.trim();
  if (!t) return t;
  const lower = t.toLowerCase();
  if (lower.startsWith('openrouter/')) return t;
  return `openrouter/${t}`;
}

export function assertModelAllowed(model: string): void {
  const normalized = model.trim().toLowerCase();
  const prefixes = allowedModelPrefixes().map((p) => p.toLowerCase());
  if (!prefixes.some((prefix) => normalized.startsWith(prefix))) {
    throw new ModelPolicyError(
      `Model "${model}" is not allowed. Allowed prefixes: ${prefixes.join(', ')}`,
    );
  }
}

