import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createInboundDedupe, createInboundQueue } from './inboundQueue.js';

const tick = () => new Promise((resolve) => setImmediate(resolve));
const settle = async (rounds = 50) => {
  for (let i = 0; i < rounds; i += 1) await tick();
};

/** A task that blocks until released, so overlap is observable instead of timing-dependent. */
function gate() {
  let release;
  const promise = new Promise((resolve) => {
    release = resolve;
  });
  return { promise, release: () => release() };
}

describe('createInboundQueue', () => {
  it('answers a second contact while the first is still being handled', async () => {
    // The incident: Hemila's turn held the only slot for 24s and Raghu's "yes" was discarded.
    const queue = createInboundQueue();
    const hemila = gate();
    const started = [];

    queue.run('hemila', async () => {
      started.push('hemila');
      await hemila.promise;
    });
    queue.run('raghu', async () => {
      started.push('raghu');
    });
    await settle();

    assert.deepEqual(started, ['hemila', 'raghu']);
    hemila.release();
    await settle();
    assert.equal(queue.activeKeys(), 0);
  });

  it('keeps one contact strictly in order', async () => {
    const queue = createInboundQueue();
    const first = gate();
    const order = [];

    queue.run('lead', async () => {
      order.push('yes:start');
      await first.promise;
      order.push('yes:end');
    });
    queue.run('lead', async () => {
      order.push('bangalore');
    });
    await settle();

    assert.deepEqual(order, ['yes:start'], 'second message must wait for the first to finish');
    first.release();
    await settle();
    assert.deepEqual(order, ['yes:start', 'yes:end', 'bangalore']);
  });

  it('caps how many run at once and lets the rest through as slots free up', async () => {
    const queue = createInboundQueue({ maxConcurrent: 2 });
    const gates = [gate(), gate(), gate()];
    const started = [];

    gates.forEach((g, index) =>
      queue.run(`lead-${index}`, async () => {
        started.push(index);
        await g.promise;
      }),
    );
    await settle();
    assert.deepEqual(started, [0, 1], 'third lead waits for a slot rather than being dropped');

    gates[0].release();
    await settle();
    assert.deepEqual(started, [0, 1, 2]);
    gates[1].release();
    gates[2].release();
    await settle();
    assert.equal(queue.stats().running, 0);
  });

  it('accepts a thousand contacts without losing any', async () => {
    const queue = createInboundQueue({ maxConcurrent: 16 });
    const handled = [];
    for (let i = 0; i < 1000; i += 1) {
      assert.equal(queue.run(`lead-${i}`, async () => {
        await tick();
        handled.push(i);
      }), true);
    }
    await settle(4000);
    assert.equal(handled.length, 1000);
    assert.equal(queue.activeKeys(), 0, 'finished conversations must not accumulate');
  });

  it('reports a flooding contact instead of silently dropping', async () => {
    const dropped = [];
    const queue = createInboundQueue({
      maxQueuedPerKey: 2,
      onDrop: (key, depth) => dropped.push([key, depth]),
    });
    const held = gate();
    queue.run('lead', async () => {
      await held.promise;
    });
    assert.equal(queue.run('lead', async () => {}), true);
    assert.equal(queue.run('lead', async () => {}), false);
    assert.deepEqual(dropped, [['lead', 2]]);
    held.release();
    await settle();
  });

  it('a failing turn does not wedge that contact or the pool', async () => {
    const errors = [];
    const queue = createInboundQueue({ onError: (key, err) => errors.push([key, err.message]) });
    const after = [];

    queue.run('lead', async () => {
      throw new Error('backend timeout');
    });
    queue.run('lead', async () => {
      after.push('next message still handled');
    });
    await settle();

    assert.deepEqual(errors, [['lead', 'backend timeout']]);
    assert.deepEqual(after, ['next message still handled']);
    assert.equal(queue.stats().running, 0);
  });
});

describe('createInboundDedupe', () => {
  it('suppresses a replayed message but not a different contact saying the same thing', () => {
    const dedupe = createInboundDedupe(60_000);
    assert.equal(dedupe.isDuplicate('raghu:MSG1:yes', 1_000), false);
    assert.equal(dedupe.isDuplicate('raghu:MSG1:yes', 2_000), true);
    // Two leads answering "yes" at once must both get through — the old single-slot guard
    // overwrote one with the other.
    assert.equal(dedupe.isDuplicate('hemila:MSG2:yes', 2_100), false);
  });

  it('forgets outside the window and stays bounded', () => {
    const dedupe = createInboundDedupe(1_000, 100);
    assert.equal(dedupe.isDuplicate('lead:MSG:hi', 0), false);
    assert.equal(dedupe.isDuplicate('lead:MSG:hi', 5_000), false);
    for (let i = 0; i < 5_000; i += 1) dedupe.isDuplicate(`lead-${i}:MSG:hi`, 10_000 + i);
    assert.ok(dedupe.size() <= 5_000, `unbounded dedupe map: ${dedupe.size()}`);
  });
});
