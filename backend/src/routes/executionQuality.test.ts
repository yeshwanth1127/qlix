import assert from 'node:assert/strict';
import test from 'node:test';
import {
  artifactValidityFromLists,
  completionFromStatuses,
  contractPassFromMailbox,
  isValidTeamArtifact,
  summarizeSuccessQuality,
  userRetryFromRuns,
} from './executionQuality.js';

test('completion rate uses only terminal runs', () => {
  const rate = completionFromStatuses(['completed', 'completed', 'failed', 'running', 'queued']);
  assert.equal(rate.total, 3);
  assert.equal(rate.passed, 2);
  assert.equal(rate.rate, 2 / 3);
});

test('contract pass ignores pending mailbox rows', () => {
  const rate = contractPassFromMailbox(['pending', 'completed', 'failed', 'completed']);
  assert.equal(rate.total, 3);
  assert.equal(rate.passed, 2);
});

test('artifact validity requires type, name, content, and agent', () => {
  assert.equal(isValidTeamArtifact({ id: 'a', type: 'text', name: 'note', content: 'hi', agentId: 'agent' }), true);
  assert.equal(isValidTeamArtifact({ id: 'a', type: 'text', name: 'note', content: '  ', agentId: 'agent' }), false);
  const rate = artifactValidityFromLists([
    [{ id: 'a', type: 'text', name: 'note', content: 'hi', agentId: 'agent' }],
    [{ id: 'b', type: 'json', name: '', content: {}, agentId: 'agent' }],
  ]);
  assert.equal(rate.passed, 1);
  assert.equal(rate.total, 2);
});

test('user retry counts follow-up Team runs and failed-then-retry conversations', () => {
  const rate = userRetryFromRuns([
    { conversationId: 'c1', createdAt: '2026-08-01T00:00:00.000Z', status: 'failed' },
    { conversationId: 'c1', createdAt: '2026-08-01T00:01:00.000Z', status: 'completed' },
    { conversationId: 'team', createdAt: '2026-08-01T00:00:00.000Z', status: 'failed', continuesRunId: 'prev' },
    { conversationId: 'worker', createdAt: '2026-08-01T00:00:00.000Z', status: 'failed', teamRunId: 't1', invocationKind: 'team_worker' },
  ]);
  assert.equal(rate.passed, 2);
  assert.equal(rate.total, 3);
});

test('empty windows report a perfect rate so missing data is not a false alarm', () => {
  const quality = summarizeSuccessQuality({
    runStatuses: [],
    mailboxStatuses: [],
    artifactLists: [],
    retryRuns: [],
  });
  assert.equal(quality.completion.rate, 1);
  assert.equal(quality.contractPass.rate, 1);
  assert.equal(quality.artifactValidity.rate, 1);
  assert.equal(quality.userRetry.rate, 0);
});
