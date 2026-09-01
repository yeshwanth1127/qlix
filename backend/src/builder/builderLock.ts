/**
 * Best-effort session lock so two tabs cannot run discovery on the same
 * conversation concurrently. Uses Redis when REDIS_URL is set; otherwise an
 * in-process map (fine for single-instance dev).
 */

type LockHandle = { release: () => Promise<void> };

const localLocks = new Map<string, number>();
let redisPromise: Promise<import('ioredis').default | null> | null = null;

async function getRedis(): Promise<import('ioredis').default | null> {
  if (!redisPromise) {
    redisPromise = (async () => {
      const url = process.env.REDIS_URL?.trim() || process.env.QLIX_REDIS_URL?.trim();
      if (!url) return null;
      try {
        const mod = await import('ioredis');
        const RedisCtor = (mod as unknown as { default: new (u: string, opts?: object) => import('ioredis').default }).default
          ?? (mod as unknown as new (u: string, opts?: object) => import('ioredis').default);
        const client = new RedisCtor(url, { maxRetriesPerRequest: 1, lazyConnect: true });
        await client.connect();
        return client;
      } catch {
        return null;
      }
    })();
  }
  return redisPromise;
}

export class BuilderSessionBusyError extends Error {
  constructor() {
    super('This builder conversation is already processing another message. Please wait a moment.');
    this.name = 'BuilderSessionBusyError';
  }
}

export async function acquireBuilderSessionLock(
  sessionId: string,
  ttlMs = 120_000,
): Promise<LockHandle> {
  const key = `qlix:builder:lock:${sessionId}`;
  const redis = await getRedis();
  if (redis) {
    const token = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const ok = await redis.set(key, token, 'PX', ttlMs, 'NX');
    if (ok !== 'OK') throw new BuilderSessionBusyError();
    return {
      release: async () => {
        const current = await redis.get(key);
        if (current === token) await redis.del(key);
      },
    };
  }

  const now = Date.now();
  const existing = localLocks.get(sessionId);
  if (existing && existing > now) throw new BuilderSessionBusyError();
  localLocks.set(sessionId, now + ttlMs);
  return {
    release: async () => {
      localLocks.delete(sessionId);
    },
  };
}
