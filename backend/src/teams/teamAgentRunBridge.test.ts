import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { actingToolCall, buildTeamPromptEnvelope, TeamAgentRunBridge } from './teamAgentRunBridge.js';
import { isActingScope } from './teamOrchestrator.js';
import { TEAM_DISPATCH_ONLY_SKILL } from './lunaTeamsHost.js';
import { DEFAULT_TEAM_CONFIG } from './teams.types.js';
import type { TeamDTO } from './teams.types.js';

const team: TeamDTO = {
  id: 'team-1',
  orgId: 'org-1',
  createdByUserId: 'user-1',
  supervisorAgentId: 'sup-1',
  did: 'did:qlix:team',
  name: 'Alpha Team',
  description: null,
  status: 'active',
  config: DEFAULT_TEAM_CONFIG,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe('teamAgentRunBridge', () => {
  it('buildTeamPromptEnvelope includes team context', () => {
    const prompt = buildTeamPromptEnvelope({
      team,
      role: 'worker',
      delegatedScopes: ['web.read'],
      task: 'Summarize competitors',
    });
    assert.ok(prompt.includes('Alpha Team'));
    assert.ok(prompt.includes('Role: worker'));
    assert.ok(prompt.includes('Summarize competitors'));
  });

  it('does not advertise team.dispatch as a connector scope', () => {
    const prompt = buildTeamPromptEnvelope({
      team,
      role: 'worker',
      delegatedScopes: [TEAM_DISPATCH_ONLY_SKILL],
      task: 'Filter Bangalore leads',
    });
    assert.match(prompt, /Delegated scopes: none/);
    assert.doesNotMatch(prompt, /crm\.write/);
  });

  it('extractResultText reads text field', () => {
    assert.equal(TeamAgentRunBridge.extractResultText({ text: 'hello' }), 'hello');
  });
});

describe('actingToolCall', () => {
  it('counts a connector tool that succeeded and changed something', () => {
    assert.equal(
      actingToolCall({ ok: true, tool: 'whatsapp_send_message', message: 'tool_finished' }),
      'whatsapp_send_message',
    );
    assert.equal(actingToolCall({ ok: true, tool: 'sheets_write', message: 'tool_finished' }), 'sheets_write');
  });

  it('ignores meta tools, lookups, failures and unfinished calls', () => {
    // The run that shipped nothing looked exactly like this: think, a failed call_tool, think.
    for (const data of [
      { ok: true, tool: 'think', message: 'tool_finished' },
      { ok: true, tool: 'find_tools', message: 'tool_finished' },
      { ok: true, tool: 'brain_query', message: 'tool_finished' },
      { ok: true, tool: 'crm_list', message: 'tool_finished' },
      { ok: true, tool: 'whatsapp_get_contact', message: 'tool_finished' },
      { ok: false, tool: 'call_tool', message: 'tool_finished', error: 'Unknown tool: whatsapp_send_message' },
      { tool: 'whatsapp_send_message', message: 'tool_started' },
      null,
      'not an event',
    ]) {
      assert.equal(actingToolCall(data), null, JSON.stringify(data));
    }
  });

  it('treats an unrecognised tool name as acting rather than risk failing a real send', () => {
    assert.equal(
      actingToolCall({ ok: true, tool: 'some_new_connector', message: 'tool_finished' }),
      'some_new_connector',
    );
  });
});

describe('isActingScope', () => {
  it('separates scopes that must produce a tool call from ones that need not', () => {
    for (const scope of ['whatsapp.contact_send', 'email.send', 'crm.write', 'sheets.write']) {
      assert.equal(isActingScope(scope), true, scope);
    }
    for (const scope of ['whatsapp.auto_reply', 'brain.query', 'web.research', 'crm.read']) {
      assert.equal(isActingScope(scope), false, scope);
    }
  });
});
