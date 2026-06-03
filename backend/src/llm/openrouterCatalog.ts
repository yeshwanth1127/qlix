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
}

/**
 * Fetches model ids from OpenRouter (`GET /models`) — **exact `id` values** their API accepts.
 * Filters out embedding / non–chat-query models where architecture metadata is present.
 * Requires `OPENROUTER_API_KEY`.
 */
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

export async function fetchOpenRouterModelCatalog(): Promise<OpenRouterCatalogModel[]> {
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
    out.push({ id, name, contextLength: ctx });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}
