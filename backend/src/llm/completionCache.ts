import { createHash } from 'node:crypto';

interface CacheEntry {
  payload: unknown;
  expiresAt: number;
}

const store = new Map<string, CacheEntry>();
const DEFAULT_TTL_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 2_000;

function prune(now: number): void {
  if (store.size < MAX_ENTRIES) return;
  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) store.delete(key);
  }
  if (store.size < MAX_ENTRIES) return;
  // Drop oldest half
  const keys = [...store.keys()].slice(0, Math.floor(store.size / 2));
  for (const k of keys) store.delete(k);
}

export function completionCacheKey(parts: {
  agentId: string;
  model: string;
  messages: unknown;
  toolsHash?: string | null;
  temperature?: number;
  maxTokens?: number;
}): string {
  const h = createHash('sha256');
  h.update(parts.agentId);
  h.update('|');
  h.update(parts.model);
  h.update('|');
  h.update(JSON.stringify(parts.messages));
  h.update('|');
  h.update(parts.toolsHash ?? '');
  h.update('|');
  h.update(String(parts.temperature ?? ''));
  h.update('|');
  h.update(String(parts.maxTokens ?? ''));
  return h.digest('hex');
}

export function getCachedCompletion(key: string): unknown | null {
  const now = Date.now();
  const hit = store.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= now) {
    store.delete(key);
    return null;
  }
  return hit.payload;
}

export function setCachedCompletion(key: string, payload: unknown, ttlMs = DEFAULT_TTL_MS): void {
  const now = Date.now();
  prune(now);
  store.set(key, { payload, expiresAt: now + ttlMs });
}

export function isCompletionCacheEnabled(): boolean {
  const raw = process.env.QLIX_COMPLETION_CACHE_ENABLED?.trim().toLowerCase();
  if (raw === 'false' || raw === '0') return false;
  return true;
}
