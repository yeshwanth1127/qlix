import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractMcpBindingRequests, isMcpScope } from './mcpScopeCatalog.js';

describe('mcpScopeCatalog', () => {
  it('isMcpScope identifies mcp namespace', () => {
    assert.equal(isMcpScope('mcp.qlix-jobs.search_jobs'), true);
    assert.equal(isMcpScope('web.read'), false);
  });

  it('extractMcpBindingRequests groups tools by server slug', () => {
    const map = extractMcpBindingRequests([
      'web.read',
      'mcp.qlix-jobs.search_jobs',
      'mcp.qlix-jobs.list_applications',
    ]);
    assert.equal(map.size, 1);
    assert.deepEqual(map.get('qlix-jobs'), ['search_jobs', 'list_applications']);
  });

  it('extractMcpBindingRequests treats wildcard as allow-all', () => {
    const map = extractMcpBindingRequests([
      'mcp.qlix-jobs.*',
      'mcp.qlix-jobs.search_jobs',
    ]);
    assert.equal(map.get('qlix-jobs'), '*');
  });

  it('extractMcpBindingRequests supports multiple servers', () => {
    const map = extractMcpBindingRequests([
      'mcp.qlix-jobs.list_applications',
      'mcp.github.create_issue',
    ]);
    assert.equal(map.size, 2);
    assert.deepEqual(map.get('qlix-jobs'), ['list_applications']);
    assert.deepEqual(map.get('github'), ['create_issue']);
  });
});
