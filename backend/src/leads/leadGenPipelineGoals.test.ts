import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildLeadGenStageGoal,
  extractCampaignIdFromText,
  isLeadGenPipelineTeam,
  memberLeadGenStage,
  parseLeadGenRequest,
  validateLeadGenWorkerOutput,
} from './leadGenPipelineGoals.js';
import type { TeamMemberDTO } from '../teams/teams.types.js';

function member(scopes: string[], role = 'worker'): TeamMemberDTO {
  return {
    id: 'm1',
    teamId: 't1',
    agentId: 'a1',
    role,
    stageOrder: 0,
    delegatedScopes: scopes as TeamMemberDTO['delegatedScopes'],
    addedAt: new Date().toISOString(),
  };
}

describe('parseLeadGenRequest', () => {
  it('parses salons in Bangalore', () => {
    const p = parseLeadGenRequest(
      'generate 5 leads for salons around Bangalore and send personalised email',
    );
    assert.equal(p.searchQuery, 'salons');
    assert.equal(p.location, 'Bangalore');
    assert.equal(p.maxResults, 5);
  });
});

describe('isLeadGenPipelineTeam', () => {
  it('detects scrape + enrich pipeline', () => {
    const members = [
      member(['mcp.qlix-leads.gmb_search_leads']),
      member(['mcp.qlix-leads.list_leads', 'web.read']),
      member(['email.send']),
    ];
    assert.equal(isLeadGenPipelineTeam(members), true);
    assert.equal(memberLeadGenStage(members[0]!), 'scrape');
    assert.equal(memberLeadGenStage(members[1]!), 'enrich');
    assert.equal(memberLeadGenStage(members[2]!), 'outreach');
  });

  it('classifies outreach agent with list_leads as outreach, not enrich', () => {
    const outreach = member([
      'email.send',
      'mcp.qlix-leads.list_leads',
      'mcp.qlix-leads.start_outreach',
    ]);
    assert.equal(memberLeadGenStage(outreach), 'outreach');
  });
});

describe('buildLeadGenStageGoal', () => {
  it('scrape stage mentions gmb_search_leads and salons', () => {
    const parsed = parseLeadGenRequest('generate 5 leads for salons around Bangalore');
    const goal = buildLeadGenStageGoal('scrape', 'user goal', parsed, null);
    assert.match(goal, /gmb_search_leads/);
    assert.match(goal, /salons/);
    assert.match(goal, /Bangalore/);
  });

  it('outreach stage mentions email_send, not browser enrichment', () => {
    const parsed = parseLeadGenRequest('generate 5 leads for salons around Bangalore');
    const goal = buildLeadGenStageGoal('outreach', 'user goal', parsed, 'cm123');
    assert.match(goal, /email_send/);
    assert.match(goal, /start_outreach/);
    assert.doesNotMatch(goal, /browser_ab_open/);
  });
});

describe('validateLeadGenWorkerOutput', () => {
  it('fails scraper that only thought', () => {
    const err = validateLeadGenWorkerOutput({
      stage: 'scrape',
      toolsUsed: ['think', 'think'],
      findings: 'No response generated.',
    });
    assert.match(err ?? '', /gmb_search_leads/);
  });

  it('fails enricher that only update_lead_email', () => {
    const err = validateLeadGenWorkerOutput({
      stage: 'enrich',
      toolsUsed: ['mcp__qlix-leads__update_lead_email'],
      findings: '',
    });
    assert.match(err ?? '', /list_leads/);
  });

  it('passes scraper with gmb call and object findings', () => {
    const err = validateLeadGenWorkerOutput({
      stage: 'scrape',
      toolsUsed: ['mcp__qlix-leads__gmb_search_leads', 'mcp__qlix-leads__list_leads'],
      findings: { campaignId: 'cm123abc', leads: [{ businessName: 'Salon A' }] },
    });
    assert.equal(err, null);
  });

  it('passes outreach with start_outreach', () => {
    const err = validateLeadGenWorkerOutput({
      stage: 'outreach',
      toolsUsed: ['mcp__qlix-leads__start_outreach'],
      findings: { campaignId: 'cm123' },
    });
    assert.equal(err, null);
  });
});

describe('extractCampaignIdFromText', () => {
  it('extracts campaignId from JSON', () => {
    assert.equal(extractCampaignIdFromText('{"campaignId":"cmabc123xyz"}'), 'cmabc123xyz');
  });
});
