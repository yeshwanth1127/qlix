export const JIT_MAX_ATTEMPTS = 5;

export function jitAttemptFromPayload(payload: unknown): number {
  if (!payload || typeof payload !== 'object') return 1;
  const value = (payload as { jitAttempt?: unknown }).jitAttempt;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) return 1;
  return Math.floor(value);
}

/** Next 1-based attempt, or null when the 5-attempt budget is spent. */
export function nextJitAttempt(currentAttempt: number): number | null {
  const current = jitAttemptFromPayload({ jitAttempt: currentAttempt });
  if (current >= JIT_MAX_ATTEMPTS) return null;
  return current + 1;
}
