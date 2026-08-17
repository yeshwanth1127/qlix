/**
 * Serialize checkpoint / live-sheet writes for one team run.
 *
 * Classification and field extraction stay parallel. Only the read-merge-write of
 * `checkpointJson.liveArtifacts` (and the sandbox rematerialize) takes this lock,
 * so two leads answering at once cannot overwrite each other's rows.
 */
const tails = new Map<string, Promise<unknown>>();

export function withRunCheckpointLock<T>(runId: string, task: () => Promise<T>): Promise<T> {
  const prev = tails.get(runId) ?? Promise.resolve();
  const current = prev.then(() => task(), () => task());
  const holder = current.then(
    () => undefined,
    () => undefined,
  );
  tails.set(runId, holder);
  void holder.then(() => {
    if (tails.get(runId) === holder) tails.delete(runId);
  });
  return current;
}

export function runCheckpointLockPending(): number {
  return tails.size;
}
