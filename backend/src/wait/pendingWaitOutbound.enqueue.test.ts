import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyConversationPromptToOutbound,
  distinctPendingContactCount,
  enqueuePendingWaitOutbound,
  normalizePendingWaitOutbounds,
} from './pendingWaitOutbound.js';
import type { PendingWaitOutbound, TeamRunCheckpoint } from '../teams/teams.types.js';

function emptyCheckpoint(): TeamRunCheckpoint {
  return {
    plan: [],
    completedResults: [],
    nextStageIndex: 0,
    waitTriggerIds: [],
    waitReason: '',
  };
}

describe('enqueuePendingWaitOutbound', () => {
  it('keeps ordered text, document, and poll for the same contact', () => {
    let checkpoint = emptyCheckpoint();
    checkpoint = enqueuePendingWaitOutbound(checkpoint, {
      agentId: 'agent-1',
      connectorId: 'conn-1',
      recipient: 'Karthik',
      message: 'Hello',
      kind: 'text',
      jid: '919999999999@s.whatsapp.net',
    });
    checkpoint = enqueuePendingWaitOutbound(checkpoint, {
      agentId: 'agent-1',
      connectorId: 'conn-1',
      recipient: 'Karthik',
      message: 'brochure.pdf',
      kind: 'document',
      documentFileName: 'brochure.pdf',
      documentStagedPath: '/tmp/qlix-wa-pending/run/brochure.pdf',
      jid: '919999999999@s.whatsapp.net',
    });
    checkpoint = enqueuePendingWaitOutbound(checkpoint, {
      agentId: 'agent-1',
      connectorId: 'conn-1',
      recipient: 'Karthik',
      message: 'Are you free?',
      kind: 'poll',
      pollName: 'Are you free?',
      pollValues: ['Yes', 'No'],
      pollSelectableCount: 1,
      jid: '919999999999@s.whatsapp.net',
    });
    const pending = checkpoint.pendingWaitOutbounds ?? [];
    assert.equal(pending.length, 3);
    assert.deepEqual(
      pending.map((row) => row.kind ?? 'text'),
      ['text', 'document', 'poll'],
    );
    assert.equal(distinctPendingContactCount(pending), 1);
  });

  it('keeps multiple distinct texts to the same contact in call order', () => {
    let checkpoint = emptyCheckpoint();
    checkpoint = enqueuePendingWaitOutbound(checkpoint, {
      agentId: 'agent-1',
      connectorId: 'conn-1',
      recipient: 'Karthik',
      message: 'v1',
      kind: 'text',
      jid: '919999999999@s.whatsapp.net',
    });
    checkpoint = enqueuePendingWaitOutbound(checkpoint, {
      agentId: 'agent-1',
      connectorId: 'conn-1',
      recipient: 'Karthik',
      message: 'v2',
      kind: 'text',
      jid: '919999999999@s.whatsapp.net',
    });
    const pending = checkpoint.pendingWaitOutbounds ?? [];
    assert.equal(pending.length, 2);
    assert.deepEqual(
      pending.map((row) => row.message),
      ['v1', 'v2'],
    );
  });

  it('does not stack identical text retries for the same contact', () => {
    let checkpoint = emptyCheckpoint();
    checkpoint = enqueuePendingWaitOutbound(checkpoint, {
      agentId: 'agent-1',
      connectorId: 'conn-1',
      recipient: 'Karthik',
      message: 'Hello Karthik',
      kind: 'text',
      jid: '919999999999@s.whatsapp.net',
    });
    checkpoint = enqueuePendingWaitOutbound(checkpoint, {
      agentId: 'agent-1',
      connectorId: 'conn-1',
      recipient: 'Karthik',
      message: 'Hello Karthik',
      kind: 'text',
      jid: '919999999999@s.whatsapp.net',
    });
    assert.equal((checkpoint.pendingWaitOutbounds ?? []).length, 1);
  });

  it('keeps multiple distinct polls for the same contact', () => {
    let checkpoint = emptyCheckpoint();
    for (const name of ['In Bangalore?', 'Fresher?', 'Interested?']) {
      checkpoint = enqueuePendingWaitOutbound(checkpoint, {
        agentId: 'agent-1',
        connectorId: 'conn-1',
        recipient: 'Karthik',
        message: name,
        kind: 'poll',
        pollName: name,
        pollValues: ['Yes', 'No'],
        pollSelectableCount: 1,
        jid: '919999999999@s.whatsapp.net',
      });
    }
    assert.equal((checkpoint.pendingWaitOutbounds ?? []).length, 3);
  });

  it('counts distinct contacts across multi-message queues', () => {
    let checkpoint = emptyCheckpoint();
    checkpoint = enqueuePendingWaitOutbound(checkpoint, {
      agentId: 'a',
      connectorId: 'c',
      recipient: 'A',
      message: 'hi',
      jid: '111@s.whatsapp.net',
    });
    checkpoint = enqueuePendingWaitOutbound(checkpoint, {
      agentId: 'a',
      connectorId: 'c',
      recipient: 'A',
      message: 'again',
      jid: '111@s.whatsapp.net',
    });
    checkpoint = enqueuePendingWaitOutbound(checkpoint, {
      agentId: 'a',
      connectorId: 'c',
      recipient: 'B',
      message: 'hi',
      jid: '222@s.whatsapp.net',
    });
    assert.equal(distinctPendingContactCount(checkpoint.pendingWaitOutbounds ?? []), 2);
  });
});

