import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isValidPermissionScope } from './scopeValidation.js';

describe('scopeValidation', () => {
  it('accepts builtin scopes', () => {
    assert.equal(isValidPermissionScope('web.read'), true);
    assert.equal(isValidPermissionScope('email.send'), true);
  });

  it('accepts mcp tool scopes', () => {
    assert.equal(isValidPermissionScope('mcp.qlix-jobs.search_jobs'), true);
    assert.equal(isValidPermissionScope('mcp.qlix-jobs.queue_applications'), true);
  });

  it('rejects unknown scopes', () => {
    assert.equal(isValidPermissionScope('not.a.scope'), false);
    assert.equal(isValidPermissionScope('mcp.bad'), false);
  });
});
