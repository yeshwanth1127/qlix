import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractMcpBindingRequests, isMcpScope } from './mcpScopeCatalog.js';

describe('mcpScopeCatalog', () => {
  it('isMcpScope identifies mcp namespace', () => {
    assert.equal(isMcpScope('mcp.qlix-leads.gmb_search_leads'), true);
    assert.equal(isMcpScope('web.read'), false);
  });

  it('extractMcpBindingRequests groups tools by server slug', () => {
    const map = extractMcpBindingRequests([
      'web.read',
      'mcp.qlix-leads.gmb_search_leads',
      'mcp.qlix-leads.list_leads',
    ]);
    assert.equal(map.size, 1);
    assert.deepEqual(map.get('qlix-leads'), ['gmb_search_leads', 'list_leads']);
  });

  it('extractMcpBindingRequests treats wildcard as allow-all', () => {
    const map = extractMcpBindingRequests([
      'mcp.qlix-leads.*',
      'mcp.qlix-leads.gmb_search_leads',
    ]);
    assert.equal(map.get('qlix-leads'), '*');
  });

  it('extractMcpBindingRequests supports multiple servers', () => {
    const map = extractMcpBindingRequests([
      'mcp.qlix-leads.list_leads',
      'mcp.github.create_issue',
    ]);
    assert.equal(map.size, 2);
    assert.deepEqual(map.get('qlix-leads'), ['list_leads']);
    assert.deepEqual(map.get('github'), ['create_issue']);
  });
});
