/**
 * Prefetch conversation memory at gateway admit time so the runner poll
 * can reuse it instead of rebuilding on the hot path.
 */

const cache = new Map<string, { block: string | null; expiresAt: number }>();
const TTL_MS = 5 * 60_000;

export function putPrefetchedMemory(runId: string, block: string | null): void {
  cache.set(runId, { block, expiresAt: Date.now() + TTL_MS });
}

export function takePrefetchedMemory(runId: string): string | null | undefined {
  const hit = cache.get(runId);
  if (!hit) return undefined;
  cache.delete(runId);
  if (Date.now() > hit.expiresAt) return undefined;
  return hit.block;
}

export function clearPrefetchedMemory(runId: string): void {
  cache.delete(runId);
}
