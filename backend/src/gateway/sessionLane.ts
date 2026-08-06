/**
 * Per-session command lane — OpenClaw `session:${key}` equivalent.
 * Serializes turns so two concurrent messages cannot corrupt the same conversation.
 */

const lanes = new Map<string, Promise<unknown>>();

/** Active / queued run id per session (for admission steer/interrupt). */
const activeRuns = new Map<string, string>();

export async function withSessionLane<T>(sessionKey: string, fn: () => Promise<T>): Promise<T> {
  const prev = lanes.get(sessionKey) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const next = prev.then(() => gate, () => gate);
  lanes.set(sessionKey, next);

  await prev.catch(() => undefined);
  try {
    return await fn();
  } finally {
    release();
    // Drop settled lane head if we are still the tip
    if (lanes.get(sessionKey) === next) {
      // Keep a resolved promise so chained waiters finish; GC when idle.
      void next.finally(() => {
        if (lanes.get(sessionKey) === next) {
          lanes.delete(sessionKey);
        }
      });
    }
  }
}

export function setActiveRun(sessionKey: string, runId: string): void {
  activeRuns.set(sessionKey, runId);
}

export function clearActiveRun(sessionKey: string, runId?: string): void {
  if (runId && activeRuns.get(sessionKey) !== runId) return;
  activeRuns.delete(sessionKey);
}

export function getActiveRun(sessionKey: string): string | undefined {
  return activeRuns.get(sessionKey);
}

/** Test helper — reset in-memory lane state. */
export function _resetSessionLanesForTests(): void {
  lanes.clear();
  activeRuns.clear();
}
