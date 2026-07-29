import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isValidPermissionScope } from './scopeValidation.js';

describe('scopeValidation', () => {
  it('accepts builtin scopes', () => {
    assert.equal(isValidPermissionScope('web.read'), true);
    assert.equal(isValidPermissionScope('email.send'), true);
  });

  it('accepts mcp tool scopes', () => {
    assert.equal(isValidPermissionScope('mcp.qlix-leads.gmb_search_leads'), true);
    assert.equal(isValidPermissionScope('mcp.qlix-leads.start_outreach'), true);
  });

  it('rejects unknown scopes', () => {
    assert.equal(isValidPermissionScope('not.a.scope'), false);
    assert.equal(isValidPermissionScope('mcp.bad'), false);
  });
});
