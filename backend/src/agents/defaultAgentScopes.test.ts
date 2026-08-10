import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_AGENT_SCOPES,
  missingDefaultAgentScopes,
  withDefaultAgentScopes,
} from './defaultAgentScopes.js';

describe('withDefaultAgentScopes', () => {
  it('adds brain.query and all qlix-schedule tools', () => {
    const merged = withDefaultAgentScopes(['web.read']);
    assert.ok(merged.includes('web.read'));
    assert.ok(merged.includes('brain.query'));
    for (const s of DEFAULT_AGENT_SCOPES) {
      assert.ok(merged.includes(s), `missing ${s}`);
    }
  });

  it('is idempotent', () => {
    const once = withDefaultAgentScopes(['web.read', 'brain.query']);
    const twice = withDefaultAgentScopes(once);
    assert.deepEqual(twice, once);
  });

  it('preserves caller order and appends defaults', () => {
    const merged = withDefaultAgentScopes(['email.send', 'web.click']);
    assert.equal(merged[0], 'email.send');
    assert.equal(merged[1], 'web.click');
    assert.ok(merged.indexOf('brain.query') > 1);
  });
});

describe('missingDefaultAgentScopes', () => {
  it('reports only absent defaults', () => {
    const missing = missingDefaultAgentScopes(['brain.query', 'web.read']);
    assert.ok(!missing.includes('brain.query'));
    assert.ok(missing.some((s) => s.startsWith('mcp.qlix-schedule.')));
  });
});
