import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runCheckpointLockPending, withRunCheckpointLock } from './runCheckpointLock.js';

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('withRunCheckpointLock', () => {
  it('runs tasks for the same run one after another', async () => {
    let held = false;
    const order: string[] = [];

    const first = withRunCheckpointLock('run-a', async () => {
      assert.equal(held, false);
      held = true;
      order.push('first:start');
      await tick();
      order.push('first:end');
      held = false;
    });
    const second = withRunCheckpointLock('run-a', async () => {
      order.push('second');
    });

    await Promise.all([first, second]);
    assert.deepEqual(order, ['first:start', 'first:end', 'second']);
    assert.equal(runCheckpointLockPending(), 0);
  });

  it('does not block different runs', async () => {
    const order: string[] = [];
    const gate = new Promise<void>((resolve) => {
      (globalThis as { __gate?: () => void }).__gate = resolve;
    });

    const slow = withRunCheckpointLock('run-a', async () => {
      order.push('a:start');
      await gate;
      order.push('a:end');
    });
    await tick();
    await withRunCheckpointLock('run-b', async () => {
      order.push('b');
    });
    (globalThis as { __gate?: () => void }).__gate?.();
    await slow;

    assert.deepEqual(order, ['a:start', 'b', 'a:end']);
  });
});
