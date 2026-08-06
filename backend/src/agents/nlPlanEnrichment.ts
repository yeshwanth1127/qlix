/**
 * Post-process NL builder plans when the user prompt is clearly lead-generation /
 * Google Maps scraping — the LLM often picks web.read instead of mcp.qlix-leads.*.
 */
import type { PermissionScope } from './agents.types.js';
import { scopesRequireHybrid } from './scopeCatalog.js';
import type { AgentCreationPlan, NLAgentSpec, NLWorkerSpec } from './nlTypes.js';

const LEAD_GEN_INTENT =
  /\b(google\s*maps|gmb|google\s*business(?:\s*profile)?|business\s*profile|local\s+business(?:es)?|scrape\s+leads?|lead\s+gen|lead\s+generation|find\s+leads?|leads?\s+with\s+emails?|outreach\s+to\s+leads?|search\s+(?:their\s+)?website(?:s)?\s+for\s+emails?|browser\s+enrichment|enrich\s+leads?)\b/i;

const FINDER_SCOPES: readonly string[] = [
  'mcp.qlix-leads.gmb_search_leads',
  'mcp.qlix-leads.get_campaign',
  'mcp.qlix-leads.list_leads',
];

const QUALIFIER_SCOPES: readonly string[] = [
  'mcp.qlix-leads.list_leads',
  'mcp.qlix-leads.get_campaign',
  'mcp.qlix-leads.update_lead_email',
  'mcp.qlix-leads.record_lead_enrichment',
  'web.read',
  'web.click',
];

const OUTREACH_PERM: readonly string[] = ['email.send', 'mcp.qlix-leads.start_outreach'];
const OUTREACH_JIT: readonly string[] = ['email.send', 'mcp.qlix-leads.start_outreach'];

const SUPERVISOR_SCOPES: readonly string[] = ['mcp.qlix-leads.get_campaign', 'mcp.qlix-leads.list_leads'];

export function isLeadGenPrompt(prompt: string): boolean {
  return LEAD_GEN_INTENT.test(prompt);
}

function filterAllowed(scopes: readonly string[], allowed: Set<string>): PermissionScope[] {
  return scopes.filter((s) => allowed.has(s)) as PermissionScope[];
}

function mergeScopes(
  spec: NLAgentSpec,
  addPerm: readonly string[],
  addJit: readonly string[],
  allowed: Set<string>,
  stripWebRead: boolean,
): NLAgentSpec {
  const perm = new Set(spec.permissionScopes);
  const jit = new Set(spec.jitScopes);

  if (stripWebRead && (addPerm.some((s) => s.startsWith('mcp.qlix-leads.')) || [...perm].some((s) => s.startsWith('mcp.qlix-leads.')))) {
    perm.delete('web.read');
    perm.delete('web.click');
  }

  for (const s of filterAllowed(addPerm, allowed)) perm.add(s);
  for (const s of filterAllowed(addJit, allowed)) {
    perm.add(s);
    jit.add(s);
  }

  return {
    ...spec,
    permissionScopes: [...perm],
    jitScopes: [...jit].filter((s) => perm.has(s)),
  };
}

function workerKind(worker: NLWorkerSpec, index: number, total: number): 'finder' | 'qualifier' | 'outreach' | 'unknown' {
  const blob = `${worker.role} ${worker.name} ${worker.description}`.toLowerCase();
  if (/\b(finder|scrape|scraping|maps|gmb|search|collect)\b/.test(blob)) return 'finder';
  if (/\b(qualif|enrich|verify|valid|email)\b/.test(blob)) return 'qualifier';
  if (/\b(outreach|sender|send|email)\b/.test(blob)) return 'outreach';
  if (total === 3) {
    if (index === 0) return 'finder';
    if (index === 1) return 'qualifier';
    if (index === 2) return 'outreach';
  }
  if (total === 2) {
    return index === 0 ? 'finder' : 'qualifier';
  }
  return index === 0 ? 'finder' : 'unknown';
}

