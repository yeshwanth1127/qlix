import { InferenceConfigError, InferenceProviderError } from './providers/types.js';

export interface ExoraCatalogModel {
  id: string;
  name: string;
  contextLength?: number;
  supportsTools?: boolean;
}

const FALLBACK_MODELS: ExoraCatalogModel[] = [
  {
    id: 'exora-general',
    name: 'Exora General',
    supportsTools: true,
  },
  {
    id: 'exora-coder',
    name: 'Exora Coder',
    supportsTools: true,
  },
];

let catalogCache: { at: number; models: ExoraCatalogModel[] } | null = null;
const CATALOG_TTL_MS = 30 * 60 * 1000;

export async function fetchExoraModelCatalog(options?: {
  forceRefresh?: boolean;
}): Promise<ExoraCatalogModel[]> {
  const enabled = process.env.EXORA_LLM_ENABLED?.trim().toLowerCase();
  const key = process.env.EXORA_LLM_API_KEY?.trim();
  if (enabled === 'false' || enabled === '0' || !key) {
    throw new InferenceConfigError('exora', 'Exora LLM gateway is not configured');
  }
  const now = Date.now();
  if (!options?.forceRefresh && catalogCache && now - catalogCache.at < CATALOG_TTL_MS) {
    return catalogCache.models;
  }

  const baseUrl =
    process.env.EXORA_LLM_BASE_URL?.trim() || 'https://llm.exora.solutions/v1';
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, {
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
      'X-Exora-Application': 'qlix-model-catalog',
    },
    signal: AbortSignal.timeout(25_000),
  });
  if (response.status === 404 || response.status === 405) {
    catalogCache = { at: now, models: FALLBACK_MODELS };
    return FALLBACK_MODELS;
  }
  const payload = (await response.json().catch(() => null)) as {
    data?: unknown;
    error?: { message?: string };
    message?: string;
  } | null;
  if (!response.ok) {
    throw new InferenceProviderError(
      'exora',
      response.status,
      String(payload?.error?.message ?? payload?.message ?? `HTTP ${response.status}`),
    );
  }

  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const models = rows.flatMap((row): ExoraCatalogModel[] => {
    if (!row || typeof row !== 'object') return [];
    const value = row as Record<string, unknown>;
    const id = typeof value.id === 'string' ? value.id.trim() : '';
    if (!id) return [];
    return [{
      id,
      name: typeof value.name === 'string' && value.name.trim() ? value.name.trim() : id,
      contextLength:
        typeof value.context_length === 'number' ? value.context_length : undefined,
      supportsTools: true,
    }];
  });
  const resolved = models.length ? models : FALLBACK_MODELS;
  catalogCache = { at: now, models: resolved };
  return resolved;
}
