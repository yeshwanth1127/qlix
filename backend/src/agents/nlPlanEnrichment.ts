/**
 * Post-process NL builder plans for specialized intents (jobs, competitor research, CRM, schedule, cloud prefs).
 */
import type { PermissionScope } from './agents.types.js';
import { scopesRequireHybrid } from './scopeCatalog.js';
import type { AgentCreationPlan, NLAgentSpec, NLWorkerSpec } from './nlTypes.js';
import { DEFAULT_SCHEDULE_SCOPES } from './defaultAgentScopes.js';

const LOCAL_HYBRID_INTENT =
  /\b(local\s+(?:file|files|filesystem|machine|computer|desktop)|my\s+(?:machine|computer|desktop|files?)|desktop\s+app|gui\s+control|screen\s+automation|hybrid\s+agent|file\s+control|read\s+(?:local\s+)?files?|write\s+(?:local\s+)?files?)\b/i;

/** True when the user explicitly wants on-device / hybrid local tools. */
export function isLocalHybridPrompt(prompt: string): boolean {
  return LOCAL_HYBRID_INTENT.test(prompt);
}

function filterAllowed(scopes: readonly string[], allowed: Set<string>): PermissionScope[] {
  return scopes.filter((s) => allowed.has(s)) as PermissionScope[];
}