function enrichWorker(
  worker: NLWorkerSpec,
  kind: 'finder' | 'qualifier' | 'outreach' | 'full',
  allowed: Set<string>,
): NLWorkerSpec {
  return enrichAgent(worker, kind, allowed) as NLWorkerSpec;
}
function enrichAgent(spec: NLAgentSpec, kind: 'finder' | 'qualifier' | 'outreach' | 'full', allowed: Set<string>): NLAgentSpec {
  switch (kind) {
    case 'finder':
      return mergeScopes(spec, FINDER_SCOPES, [], allowed, true);
    case 'qualifier':
      return mergeScopes(spec, QUALIFIER_SCOPES, [], allowed, false);
    case 'outreach':
      return mergeScopes(spec, OUTREACH_PERM, OUTREACH_JIT, allowed, true);
    case 'full': {
      let agent = mergeScopes(
        spec,
        [...FINDER_SCOPES, ...OUTREACH_PERM],
        OUTREACH_JIT,
        allowed,
        true,
      );
      agent = mergeScopes(
        agent,
        ['web.read', 'web.click', 'mcp.qlix-leads.update_lead_email', 'mcp.qlix-leads.record_lead_enrichment'],
        [],
        allowed,
        false,
      );
      return agent;
    }
    default:
      return spec;
  }
}

export function enrichLeadGenPlan(
  userPrompt: string,
  plan: AgentCreationPlan,
  allowed: Set<string>,
): AgentCreationPlan {
  if (!isLeadGenPrompt(userPrompt)) return plan;

  const hasQlixLeads = [...allowed].some((s) => s.startsWith('mcp.qlix-leads.'));
  if (!hasQlixLeads) return plan;

  if (plan.type === 'single') {
    return {
      ...plan,
      agent: enrichAgent(plan.agent, 'full', allowed),
      rationale: `${plan.rationale} Lead-gen enrichment: Qlix Leads MCP tools wired for GMB scrape and outreach.`,
    };
  }

  const workers = plan.team.workers.map((w, i) => {
    const kind = workerKind(w, i, plan.team.workers.length);
    if (kind === 'finder') return enrichWorker(w, 'finder', allowed);
    if (kind === 'qualifier') return enrichWorker(w, 'qualifier', allowed);
    if (kind === 'outreach') return enrichWorker(w, 'outreach', allowed);
    return enrichWorker(w, 'finder', allowed);
  });

  let supervisor = plan.team.supervisor;
  supervisor = mergeScopes(supervisor, SUPERVISOR_SCOPES, [], allowed, true);
  // Orchestrator should not send email directly — workers own outreach.
  supervisor = {
    ...supervisor,
    permissionScopes: supervisor.permissionScopes.filter((s) => s !== 'email.send'),
    jitScopes: supervisor.jitScopes.filter((s) => s !== 'email.send'),
  };

  const hasOutreachWorker = workers.some((w) =>
    w.permissionScopes.includes('mcp.qlix-leads.start_outreach' as PermissionScope),
  );
  if (!hasOutreachWorker && /\b(email|outreach)\b/i.test(userPrompt)) {
    const lastIdx = workers.length - 1;
    const last = workers[lastIdx];
    const lastKind = last ? workerKind(last, lastIdx, workers.length) : 'unknown';
    // Do not replace a qualifier worker — it owns browser email enrichment.
    if (last && lastKind !== 'qualifier' && lastKind !== 'finder') {
      workers[lastIdx] = enrichWorker(last, 'outreach', allowed);
    }
  }

  return {
    ...plan,
    team: { ...plan.team, supervisor, workers },
    rationale: `${plan.rationale} Lead-gen enrichment: GMB scraping uses mcp.qlix-leads.*; browser enrichment uses web.read on lead websites.`,
  };
}

// ---------------------------------------------------------------------------
// Job apply enrichment — resume → Greenhouse / Lever / Ashby career pages
// ---------------------------------------------------------------------------

