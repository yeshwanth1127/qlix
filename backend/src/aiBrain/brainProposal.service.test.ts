import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { planToDto } from './brainProposal.service.js';
import type { AgentCreationPlan } from '../agents/nlTypes.js';

describe('planToDto', () => {
  it('summarizes a single-agent plan', () => {
    const plan: AgentCreationPlan = {
      type: 'single',
      rationale: 'Need a research aide',
      agent: {
        name: 'Jarvis',
        description: 'Personal assistant',
        permissionScopes: ['web.research', 'brain.query'],
        jitScopes: [],
        runtime: 'hybrid',
        model: 'exora/exora-general',
        llmMode: 'proxy',
        localInferenceMode: null,
        rationale: 'Hybrid for desktop',
      },
    };
    const dto = planToDto({
      id: 'prop_1',
      status: 'pending',
      rationale: plan.rationale,
      planJson: plan,
      primaryAgentId: null,
      createdAgentIds: [],
      teamId: null,
      createdAt: new Date('2026-08-10T00:00:00.000Z'),
      resolvedAt: null,
    });
    assert.equal(dto.kind, 'single');
    assert.equal(dto.agents.length, 1);
    assert.equal(dto.agents[0]?.name, 'Jarvis');
    assert.equal(dto.agents[0]?.runtime, 'hybrid');
    assert.deepEqual(dto.agents[0]?.permissionScopes, ['web.research', 'brain.query']);
  });

  it('summarizes a team plan with supervisor first', () => {
    const plan: AgentCreationPlan = {
      type: 'team',
      rationale: 'Fleet',
      team: {
        name: 'Ops',
        description: 'Ops team',
        supervisor: {
          name: 'Supervisor',
          description: 'Orchestrates',
          permissionScopes: ['web.read'],
          jitScopes: [],
          runtime: 'cloud',
          model: 'exora/exora-general',
          llmMode: 'proxy',
          localInferenceMode: null,
          rationale: '',
        },
        workers: [
          {
            name: 'Researcher',
            description: 'Research',
            role: 'research',
            stageOrder: 1,
            permissionScopes: ['web.research'],
            jitScopes: [],
            runtime: 'cloud',
            model: 'exora/exora-general',
            llmMode: 'proxy',
            localInferenceMode: null,
            rationale: '',
          },
        ],
        config: { maxParallelWorkers: 2, subtaskTimeoutMs: 60_000, retryPolicy: 'once' },
      },
    };
    const dto = planToDto({
      id: 'prop_2',
      status: 'pending',
      rationale: '',
      planJson: plan,
      primaryAgentId: null,
      createdAgentIds: [],
      teamId: null,
      createdAt: new Date('2026-08-10T00:00:00.000Z'),
      resolvedAt: null,
    });
    assert.equal(dto.kind, 'team');
    assert.equal(dto.teamName, 'Ops');
    assert.equal(dto.agents[0]?.name, 'Supervisor');
    assert.equal(dto.agents[1]?.role, 'research');
  });
});
