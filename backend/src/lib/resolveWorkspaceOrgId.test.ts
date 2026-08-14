import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Request } from 'express';
import { resolveWorkspaceOrgId } from './resolveWorkspaceOrgId.js';

function fakeRequest(auth: Request['auth']): Request {
  return { auth } as Request;
}

describe('resolveWorkspaceOrgId', () => {
  it('uses the org bound to an API key and ignores body orgId', () => {
    const request = fakeRequest({
      userId: 'u1',
      orgId: 'org-from-key',
      email: 'a@b.c',
      role: 'owner',
      authMethod: 'api_key',
    });
    assert.equal(resolveWorkspaceOrgId(request, 'other-org'), 'org-from-key');
    assert.equal(resolveWorkspaceOrgId(request, null), 'org-from-key');
    assert.equal(resolveWorkspaceOrgId(request), 'org-from-key');
  });

  it('lets a session pass explicit null or uuid', () => {
    const request = fakeRequest({
      userId: 'u1',
      orgId: 'org-session',
      email: 'a@b.c',
      role: 'owner',
      authMethod: 'session',
    });
    assert.equal(resolveWorkspaceOrgId(request, null), null);
    assert.equal(resolveWorkspaceOrgId(request, 'org-session'), 'org-session');
    assert.equal(resolveWorkspaceOrgId(request), 'org-session');
  });
});
