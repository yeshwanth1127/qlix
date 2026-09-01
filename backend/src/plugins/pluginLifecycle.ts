export type PluginLifecycleState = 'registered' | 'active' | 'draining' | 'inactive' | 'failed';

export type PluginOwner = {
  id: string;
  kind: 'core' | 'gateway' | 'conversation' | 'organization' | 'connector' | 'mcp' | 'skill' | string;
  version?: string;
};

export type PluginRegistrationOptions<TConfig = Record<string, unknown>> = {
  owner?: PluginOwner;
  dependencies?: string[];
  validateConfig?: (config: TConfig) => void | Promise<void>;
  activate?: (config: TConfig) => void | Promise<void>;
  deactivate?: () => void | Promise<void>;
  cleanup?: () => void | Promise<void>;
  active?: boolean;
};

export type DisposableRegistration = {
  key: string;
  owner: PluginOwner;
  dispose(): Promise<void>;
};

export class PluginUnavailableError extends Error {
  readonly code = 'plugin_unavailable';
}

type Entry<T, TConfig> = {
  value: T;
  owner: PluginOwner;
  dependencies: string[];
  validateConfig?: (config: TConfig) => void | Promise<void>;
  activate?: (config: TConfig) => void | Promise<void>;
  deactivate?: () => void | Promise<void>;
  cleanup?: () => void | Promise<void>;
  state: PluginLifecycleState;
  activeLeases: number;
  drainWaiters: Array<() => void>;
};

/** Shared lifecycle for dynamically registered capabilities.
 * Existing registrations can start active; managed plugins can validate then activate.
 */
export class PluginLifecycleRegistry<T, TConfig = Record<string, unknown>> {
  private readonly entries = new Map<string, Entry<T, TConfig>>();

  register(
    key: string,
    value: T,
    options: PluginRegistrationOptions<TConfig> = {},
  ): DisposableRegistration {
    if (!key.trim()) throw new Error('Plugin registration key is required');
    if (this.entries.has(key)) throw new Error(`Plugin registration already exists: ${key}`);
    const owner = options.owner ?? { id: 'core', kind: 'core' };
    this.entries.set(key, {
      value,
      owner,
      dependencies: [...(options.dependencies ?? [])],
      validateConfig: options.validateConfig,
      activate: options.activate,
      deactivate: options.deactivate,
      cleanup: options.cleanup,
      state: options.active === false ? 'registered' : 'active',
      activeLeases: 0,
      drainWaiters: [],
    });
    return { key, owner, dispose: () => this.dispose(key) };
  }

  metadata(key: string): { owner: PluginOwner; state: PluginLifecycleState; activeLeases: number } | undefined {
    const entry = this.entries.get(key);
    return entry ? { owner: entry.owner, state: entry.state, activeLeases: entry.activeLeases } : undefined;
  }

  keys(options: { includeInactive?: boolean } = {}): string[] {
    return [...this.entries.entries()]
      .filter(([, entry]) => options.includeInactive || entry.state === 'active')
      .map(([key]) => key);
  }

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    return entry?.state === 'active' ? entry.value : undefined;
  }

  async activate(key: string, config: TConfig): Promise<void> {
    const entry = this.entries.get(key);
    if (!entry) throw new PluginUnavailableError(`Plugin is not registered: ${key}`);
    for (const dependency of entry.dependencies) {
      if (this.entries.get(dependency)?.state !== 'active') {
        throw new PluginUnavailableError(`Plugin ${key} requires active dependency ${dependency}`);
      }
    }
    try {
      await entry.validateConfig?.(config);
      await entry.activate?.(config);
      entry.state = 'active';
    } catch (error) {
      entry.state = 'failed';
      throw error;
    }
  }

  async run<TResult>(key: string, operation: (value: T) => Promise<TResult>): Promise<TResult> {
    const entry = this.entries.get(key);
    if (!entry || entry.state !== 'active') {
      throw new PluginUnavailableError(`Plugin is not accepting new work: ${key}`);
    }
    entry.activeLeases += 1;
    try {
      return await operation(entry.value);
    } finally {
      entry.activeLeases -= 1;
      if (entry.activeLeases === 0) {
        for (const wake of entry.drainWaiters.splice(0)) wake();
      }
    }
  }

  async deactivate(key: string, options: { timeoutMs?: number } = {}): Promise<void> {
    const entry = this.entries.get(key);
    if (!entry || entry.state === 'inactive') return;
    entry.state = 'draining';
    if (entry.activeLeases > 0) {
      const drained = new Promise<void>((resolve) => entry.drainWaiters.push(resolve));
      const timeoutMs = Math.max(1, options.timeoutMs ?? 30_000);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          drained,
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error(`Timed out draining plugin ${key}`)),
              timeoutMs,
            );
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    await entry.deactivate?.();
    entry.state = 'inactive';
  }

  async dispose(key: string): Promise<void> {
    const entry = this.entries.get(key);
    if (!entry) return;
    await this.deactivate(key);
    await entry.cleanup?.();
    this.entries.delete(key);
  }

  async disposeOwner(ownerId: string): Promise<void> {
    const keys = [...this.entries.entries()]
      .filter(([, entry]) => entry.owner.id === ownerId)
      .map(([key]) => key);
    for (const key of keys) await this.dispose(key);
  }
}
