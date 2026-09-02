import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ScopeDef } from './scopeCatalog.js';
import { filterScopesForBuilderPrompt } from './nlScopeFilter.js';

function scope(id: string): ScopeDef {
  return {
    id: id as ScopeDef['id'],
    label: id,
    description: id,
    forceJit: false,
    runtimes: ['cloud'],
  };
}

const CATALOG: ScopeDef[] = [
  scope('brain.query'),
  scope('web.read'),
  scope('web.research'),
  scope('web.click'),
  scope('files.create'),
  scope('crm.read'),
  scope('crm.write'),
  scope('slack.read'),
  scope('slack.send'),
  scope('mcp.qlix-schedule.schedule_create'),
  scope('mcp.qlix-jobs.search_jobs'),
];

describe('filterScopesForBuilderPrompt', () => {
  it('narrows to CRM scopes for CRM prompts', () => {
    const filtered = filterScopesForBuilderPrompt('agent to manage my zoho crm', CATALOG);
    assert.ok(filtered.some((s) => s.id === 'crm.read'));
    assert.ok(filtered.some((s) => s.id === 'crm.write'));
    assert.ok(!filtered.some((s) => s.id === 'slack.read'));
  });

  it('includes schedule MCP scopes only when schedule intent matches', () => {
    const daily = filterScopesForBuilderPrompt('send me a daily digest every morning', CATALOG);
    assert.ok(daily.some((s) => s.id.startsWith('mcp.qlix-schedule.')));

    const plain = filterScopesForBuilderPrompt('research competitors on the web', CATALOG);
    assert.ok(!plain.some((s) => s.id.startsWith('mcp.qlix-schedule.')));
  });

  it('always includes brain.query', () => {
    const filtered = filterScopesForBuilderPrompt('read slack messages', CATALOG);
    assert.ok(filtered.some((s) => s.id === 'brain.query'));
  });
});
