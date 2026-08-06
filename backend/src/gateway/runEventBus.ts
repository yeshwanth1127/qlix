import { EventEmitter } from 'node:events';

export type RunBusEvent = {
  runId: string;
  seq: number;
  type: string;
  data: unknown;
  createdAt: string;
};

type BusListener = (event: RunBusEvent) => void;

/**
 * Run-event bus with optional Redis pub/sub.
 * Falls back to in-process EventEmitter when REDIS_URL is unset (dev / single instance).
 */
class RunEventBus {
  private readonly local = new EventEmitter();
  private redisPub: import('ioredis').default | null = null;
  private redisSub: import('ioredis').default | null = null;
  private ready: Promise<void> | null = null;

  constructor() {
    this.local.setMaxListeners(200);
  }

  private channel(runId: string): string {
    return `qlix:run:${runId}`;
  }

  async init(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      const url = process.env.REDIS_URL?.trim() || process.env.QLIX_REDIS_URL?.trim();
      if (!url) {
        console.info('[run-event-bus] REDIS_URL unset — using in-process bus');
        return;
      }
      try {
        const mod = await import('ioredis');
        const RedisCtor = (mod as unknown as { default: new (u: string, opts?: object) => import('ioredis').default }).default
          ?? (mod as unknown as new (u: string, opts?: object) => import('ioredis').default);
        this.redisPub = new RedisCtor(url, { maxRetriesPerRequest: 2, lazyConnect: true });
        this.redisSub = new RedisCtor(url, { maxRetriesPerRequest: 2, lazyConnect: true });
        const pub = this.redisPub;
        const sub = this.redisSub;
        await Promise.all([pub.connect(), sub.connect()]);
        sub.on('message', (ch, message) => {
          try {
            const parsed = JSON.parse(message) as RunBusEvent;
            this.local.emit(ch, parsed);
          } catch {
            // ignore malformed
          }
        });
        console.info('[run-event-bus] Redis pub/sub connected');
      } catch (err) {
        console.warn(
          '[run-event-bus] Redis connect failed — falling back to in-process',
          err instanceof Error ? err.message : err,
        );
        this.redisPub = null;
        this.redisSub = null;
      }
    })();
    return this.ready;
  }

  async publish(event: RunBusEvent): Promise<void> {
    await this.init();
    const ch = this.channel(event.runId);
    this.local.emit(ch, event);
    if (this.redisPub) {
      try {
        await this.redisPub.publish(ch, JSON.stringify(event));
      } catch (err) {
        console.warn('[run-event-bus] publish failed', err instanceof Error ? err.message : err);
      }
    }
  }

  async subscribe(runId: string, listener: BusListener): Promise<() => void> {
    await this.init();
    const ch = this.channel(runId);
    this.local.on(ch, listener);
    if (this.redisSub) {
      try {
        await this.redisSub.subscribe(ch);
      } catch (err) {
        console.warn('[run-event-bus] subscribe failed', err instanceof Error ? err.message : err);
      }
    }
    return () => {
      this.local.off(ch, listener);
      if (this.redisSub) {
        void this.redisSub.unsubscribe(ch).catch(() => undefined);
      }
    };
  }

  async close(): Promise<void> {
    await this.redisPub?.quit().catch(() => undefined);
    await this.redisSub?.quit().catch(() => undefined);
    this.redisPub = null;
    this.redisSub = null;
  }
}

export const runEventBus = new RunEventBus();
