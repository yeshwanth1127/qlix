import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PROMPT_ATTRIBUTION_TARGET,
  assignMissingTeamAttempts,
  attributePromptTokens,
  extractTeamDispatch,
  groupTeamTokensByStageAttempt,
  summarizePromptAttribution,
} from './usageAttribution.js';

test('component totals explain billed prompt tokens and leave a remainder', () => {
  const attributed = attributePromptTokens({
    promptTokens: 1000,
    components: { memory: 400, task: 200, tools: 350 },
  });
  assert.equal(attributed.explainedTokens, 950);
  assert.equal(attributed.unexplainedTokens, 50);
  assert.equal(attributed.byComponent.unexplained, 50);
  assert.equal(attributed.meetsTarget, true);
  assert.ok(attributed.coverage >= PROMPT_ATTRIBUTION_TARGET);
});

test('missing components fail the 95 percent target', () => {
  const attributed = attributePromptTokens({
    promptTokens: 1000,
    components: { task: 100 },
  });
  assert.equal(attributed.coverage, 0.1);
  assert.equal(attributed.meetsTarget, false);
});

test('Brain queries without a pack count as a brain component', () => {
  const attributed = attributePromptTokens({
    promptTokens: 80,
    runType: 'brain_query',
  });
  assert.equal(attributed.byComponent.brain, 80);
  assert.equal(attributed.unexplainedTokens, 0);
  assert.equal(attributed.meetsTarget, true);
});

test('round fallback uses the last recorded component split', () => {
  const attributed = attributePromptTokens({
    promptTokens: 500,
    rounds: [
      { components: { task: 100 } },
      { components: { task: 120, tools: 355 } },
    ],
  });
  assert.equal(attributed.explainedTokens, 475);
  assert.equal(attributed.unexplainedTokens, 25);
});

test('team dispatch events carry stage and attempt', () => {
  const meta = extractTeamDispatch([
    { data: { message: 'context_size' } },
    { data: { message: 'team_dispatch', attempt: 2, stageOrder: 3, teamRole: 'worker', nodeId: 'filter' } },
  ]);
  assert.deepEqual(meta, { attempt: 2, stageOrder: 3, nodeId: 'filter', teamRole: 'worker' });
});

test('workspace attribution rolls component totals without double-counting unexplained', () => {
  const summary = summarizePromptAttribution([
    attributePromptTokens({ promptTokens: 100, components: { task: 90 } }),
    attributePromptTokens({ promptTokens: 100, components: { tools: 100 } }),
  ]);
  assert.equal(summary.promptTokens, 200);
  assert.equal(summary.explainedTokens, 190);
  assert.equal(summary.byComponent.task, 90);
  assert.equal(summary.byComponent.tools, 100);
  assert.equal(summary.byComponent.unexplained, 10);
});

test('Team tokens group by stage and attempt', () => {
  const rows = groupTeamTokensByStageAttempt([
    {
      teamRunId: 'team_1',
      teamRole: 'worker',
      stageOrder: 2,
      attempt: 1,
      promptTokens: 400,
      completionTokens: 40,
      explainedTokens: 390,
      unexplainedTokens: 10,
      coverage: 0.975,
    },
    {
      teamRunId: 'team_1',
      teamRole: 'worker',
      stageOrder: 2,
      attempt: 2,
      promptTokens: 200,
      completionTokens: 20,
      explainedTokens: 180,
      unexplainedTokens: 20,
      coverage: 0.9,
    },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.attempt, 1);
  assert.equal(rows[1]?.promptTokens, 200);
});

test('missing team attempts are numbered in start order per agent', () => {
  const ranked = assignMissingTeamAttempts([
    { teamRunId: 't1', rankAgentId: 'a', createdAt: '2026-08-01T00:00:02.000Z', attempt: null },
    { teamRunId: 't1', rankAgentId: 'a', createdAt: '2026-08-01T00:00:01.000Z', attempt: null },
    { teamRunId: 't1', rankAgentId: 'b', createdAt: '2026-08-01T00:00:01.000Z', attempt: 3 },
  ]);
  assert.equal(ranked[1]?.attempt, 1);
  assert.equal(ranked[0]?.attempt, 2);
  assert.equal(ranked[2]?.attempt, 3);
});