const JOB_APPLY_INTENT =
  /\b(job\s+appl(?:y|ication)s?|apply\s+(?:to\s+)?jobs?|send\s+(?:my\s+)?resume|submit\s+(?:my\s+)?resume|resume\s+to\s+(?:jobs?|companies|platforms)|career\s+pages?|greenhouse|lever\.co|ashby|easy\s+apply|auto[\s-]?apply)\b/i;

const JOB_APPLY_SCOPES: readonly string[] = [
  'web.read',
  'web.click',
  'web.transaction',
  'mcp.qlix-jobs.upsert_candidate_profile',
  'mcp.qlix-jobs.stage_resume',
  'mcp.qlix-jobs.search_jobs',
  'mcp.qlix-jobs.queue_applications',
  'mcp.qlix-jobs.list_applications',
  'mcp.qlix-jobs.get_apply_brief',
  'mcp.qlix-jobs.record_application_result',
];

const JOB_APPLY_JIT: readonly string[] = ['web.transaction'];

const JOB_APPLY_METHOD_MARKER = '## Job apply method';

const JOB_APPLY_METHOD = `

${JOB_APPLY_METHOD_MARKER}
MANDATORY — apply only to Greenhouse / Lever / Ashby company career pages. Refuse LinkedIn Easy Apply and Indeed.

Process:
1. Collect candidate profile (name, email, phone, work auth, answer bank) via upsert_candidate_profile. Stage the resume with stage_resume (text or base64) before queueing.
2. search_jobs on ATS boards and/or queue_applications with apply URLs.
3. For each queued application: get_apply_brief → browser_ab_open(applyUrl) → fill from profile only → browser_ab_upload resume → record_application_result(awaiting_jit).
4. Wait for web.transaction JIT approval, then Submit. Capture confirmation; record_application_result(submitted|blocked|failed).
5. CAPTCHA or unknown required fields → pause and ask the user. Never invent facts outside the profile/answer bank.`;

export function isJobApplyPrompt(prompt: string): boolean {
  return JOB_APPLY_INTENT.test(prompt);
}

function appendJobApplyMethod(description: string): string {
  if (description.includes(JOB_APPLY_METHOD_MARKER)) return description;
  return `${description}${JOB_APPLY_METHOD}`.slice(0, 10000);
}

function enrichJobApplyAgent(spec: NLAgentSpec, allowed: Set<string>): NLAgentSpec {
  const withScopes = mergeScopes(spec, JOB_APPLY_SCOPES, JOB_APPLY_JIT, allowed, false);
  return {
    ...withScopes,
    runtime: 'cloud',
    description: appendJobApplyMethod(withScopes.description),
  };
}

export function enrichJobApplyPlan(
  userPrompt: string,
  plan: AgentCreationPlan,
  allowed: Set<string>,
): AgentCreationPlan {
  if (!isJobApplyPrompt(userPrompt)) return plan;
  if (isLeadGenPrompt(userPrompt)) return plan;
  const hasJobs = [...allowed].some((s) => s.startsWith('mcp.qlix-jobs.'));
  if (!hasJobs) return plan;

  if (plan.type === 'single') {
    return {
      ...plan,
      agent: enrichJobApplyAgent(plan.agent, allowed),
      rationale: `${plan.rationale} Job-apply enrichment: qlix-jobs MCP + browser fill with JIT on every submit.`,
    };
  }

  const supervisor = enrichJobApplyAgent(plan.team.supervisor, allowed);
  const workers = plan.team.workers.map((w) => enrichJobApplyAgent(w, allowed) as NLWorkerSpec);
  return {
    ...plan,
    team: { ...plan.team, supervisor, workers },
    rationale: `${plan.rationale} Job-apply enrichment: qlix-jobs tools wired for ATS applications.`,
  };
}

// ---------------------------------------------------------------------------
// Competitor research enrichment
//
// When the prompt is clearly competitor / competitive intelligence, the LLM
// tends to under-scope (or reach for web.read browsing) instead of the curated
// web.research tools. We force web.research (+ brain.query for internal context
// when available) and inject a Researcher -> Analyst -> Writer method so the run
// produces a cited SWOT / executive report from the existing research toolset.
// ---------------------------------------------------------------------------

