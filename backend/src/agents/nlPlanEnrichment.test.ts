import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  enrichLeadGenPlan,
  isLeadGenPrompt,
  enrichCompetitorResearchPlan,
  isCompetitorResearchPrompt,
  enrichJobApplyPlan,
  isJobApplyPrompt,
  enrichCrmPlan,
  isCrmPrompt,
} from './nlPlanEnrichment.js';
import type { AgentCreationPlan, NLAgentSpec } from './nlTypes.js';

const ALLOWED = new Set([
  'web.read',
  'web.click',
  'web.research',
  'email.send',
  'mcp.qlix-leads.gmb_search_leads',
  'mcp.qlix-leads.get_campaign',
  'mcp.qlix-leads.list_leads',
  'mcp.qlix-leads.update_lead_email',
  'mcp.qlix-leads.start_outreach',
]);

describe('nlPlanEnrichment', () => {
  it('detects Google Maps lead prompts', () => {
    assert.equal(isLeadGenPrompt('scrape Google Maps for coffee shops in Bangalore'), true);
    assert.equal(isLeadGenPrompt('summarize my inbox'), false);
  });

  it('enriches a mis-scoped team plan with MCP lead tools', () => {
    const plan: AgentCreationPlan = {
      type: 'team',
      rationale: 'team',
      team: {
        name: 'Coffee Shop Lead Generation Team',
        description: 'scrape',
        supervisor: {
          name: 'Lead Generation Supervisor',
          description: 'orchestrates',
          permissionScopes: ['email.send'],
          jitScopes: [],
          runtime: 'cloud',
          model: 'openrouter/openai/gpt-4o-mini',
          llmMode: 'proxy',
          localInferenceMode: null,
          rationale: '',
        },
        workers: [
          {
            name: 'Coffee Shop Finder',
            role: 'finder',
            stageOrder: 1,
            description: 'Scrapes Google Maps',
            permissionScopes: ['web.read'],
            jitScopes: [],
            runtime: 'cloud',
            model: 'openrouter/openai/gpt-4o-mini',
            llmMode: 'proxy',
            localInferenceMode: null,
            rationale: '',
          },
          {
            name: 'Lead Qualifier',
            role: 'qualifier',
            stageOrder: 2,
            description: 'email addresses',
            permissionScopes: ['web.read'],
            jitScopes: [],
            runtime: 'cloud',
            model: 'openrouter/openai/gpt-4o-mini',
            llmMode: 'proxy',
            localInferenceMode: null,
            rationale: '',
          },
        ],
        config: { maxParallelWorkers: 3, subtaskTimeoutMs: 180_000, retryPolicy: 'once' },
      },
    };

    const prompt = 'scrape Google Maps for coffee shops in Bangalore and lists leads with email addresses';
    const enriched = enrichLeadGenPlan(prompt, plan, ALLOWED);
    assert.equal(enriched.type, 'team');

    const finder = enriched.team.workers[0];
    assert.ok(finder.permissionScopes.includes('mcp.qlix-leads.gmb_search_leads'));
    assert.ok(!finder.permissionScopes.includes('web.read'));

    const qualifier = enriched.team.workers[1];
    assert.ok(qualifier.permissionScopes.includes('mcp.qlix-leads.list_leads'));
    assert.ok(qualifier.permissionScopes.includes('mcp.qlix-leads.update_lead_email'));
    assert.ok(qualifier.permissionScopes.includes('web.read'));
    assert.ok(qualifier.permissionScopes.includes('web.click'));

    assert.ok(!enriched.team.supervisor.permissionScopes.includes('email.send'));
  });
});

function singleAgentPlan(
  description: string,
  permissionScopes: NLAgentSpec['permissionScopes'],
  runtime: NLAgentSpec['runtime'] = 'cloud',
): AgentCreationPlan {
  return {
    type: 'single',
    rationale: 'base',
    agent: {
      name: 'Agent',
      description,
      permissionScopes,
      jitScopes: [],
      runtime,
      model: 'openrouter/openai/gpt-4o-mini',
      llmMode: 'proxy',
      localInferenceMode: null,
      rationale: '',
    },
  };
}

const ALLOWED_CI = new Set(['web.read', 'web.research', 'brain.query']);

