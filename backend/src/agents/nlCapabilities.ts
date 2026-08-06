import type { ScopeDef } from './scopeCatalog.js';

const AGENT_REQUIRED = [
  'name',
  'description',
  'permissionScopes',
  'jitScopes',
  'runtime',
  'model',
  'llmMode',
  'localInferenceMode',
  'rationale',
];

/** Agent property schema, with scope enums narrowed to the scopes available this request. */
function agentPropertiesSchema(scopeIds: string[]): Record<string, unknown> {
  return {
    name: { type: 'string', description: 'Short descriptive name, e.g. "Web Researcher"', maxLength: 120 },
    description: {
      type: 'string',
      description: 'Task-specific system prompt for the agent. Be precise about what it does.',
      maxLength: 10000,
    },
    permissionScopes: {
      type: 'array',
      description: 'Minimum set of permission scopes required. JIT-forced scopes must also appear in jitScopes.',
      items: { type: 'string', enum: scopeIds },
    },
    jitScopes: {
      type: 'array',
      description: 'Subset of permissionScopes requiring user approval on every invocation. Must include all JIT-forced scopes present in permissionScopes.',
      items: { type: 'string', enum: scopeIds },
    },
    runtime: {
      type: 'string',
      enum: ['cloud', 'hybrid', 'local'],
      description: 'cloud = Qlix servers (default); hybrid = Qlix-hosted + local tool execution; local = SDK on user machine.',
    },
    model: { type: 'string', description: 'LLM model ID. For cloud/hybrid always use "openrouter/qlix/auto" unless the user names a specific pinned model.' },
    llmMode: {
      type: 'string',
      enum: ['proxy', 'direct'],
      description: 'proxy for cloud/hybrid; direct or proxy for local.',
    },
    localInferenceMode: {
      anyOf: [{ type: 'string', enum: ['local_llm', 'cloud_api'] }, { type: 'null' }],
      description: 'null for cloud/hybrid; "local_llm" or "cloud_api" for local runtime.',
    },
    rationale: { type: 'string', description: 'Brief explanation of why these choices were made.' },
  };
}

export function buildAgentToolSchema(scopes: ScopeDef[]): Record<string, unknown> {
  const scopeIds = scopes.map((s) => s.id);
  return {
    type: 'function',
    function: {
      name: 'plan_single_agent',
      description: "Plan a single Qlix agent. Call this when the user describes ONE agent's purpose.",
      parameters: {
        type: 'object',
        properties: {
          rationale: { type: 'string', description: 'Why these permissions and runtime were chosen.' },
          agent: {
            type: 'object',
            properties: agentPropertiesSchema(scopeIds),
            required: AGENT_REQUIRED,
            additionalProperties: false,
          },
        },
        required: ['rationale', 'agent'],
        additionalProperties: false,
      },
    },
  };
}

export function buildTeamToolSchema(scopes: ScopeDef[]): Record<string, unknown> {
  const scopeIds = scopes.map((s) => s.id);
  const props = agentPropertiesSchema(scopeIds);
  return {
    type: 'function',
    function: {
      name: 'plan_team',
      description: 'Plan a supervisor + workers team. Call when the user describes multiple coordinating agents, a pipeline, or a team.',
      parameters: {
        type: 'object',
        properties: {
          rationale: { type: 'string', description: 'Why a team structure was chosen.' },
          team: {
            type: 'object',
            properties: {
              name: { type: 'string', maxLength: 120, description: 'Team name.' },
              description: { type: 'string', maxLength: 10000, description: 'Team purpose.' },
              supervisor: {
                type: 'object',
                description: 'Orchestrator agent that delegates to workers and synthesizes results.',
                properties: props,
                required: AGENT_REQUIRED,
                additionalProperties: false,
              },
              workers: {
                type: 'array',
                description: 'Specialized worker agents.',
                items: {
                  type: 'object',
                  properties: {
                    ...props,
                    role: {
                      type: 'string',
                      maxLength: 80,
                      description: 'Worker role, e.g. researcher, writer, analyst.',
                    },
                    stageOrder: {
                      type: 'integer',
                      minimum: 1,
                      description: 'Execution order starting at 1.',
                    },
                  },
                  required: [...AGENT_REQUIRED, 'role', 'stageOrder'],
                  additionalProperties: false,
                },
              },
              config: {
                type: 'object',
                properties: {
                  maxParallelWorkers: { type: 'integer', minimum: 1, maximum: 10, default: 3 },
                  subtaskTimeoutMs: { type: 'integer', minimum: 30000, default: 180000 },
                  retryPolicy: { type: 'string', enum: ['none', 'once', 'twice'], default: 'once' },
                },
                required: ['maxParallelWorkers', 'subtaskTimeoutMs', 'retryPolicy'],
                additionalProperties: false,
              },
            },
            required: ['name', 'description', 'supervisor', 'workers', 'config'],
            additionalProperties: false,
          },
        },
        required: ['rationale', 'team'],
        additionalProperties: false,
      },
    },
  };
}

