import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { groupSubtasksByStage, type SubtaskPlan } from './teamOrchestrator.js';
import { detectPlaybookFromScopeSets } from './teamPlaybook.js';
import type { PermissionScope } from '../agents/agents.types.js';

function subtask(agentId: string, stageOrder: number): SubtaskPlan {
  return {
    subtaskId: `st_${agentId}`,
    agentId,
    agentName: agentId,
    role: 'worker',
    goal: 'do the thing',
    delegatedScopes: [],
    stageOrder,
  };
}

const ids = (groups: SubtaskPlan[][]) => groups.map((g) => g.map((s) => s.agentId));

describe('groupSubtasksByStage', () => {
  it('keeps every subtask in its own stage when stageOrder is distinct', () => {
    // This is what every team created through the existing APIs looks like (1..N),
    // so grouping must be a no-op for them — the pipeline stays fully sequential.
    const plan = [subtask('a', 1), subtask('b', 2), subtask('c', 3)];
    assert.deepEqual(ids(groupSubtasksByStage(plan)), [['a'], ['b'], ['c']]);
  });

  it('groups members that share a stage', () => {
    const plan = [subtask('a', 1), subtask('b', 2), subtask('c', 2), subtask('d', 3)];
    assert.deepEqual(ids(groupSubtasksByStage(plan)), [['a'], ['b', 'c'], ['d']]);
  });

  it('groups a fully parallel team into a single stage', () => {
    const plan = [subtask('a', 1), subtask('b', 1), subtask('c', 1)];
    assert.deepEqual(ids(groupSubtasksByStage(plan)), [['a', 'b', 'c']]);
  });

  it('handles legacy members left at stageOrder 0', () => {
    const plan = [subtask('a', 0), subtask('b', 0)];
    assert.deepEqual(ids(groupSubtasksByStage(plan)), [['a', 'b']]);
  });

  it('does not merge non-adjacent stages that share a number', () => {
    // The plan is always sorted by stageOrder before grouping, so a repeat after a gap
    // means unsorted input — group it as it arrives rather than silently reordering work.
    const plan = [subtask('a', 1), subtask('b', 2), subtask('c', 1)];
    assert.deepEqual(ids(groupSubtasksByStage(plan)), [['a'], ['b'], ['c']]);
  });

  it('returns no groups for an empty plan', () => {
    assert.deepEqual(groupSubtasksByStage([]), []);
  });

  it('preserves plan order inside a stage', () => {
    const plan = [subtask('b', 1), subtask('a', 1)];
    assert.deepEqual(ids(groupSubtasksByStage(plan)), [['b', 'a']]);
  });
});

describe('detectPlaybookFromScopeSets', () => {
  const scopes = (...s: string[]) => s as PermissionScope[];

  it('always returns none (specialized playbooks removed)', () => {
    assert.equal(
      detectPlaybookFromScopeSets([
        scopes('mcp.qlix-jobs.search_jobs'),
        scopes('web.read'),
        scopes('email.send'),
      ]),
      'none',
    );
  });

  it('returns none when only research/email scopes are present', () => {
    assert.equal(
      detectPlaybookFromScopeSets([scopes('web.research'), scopes('email.send')]),
      'none',
    );
  });

  it('returns none for an empty team', () => {
    assert.equal(detectPlaybookFromScopeSets([]), 'none');
  });
});
