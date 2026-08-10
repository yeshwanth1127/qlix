/**
 * Conditional domain instruction packs for the NL agent builder.
 * Core prompt stays small; specialty recipes load only when the user prompt matches.
 */
import {
  isCompetitorResearchPrompt,
  isCrmPrompt,
  isJobApplyPrompt,
  isLeadGenPrompt,
} from './nlPlanEnrichment.js';

export type NlPromptPackId =
  | 'leads'
  | 'jobs'
  | 'competitor'
  | 'crm'
  | 'slack'
  | 'local'
  | 'finance'
  | 'messaging';

const LOCAL_INTENT =
  /\b(local\s+(?:file|files|filesystem|machine|computer|desktop)|my\s+(?:machine|computer|desktop|files?)|desktop\s+app|gui\s+control|screen\s+automation|hybrid\s+agent|file\s+control|read\s+(?:local\s+)?files?|write\s+(?:local\s+)?files?)\b/i;

const FINANCE_INTENT =
  /\b(spend|payment|pay\b|purchase|checkout|buy\b|financ(?:e|ial)|\$\d+|up\s+to\s+\$?\d+)\b/i;

const MESSAGING_INTENT =
  /\b(email|gmail|inbox|whatsapp|wa\b|orbit|instagram|facebook|tweet|twitter|social\s+post|schedule\s+(?:a\s+)?post)\b/i;

const SLACK_INTENT = /\bslack\b/i;

const PACK_TEXT: Record<NlPromptPackId, string> = {
  leads: `## Leads / Google Maps
- Use mcp.qlix-leads.gmb_search_leads + get_campaign + list_leads (export_leads if CSV needed). Never web.read/web.click for Maps.
- list_leads defaults to contactable leads; includeAll=true before enrichment.
- Enrichment: list_leads(includeAll) → for each needsBrowserEnrichment: browser open website → update_lead_email or record_lead_enrichment. Email domain must match site.
- Outreach: email.send + mcp.qlix-leads.start_outreach (JIT). Team: finder=GMB, qualifier=web enrich, outreach=email.`,

  jobs: `## Job apply
- Cloud: web.read + web.click + web.transaction + mcp.qlix-jobs.* (search_jobs, queue_applications, get_apply_brief, record_application_result, upsert_candidate_profile, stage_resume).
- Greenhouse/Lever/Ashby only — not LinkedIn Easy Apply or Indeed. Put web.transaction in jitScopes.
- Flow: upsert/stage resume → queue/search → get_apply_brief → browser fill → JIT submit → record_application_result.`,

  competitor: `## Competitor research
- Prefer web.research (+ brain.query if internal context). Stay cloud; do not add system.file_* for PDF (built-in cloud PDF).
- Cited SWOT/executive report from research tools, not browsing-only.`,

  crm: `## CRM
- Request crm.read + crm.write + crm.delete for create/update/delete/convert/link/attach. write+delete are JIT.
- Start with list/describe modules before mutating.`,

  slack: `## Slack
- Request slack.read + slack.send together. slack.send is JIT. Connector can be linked later.`,

  local: `## Local / hybrid
- Local files or desktop GUI → runtime hybrid.
- Read files: system.file_read. Read+write: + system.file_write (JIT). GUI: system.gui_control (+ web.* if also browsing).`,

  finance: `## Finance
- Add finance.spend_50 or finance.spend_100 as needed (both JIT).`,

  messaging: `## Email / WhatsApp / social / Google
- Google suite: email.read / email.send (Gmail; send JIT), drive.read / drive.write, calendar.read / calendar.write, meet.manage (JIT), youtube.read / youtube.publish (publish JIT).
- whatsapp.send = self-chat files; whatsapp.read / whatsapp.contact_send for contacts (contact_send JIT).
- social.read / social.publish (publish JIT) via Orbit. Request only channels the task needs.`,
};

export function selectNlPromptPacks(userPrompt: string): NlPromptPackId[] {
  const packs: NlPromptPackId[] = [];
  if (isLeadGenPrompt(userPrompt)) packs.push('leads');
  if (isJobApplyPrompt(userPrompt) && !isLeadGenPrompt(userPrompt)) packs.push('jobs');
  if (
    isCompetitorResearchPrompt(userPrompt) &&
    !isLeadGenPrompt(userPrompt) &&
    !isJobApplyPrompt(userPrompt)
  ) {
    packs.push('competitor');
  }
  if (
    isCrmPrompt(userPrompt) &&
    !isLeadGenPrompt(userPrompt) &&
    !isJobApplyPrompt(userPrompt) &&
    !isCompetitorResearchPrompt(userPrompt)
  ) {
    packs.push('crm');
  }
  if (SLACK_INTENT.test(userPrompt)) packs.push('slack');
  if (LOCAL_INTENT.test(userPrompt)) packs.push('local');
  if (FINANCE_INTENT.test(userPrompt)) packs.push('finance');
  if (MESSAGING_INTENT.test(userPrompt)) packs.push('messaging');
  return packs;
}

export function renderNlPromptPacks(packs: readonly NlPromptPackId[]): string {
  if (!packs.length) return '';
  return `\n\n${packs.map((id) => PACK_TEXT[id]).join('\n\n')}`;
}
