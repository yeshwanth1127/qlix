/**
 * Fair inbound scheduling.
 *
 * Every reply on a linked WhatsApp account arrives through one socket, and answering one takes
 * as long as the agent needs to think and send — seconds, sometimes half a minute. A single
 * in-flight flag therefore meant that while one lead was being answered, every other lead's
 * reply was dropped on the floor: no queue, no retry, no log, and WhatsApp never redelivers.
 *
 * So work is serialized **per contact** rather than per account. One lead's messages are handled
 * strictly in the order they arrived — "yes" is answered before "bangalore" — while different
 * leads are handled alongside each other, up to a concurrency ceiling that keeps a 500-lead
 * reply storm from stampeding the backend. Nothing is discarded until a single contact
 * has more than `maxQueuedPerKey` messages outstanding, which is a flood, not a conversation.
 */

const DEFAULT_MAX_CONCURRENT = Number(process.env.QLIX_INBOUND_MAX_CONCURRENT || 64);
const DEFAULT_MAX_QUEUED_PER_KEY = Number(process.env.QLIX_INBOUND_MAX_QUEUED_PER_CONTACT || 20);

/** Admission control: at most `max` tasks run at once; the rest wait in arrival order. */
class Semaphore {
  constructor(max) {
    this.max = Math.max(1, max);
    this.active = 0;
    this.waiters = [];
  }

  acquire() {
    if (this.active < this.max) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  release() {
    const next = this.waiters.shift();
    // Hand the slot straight to the next waiter — decrementing here would let a third task in.
    if (next) next();
    else this.active = Math.max(0, this.active - 1);
  }
}

export function createInboundQueue(options = {}) {
  const maxConcurrent = options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
  const maxQueuedPerKey = options.maxQueuedPerKey ?? DEFAULT_MAX_QUEUED_PER_KEY;
  const onDrop = options.onDrop ?? (() => {});
  const onError = options.onError ?? (() => {});
  const semaphore = new Semaphore(maxConcurrent);
  /** key → { tail: Promise, depth: number } — one FIFO chain per contact. */
  const chains = new Map();

  /**
   * Queue `task` behind anything already pending for `key`. Resolves true once accepted, false
   * when this contact is flooding; the caller logs the drop rather than losing it silently.
   */
  function run(key, task) {
    const chainKey = String(key);
    const state = chains.get(chainKey) ?? { tail: Promise.resolve(), depth: 0 };
    if (state.depth >= maxQueuedPerKey) {
      onDrop(chainKey, state.depth);
      return false;
    }
    state.depth += 1;
    chains.set(chainKey, state);

    state.tail = state.tail
      .then(async () => {
        // The slot is taken only for the work itself. Waiting for one's turn in the per-contact
        // chain must not hold a slot, or contacts with queued messages would deadlock the pool.
        await semaphore.acquire();
        try {
          await task();
        } finally {
          semaphore.release();
        }
      })
      .catch((err) => onError(chainKey, err))
      .finally(() => {
        state.depth -= 1;
        // Drop the chain once idle so a thousand one-off conversations do not accumulate.
        if (state.depth <= 0 && chains.get(chainKey) === state) chains.delete(chainKey);
      });
    return true;
  }

  return {
    run,
    /** Contacts with work outstanding — the number of live conversations, not messages. */
    activeKeys: () => chains.size,
    pending: (key) => chains.get(String(key))?.depth ?? 0,
    stats: () => ({
      activeKeys: chains.size,
      running: semaphore.active,
      waiting: semaphore.waiters.length,
      maxConcurrent,
      maxQueuedPerKey,
    }),
  };
}

/**
 * Message-level replay guard.
 *
 * Baileys re-emits the same message on reconnect, so a duplicate must not start a second turn.
 * The old guard kept one "last message" slot per account, which two contacts replying at once
 * would overwrite for each other; this keeps the window per contact and expires by time.
 */
export function createInboundDedupe(windowMs = 60_000, maxEntries = 5_000) {
  const seen = new Map();

  function prune(now) {
    if (seen.size <= maxEntries) return;
    for (const [key, at] of seen) {
      if (now - at > windowMs) seen.delete(key);
      if (seen.size <= maxEntries / 2) break;
    }
  }

  return {
    /** True when this exact message was already accepted inside the window. */
    isDuplicate(key, now = Date.now()) {
      const at = seen.get(key);
      if (at !== undefined && now - at < windowMs) return true;
      seen.set(key, now);
      prune(now);
      return false;
    },
    size: () => seen.size,
  };
}
