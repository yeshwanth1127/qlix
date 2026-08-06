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

let catalogCache: { at: number; models: OpenRouterCatalogModel[] } | null = null;
const CATALOG_TTL_MS = 30 * 60 * 1000;

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
    out.push({
      id,
      name,
      contextLength: ctx,
      promptUsdPerToken,
      completionUsdPerToken,
      blendUsdPer1M,
      supportsTools,
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  catalogCache = { at: now, models: out };
  return out;
}