describe('enrichCompetitorResearchPlan', () => {
  it('detects competitor / competitive-intelligence prompts', () => {
    assert.equal(isCompetitorResearchPrompt('do a competitor analysis of Linear'), true);
    assert.equal(isCompetitorResearchPrompt('research my competitors and build a SWOT'), true);
    assert.equal(isCompetitorResearchPrompt('summarize my inbox'), false);
  });

  it('forces web.research (+ brain.query) and injects the method for a single agent', () => {
    const plan = singleAgentPlan('Analyze Notion for us.', ['web.read']);
    const out = enrichCompetitorResearchPlan('competitive analysis of Notion', plan, ALLOWED_CI);
    assert.equal(out.type, 'single');
    if (out.type !== 'single') return;
    assert.ok(out.agent.permissionScopes.includes('web.research'));
    assert.ok(out.agent.permissionScopes.includes('brain.query'));
    assert.ok(out.agent.permissionScopes.includes('web.read'), 'browser fallback scope granted');
    assert.match(out.agent.description, /## Competitor research method/);
    assert.match(out.agent.description, /## Sources/);
  });

  it('is idempotent — re-enriching does not duplicate the method block', () => {
    const plan = singleAgentPlan('Analyze Figma.', ['web.research']);
    const once = enrichCompetitorResearchPlan('competitor research on Figma', plan, ALLOWED_CI);
    const twice = enrichCompetitorResearchPlan('competitor research on Figma', once, ALLOWED_CI);
    if (once.type !== 'single' || twice.type !== 'single') {
      assert.fail('expected single');
      return;
    }
    const count = (twice.agent.description.match(/## Competitor research method/g) ?? []).length;
    assert.equal(count, 1);
  });

  it('defers to lead-gen: a lead-gen prompt is left untouched', () => {
    const plan = singleAgentPlan('Find leads.', ['web.read']);
    const out = enrichCompetitorResearchPlan('scrape google maps for competitor coffee shops', plan, ALLOWED_CI);
    // isLeadGenPrompt matches ("google maps" / "scrape ... leads"), so no CI method is added.
    if (out.type !== 'single') return;
    assert.doesNotMatch(out.agent.description, /## Competitor research method/);
  });

  it('strips hybrid-forcing file scopes and keeps the agent on cloud', () => {
    // Mirrors the builder screenshot: model added system.file_write for "make a PDF"
    // and got pushed to hybrid. Cloud has a built-in PDF tool, so strip + stay cloud.
    const allowed = new Set(['web.research', 'brain.query', 'system.file_write']);
    const plan = singleAgentPlan('Analyze Notion and make a PDF.', ['web.research', 'system.file_write'], 'hybrid');
    const out = enrichCompetitorResearchPlan('competitor analysis of Notion, send as PDF', plan, allowed);
    if (out.type !== 'single') {
      assert.fail('expected single');
      return;
    }
    assert.ok(!out.agent.permissionScopes.includes('system.file_write'), 'file_write stripped');
    assert.equal(out.agent.runtime, 'cloud');
    assert.ok(out.agent.permissionScopes.includes('web.research'));
  });

  it('is a no-op when web.research is not available to the org', () => {
    const plan = singleAgentPlan('Analyze rival.', ['web.read']);
    const out = enrichCompetitorResearchPlan('competitor analysis', plan, new Set(['web.read']));
    if (out.type !== 'single') return;
    assert.ok(!out.agent.permissionScopes.includes('web.research'));
    assert.doesNotMatch(out.agent.description, /## Competitor research method/);
  });
});

describe('enrichJobApplyPlan', () => {
  const JOB_ALLOWED = new Set([
    'web.read',
    'web.click',
    'web.transaction',
    'mcp.qlix-jobs.stage_resume',
    'mcp.qlix-jobs.search_jobs',
    'mcp.qlix-jobs.queue_applications',
    'mcp.qlix-jobs.get_apply_brief',
    'mcp.qlix-jobs.record_application_result',
    'mcp.qlix-jobs.upsert_candidate_profile',
    'mcp.qlix-jobs.list_applications',
  ]);

  it('detects job apply prompts', () => {
    assert.equal(isJobApplyPrompt('create an agent that sends my resume to job platforms'), true);
    assert.equal(isJobApplyPrompt('apply to greenhouse jobs for me'), true);
    assert.equal(isJobApplyPrompt('scrape google maps leads'), false);
  });

  it('wires qlix-jobs + browser + JIT transaction', () => {
    const plan = singleAgentPlan('Apply to jobs', ['web.read']);
    const out = enrichJobApplyPlan(
      'Create an agent that applies to jobs with my resume on Greenhouse',
      plan,
      JOB_ALLOWED,
    );
    if (out.type !== 'single') {
      assert.fail('expected single');
      return;
    }
    assert.ok(out.agent.permissionScopes.includes('mcp.qlix-jobs.stage_resume'));
    assert.ok(out.agent.permissionScopes.includes('web.transaction'));
    assert.ok(out.agent.jitScopes.includes('web.transaction'));
    assert.match(out.agent.description, /## Job apply method/);
  });

  const CRM_ALLOWED = new Set(['crm.read', 'crm.write', 'crm.delete', 'web.read']);

  it('detects Zoho CRM prompts', () => {
    assert.equal(isCrmPrompt('I need an agent to perform tasks on my Zoho CRM'), true);
    assert.equal(isCrmPrompt('manage CRM records and deals'), true);
    assert.equal(isCrmPrompt('summarize my inbox'), false);
  });

  it('adds full CRM scopes when the model under-scopes', () => {
    const plan = singleAgentPlan('Zoho CRM agent', ['crm.read', 'crm.write']);
    const out = enrichCrmPlan('agent to perform tasks on my zoho crm', plan, CRM_ALLOWED);
    if (out.type !== 'single') {
      assert.fail('expected single');
      return;
    }
    assert.deepEqual(
      [...out.agent.permissionScopes].sort(),
      ['crm.delete', 'crm.read', 'crm.write'],
    );
    assert.ok(out.agent.jitScopes.includes('crm.write'));
    assert.ok(out.agent.jitScopes.includes('crm.delete'));
  });
});
