import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildTeamPromptEnvelope, TeamAgentRunBridge } from './teamAgentRunBridge.js';
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
