import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  apiKeyHasScopes,
  isApiKeyCredential,
  normalizeApiKeyScopes,
  resolveApiKeyRouteAccess,
} from './apiKeyScopes.js';

describe('apiKeyScopes', () => {
  it('detects qlix_live credentials', () => {
    assert.equal(isApiKeyCredential('qlix_live_abc'), true);
    assert.equal(isApiKeyCredential('eyJhbGciOi'), false);
  });

  it('normalizes scopes and defaults to full set', () => {
    assert.ok(normalizeApiKeyScopes(undefined).includes('agents:read'));
    assert.deepEqual(normalizeApiKeyScopes(['agents:read', 'nope', 'agents:read']), ['agents:read']);
  });

  it('checks required scopes', () => {
    assert.equal(apiKeyHasScopes(['agents:read'], ['agents:read']), true);
    assert.equal(apiKeyHasScopes(['agents:read'], ['agents:write']), false);
  });

  it('allowlists curated developer routes', () => {
    assert.deepEqual(resolveApiKeyRouteAccess('GET', '/api/v1/auth/me'), {
      allowed: true,
      scopes: [],
    });
    assert.deepEqual(resolveApiKeyRouteAccess('GET', '/api/v1/agents'), {
      allowed: true,
      scopes: ['agents:read'],
    });
    assert.deepEqual(resolveApiKeyRouteAccess('POST', '/api/v1/agents/abc/conversations'), {
      allowed: true,
      scopes: ['runs:write'],
    });
    assert.deepEqual(resolveApiKeyRouteAccess('POST', '/api/v1/ai-brain/query'), {
      allowed: true,
      scopes: ['brain:read'],
    });
    assert.deepEqual(resolveApiKeyRouteAccess('GET', '/api/v1/dashboard/audit'), {
      allowed: true,
      scopes: ['audit:read'],
    });
    assert.deepEqual(resolveApiKeyRouteAccess('POST', '/api/v1/teams/t1/runs'), {
      allowed: true,
      scopes: ['teams:write'],
    });
    assert.deepEqual(resolveApiKeyRouteAccess('POST', '/api/v1/agents/nl-parse'), {
      allowed: true,
      scopes: ['builder:write'],
    });
    assert.deepEqual(resolveApiKeyRouteAccess('POST', '/api/v1/agents/nl-create'), {
      allowed: true,
      scopes: ['builder:write'],
    });
    assert.deepEqual(resolveApiKeyRouteAccess('GET', '/api/v1/nl-builder/sessions'), {
      allowed: true,
      scopes: ['builder:read'],
    });
    assert.deepEqual(resolveApiKeyRouteAccess('GET', '/api/v1/builder/canvases'), {
      allowed: true,
      scopes: ['builder:read'],
    });
  });

  it('rejects non-developer routes for API keys', () => {
    assert.deepEqual(resolveApiKeyRouteAccess('GET', '/api/v1/connectors'), {
      allowed: false,
      reason: 'not_in_developer_api',
    });
    assert.deepEqual(resolveApiKeyRouteAccess('POST', '/api/v1/agents/nl-parse-not-a-route'), {
      allowed: false,
      reason: 'not_in_developer_api',
    });
  });
});