const COMPETITOR_RESEARCH_INTENT =
  /\b(competitor|competitors|competitive|competition|rival|rivals|market\s+landscape|competitive\s+landscape|competitive\s+(?:research|analysis|intelligence)|swot)\b/i;

// web.research is required; web.read/web.click give the browser tools as a silent
// fallback when a platform API (Twitter/Reddit/etc.) is blocked; brain.query is
// best-effort (added only if the org has it). All are cloud-capable.
const COMPETITOR_SCOPES: readonly string[] = ['web.research', 'web.read', 'web.click', 'brain.query'];

// Hybrid/local-only scopes the model tends to add for "make a PDF" / "save a file".
// The built-in cloud create_report_pdf tool covers PDF output, so we strip these to
// keep competitor research on the cloud runtime (no local starter pack needed).
const COMPETITOR_STRIP_SCOPES: ReadonlySet<string> = new Set([
  'system.file_read',
  'system.file_write',
  'system.gui_control',
]);

// Idempotency marker so re-enriching a plan never appends the method twice.
const COMPETITOR_METHOD_MARKER = '## Competitor research method';

const COMPETITOR_METHOD = `

${COMPETITOR_METHOD_MARKER}
MANDATORY — you MUST gather real evidence with the research tools BEFORE writing anything. Do NOT call create_report_pdf and do NOT write the report until you have made several research_web_search / research_read_url calls and collected real facts WITH their source URLs. Never invent companies, people, ratings, prices, funding, or any fact — every claim must trace to a tool result. If you cannot verify something, say so; do not guess. Do not produce the report from prior knowledge alone.

Process:
1. RESEARCH (required — several calls) — Start with research_web_search, then research_read_url on the most useful results, plus research_social_search / research_github / research_video where relevant. Gather evidence across: company overview, products & key features, pricing & packaging, market positioning & differentiation, leadership & team, hiring & growth signals, recent news & funding, and customer sentiment (reviews, social). Prefer primary sources (the competitor's own site, docs and pricing pages) and corroborate with third parties. If a platform source (Twitter/Reddit/etc.) is unavailable, do NOT report an error — quietly gather the same information from the open web using the browser tools (browser_ab_open) instead, and continue.
2. ANALYZE — Build a COMPLETE SWOT with ALL FOUR sections: Strengths, Weaknesses, Opportunities, AND Threats, plus a short threat assessment. Never omit Opportunities or Threats.
3. WRITE — Produce an executive-ready report: a 3–5 sentence executive summary, the full four-part SWOT, a dimension-by-dimension breakdown, and concrete recommendations.
Always end with a "## Sources" section listing every URL you actually used with its title. If a channel is unavailable, note the gap instead of guessing. Never fabricate facts, prices, or citations.
Deliver the full report in your chat reply. If a create_report_pdf tool is available (or the user asks for a document), render the report to a PDF and share the exact download link it returns — never invent a link or a local file path (no sandbox: URLs). When WhatsApp delivery is available, also send the PDF with whatsapp_send.`;

export function isCompetitorResearchPrompt(prompt: string): boolean {
  return COMPETITOR_RESEARCH_INTENT.test(prompt);
}

function appendCompetitorMethod(description: string): string {
  if (description.includes(COMPETITOR_METHOD_MARKER)) return description;
  return `${description}${COMPETITOR_METHOD}`.slice(0, 10000);
}

function enrichCompetitorAgent(spec: NLAgentSpec, allowed: Set<string>): NLAgentSpec {
  const withScopes = mergeScopes(spec, COMPETITOR_SCOPES, [], allowed, false);
  const permissionScopes = withScopes.permissionScopes.filter((s) => !COMPETITOR_STRIP_SCOPES.has(s));
  const jitScopes = withScopes.jitScopes.filter((s) => !COMPETITOR_STRIP_SCOPES.has(s));
  // Nothing left forces hybrid → put it back on cloud (preserve an explicit 'local').
  const runtime = scopesRequireHybrid(permissionScopes)
    ? withScopes.runtime
    : withScopes.runtime === 'local'
      ? 'local'
      : 'cloud';
  return {
    ...withScopes,
    permissionScopes,
    jitScopes,
    runtime,
    description: appendCompetitorMethod(withScopes.description),
  };
}

