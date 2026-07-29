/**
 * Per-container CPU/RAM ceiling for cloud agent runners. Previously unset entirely
 * (every agent container ran unbounded on the remote Docker host) — defaults below
 * match the "Standard" profile sized from the runtime's own component footprint
 * (Python + Node + a warm headless Chromium via agent-browser). Override per
 * deployment via env if the agent host's capacity calls for a different budget.
 */
export interface RunnerResourceLimits {
  memoryLimit: string;
  memoryReservation: string;
  cpuLimit: string;
  pidsLimit: string;
}

export function resolveRunnerResourceLimits(): RunnerResourceLimits {
  return {
    memoryLimit: process.env.QLIX_RUNNER_MEMORY_LIMIT?.trim() || '1g',
    memoryReservation: process.env.QLIX_RUNNER_MEMORY_RESERVATION?.trim() || '512m',
    cpuLimit: process.env.QLIX_RUNNER_CPU_LIMIT?.trim() || '1.5',
    pidsLimit: process.env.QLIX_RUNNER_PIDS_LIMIT?.trim() || '512',
  };
}
