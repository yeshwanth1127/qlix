import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildWhatsAppReplyWaitStep,
  completedStageOrderFromPlan,
  goalRequestsReplyWait,
  inferWaitStepsFromGoal,
  inferTeamWaitStepsFromSpec,
  REPLY_LIVE_SHEET_EFFECT,
  resolveReplyInclusion,
  resolveTeamWhatsAppWaitMode,
  resolveWaitStepsForTeam,
  WHATSAPP_REPLY_LIVE_SHEET_EFFECT,
} from './waitPolicy.js';
import { ALL_REPLY_LABELS, DEFAULT_REPLY_INCLUSION } from './replyInclusion.js';

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

  it('adds the live artifact effect to stored steps that declare none', () => {
    const stored = [{ ...buildWhatsAppReplyWaitStep(2), sideEffects: [] }];
    const resolved = resolveWaitStepsForTeam(
      { waitSteps: stored } as import('../teams/teams.types.js').TeamConfig,
      'message the leads, wait 1 hour for replies, then put the replies in an excel sheet',
      2,
    );
    assert.equal(resolved.length, 1);
    assert.equal(resolved[0]!.afterStageOrder, 2);
    assert.equal(resolved[0]!.sideEffects.length, 1);
    assert.equal(resolved[0]!.sideEffects[0]!.id, WHATSAPP_REPLY_LIVE_SHEET_EFFECT.id);
    assert.deepEqual(stored[0]!.sideEffects, [], 'stored config is not mutated');
  });

  it('leaves stored steps alone when the goal asks for no file', () => {
    const stored = [{ ...buildWhatsAppReplyWaitStep(2), sideEffects: [] }];
    const resolved = resolveWaitStepsForTeam(
      { waitSteps: stored } as import('../teams/teams.types.js').TeamConfig,
      'message the leads and wait for replies',
      2,
    );
    assert.deepEqual(resolved, stored);
  });

  it('carries the goal inclusion policy onto a step it repairs', () => {
    const stored = [{ ...buildWhatsAppReplyWaitStep(2), sideEffects: [] }];
    const resolved = resolveWaitStepsForTeam(
      { waitSteps: stored } as import('../teams/teams.types.js').TeamConfig,
      'wait for replies then log every reply in an excel sheet',
      2,
    );
    assert.deepEqual(resolved[0]!.sideEffects[0]!.filter?.include, ALL_REPLY_LABELS);
  });
});

describe('reply inclusion policy on wait steps', () => {
  it('defaults to engaged leads when the goal is silent', () => {
    const steps = inferWaitStepsFromGoal(
      'send hi on whatsapp; if they respond, put them in a sheet',
      2,
    );
    assert.deepEqual(steps[0]!.sideEffects[0]!.filter?.include, DEFAULT_REPLY_INCLUSION);
  });

  it('widens to everyone when the goal asks for all replies', () => {
    const steps = inferWaitStepsFromGoal(
      'if they reply, record every reply in a sheet regardless of interest',
      2,
    );
    assert.deepEqual(steps[0]!.sideEffects[0]!.filter?.include, ALL_REPLY_LABELS);
  });

  it('narrows to declines when the goal asks only for the no replies', () => {
    const steps = inferWaitStepsFromGoal(
      'if they reply, put only the ones who said no in a sheet',
      2,
    );
    assert.deepEqual(steps[0]!.sideEffects[0]!.filter?.include, ['not_interested']);
  });

  it('does not mutate the shared effect constant', () => {
    inferWaitStepsFromGoal('if they reply, log every reply in a sheet', 2);
    assert.deepEqual(REPLY_LIVE_SHEET_EFFECT.filter?.include, DEFAULT_REPLY_INCLUSION);
    assert.equal(WHATSAPP_REPLY_LIVE_SHEET_EFFECT, REPLY_LIVE_SHEET_EFFECT);
  });
});

describe('resolveReplyInclusion', () => {
  it('reads the policy back off a persisted snapshot', () => {
    const steps = inferWaitStepsFromGoal('if they reply, log every reply in a sheet', 2);
    const snapshot = { waitSteps: steps, activeWaitStepId: steps[0]!.id };
    assert.deepEqual(resolveReplyInclusion(snapshot), ALL_REPLY_LABELS);
  });

  it('accepts a bare step', () => {
    const step = buildWhatsAppReplyWaitStep(2, 'sheet only the interested leads');
    assert.deepEqual(resolveReplyInclusion(step), ['interested']);
  });

  it('falls back to the default for legacy steps with no filter', () => {
    const legacy = { ...buildWhatsAppReplyWaitStep(2), sideEffects: [] };
    assert.deepEqual(resolveReplyInclusion(legacy), DEFAULT_REPLY_INCLUSION);
    assert.deepEqual(resolveReplyInclusion(null), DEFAULT_REPLY_INCLUSION);
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
