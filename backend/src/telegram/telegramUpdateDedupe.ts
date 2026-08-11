/**
 * Prevent obvious duplicate processing of the same Telegram update_id.
 * In-process TTL map (same approach as the WhatsApp sidecar inbound dedupe).
 * Sufficient for a single API instance; Redis multi-instance can replace this later.
 */

const MEMORY_TTL_MS = 10 * 60 * 1000;
const seen = new Map<number, number>();

function pruneMemory(now: number): void {
  if (seen.size < 256) return;
  for (const [id, at] of seen) {
    if (now - at > MEMORY_TTL_MS) seen.delete(id);
  }
}

/** @returns true if this update should be processed (first sighting). */
export function claimTelegramUpdateId(updateId: number): boolean {
  if (!Number.isFinite(updateId)) return true;
  const now = Date.now();
  pruneMemory(now);
  const prev = seen.get(updateId);
  if (prev !== undefined && now - prev < MEMORY_TTL_MS) return false;
  seen.set(updateId, now);
  return true;
}

/** Test helper */
export function _resetTelegramUpdateDedupeForTests(): void {
  seen.clear();
}
