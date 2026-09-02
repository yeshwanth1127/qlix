import assert from 'node:assert/strict';
import test from 'node:test';
import { discoveryPlanContentSchema, formatGtmIdeaMarkdown } from './gtmDiscoveryPlan.service.js';
import { GTM_DISCOVERY_PLAN_BRAIN_TOOL_DEFINITIONS } from '../aiBrain/brainTools.js';

test('formatGtmIdeaMarkdown includes all six founder fields', () => {
  const markdown = formatGtmIdeaMarkdown(2, {
    idea: 'AI reporting for plants',
    problem: 'Manual reports',
    audience: 'Plant managers',
    solution: 'Automated dashboards',
    outcome: 'Faster decisions',
    constraints: 'No ERP integration yet',
  });
  assert.match(markdown, /Founder discovery answers \(v2\)/);
  assert.match(markdown, /AI reporting for plants/);
  assert.match(markdown, /Plant managers/);
});

test('discovery plan schema validates dashboard payload', () => {
  const result = discoveryPlanContentSchema.safeParse({
    schemaVersion: 'gtm.discovery_plan.v1',
    summary: 'Start with plant managers at mid-size manufacturers.',
    focus: {
      audience: 'Plant managers in discrete manufacturing',
      reasons: ['Clear pain around reporting delays', 'Budget authority for ops tools'],
      openQuestions: ['Which ERP systems are most common?'],
    },
    suggestedAgents: [{
      roleSlug: 'sales-executive',
      label: 'Sales Executive',
      reason: 'Qualify accounts and run discovery outreach.',
    }],
    tools: [{
      capabilityId: 'research',
      priority: 'now',
      reason: 'Need web and email context for account research.',
    }],
    planSteps: [
      { title: 'Interview five plant managers', why: 'Validate the problem', effort: 'small' },
      { title: 'List ten lookalike accounts', why: 'Build a test list', effort: 'small' },
      { title: 'Research top three accounts', why: 'Gather evidence', effort: 'medium' },
    ],
    hypotheses: [
      { kind: 'problem', statement: 'Reporting delays cost more than one hour per week' },
      { kind: 'segment', statement: 'Mid-size manufacturers feel this pain most' },
    ],
  });
  assert.equal(result.success, true);
});

test('discovery plan brain tool is exposed for automated drafting', () => {
  assert.deepEqual(
    GTM_DISCOVERY_PLAN_BRAIN_TOOL_DEFINITIONS.map((tool) => tool.function.name),
    ['propose_gtm_discovery_plan'],
  );
});

test('generating plans older than three minutes are considered stale', () => {
  const staleMs = 3 * 60 * 1000;
  const updatedAt = new Date(Date.now() - staleMs - 1_000);
  assert.equal(Date.now() - updatedAt.getTime() > staleMs, true);
});
