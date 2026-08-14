import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatPollVoteText,
  shouldForwardPollVote,
  validatePollPayload,
  rememberPollCreation,
} from './pollStore.js';

describe('validatePollPayload', () => {
  it('requires at least two unique options', () => {
    assert.equal(validatePollPayload({ name: 'Hi?', values: ['Yes'] }).ok, false);
    assert.equal(validatePollPayload({ name: 'Hi?', values: ['Yes', 'Yes'] }).ok, false);
    const ok = validatePollPayload({ name: 'Hi?', values: ['Yes', 'No'] });
    assert.equal(ok.ok, true);
    assert.deepEqual(ok.values, ['Yes', 'No']);
    assert.equal(ok.selectableCount, 1);
  });

  it('clamps selectableCount', () => {
    const ok = validatePollPayload({
      name: 'Pick',
      values: ['A', 'B', 'C'],
      selectableCount: 9,
    });
    assert.equal(ok.ok, true);
    assert.equal(ok.selectableCount, 3);
  });
});

describe('formatPollVoteText', () => {
  it('joins selected options', () => {
    assert.equal(formatPollVoteText(['Yes']), 'Yes');
    assert.equal(formatPollVoteText(['Yes', 'Maybe']), 'Yes, Maybe');
  });
});

describe('shouldForwardPollVote', () => {
  it('forwards a new fingerprint once', () => {
    rememberPollCreation({
      connectorId: 'test-connector',
      id: 'poll-1',
      remoteJid: '111@s.whatsapp.net',
      message: { pollCreationMessage: { name: 'Hi?', options: [] } },
    });
    assert.equal(shouldForwardPollVote('test-connector', 'poll-1', 'voter', 'Yes'), true);
    assert.equal(shouldForwardPollVote('test-connector', 'poll-1', 'voter', 'Yes'), false);
    assert.equal(shouldForwardPollVote('test-connector', 'poll-1', 'voter', 'No'), true);
  });
});
