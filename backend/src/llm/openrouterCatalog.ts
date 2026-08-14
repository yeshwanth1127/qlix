import { OpenRouterConfigError } from './openrouterClient.js';

function openRouterApiKey(): string {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (!key) throw new OpenRouterConfigError();
  return key;
}

function modelsListUrl(): string {
  const base = process.env.OPENROUTER_BASE_URL?.trim() || 'https://openrouter.ai/api/v1';
  return `${base.replace(/\/$/, '')}/models`;
}

/**
 * Reasoning capabilities as reported by OpenRouter's `GET /models`.
 *
 * Effort is a *share* of `max_tokens` (high ~80%, low ~20%, minimal ~10%), so a
 * model left on its own `defaultEffort` can spend the entire completion budget
 * thinking and return no visible answer. This metadata is what lets us pick a
 * small-but-nonzero share instead of accepting that default.
 */
export interface OpenRouterReasoningMeta {
  /** Efforts the gateway accepts, highest first. `null` means "any value". */
  supportedEfforts: string[] | null;
  /** Pre-selected effort when reasoning is on but no effort was sent. */
  defaultEffort: string | null;
  /** True when the model accepts an absolute `reasoning.max_tokens` budget. */
  supportsMaxTokens: boolean;
  /** True when reasoning cannot be disabled — never send `effort: "none"`. */
  mandatory: boolean;
  defaultEnabled: boolean | null;
}

export interface OpenRouterCatalogModel {
  id: string;
  name: string;
  contextLength?: number;
  /** USD per input token */
  promptUsdPerToken?: number;
  /** USD per output token */
  completionUsdPerToken?: number;
  /** Blended USD per 1M tokens (0.7 in + 0.3 out) for ranking */
  blendUsdPer1M?: number;
  supportsTools?: boolean;
  /** Present only for models that expose thinking tokens. */
  reasoning?: OpenRouterReasoningMeta;
}

function isOpenRouterChatQueryModel(row: Record<string, unknown>, id: string): boolean {
  const lid = id.toLowerCase();
  if (lid.includes('embed')) return false;
  if (lid.includes('text-embedding')) return false;
  if (lid.includes('/whisper') || lid.endsWith('whisper')) return false;

  const arch = row.architecture as { modality?: string; output_modalities?: unknown } | undefined;
  const modality = typeof arch?.modality === 'string' ? arch.modality.toLowerCase() : '';
  if (modality === 'text->embedding' || modality.includes('embedding')) return false;
  const out = arch?.output_modalities;
  if (Array.isArray(out) && out.length > 0 && out.every((m) => String(m).toLowerCase() === 'embeddings')) {
    return false;
  }

  return true;
}

function parseUsdPerToken(raw: unknown): number | undefined {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && raw.trim()) {
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function parseReasoningMeta(raw: unknown): OpenRouterReasoningMeta | undefined {
  // Non-reasoning models and dynamic routers report `reasoning: null`.
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const efforts = r.supported_efforts;
  return {
    supportedEfforts: Array.isArray(efforts) ? efforts.map((e) => String(e).toLowerCase()) : null,
    defaultEffort: typeof r.default_effort === 'string' ? r.default_effort.toLowerCase() : null,
    supportsMaxTokens: r.supports_max_tokens === true,
    mandatory: r.mandatory === true,
    defaultEnabled: typeof r.default_enabled === 'boolean' ? r.default_enabled : null,
  };
}

let catalogCache: { at: number; models: OpenRouterCatalogModel[] } | null = null;
const CATALOG_TTL_MS = 30 * 60 * 1000;

/** Bare model id (no `openrouter/` prefix) → reasoning metadata, for sync lookups. */
let reasoningIndex = new Map<string, OpenRouterReasoningMeta>();
/** Bare ids seen in the catalog, so we can tell "not a reasoning model" from "unknown". */
let knownModelIds = new Set<string>();

function bareModelId(modelId: string): string {
  return modelId.trim().toLowerCase().replace(/^openrouter\//, '');
}

/**
 * Reasoning metadata for a model without awaiting a fetch.
 *
 * Returns `{ known: false }` on a cold cache so callers can fall back to a
 * static classifier rather than assuming the model does not reason.
 */
export function cachedReasoningMeta(
  modelId: string,
): { known: boolean; reasoning: OpenRouterReasoningMeta | null } {
  const id = bareModelId(modelId);
  const meta = reasoningIndex.get(id);
  if (meta) return { known: true, reasoning: meta };
  return { known: knownModelIds.has(id), reasoning: null };
}

/** Populate the catalog cache in the background; failures are non-fatal. */
export function warmOpenRouterCatalog(): void {
  if (catalogCache || !process.env.OPENROUTER_API_KEY?.trim()) return;
  void fetchOpenRouterModelCatalog().catch((err) => {
    console.warn(
      '[inference] OpenRouter catalog warm failed; reasoning limits fall back to static rules:',
      err instanceof Error ? err.message : err,
    );
  });
}

/**
 * Fetches model ids + pricing from OpenRouter (`GET /models`).
 * Requires `OPENROUTER_API_KEY`.
 */
export async function fetchOpenRouterModelCatalog(options?: {
  forceRefresh?: boolean;
}): Promise<OpenRouterCatalogModel[]> {
  const now = Date.now();
  if (!options?.forceRefresh && catalogCache && now - catalogCache.at < CATALOG_TTL_MS) {
    return catalogCache.models;
  }

  const url = modelsListUrl();
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${openRouterApiKey()}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`OpenRouter models request failed (${response.status}): ${text.slice(0, 200)}`);
  }
  const payload = (await response.json()) as { data?: unknown };
  const rows = Array.isArray(payload.data) ? payload.data : [];
  const out: OpenRouterCatalogModel[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const id = typeof r.id === 'string' ? r.id.trim() : '';
    if (!id || !isOpenRouterChatQueryModel(r, id)) continue;
    const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim() : id;
    const ctx =
      typeof r.context_length === 'number'
        ? r.context_length
        : typeof r.contextLength === 'number'
          ? r.contextLength
          : undefined;
    const pricing = (r.pricing ?? {}) as Record<string, unknown>;
    const promptUsdPerToken = parseUsdPerToken(pricing.prompt);
    const completionUsdPerToken = parseUsdPerToken(pricing.completion);
    let blendUsdPer1M: number | undefined;
    if (promptUsdPerToken != null && completionUsdPerToken != null) {
      blendUsdPer1M = 1e6 * (0.7 * promptUsdPerToken + 0.3 * completionUsdPerToken);
    }
    const supported = r.supported_parameters;
    const supportsTools = Array.isArray(supported) && supported.map(String).includes('tools');
    const reasoning = parseReasoningMeta(r.reasoning);
    out.push({
      id,
      name,
      contextLength: ctx,
      promptUsdPerToken,
      completionUsdPerToken,
      blendUsdPer1M,
      supportsTools,
      ...(reasoning ? { reasoning } : {}),
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  catalogCache = { at: now, models: out };
  const nextIndex = new Map<string, OpenRouterReasoningMeta>();
  const nextKnown = new Set<string>();
  for (const model of out) {
    const bare = bareModelId(model.id);
    nextKnown.add(bare);
    if (model.reasoning) nextIndex.set(bare, model.reasoning);
  }
  reasoningIndex = nextIndex;
  knownModelIds = nextKnown;
  return out;
}
