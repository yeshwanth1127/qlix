import { describe, expect, it } from 'vitest';
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
    expect(p.searchQuery).toBe('salons');
    expect(p.location).toBe('Bangalore');
    expect(p.maxResults).toBe(5);
  });
});

describe('isLeadGenPipelineTeam', () => {
  it('detects scrape + enrich pipeline', () => {
    const members = [
      member(['mcp.qlix-leads.gmb_search_leads']),
      member(['mcp.qlix-leads.list_leads', 'web.read']),
      member(['email.send']),
    ];
    expect(isLeadGenPipelineTeam(members)).toBe(true);
    expect(memberLeadGenStage(members[0]!)).toBe('scrape');
    expect(memberLeadGenStage(members[1]!)).toBe('enrich');
    expect(memberLeadGenStage(members[2]!)).toBe('outreach');
  });

  it('classifies outreach agent with list_leads as outreach, not enrich', () => {
    const outreach = member([
      'email.send',
      'mcp.qlix-leads.list_leads',
      'mcp.qlix-leads.start_outreach',
    ]);
    expect(memberLeadGenStage(outreach)).toBe('outreach');
  });
});

describe('buildLeadGenStageGoal', () => {
  it('scrape stage mentions gmb_search_leads and salons', () => {
    const parsed = parseLeadGenRequest('generate 5 leads for salons around Bangalore');
    const goal = buildLeadGenStageGoal('scrape', 'user goal', parsed, null);
    expect(goal).toContain('gmb_search_leads');
    expect(goal).toContain('salons');
    expect(goal).toContain('Bangalore');
  });

  it('outreach stage mentions email_send, not browser enrichment', () => {
    const parsed = parseLeadGenRequest('generate 5 leads for salons around Bangalore');
    const goal = buildLeadGenStageGoal('outreach', 'user goal', parsed, 'cm123');
    expect(goal).toContain('email_send');
    expect(goal).toContain('start_outreach');
    expect(goal).not.toContain('browser_ab_open');
  });
});

describe('validateLeadGenWorkerOutput', () => {
  it('fails scraper that only thought', () => {
    const err = validateLeadGenWorkerOutput({
      stage: 'scrape',
      toolsUsed: ['think', 'think'],
      findings: 'No response generated.',
    });
    expect(err).toMatch(/gmb_search_leads/);
  });

  it('fails enricher that only update_lead_email', () => {
    const err = validateLeadGenWorkerOutput({
      stage: 'enrich',
      toolsUsed: ['mcp__qlix-leads__update_lead_email'],
      findings: '',
    });
    expect(err).toMatch(/list_leads/);
  });

  it('passes scraper with gmb call and object findings', () => {
    const err = validateLeadGenWorkerOutput({
      stage: 'scrape',
      toolsUsed: ['mcp__qlix-leads__gmb_search_leads', 'mcp__qlix-leads__list_leads'],
      findings: { campaignId: 'cm123abc', leads: [{ businessName: 'Salon A' }] },
    });
    expect(err).toBeNull();
  });

  it('passes outreach with start_outreach', () => {
    const err = validateLeadGenWorkerOutput({
      stage: 'outreach',
      toolsUsed: ['mcp__qlix-leads__start_outreach'],
      findings: { campaignId: 'cm123' },
    });
    expect(err).toBeNull();
  });
});

describe('extractCampaignIdFromText', () => {
  it('extracts campaignId from JSON', () => {
    expect(extractCampaignIdFromText('{"campaignId":"cmabc123xyz"}')).toBe('cmabc123xyz');
  });
});
