import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildWhatsAppReplyWaitStep,
  completedStageOrderFromPlan,
  goalRequestsReplyWait,
  inferWaitStepsFromGoal,
  inferTeamWaitStepsFromSpec,
  resolveTeamWhatsAppWaitMode,
  resolveWaitStepsForTeam,
  WHATSAPP_REPLY_LIVE_SHEET_EFFECT,
} from './waitPolicy.js';

describe('goalRequestsReplyWait', () => {
  it('matches collect-the-response-via-the-poll language', () => {
    assert.equal(
      goalRequestsReplyWait(
        'send a greeting, brochure, yes or no poll. then collect the response via the poll and put those contacts in a excel sheet',
      ),
      true,
    );
  });

  it('matches wait-for-the-response (poll) language', () => {
    assert.equal(
      goalRequestsReplyWait(
        'send a greeting, brochure, yes or no poll. then wait for the response via the poll and put those contacts in a excel sheet',
      ),
      true,
    );
  });

  it('does not match wait without a reply/response', () => {
    assert.equal(goalRequestsReplyWait('wait for the file to finish downloading'), false);
  });
});

describe('resolveTeamWhatsAppWaitMode', () => {
  it('blocks outbound after the team run is no longer active', () => {
    assert.equal(
      resolveTeamWhatsAppWaitMode({
        teamRunStatus: 'canceled',
        goal: 'wait for the reply and put them in a sheet',
      }),
      'blocked',
    );
  });

  it('queues when the run is active and the goal asks to wait', () => {
    assert.equal(
      resolveTeamWhatsAppWaitMode({
        teamRunStatus: 'running',
        goal: 'wait for the response via the poll and put them in excel',
      }),
      'queue',
    );
  });
});

describe('inferWaitStepsFromGoal', () => {
  it('returns a wait step when reply-wait and sheet language match', () => {
    const steps = inferWaitStepsFromGoal(
      'send hi on whatsapp; if they respond, put them in a sheet',
      2,
    );
    assert.equal(steps.length, 1);
    assert.equal(steps[0]!.afterStageOrder, 2);
    assert.equal(steps[0]!.sideEffects[0]!.id, WHATSAPP_REPLY_LIVE_SHEET_EFFECT.id);
  });

  it('returns empty when no sheet language', () => {
    assert.equal(inferWaitStepsFromGoal('wait for a reply on whatsapp', 2).length, 0);
  });
});

describe('resolveWaitStepsForTeam', () => {
  it('prefers explicit team config over goal inference', () => {
    const explicit = [buildWhatsAppReplyWaitStep(3)];
    const resolved = resolveWaitStepsForTeam(
      { waitSteps: explicit } as import('../teams/teams.types.js').TeamConfig,
      'if they reply create a sheet',
      2,
    );
    assert.deepEqual(resolved, explicit);
  });
});

describe('completedStageOrderFromPlan', () => {
  it('maps next stage index to completed stage order', () => {
    const order = completedStageOrderFromPlan(
      [{ stageOrder: 1 }, { stageOrder: 2 }, { stageOrder: 3 }],
      2,
    );
    assert.equal(order, 2);
  });
});

describe('inferTeamWaitStepsFromSpec', () => {
  it('infers from worker descriptions and outreach stage', () => {
    const steps = inferTeamWaitStepsFromSpec({
      name: 'Outreach team',
      description: 'Wait for replies and build a spreadsheet',
      workers: [
        { stageOrder: 1, permissionScopes: ['web.research'], description: 'filter' },
        {
          stageOrder: 2,
          permissionScopes: ['whatsapp.contact_send'],
          description: 'send whatsapp and wait for reply',
        },
        { stageOrder: 3, permissionScopes: ['whatsapp.send'], description: 'deliver excel sheet' },
      ],
    });
    assert.equal(steps.length, 1);
    assert.equal(steps[0]!.afterStageOrder, 2);
  });
});
