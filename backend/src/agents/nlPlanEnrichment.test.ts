import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  enrichCompetitorResearchPlan,
  isCompetitorResearchPrompt,
  enrichJobApplyPlan,
  isJobApplyPrompt,
  enrichCrmPlan,
  isCrmPrompt,
  enrichSchedulePlan,
  isSchedulePrompt,
  enrichCloudPreferPlan,
  isCloudHostedPrompt,
  isCloudDocPrompt,
} from './nlPlanEnrichment.js';
import type { AgentCreationPlan, NLAgentSpec } from './nlTypes.js';

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

const ALLOWED_CI = new Set(['web.read', 'web.research', 'files.create', 'brain.query']);

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

  it('strips hybrid-forcing file scopes and keeps the agent on cloud', () => {
    // Mirrors the builder screenshot: model added system.file_write for "make a PDF"
    // and got pushed to hybrid. Cloud has a built-in PDF tool, so strip + stay cloud.
    const allowed = new Set(['web.research', 'files.create', 'brain.query', 'system.file_write']);
    const plan = singleAgentPlan('Analyze Notion and make a PDF.', ['web.research', 'system.file_write'], 'hybrid');
    const out = enrichCompetitorResearchPlan('competitor analysis of Notion, send as PDF', plan, allowed);
    if (out.type !== 'single') {
      assert.fail('expected single');
      return;
    }
    assert.ok(!out.agent.permissionScopes.includes('system.file_write'), 'file_write stripped');
    assert.equal(out.agent.runtime, 'cloud');
    assert.ok(out.agent.permissionScopes.includes('web.research'));
    assert.ok(out.agent.permissionScopes.includes('files.create'));
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

describe('enrichSchedulePlan', () => {
  const SCHEDULE_ALLOWED = new Set([
    'web.read',
    'mcp.qlix-schedule.schedule_create',
    'mcp.qlix-schedule.schedule_list',
    'mcp.qlix-schedule.schedule_get',
    'mcp.qlix-schedule.schedule_update',
    'mcp.qlix-schedule.schedule_cancel',
  ]);

  it('detects schedule prompts', () => {
    assert.equal(isSchedulePrompt('create an agent that runs a daily digest every morning'), true);
    assert.equal(isSchedulePrompt('schedule a recurring task for weekdays'), true);
    assert.equal(isSchedulePrompt('scrape google maps leads'), false);
  });

  it('wires qlix-schedule MCP scopes', () => {
    const plan = singleAgentPlan('Daily reporter', ['web.read']);
    const out = enrichSchedulePlan(
      'Build an agent that runs a daily digest every morning',
      plan,
      SCHEDULE_ALLOWED,
    );
    if (out.type !== 'single') {
      assert.fail('expected single');
      return;
    }
    assert.ok(out.agent.permissionScopes.includes('mcp.qlix-schedule.schedule_create'));
    assert.match(out.agent.description, /## Schedule method/);
  });
});

describe('enrichCloudPreferPlan', () => {
  const ALLOWED = new Set([
    'web.read',
    'web.research',
    'files.create',
    'whatsapp.read',
    'whatsapp.send',
    'system.file_read',
    'system.file_write',
  ]);

  it('detects cloud-hosted and spreadsheet prompts', () => {
    assert.equal(isCloudHostedPrompt('workers and supervisors must all be cloud hosted'), true);
    assert.equal(isCloudDocPrompt('update an Excel sheet and send it on WhatsApp'), true);
    assert.equal(isCloudHostedPrompt('scrape google maps leads'), false);
  });

  it('strips system.file_* for excel intents and stays on cloud with files.create', () => {
    const plan = singleAgentPlan(
      'Track replies in Excel',
      ['whatsapp.read', 'whatsapp.send', 'system.file_write', 'system.file_read'],
      'hybrid',
    );
    const out = enrichCloudPreferPlan(
      'Detect replies, update an Excel sheet, send via WhatsApp',
      plan,
      ALLOWED,
    );
    if (out.type !== 'single') {
      assert.fail('expected single');
      return;
    }
    assert.ok(!out.agent.permissionScopes.includes('system.file_write'));
    assert.ok(!out.agent.permissionScopes.includes('system.file_read'));
    assert.ok(out.agent.permissionScopes.includes('files.create'));
    assert.equal(out.agent.runtime, 'cloud');
  });

  it('honors explicit cloud-hosted even without excel wording', () => {
    const plan = singleAgentPlan('Leads supervisor', ['web.read', 'system.file_read'], 'hybrid');
    const out = enrichCloudPreferPlan(
      'Build a team of 4; workers and supervisors must all be cloud hosted',
      plan,
      ALLOWED,
    );
    if (out.type !== 'single') {
      assert.fail('expected single');
      return;
    }
    assert.ok(!out.agent.permissionScopes.includes('system.file_read'));
    assert.equal(out.agent.runtime, 'cloud');
  });

  it('leaves hybrid scopes alone when the user asks for local files', () => {
    const plan = singleAgentPlan('Desktop helper', ['system.file_write'], 'hybrid');
    const out = enrichCloudPreferPlan(
      'cloud hosted agent that also writes local files on my machine',
      plan,
      ALLOWED,
    );
    if (out.type !== 'single') {
      assert.fail('expected single');
      return;
    }
    assert.ok(out.agent.permissionScopes.includes('system.file_write'));
    assert.equal(out.agent.runtime, 'hybrid');
  });
});
