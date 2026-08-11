import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  agentAskScopeFor,
  agentIdFromAskScope,
  askableAgentIds,
  isAgentAskScope,
} from './peerAgentScopes.js';
import { isAgentAskPermissionScope, isValidPermissionScope } from './scopeValidation.js';
import { filterScopesByToolProfile } from './toolProfiles.js';
import type { PermissionScope } from './agents.types.js';

describe('agent.ask scope ids', () => {
  it('round-trips an agent id', () => {
    const scope = agentAskScopeFor('clx123abc');
    assert.equal(scope, 'agent.ask.clx123abc');
    assert.equal(isAgentAskScope(scope), true);
    assert.equal(agentIdFromAskScope(scope), 'clx123abc');
  });

  it('does not claim unrelated scopes', () => {
    assert.equal(isAgentAskScope('web.read'), false);
    assert.equal(isAgentAskScope('mcp.qlix-jobs.list_applications'), false);
    assert.equal(agentIdFromAskScope('web.read'), null);
  });

  it('rejects a bare prefix with no agent id', () => {
    assert.equal(agentIdFromAskScope('agent.ask.'), null);
  });

  it('collects unique targets from a mixed scope set', () => {
    const ids = askableAgentIds([
      'web.read',
      'agent.ask.a1',
      'mcp.qlix-jobs.list_applications',
      'agent.ask.a2',
      'agent.ask.a1',
    ]);
    assert.deepEqual(ids.sort(), ['a1', 'a2']);
  });

  it('returns nothing when no grants are present', () => {
    assert.deepEqual(askableAgentIds(['web.read', 'email.send']), []);
  });
});

describe('permission scope validation', () => {
  it('accepts agent.ask ids', () => {
    assert.equal(isAgentAskPermissionScope('agent.ask.clx123'), true);
    assert.equal(isValidPermissionScope('agent.ask.clx123'), true);
  });

  it('rejects malformed variants', () => {
    // A dot in the id would make the target ambiguous against future sub-namespaces.
    assert.equal(isAgentAskPermissionScope('agent.ask.a.b'), false);
    assert.equal(isAgentAskPermissionScope('agent.ask.'), false);
    assert.equal(isAgentAskPermissionScope('agent.ask'), false);
    assert.equal(isAgentAskPermissionScope('agent.tell.abc'), false);
    assert.equal(isValidPermissionScope('agent.ask.'), false);
  });

  it('still accepts builtin and mcp scopes', () => {
    assert.equal(isValidPermissionScope('web.read'), true);
    assert.equal(isValidPermissionScope('mcp.qlix-jobs.list_applications'), true);
    assert.equal(isValidPermissionScope('not.a.scope'), false);
  });
});

describe('tool profile filtering', () => {
  const scopes = [
    'web.read',
    'email.send',
    'mcp.qlix-jobs.list_applications',
    'agent.ask.a1',
  ] as PermissionScope[];

  it('keeps deliberate per-target grants under a narrowed profile', () => {
    // `minimal` hides rarely-used built-ins; it must not revoke a grant the user made
    // explicitly, which is how mcp.* has always behaved.
    const filtered = filterScopesByToolProfile(scopes, 'minimal');
    assert.ok(filtered.includes('agent.ask.a1' as PermissionScope));
    assert.ok(filtered.includes('mcp.qlix-jobs.list_applications' as PermissionScope));
    assert.ok(filtered.includes('web.read' as PermissionScope));
    assert.ok(!filtered.includes('email.send' as PermissionScope));
  });

  it('leaves everything alone on full', () => {
    assert.deepEqual(filterScopesByToolProfile(scopes, 'full'), scopes);
  });
});
