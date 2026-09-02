import assert from 'node:assert/strict';
import test from 'node:test';
import { recommendGtmTeam, teamHireProgress } from './gtmTeamComposition.service.js';

test('recommendGtmTeam includes research and email agents by default', () => {
  const team = recommendGtmTeam({
    content: {
      idea: 'B2B SaaS for plant managers',
      problem: 'Manual reporting',
      audience: 'Manufacturing companies',
      solution: 'Automated dashboards',
      outcome: 'Faster decisions',
      constraints: 'None',
    },
  });
  assert.ok(team.some((s) => s.slotId === 'research'));
  assert.ok(team.some((s) => s.slotId === 'email'));
  assert.equal(team.every((s) => s.parallel), true);
});

test('recommendGtmTeam adds support agent for inbound-heavy ideas', () => {
  const team = recommendGtmTeam({
    content: {
      idea: 'Customer support automation',
      problem: 'Too many tickets',
      audience: 'SaaS customers',
      solution: 'AI helpdesk',
      outcome: 'Faster ticket resolution',
      constraints: 'None',
    },
  });
  assert.ok(team.some((s) => s.slotId === 'support'));
});

test('teamHireProgress finds next unhired slot', () => {
  const team = recommendGtmTeam({
    content: {
      idea: 'B2B sales tool',
      problem: 'Low pipeline',
      audience: 'Startups',
      solution: 'Lead gen',
      outcome: 'More meetings',
      constraints: '',
    },
  });
  const progress = teamHireProgress(team, []);
  assert.equal(progress.hiredCount, 0);
  assert.ok(progress.nextSlot);
});