function mergeScopes(
  spec: NLAgentSpec,
  addPerm: readonly string[],
  addJit: readonly string[],
  allowed: Set<string>,
  _stripUnused: boolean,
): NLAgentSpec {
  const perm = new Set(spec.permissionScopes);
  const jit = new Set(spec.jitScopes);

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
const COMPETITOR_SCOPES: readonly string[] = [
  'web.research',
  'files.create',
  'web.read',
  'web.click',
  'brain.query',
];

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
  // Job-apply is a distinct intent that owns its own tool wiring.
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
  if (isJobApplyPrompt(userPrompt) || isCompetitorResearchPrompt(userPrompt)) {
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

// ---------------------------------------------------------------------------
// Schedule enrichment — recurring / delayed agent work via qlix-schedule MCP
// ---------------------------------------------------------------------------

const SCHEDULE_INTENT =
  /\b(?:cron|qlix-schedule|schedule_create|schedule(?:d)?\s+(?:task|job|event|run|reminder)|recurring\s+(?:task|job|run)|daily\s+(?:digest|summary)(?:\s+\w+){0,12}\s+(?:every|each)|(?:every|each)\s+(?:day|morning|evening|hour|weekday)\s+(?:at\s+\d|run\b|send\b|execute\b|trigger\b|remind\b)|remind\s+me\s+(?:to|at|every)|run\s+(?:this|it)\s+(?:later|daily|weekly|every)|at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s+(?:every|daily|each))\b/i;

const SCHEDULE_SCOPES: readonly string[] = DEFAULT_SCHEDULE_SCOPES;

const SCHEDULE_METHOD_MARKER = '## Schedule method';

const SCHEDULE_METHOD = `

${SCHEDULE_METHOD_MARKER}
Use qlix-schedule MCP tools to manage timed work:
1. schedule_create with scheduleType cron|once|interval + prompt (what to do when due).
2. Cron is 5-field UTC (e.g. \`0 9 * * 1-5\` weekdays 09:00 UTC). onceAt is ISO-8601. intervalSeconds ≥ 60.
3. schedule_list / schedule_get to inspect; schedule_update to pause/resume; schedule_cancel to stop.
4. When a scheduled event fires you receive the prompt as a normal run — execute it, then done.`;

export function isSchedulePrompt(prompt: string): boolean {
  return SCHEDULE_INTENT.test(prompt);
}

function appendScheduleMethod(description: string): string {
  if (description.includes(SCHEDULE_METHOD_MARKER)) return description;
  return `${description}${SCHEDULE_METHOD}`.slice(0, 10000);
}

function enrichScheduleAgent(spec: NLAgentSpec, allowed: Set<string>): NLAgentSpec {
  const withScopes = mergeScopes(spec, SCHEDULE_SCOPES, [], allowed, false);
  return {
    ...withScopes,
    description: appendScheduleMethod(withScopes.description),
  };
}

export function enrichSchedulePlan(
  userPrompt: string,
  plan: AgentCreationPlan,
  allowed: Set<string>,
): AgentCreationPlan {
  if (!isSchedulePrompt(userPrompt)) return plan;
  const hasSchedule = [...allowed].some((s) => s.startsWith('mcp.qlix-schedule.'));
  if (!hasSchedule) return plan;

  if (plan.type === 'single') {
    return {
      ...plan,
      agent: enrichScheduleAgent(plan.agent, allowed),
      rationale: `${plan.rationale} Schedule enrichment: qlix-schedule MCP for cron/once/interval events.`,
    };
  }

  const supervisor = enrichScheduleAgent(plan.team.supervisor, allowed);
  const workers = plan.team.workers.map((w) => enrichScheduleAgent(w, allowed) as NLWorkerSpec);
  return {
    ...plan,
    team: { ...plan.team, supervisor, workers },
    rationale: `${plan.rationale} Schedule enrichment: qlix-schedule tools wired for timed agent runs.`,
  };
}

function stripScheduleFromAgent(spec: NLAgentSpec): NLAgentSpec {
  const permissionScopes = spec.permissionScopes.filter((s) => !s.startsWith('mcp.qlix-schedule.'));
  const jitScopes = spec.jitScopes.filter((s) => !s.startsWith('mcp.qlix-schedule.'));
  let description = spec.description;
  const markerIdx = description.indexOf(SCHEDULE_METHOD_MARKER);
  if (markerIdx >= 0) {
    description = description.slice(0, markerIdx).trimEnd();
  }
  return { ...spec, permissionScopes, jitScopes, description };
}

/** Remove qlix-schedule scopes unless the user explicitly asked for timed/recurring runs. */
export function stripScheduleUnlessIntent(
  intentText: string,
  plan: AgentCreationPlan,
): AgentCreationPlan {
  if (isSchedulePrompt(intentText)) return plan;
  if (plan.type === 'single') {
    return { ...plan, agent: stripScheduleFromAgent(plan.agent) };
  }
  return {
    ...plan,
    team: {
      ...plan.team,
      supervisor: stripScheduleFromAgent(plan.team.supervisor),
      workers: plan.team.workers.map((w) => stripScheduleFromAgent(w) as NLWorkerSpec),
    },
  };
}

// ---------------------------------------------------------------------------
// Cloud preference / cloud documents
//
// The planner often stamps system.file_* for "Excel sheet" / "PDF", which forces
// Cloud runners already have create_xlsx + create_report_pdf (gated on files.create)
// that upload to the Qlix sandbox.
// When the user asks for cloud-hosted agents or cloud documents — and does not
// ask for local/desktop tools — strip hybrid-only scopes and stay on cloud.
// ---------------------------------------------------------------------------

const CLOUD_HOSTED_INTENT =
  /\b(cloud[\s-]?hosted|fully\s+cloud|all\s+(?:agents?\s+)?(?:must\s+be\s+|on\s+)?cloud|(?:runtime|prefer|use)\s+cloud|must\s+(?:all\s+)?be\s+cloud|workers?\s+and\s+supervisors?\s+must\s+all\s+be\s+cloud)\b/i;

const CLOUD_DOC_INTENT =
  /\b(excel|\.xlsx|\bxlsx\b|spreadsheet|google\s+sheets?|make\s+a\s+pdf|create\s+a\s+pdf|send\s+(?:as\s+)?(?:a\s+)?pdf|export\s+(?:to\s+)?(?:csv|xlsx|excel))\b/i;

/** Hybrid-only scopes that cloud document tools replace. */
const CLOUD_STRIP_SCOPES: ReadonlySet<string> = new Set([
  'system.file_read',
  'system.file_write',
  'system.gui_control',
]);

export function isCloudHostedPrompt(prompt: string): boolean {
  return CLOUD_HOSTED_INTENT.test(prompt);
}

export function isCloudDocPrompt(prompt: string): boolean {
  return CLOUD_DOC_INTENT.test(prompt);
}

function stripHybridOnlyScopes(spec: NLAgentSpec, addDocs: boolean, allowed: Set<string>): NLAgentSpec {
  const hadHybridScopes = spec.permissionScopes.some((s) => CLOUD_STRIP_SCOPES.has(s));
  let permissionScopes = spec.permissionScopes.filter((s) => !CLOUD_STRIP_SCOPES.has(s));
  let jitScopes = spec.jitScopes.filter((s) => !CLOUD_STRIP_SCOPES.has(s));
  let addedDocs = false;
  if (addDocs && allowed.has('files.create') && !permissionScopes.includes('files.create')) {
    permissionScopes = [...permissionScopes, 'files.create'];
    addedDocs = true;
  }
  const runtime = scopesRequireHybrid(permissionScopes)
    ? spec.runtime
    : spec.runtime === 'local'
      ? 'local'
      : 'cloud';
  if (!hadHybridScopes && !addedDocs && runtime === spec.runtime) return spec;
  return { ...spec, permissionScopes, jitScopes, runtime };
}

export function enrichCloudPreferPlan(
  userPrompt: string,
  plan: AgentCreationPlan,
  allowed: Set<string>,
): AgentCreationPlan {
  if (isLocalHybridPrompt(userPrompt)) return plan;
  const wantCloud = isCloudHostedPrompt(userPrompt);
  const wantDocs = isCloudDocPrompt(userPrompt);
  if (!wantCloud && !wantDocs) return plan;

  const mapAgent = (spec: NLAgentSpec): NLAgentSpec =>
    stripHybridOnlyScopes(spec, wantDocs, allowed);

  if (plan.type === 'single') {
    const agent = mapAgent(plan.agent);
    if (agent === plan.agent) return plan;
    return {
      ...plan,
      agent,
      rationale: `${plan.rationale} Cloud preference: stripped local-file scopes; documents use files.create (create_xlsx / create_report_pdf).`,
    };
  }

  const supervisor = mapAgent(plan.team.supervisor);
  const workers = plan.team.workers.map((w) => mapAgent(w) as NLWorkerSpec);
  const unchanged =
    supervisor === plan.team.supervisor &&
    workers.every((w, i) => w === plan.team.workers[i]);
  if (unchanged) return plan;
  return {
    ...plan,
    team: { ...plan.team, supervisor, workers },
    rationale: `${plan.rationale} Cloud preference: team kept on cloud; local-file scopes stripped in favor of sandbox document tools.`,
  };
}
