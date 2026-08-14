import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  completePendingOutreachPack,
  distinctPendingContactCount,
  enqueuePendingWaitOutbound,
} from './pendingWaitOutbound.js';
import type { TeamRunCheckpoint } from '../teams/teams.types.js';

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

  it('keeps multiple texts to the same contact in call order', () => {
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

describe('completePendingOutreachPack', () => {
  const text: Parameters<typeof completePendingOutreachPack>[0][number] = {
    id: 't1',
    agentId: 'agent-1',
    connectorId: 'conn-1',
    recipient: 'Karthik',
    message: 'Hi Karthik',
    kind: 'text',
    jid: '919999999999@s.whatsapp.net',
    queuedAt: '2026-08-13T00:00:00.000Z',
  };

  it('appends brochure file and yes/no poll after greeting text', () => {
    const next = completePendingOutreachPack(
      [text, { ...text, id: 't2', message: 'brochure' }],
      {
        brochureForContact: () => ({
          fileName: 'brochure.pdf',
          mimetype: 'application/pdf',
          stagedPath: '/tmp/brochure.pdf',
        }),
        poll: { name: 'Are you interested?', values: ['Yes', 'No'] },
      },
    );
    assert.deepEqual(
      next.map((row) => row.kind ?? 'text'),
      ['text', 'document', 'poll'],
    );
    assert.equal(next[0]!.message, 'Hi Karthik');
    assert.equal(next[1]!.documentFileName, 'brochure.pdf');
    assert.deepEqual(next[2]!.pollValues, ['Yes', 'No']);
  });

  it('does not duplicate a poll the worker already queued', () => {
    const next = completePendingOutreachPack(
      [
        text,
        {
          ...text,
          id: 'p1',
          kind: 'poll',
          message: 'Interested?',
          pollName: 'Interested?',
          pollValues: ['Yes', 'No'],
        },
      ],
      { poll: { name: 'Are you interested?', values: ['Yes', 'No'] } },
    );
    assert.equal(next.filter((row) => row.kind === 'poll').length, 1);
    assert.equal(next[1]!.pollName, 'Interested?');
  });
});
