import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractRunnerToken, RUNNER_TOKEN_HEADER } from './runnerAuth.js';

describe('extractRunnerToken', () => {
  it('reads X-QLIX-Runner-Token header', () => {
    const token = extractRunnerToken({
      headers: { [RUNNER_TOKEN_HEADER]: 'abc123' },
    });
    assert.equal(token, 'abc123');
  });

  it('reads Authorization Bearer token', () => {
    const token = extractRunnerToken({
      headers: { authorization: 'Bearer runner-secret' },
    });
    assert.equal(token, 'runner-secret');
  });

  it('prefers header over Bearer when both present', () => {
    const token = extractRunnerToken({
      headers: {
        [RUNNER_TOKEN_HEADER]: 'from-header',
        authorization: 'Bearer from-bearer',
      },
    });
    assert.equal(token, 'from-header');
  });

  it('returns empty when missing', () => {
    assert.equal(extractRunnerToken({ headers: {} }), '');
  });
});