describe('normalizePendingWaitOutbounds', () => {
  const text: PendingWaitOutbound = {
    id: 't1',
    agentId: 'agent-1',
    connectorId: 'conn-1',
    recipient: 'Karthik',
    message: 'Hi Karthik',
    kind: 'text',
    jid: '919999999999@s.whatsapp.net',
    queuedAt: '2026-08-13T00:00:00.000Z',
  };

  it('preserves call order and does not invent brochure or poll steps', () => {
    const poll: PendingWaitOutbound = {
      ...text,
      id: 'p1',
      kind: 'poll',
      message: 'In Bangalore?',
      pollName: 'In Bangalore?',
      pollValues: ['Yes', 'No'],
    };
    const next = normalizePendingWaitOutbounds([
      text,
      { ...text, id: 't2', message: 'brochure' },
      poll,
    ]);
    assert.deepEqual(
      next.map((row) => row.kind ?? 'text'),
      ['text', 'poll'],
    );
    assert.equal(next[0]!.message, 'Hi Karthik');
    assert.equal(next[1]!.pollName, 'In Bangalore?');
  });

  it('dedupes identical polls while keeping distinct ones', () => {
    const pollA: PendingWaitOutbound = {
      ...text,
      id: 'p1',
      kind: 'poll',
      message: 'Interested?',
      pollName: 'Interested?',
      pollValues: ['Yes', 'No'],
    };
    const pollB: PendingWaitOutbound = {
      ...text,
      id: 'p2',
      kind: 'poll',
      message: 'Fresher?',
      pollName: 'Fresher?',
      pollValues: ['Yes', 'No'],
    };
    const next = normalizePendingWaitOutbounds([text, pollA, { ...pollA, id: 'p1b' }, pollB]);
    assert.equal(next.filter((row) => row.kind === 'poll').length, 2);
    assert.deepEqual(
      next.filter((row) => row.kind === 'poll').map((row) => row.pollName),
      ['Interested?', 'Fresher?'],
    );
  });
});

describe('applyConversationPromptToOutbound', () => {
  it('renders a choice prompt as a WhatsApp poll outbound DTO', () => {
    const row = applyConversationPromptToOutbound(
      {
        agentId: 'agent-1',
        connectorId: 'conn-1',
        recipient: '+919999999999',
        message: 'hello',
        kind: 'text',
      },
      {
        kind: 'choice',
        content: 'Are you interested?',
        options: ['Yes', 'No'],
        maxSelections: 1,
      },
    );
    assert.equal(row.kind, 'poll');
    assert.equal(row.pollName, 'Are you interested?');
    assert.deepEqual(row.pollValues, ['Yes', 'No']);
    assert.equal(row.pollSelectableCount, 1);
  });
});
