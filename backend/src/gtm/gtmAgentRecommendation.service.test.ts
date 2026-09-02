import assert from 'node:assert/strict';
import test from 'node:test';
import { recommendGtmAgents } from './gtmAgentRecommendation.service.js';

test('early B2B discovery defaults to sales-executive as primary', () => {
  const recs = recommendGtmAgents({
    content: {
      idea: 'Help B2B SaaS teams find qualified leads faster',
      problem: 'Sales teams waste time on bad fit accounts',
      audience: 'SMB and mid-market SaaS companies',
      solution: 'AI-assisted account research and scoring',
      outcome: 'More qualified meetings',
      constraints: 'Discovery only for now',
    },
  });
  assert.equal(recs[0]?.roleSlug, 'sales-executive');
  assert.equal(recs[0]?.tier, 'primary');
  assert.ok(recs[0]!.matchReasons.length >= 1);
});

test('recruiting keywords favor recruiter role', () => {
  const recs = recommendGtmAgents({
    content: {
      idea: 'Automate candidate screening for hiring teams',
      problem: 'Recruiters spend hours on unqualified applicants',
      audience: 'HR and talent teams',
      solution: 'AI resume and interview screening',
      outcome: 'Faster shortlists',
      constraints: '',
    },
  });
  assert.ok(recs.some((r) => r.roleSlug === 'recruiter'));
});

test('returns at most three recommendations with one primary', () => {
  const recs = recommendGtmAgents({
    content: {
      idea: 'Generic business tool',
      problem: '',
      audience: '',
      solution: '',
      outcome: '',
      constraints: '',
    },
  });
  assert.ok(recs.length >= 1 && recs.length <= 3);
  assert.equal(recs.filter((r) => r.tier === 'primary').length, 1);
});
