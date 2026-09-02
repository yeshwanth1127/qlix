/**
 * Conditional domain instruction packs for the NL agent builder.
 * Core prompt stays small; specialty recipes load only when the user prompt matches.
 */
import {
  isCompetitorResearchPrompt,
  isCrmPrompt,
  isJobApplyPrompt,
  isLocalHybridPrompt,
} from './nlPlanEnrichment.js';

export type NlPromptPackId =
  | 'jobs'
  | 'competitor'
  | 'crm'
  | 'slack'
  | 'notion'
  | 'local'
  | 'finance'
  | 'messaging';

const FINANCE_INTENT =
  /\b(spend|payment|pay\b|purchase|checkout|buy\b|financ(?:e|ial)|\$\d+|up\s+to\s+\$?\d+)\b/i;

const MESSAGING_INTENT =
  /\b(email|gmail|inbox|whatsapp|wa\b|orbit|instagram|facebook|tweet|twitter|social\s+post|schedule\s+(?:a\s+)?post)\b/i;

const SLACK_INTENT = /\bslack\b/i;
const NOTION_INTENT = /\bnotion\b/i;

const PACK_TEXT: Record<NlPromptPackId, string> = {
  jobs: `## Job apply
- Cloud: web.read + web.click + web.transaction + mcp.qlix-jobs.* (search_jobs, queue_applications, get_apply_brief, record_application_result, upsert_candidate_profile, stage_resume).
- Greenhouse/Lever/Ashby only — not LinkedIn Easy Apply or Indeed. Put web.transaction in jitScopes.
- Flow: upsert/stage resume → queue/search → get_apply_brief → browser fill → JIT submit → record_application_result.`,

  competitor: `## Competitor research
- Prefer web.research (+ brain.query if internal context). Stay cloud; for PDF add files.create (built-in cloud PDF), not system.file_*.
- Cited SWOT/executive report from research tools, not browsing-only.`,

  crm: `## CRM
- Request crm.read + crm.write + crm.delete for create/update/delete/convert/link/attach. write+delete are JIT.
- Start with list/describe modules before mutating.`,

  slack: `## Slack
- Request slack.read + slack.send together. slack.send is JIT. Connector can be linked later.`,

  notion: `## Notion
- Request notion.read + notion.write together. notion.write is JIT. Connector can be linked later.
- Use notion_read (search / get_page / query_database) then notion_write (create_page / update_page / create_database_row). Pass markdown for page body content.`,

  local: `## Local / hybrid
- Local files or desktop GUI → runtime hybrid.
- Read files: system.file_read. Read+write: + system.file_write (JIT). GUI: system.gui_control (+ web.* if also browsing).`,

  finance: `## Finance
- Add finance.spend_50 or finance.spend_100 as needed (both JIT).`,

  messaging: `## Email / WhatsApp / social / Google
- Google / Microsoft: email.read / email.send (Gmail or Microsoft 365; send JIT), drive.read / drive.write (Google Drive or OneDrive), docs.read / docs.write, sheets.read / sheets.write, slides.read / slides.write, forms.read / forms.write, calendar.read / calendar.write, meet.manage (JIT), youtube.read / youtube.publish (publish JIT).
- whatsapp.send = self-chat files; whatsapp.read / whatsapp.contact_send for contacts (contact_send JIT). Contact send covers ordered text, documents, and polls (whatsapp_send_message / whatsapp_send_document / whatsapp_send_poll). conversation (Outreach plugin) starts parallel reply threads; whatsapp.auto_reply is a compatibility alias. A poll vote counts as the reply.
- If the user says “wait for a reply”, “when they respond”, or “if they reply”, add conversation (and keep whatsapp.auto_reply during the alias period) to the SAME worker that has whatsapp.contact_send. In a pipeline this pauses after outreach and resumes the next stage with the inbound thread snapshots.
- If the user says “if interested”, “only interested”, or similar, keep a later Contact Manager / CRM worker that builds the sheet from responders — runtime classifies reply interest on resume (keywords then LLM) and only sheets interested + unclear leads.
- Reply-wait + sheet language: persist structured waitSteps on the team (live sandbox xlsx updated on each included reply while waiting; deliver on resume).
- Spreadsheets/Excel on cloud: files.create → create_xlsx (sandbox); deliver with whatsapp_send. Never system.file_write for sheets unless the user wants local files. Never add web.research only to unlock spreadsheets.
- social.read / social.publish (publish JIT) via Orbit. Request only channels the task needs.`,
};

export function selectNlPromptPacks(userPrompt: string): NlPromptPackId[] {
  const packs: NlPromptPackId[] = [];
  if (isJobApplyPrompt(userPrompt)) packs.push('jobs');
  if (isCompetitorResearchPrompt(userPrompt) && !isJobApplyPrompt(userPrompt)) {
    packs.push('competitor');
  }
  if (
    isCrmPrompt(userPrompt) &&
    !isJobApplyPrompt(userPrompt) &&
    !isCompetitorResearchPrompt(userPrompt)
  ) {
    packs.push('crm');
  }
  if (SLACK_INTENT.test(userPrompt)) packs.push('slack');
  if (NOTION_INTENT.test(userPrompt)) packs.push('notion');
  if (isLocalHybridPrompt(userPrompt)) packs.push('local');
  if (FINANCE_INTENT.test(userPrompt)) packs.push('finance');
  if (MESSAGING_INTENT.test(userPrompt)) packs.push('messaging');
  return packs;
}

export function renderNlPromptPacks(packs: readonly NlPromptPackId[]): string {
  if (!packs.length) return '';
  return `\n\n${packs.map((id) => PACK_TEXT[id]).join('\n\n')}`;
}
