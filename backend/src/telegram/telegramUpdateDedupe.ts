/**
 * Prevent duplicate processing of the same Telegram update_id.
 * Uses Postgres unique insert so cluster workers share the claim.
 */

import { prisma } from '../lib/prisma.js';

const MEMORY_TTL_MS = 10 * 60 * 1000;
const seen = new Map<number, number>();

function claimInMemory(updateId: number): boolean {
  const now = Date.now();
  if (seen.size > 512) {
    for (const [id, at] of seen) {
      if (now - at > MEMORY_TTL_MS) seen.delete(id);
    }
  }
  const prev = seen.get(updateId);
  if (prev !== undefined && now - prev < MEMORY_TTL_MS) return false;
  seen.set(updateId, now);
  return true;
}

/** @returns true if this update should be processed (first sighting). */
export async function claimTelegramUpdateId(updateId: number): Promise<boolean> {
  if (!Number.isFinite(updateId)) return true;

  // Fast local short-circuit (same worker / same process).
  if (!claimInMemory(updateId)) return false;

  try {
    await prisma.telegramUpdateClaim.create({
      data: { updateId: BigInt(updateId) },
    });
    return true;
  } catch {
    // Unique violation or DB race — already claimed elsewhere.
    return false;
  }
}

/** Test helper */
export function _resetTelegramUpdateDedupeForTests(): void {
  seen.clear();
}
