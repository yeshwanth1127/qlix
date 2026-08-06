import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';
import {
  _resetSessionLanesForTests,
  getActiveRun,
  setActiveRun,
  withSessionLane,
} from './sessionLane.js';

describe('withSessionLane', () => {
  beforeEach(() => {
    _resetSessionLanesForTests();
  });

  it('serializes concurrent work on the same session key', async () => {
    const order: number[] = [];
    const key = 'org:a|user:b|channel:web|peer:b';

    const a = withSessionLane(key, async () => {
      order.push(1);
      await new Promise((r) => setTimeout(r, 30));
      order.push(2);
      return 'a';
    });
    const b = withSessionLane(key, async () => {
      order.push(3);
      return 'b';
    });

    const [ra, rb] = await Promise.all([a, b]);
    assert.equal(ra, 'a');
    assert.equal(rb, 'b');
    assert.deepEqual(order, [1, 2, 3]);
  });

  it('tracks active run ids', () => {
    setActiveRun('k', 'run-1');
    assert.equal(getActiveRun('k'), 'run-1');
  });
});
