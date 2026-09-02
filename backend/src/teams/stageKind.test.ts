import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { withDefaultAgentScopes } from '../agents/defaultAgentScopes.js';
import type { NLWorkerSpec } from '../agents/nlTypes.js';
import {
  allowedScopesForDispatch,
  applyStageKindPacksToPlan,
  inferStageContract,
  isJsonOnlyKinds,
  scopesForStageContract,
  toolIndexLines,
} from './stageKind.js';
import { resolveDispatchAllowedScopes, skillsForLunaTeamsDispatch, TEAM_DISPATCH_ONLY_SKILL } from './lunaTeamsHost.js';

describe('stageKind packs', () => {
  it('source/transform have no connector scopes', () => {
    assert.deepEqual(
      scopesForStageContract({ stageKind: 'source', alsoKinds: [], channels: [] }),
      [],
    );
    assert.deepEqual(
      scopesForStageContract({ stageKind: 'transform', alsoKinds: ['source'], channels: ['whatsapp'] }),
      [],
    );
  });

  it('act whatsapp does not include files.create or contact-unrelated tools', () => {
    const scopes = scopesForStageContract({
      stageKind: 'act',
      alsoKinds: ['wait'],
      channels: ['whatsapp'],
    });
    assert.deepEqual(scopes.sort(), ['whatsapp.auto_reply', 'whatsapp.contact_send'].sort());
    assert.ok(!scopes.includes('files.create'));
    assert.ok(!scopes.includes('crm.write'));
  });

  it('deliver whatsapp is self-chat file send, not contact_send', () => {
    const scopes = scopesForStageContract({
      stageKind: 'deliver',
      alsoKinds: [],
      channels: ['whatsapp'],
    });
    assert.ok(scopes.includes('whatsapp.send'));
    assert.ok(scopes.includes('files.create'));
    assert.ok(!scopes.includes('whatsapp.contact_send'));
  });

  it('extracted JSON dispatch grants no connectors even if delegated has them', () => {
    const allowed = allowedScopesForDispatch({
      contract: { stageKind: 'source', alsoKinds: [], channels: [] },
      delegatedScopes: ['brain.query', 'files.create', 'whatsapp.contact_send'],
      knowledgeMode: 'none',
      hasExtractedAuthoritativeInput: true,
    });
    assert.deepEqual(allowed, []);
  });
});

describe('applyStageKindPacksToPlan', () => {
  const worker = (over: Partial<NLWorkerSpec> = {}): NLWorkerSpec => ({
    name: 'Worker',
    description: 'd',
    permissionScopes: ['whatsapp.contact_send', 'files.create'],
    jitScopes: [],
    runtime: 'cloud',
    model: 'exora/exora-general',
    llmMode: 'proxy',
    localInferenceMode: null,
    rationale: '',
    role: 'data reader',
    stageOrder: 1,
    stageKind: 'source',
    alsoKinds: [],
    channels: [],
    ...over,
  });

  it('source workers cannot keep WhatsApp keys from whole-prompt enrichment', () => {
    const plan = applyStageKindPacksToPlan(
      {
        type: 'team',
        rationale: 'test',
        team: {
          name: 'T',
          description: 'd',
          supervisor: worker({ name: 'Sup', role: 'supervisor', stageKind: undefined }),
          workers: [worker()],
          config: { maxParallelWorkers: 2, subtaskTimeoutMs: 180_000, retryPolicy: 'once' },
        },
      },
      new Set(['brain.query', 'files.create', 'whatsapp.contact_send', 'whatsapp.send']),
    );
    if (plan.type !== 'team') throw new Error('expected team');
    assert.deepEqual(plan.team.workers[0]!.permissionScopes, withDefaultAgentScopes([]));
    assert.ok(!plan.team.workers[0]!.permissionScopes.includes('whatsapp.contact_send'));
    assert.deepEqual(plan.team.supervisor.permissionScopes, withDefaultAgentScopes([]));
  });
});

describe('inferStageContract', () => {
  it('marks a filter role as source/transform without act tools', () => {
    const contract = inferStageContract({
      role: 'lead processor',
      delegatedScopes: ['brain.query', 'files.create'],
      stageOrder: 1,
      memberCount: 2,
    });
    assert.equal(contract.stageKind, 'source');
    assert.ok(isJsonOnlyKinds([contract.stageKind, ...contract.alsoKinds]));
  });

  it('marks outreach with contact_send as act/whatsapp', () => {
    const contract = inferStageContract({
      role: 'outreach',
      delegatedScopes: ['whatsapp.contact_send', 'whatsapp.auto_reply'],
      stageOrder: 2,
      memberCount: 2,
    });
    assert.equal(contract.stageKind, 'act');
    assert.ok(contract.alsoKinds.includes('wait'));
    assert.ok(contract.channels.includes('whatsapp'));
  });

  it('backfill prefers whatsapp channel over leftover crm.write on identity', () => {
    const contract = inferStageContract({
      role: 'outreach',
      delegatedScopes: ['whatsapp.contact_send', 'crm.write'],
      stageOrder: 2,
      memberCount: 2,
    });
    assert.equal(contract.stageKind, 'act');
    assert.deepEqual(contract.channels, ['whatsapp']);
  });

  it('backfill assessment workers ignore crm.write on identity', () => {
    const contract = inferStageContract({
      role: 'process_integrity',
      delegatedScopes: [
        'assessment.session.get',
        'assessment.evidence.search',
        'crm.write',
      ],
      stageOrder: 1,
      memberCount: 1,
    });
    assert.equal(contract.stageKind, 'act');
    assert.deepEqual(contract.channels, []);
  });
});

describe('resolveDispatchAllowedScopes via kinds', () => {
  it('filter role never receives act/deliver tools', () => {
    const allowed = resolveDispatchAllowedScopes({
      role: 'filtering',
      task: 'Filter Bangalore leads and also send WhatsApp please',
      delegatedScopes: ['crm.write', 'whatsapp.contact_send', 'files.create'],
      knowledgeMode: 'none',
    });
    assert.deepEqual(allowed, []);
    assert.deepEqual(
      skillsForLunaTeamsDispatch({
        role: 'filtering',
        task: 'Filter Bangalore leads',
        delegatedScopes: ['whatsapp.contact_send'],
        knowledgeMode: 'none',
      }),
      [TEAM_DISPATCH_ONLY_SKILL],
    );
  });
});

describe('toolIndexLines', () => {
  it('lists a short WhatsApp pack instead of the warehouse', () => {
    const names = toolIndexLines(['whatsapp.contact_send', 'whatsapp.send']);
    assert.ok(names.includes('whatsapp_send_message'));
    assert.ok(!names.includes('crm_write'));
  });
});
