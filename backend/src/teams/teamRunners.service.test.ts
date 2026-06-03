import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertRunnersReady,
  buildRunnerStatusEntry,
  buildTeamRunnersStatus,
  isHeartbeatFresh,
} from './teamRunners.service.js';
import type { AgentDTO } from '../agents/agents.types.js';
import type { TeamDTO } from './teams.types.js';
import { DEFAULT_TEAM_CONFIG } from './teams.types.js';

function mockAgent(overrides: Partial<AgentDTO> = {}): AgentDTO {
  return {
    id: 'agent-1',
    userId: 'user-1',
    orgId: 'org-1',
    did: 'did:qlix:abc123',
    publicKey: 'pk',
    name: 'Test Agent',
    status: 'active',
    runtime: 'cloud',
    model: 'gpt-4o-mini',
    localInferenceMode: null,
    llmMode: 'proxy',
    permissionScopes: ['web.read'],
    jitScopes: [],
    alwaysScopes: ['web.read'],
    webauthnCredentialId: null,
    keypairDeliveredAt: null,
    lastConnectedAt: null,
    lastActive: null,
    createdAt: new Date().toISOString(),
    cloudProvisioningStatus: 'running',
    cloudRunnerId: 'container-1',
    cloudLastHeartbeatAt: new Date().toISOString(),
    cloudProvisioningError: null,
    agentKind: 'standard',
    ...overrides,
  };
}

const baseTeam: TeamDTO = {
  id: 'team-1',
  orgId: 'org-1',
  createdByUserId: 'user-1',
  supervisorAgentId: 'sup-1',
  did: 'did:qlix:team1',
  name: 'Research Team',
  description: null,
  status: 'active',
  config: DEFAULT_TEAM_CONFIG,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  members: [
    {
      id: 'm1',
      teamId: 'team-1',
      agentId: 'worker-1',
      role: 'worker',
      delegatedScopes: [],
      agentCardSnapshot: null,
      addedAt: new Date().toISOString(),
    },
  ],
};

describe('teamRunners.service', () => {
  it('isHeartbeatFresh detects recent ping', () => {
    assert.equal(isHeartbeatFresh(new Date()), true);
    assert.equal(isHeartbeatFresh(new Date(Date.now() - 60_000)), false);
  });

  it('buildTeamRunnersStatus allReady when cloud runners online', () => {
    const agents = new Map<string, AgentDTO>([
      ['sup-1', mockAgent({ id: 'sup-1', name: 'Supervisor' })],
      ['worker-1', mockAgent({ id: 'worker-1', name: 'Worker' })],
    ]);
    const status = buildTeamRunnersStatus(baseTeam, agents, true);
    assert.equal(status.allReady, true);
    assert.equal(status.runners.length, 2);
  });

  it('assertRunnersReady throws without workers', () => {
    const status = buildTeamRunnersStatus(
      { ...baseTeam, members: [] },
      new Map([['sup-1', mockAgent({ id: 'sup-1' })]]),
      true,
    );
    assert.throws(() => assertRunnersReady(status), /no worker/i);
  });

  it('team container name prefix when team context set', () => {
    const entry = buildRunnerStatusEntry({
      agent: mockAgent({ name: 'TL-1' }),
      role: 'supervisor',
      team: { id: 'team-1', name: 'Research Team' },
      inferenceReady: true,
    });
    assert.match(entry.containerName ?? '', /^qlix-t-/);
  });
});
