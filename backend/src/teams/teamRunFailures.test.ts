import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  missingAttachmentFailure,
  resolveTeamRunFailure,
  teamRunFailureFromMessage,
  teamRunFailurePayload,
} from './teamRunFailures.js';

describe('teamRunFailures', () => {
  it('builds a structured missing attachment failure', () => {
    const failure = missingAttachmentFailure();
    assert.equal(failure.code, 'missing_attachment');
    assert.match(failure.hint ?? '', /paperclip/i);
  });

  it('maps legacy orchestrator messages', () => {
    const failure = teamRunFailureFromMessage(
      'Dispatch refers to a provided file but has no valid input reference',
    );
    assert.equal(failure.code, 'missing_input_reference');
    assert.ok(failure.reason);
  });

  it('resolves failure from run_failed payload', () => {
    const failure = missingAttachmentFailure();
    const resolved = resolveTeamRunFailure(
      { status: 'failed', errorMessage: failure.message },
      [{
        eventType: 'run_failed',
        payload: teamRunFailurePayload(failure),
      }],
    );
    assert.equal(resolved?.code, 'missing_attachment');
  });
});