export function enrichCompetitorResearchPlan(
  userPrompt: string,
  plan: AgentCreationPlan,
  allowed: Set<string>,
): AgentCreationPlan {
  if (!isCompetitorResearchPrompt(userPrompt)) return plan;
  // Lead-gen / job-apply are distinct intents that own their own tool wiring.
  if (isLeadGenPrompt(userPrompt)) return plan;
  if (isJobApplyPrompt(userPrompt)) return plan;
  // The whole preset hangs off the research toolset; without it, do nothing.
  if (!allowed.has('web.research')) return plan;

  if (plan.type === 'single') {
    return {
      ...plan,
      agent: enrichCompetitorAgent(plan.agent, allowed),
      rationale: `${plan.rationale} Competitor-research enrichment: forced web.research and applied the researcher→analyst→writer method.`,
    };
  }

  // Team shape: give every member the research toolset; the supervisor writes the
  // final report, so it carries the full method.
  const supervisor = enrichCompetitorAgent(plan.team.supervisor, allowed);
  const workers = plan.team.workers.map(
    (w) => mergeScopes(w, COMPETITOR_SCOPES, [], allowed, false) as NLWorkerSpec,
  );
  return {
    ...plan,
    team: { ...plan.team, supervisor, workers },
    rationale: `${plan.rationale} Competitor-research enrichment: research tools wired across the team; supervisor writes the cited SWOT report.`,
  };
}

// ---------------------------------------------------------------------------
// CRM enrichment — Zoho / CRM task agents often under-scope (read + write only)
// ---------------------------------------------------------------------------

const CRM_INTENT =
  /\b(zoho\s*crm|(?:my\s+)?zoho(?:\s+crm)?|crm\s+(?:tasks?|records?|data|operations?|platform|agent|automation)|manage\s+(?:my\s+)?(?:zoho\s*crm|crm)|perform\s+(?:tasks?|actions?|operations?)\s+(?:on|in)\s+(?:my\s+)?(?:zoho(?:\s+crm)?|crm)|hubspot|salesforce)\b/i;

const CRM_PERM: readonly string[] = ['crm.read', 'crm.write', 'crm.delete'];
const CRM_JIT: readonly string[] = ['crm.write', 'crm.delete'];

export function isCrmPrompt(prompt: string): boolean {
  return CRM_INTENT.test(prompt);
}

function enrichCrmAgent(spec: NLAgentSpec, allowed: Set<string>): NLAgentSpec {
  return mergeScopes(spec, CRM_PERM, CRM_JIT, allowed, false);
}

export function enrichCrmPlan(
  userPrompt: string,
  plan: AgentCreationPlan,
  allowed: Set<string>,
): AgentCreationPlan {
  if (!isCrmPrompt(userPrompt)) return plan;
  if (isLeadGenPrompt(userPrompt) || isJobApplyPrompt(userPrompt) || isCompetitorResearchPrompt(userPrompt)) {
    return plan;
  }
  const hasCrm = CRM_PERM.some((s) => allowed.has(s));
  if (!hasCrm) return plan;

  if (plan.type === 'single') {
    return {
      ...plan,
      agent: enrichCrmAgent(plan.agent, allowed),
      rationale: `${plan.rationale} CRM enrichment: granted crm.read, crm.write, and crm.delete for full CRM tool access.`,
    };
  }

  const supervisor = enrichCrmAgent(plan.team.supervisor, allowed);
  const workers = plan.team.workers.map((w) => enrichCrmAgent(w, allowed) as NLWorkerSpec);
  return {
    ...plan,
    team: { ...plan.team, supervisor, workers },
    rationale: `${plan.rationale} CRM enrichment: full CRM scopes wired across the team.`,
  };
}
