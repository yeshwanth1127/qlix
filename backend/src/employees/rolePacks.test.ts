import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EMPLOYEE_ROLE_MANIFESTS } from './rolePacks.js';
import { hashRoleManifest } from './packHash.js';

describe('employee role manifests', () => {
  it('defines six unique slugs with stable hashes', () => {
    assert.equal(EMPLOYEE_ROLE_MANIFESTS.length, 6);
    const slugs = new Set(EMPLOYEE_ROLE_MANIFESTS.map((m) => m.slug));
    assert.equal(slugs.size, 6);
    for (const m of EMPLOYEE_ROLE_MANIFESTS) {
      assert.ok(m.outcomes.length >= 3);
      assert.ok(m.permissionScopes.length >= 1);
      assert.match(hashRoleManifest(m), /^[a-f0-9]{64}$/);
    }
  });

  it('keeps jit scopes subset of permission scopes', () => {
    for (const m of EMPLOYEE_ROLE_MANIFESTS) {
      for (const j of m.jitScopes) {
        assert.ok(
          m.permissionScopes.includes(j),
          `${m.slug}: jit scope ${j} not in permissionScopes`,
        );
      }
    }
  });
});
