import assert from 'node:assert/strict';
import test from 'node:test';
import { canTransitionAgentRunToTerminal } from './agentRunService.js';
import { canTransitionSubAgent } from '../agents/subAgent.service.js';

test('only active runs may accept a terminal completion report', () => {
  assert.equal(canTransitionAgentRunToTerminal('queued'), true);
  assert.equal(canTransitionAgentRunToTerminal('running'), true);
  assert.equal(canTransitionAgentRunToTerminal('success'), false);
  assert.equal(canTransitionAgentRunToTerminal('failed'), false);
  assert.equal(canTransitionAgentRunToTerminal('canceled'), false);
  assert.equal(canTransitionAgentRunToTerminal('cancelled'), false);
});

test('late subagent updates cannot overwrite any terminal result', () => {
  assert.equal(canTransitionSubAgent('queued'), true);
  assert.equal(canTransitionSubAgent('running'), true);
  assert.equal(canTransitionSubAgent('completed'), false);
  assert.equal(canTransitionSubAgent('failed'), false);
  assert.equal(canTransitionSubAgent('canceled'), false);
});