export function buildSystemPrompt(scopes: ScopeDef[]): string {
  const scopeList = scopes
    .map((s) => `  ${s.id} — ${s.description}${s.forceJit ? ' [JIT-forced]' : ''}`)
    .join('\n');
  const forceJitList = scopes
    .filter((s) => s.forceJit)
    .map((s) => s.id)
    .join(', ');

  return `You are an agent configuration expert for the Qlix AI agent platform.
Call EXACTLY ONE of the provided tools — plan_single_agent or plan_team — based on the user description.

## Which tool to call
- plan_single_agent: user describes a single agent's purpose.
- plan_team: user describes multiple coordinating agents, a pipeline, supervisor/workers, or a team.

## Available scopes
${scopeList}

## Runtime rules
- cloud (default): runs on Qlix servers. Use for web research, browsing, cloud automation. llmMode must be "proxy", localInferenceMode must be null.
- hybrid: Qlix-hosted brain, tools execute on the user's local machine. REQUIRED whenever the user mentions: local machine, my machine, my computer, desktop apps, GUI control, open apps, type/click on screen, local files, or screen automation. llmMode must be "proxy", localInferenceMode must be null.
- local: SDK-only, entirely on user's machine. llmMode can be "proxy" or "direct". localInferenceMode must be "local_llm" (local model) or "cloud_api" (proxy through Qlix).

## Scope combinations for common tasks
Pick ALL scopes that apply — err toward completeness over minimalism:
- Web research only (cloud): web.research
- Competitor / competitive research (cloud): web.research (add brain.query if it should factor in internal company context). Use the curated research tools — NOT web.read browsing — to produce a cited SWOT / executive report. PDF report generation is built in on cloud, so do NOT add system.file_write / system.file_read for "make a PDF" — that would force hybrid. Keep runtime cloud; the report is delivered in chat, and as a PDF over WhatsApp when whatsapp.send is granted (email cannot attach files).
- Web browsing + clicking (cloud): web.read + web.click
- Web automation with form submission (cloud or hybrid): web.read + web.click + web.transaction
- Desktop GUI automation on user's machine (hybrid): system.gui_control + web.read + web.click + web.transaction
- Open apps, type, click, submit on local machine (hybrid): system.gui_control + web.read + web.click + web.transaction
- Read local files (hybrid): system.file_read
- Read + write local files (hybrid): system.file_read + system.file_write
- Financial transactions: add finance.spend_50 (up to $50) or finance.spend_100 (up to $100)
- Job applications / send resume to job boards or career pages (cloud): web.read + web.click + web.transaction + mcp.qlix-jobs.* (search_jobs, queue_applications, get_apply_brief, record_application_result, upsert_candidate_profile, stage_resume). Target Greenhouse / Lever / Ashby company career pages only — NOT LinkedIn Easy Apply or Indeed. Always put web.transaction in jitScopes so every submit needs user approval.
- Job apply agent description should instruct: stage or upsert candidate profile + resume first, queue apply URLs or search ATS boards, get_apply_brief per application, browser fill + upload, pause for JIT before Submit, then record_application_result.
- Google Business / Maps lead scraping (cloud): mcp.qlix-leads.gmb_search_leads + mcp.qlix-leads.get_campaign + mcp.qlix-leads.list_leads (+ mcp.qlix-leads.export_leads if CSV export is needed)
- mcp.qlix-leads.list_leads returns contactable leads (verified website emails) by default — use includeAll=true to see every scraped business before enrichment
- NEVER use web.read or web.click for Google Maps / GMB scraping — use mcp.qlix-leads.gmb_search_leads only for Maps
- Lead website email enrichment (cloud): after gmb_search_leads, call list_leads with includeAll=true, then for EACH lead in needsBrowserEnrichment: browser_ab_open(website) → check /contact → update_lead_email OR record_lead_enrichment(no_email_on_site). Email domain must match website — never use Wix placeholders like info@mysite.com. Outreach is blocked until every website lead is browser-enriched.
- Lead email outreach after enrichment: add email.send plus mcp.qlix-leads.start_outreach (start_outreach is JIT — include in jitScopes)
- Lead gen pipeline team: supervisor orchestrates; finder worker scrapes GMB (mcp.qlix-leads.*), qualifier worker enriches websites (web.read + web.click + update_lead_email), outreach worker sends (email.send + start_outreach)
- Zoho CRM / CRM automation (cloud): crm.read + crm.write + crm.delete — request ALL THREE whenever the agent creates, updates, deletes, converts, links, attaches files to, or notes on CRM records (Leads, Contacts, Deals, etc.). crm.write and crm.delete are JIT-forced and must appear in jitScopes when granted. Start with crm_list_modules / crm_describe_module before mutating records.
- Slack (cloud): slack.read + slack.send — request BOTH whenever the agent reads channels/messages/lists OR posts messages, creates channels, opens DMs, or adds/updates Slack List task items. slack.send is JIT-forced (no separate slack.write scope). User must connect Slack under Connectors first; scopes can still be granted at build time.

## MCP scopes
Scopes starting with mcp.<server>.<tool> are MCP server tools registered for this org. Request them like any other scope when the task needs that capability — bindings are created automatically at agent creation.

## JIT scope rules
JIT-forced scopes: ${forceJitList || '(none)'}
- These MUST appear in BOTH permissionScopes AND jitScopes when requested.
- Non-JIT scopes go ONLY in permissionScopes, never in jitScopes.
- jitScopes must always be a subset of permissionScopes.

## Scope selection rule
Request every scope the agent's core task requires — incomplete permissions prevent the agent from working.
Connector-gated scopes (e.g. email, WhatsApp) MAY be requested even if the connector isn't linked yet — the user links it in Connectors and the link is verified when the agent runs. Request such a scope only when the task explicitly involves that channel.

## Defaults
- model: "openrouter/qlix/auto"  (Qlix Auto — always use this for cloud/hybrid agents unless the user explicitly asks for a pinned model)
- runtime: "cloud"
- llmMode: "proxy"
- localInferenceMode: null`;
}
