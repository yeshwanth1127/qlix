type Cleanup = (orgId: string) => void | Promise<void>;

const active = new Map<string, number>();
const draining = new Set<string>();
const waiters = new Map<string, Array<() => void>>();
const cleanupHooks = new Map<string, Set<Cleanup>>();

const instanceKey = (orgId: string, pluginId: string) => `${orgId}:${pluginId}`;

export class OrganizationPluginDrainingError extends Error {
  readonly code = 'plugin_draining';
}

export function registerOrganizationPluginCleanup(pluginId: string, cleanup: Cleanup): () => void {
  const hooks = cleanupHooks.get(pluginId) ?? new Set<Cleanup>();
  hooks.add(cleanup);
  cleanupHooks.set(pluginId, hooks);
  return () => {
    hooks.delete(cleanup);
    if (hooks.size === 0) cleanupHooks.delete(pluginId);
  };
}

/** Lease helper for dynamically managed plugin work. Legacy paths remain compatible. */
export async function withOrganizationPluginLease<T>(
  orgId: string,
  pluginId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const key = instanceKey(orgId, pluginId);
  if (draining.has(key)) throw new OrganizationPluginDrainingError(`Plugin ${pluginId} is draining`);
  active.set(key, (active.get(key) ?? 0) + 1);
  try {
    return await operation();
  } finally {
    const remaining = Math.max(0, (active.get(key) ?? 1) - 1);
    if (remaining === 0) {
      active.delete(key);
      for (const wake of waiters.get(key)?.splice(0) ?? []) wake();
      waiters.delete(key);
    } else {
      active.set(key, remaining);
    }
  }
}

export function resumeOrganizationPlugin(orgId: string, pluginId: string): void {
  draining.delete(instanceKey(orgId, pluginId));
}

export async function drainOrganizationPlugin(
  orgId: string,
  pluginId: string,
  timeoutMs = 30_000,
): Promise<void> {
  const key = instanceKey(orgId, pluginId);
  draining.add(key);
  if ((active.get(key) ?? 0) > 0) {
    const drained = new Promise<void>((resolve) => {
      const pending = waiters.get(key) ?? [];
      pending.push(resolve);
      waiters.set(key, pending);
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        drained,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`Timed out draining ${pluginId}`)), timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  for (const cleanup of cleanupHooks.get(pluginId) ?? []) await cleanup(orgId);
}
