/**
 * Deterministic stage goals + completion checks for lead-gen pipeline teams.
 */
import { listAgentRunEventsSince } from '../agentChat/agentRunService.js';
import type { PermissionScope } from '../agents/agents.types.js';
import type { TeamMemberDTO } from '../teams/teams.types.js';

export interface ParsedLeadGenRequest {
  searchQuery: string;
  location: string;
  maxResults: number;
}

export interface LeadReviewCheckpoint {
  step: 'lead_review_checkpoint';
  campaignId: string;
  completedResults: Array<{
    subtaskId: string;
    agentId: string;
    agentName: string;
    summary: string;
    findings: string;
    status: 'completed' | 'failed';
  }>;
  remainingSubtasks: Array<{
    subtaskId: string;
    agentId: string;
    agentName: string;
    role: string;
    goal: string;
    delegatedScopes: PermissionScope[];
  }>;
  timestampMs: number;
}

export function findLeadReviewCheckpoint(trace: unknown[]): LeadReviewCheckpoint | null {
  for (let i = trace.length - 1; i >= 0; i--) {
    const step = trace[i] as LeadReviewCheckpoint | undefined;
    if (step?.step === 'lead_review_checkpoint') return step;
  }
  return null;
}

const GMB_SCOPE = 'mcp.qlix-leads.gmb_search_leads';
const ENRICH_SCOPES = new Set<PermissionScope>([
  'mcp.qlix-leads.list_leads',
  'mcp.qlix-leads.update_lead_email',
  'mcp.qlix-leads.record_lead_enrichment',
]);
const OUTREACH_SCOPES = new Set<PermissionScope>(['email.send', 'mcp.qlix-leads.start_outreach']);

export function memberLeadGenStage(
  member: TeamMemberDTO,
): 'scrape' | 'enrich' | 'outreach' | null {
  const scopes = member.delegatedScopes ?? [];
  if (scopes.includes(GMB_SCOPE)) return 'scrape';
  // Outreach agents often share list_leads with enrichers — check outreach scopes first.
  if (scopes.some((s) => OUTREACH_SCOPES.has(s))) return 'outreach';
  if (scopes.some((s) => ENRICH_SCOPES.has(s))) return 'enrich';
  return null;
}

/** True when the team looks like scrape → enrich → outreach. */
export function isLeadGenPipelineTeam(members: TeamMemberDTO[]): boolean {
  const stages = members.map(memberLeadGenStage).filter(Boolean);
  return stages.includes('scrape') && stages.includes('enrich');
}

export function parseLeadGenRequest(goal: string): ParsedLeadGenRequest {
  const lower = goal.toLowerCase();
  let maxResults = 5;
  const countMatch = lower.match(/\b(?:generate|find|get|scrape)\s+(\d+)\b/);
  if (countMatch) maxResults = Math.min(200, Math.max(1, parseInt(countMatch[1]!, 10)));

  let searchQuery = 'businesses';
  for (const term of ['salon', 'salons', 'cafe', 'cafes', 'restaurant', 'restaurants', 'shop', 'shops']) {
    if (lower.includes(term)) {
      searchQuery = term.endsWith('s') ? term : `${term}s`;
      break;
    }
  }

  let location = 'Bangalore';
  const aroundMatch = goal.match(/\baround\s+([^,.]+?)(?:\s+and|\s+generate|\s+send|$)/i);
  if (aroundMatch?.[1]?.trim()) {
    location = aroundMatch[1].trim();
  } else if (/\bbangalore\b|\bbengaluru\b/i.test(goal)) {
    location = 'Bangalore';
  }

  return { searchQuery, location, maxResults };
}

export function buildLeadGenStageGoal(
  stage: 'scrape' | 'enrich' | 'outreach',
  userGoal: string,
  parsed: ParsedLeadGenRequest,
  priorCampaignId?: string | null,
): string {
  switch (stage) {
    case 'scrape':
      return [
        `Scrape ${parsed.maxResults} ${parsed.searchQuery} near ${parsed.location} using Google Maps.`,
        `Steps (required):`,
        `1. Call mcp__qlix-leads__gmb_search_leads with searchQuery="${parsed.searchQuery}", location="${parsed.location}", maxResults=${parsed.maxResults}, requireWebsite=true.`,
        `2. Call mcp__qlix-leads__list_leads with includeAll=true and the campaignId from step 1.`,
        `3. Return JSON with campaignId, business names, websites, and note which leads need browser email enrichment.`,
        `Do NOT send email. Do NOT loop on think — call gmb_search_leads immediately.`,
        `User context: ${userGoal}`,
      ].join('\n');
    case 'enrich':
      return [
        `Enrich scraped leads with emails from their websites.`,
        priorCampaignId
          ? `Use campaignId="${priorCampaignId}" from the scraper stage.`
          : `Read campaignId from the prior pipeline context below.`,
        `Steps (required):`,
        `1. mcp__qlix-leads__list_leads includeAll=true — read needsBrowserEnrichment.`,
        `2. For EACH lead with a website: browser_ab_open(website), check /contact, then update_lead_email OR record_lead_enrichment(no_email_on_site).`,
        `3. mcp__qlix-leads__list_leads again and return JSON with verified emails.`,
        `Do NOT invent emails. Do NOT call update_lead_email without a real campaignId and leadId from list_leads.`,
        `User context: ${userGoal}`,
      ].join('\n');
    case 'outreach':
      return [
        `Send personalised outreach email only to leads with verified emails from enrichment.`,
        priorCampaignId
          ? `Campaign: ${priorCampaignId}.`
          : `Use campaignId from prior pipeline context.`,
        `Steps (required):`,
        `1. mcp__qlix-leads__list_leads with the campaignId — read contactable leads with verified emails.`,
        `2. email_send to EACH contactable lead with metadata { campaignId, leadId } and a personalised message.`,
        `Alternative: mcp__qlix-leads__start_outreach with the campaignId to trigger outreach.`,
        `Do NOT invent recipient addresses. Prior pipeline stages already scraped and enriched leads.`,
        `User context: ${userGoal}`,
      ].join('\n');
  }
}

export function normalizeFindingsText(findings: unknown): string {
  if (findings == null) return '';
  if (typeof findings === 'string') return findings;
  if (typeof findings === 'object') return JSON.stringify(findings, null, 2);
  return String(findings);
}

export function extractCampaignIdFromText(text: unknown): string | null {
  const normalized = normalizeFindingsText(text);
  if (!normalized.trim()) return null;
  const m =
    normalized.match(/"campaignId"\s*:\s*"([^"]+)"/) ??
    normalized.match(/campaignId[=:\s]+["']?([a-z0-9]{10,})/i);
  return m?.[1]?.trim() ?? null;
}

export function validateLeadGenWorkerOutput(params: {
  stage: 'scrape' | 'enrich' | 'outreach' | null;
  toolsUsed: string[];
  findings: unknown;
  pipelineMode?: boolean;
}): string | null {
  const { stage, toolsUsed } = params;
  const findings = normalizeFindingsText(params.findings);
  const empty =
    !findings.trim() ||
    /^no response generated\.?$/i.test(findings.trim()) ||
    findings.trim().length < 20;

  if (!stage) return null;

  const used = (name: string) =>
    toolsUsed.some((t) => t === name || t.endsWith(`__${name}`) || t.includes(name));

  if (stage === 'scrape') {
    if (!used('gmb_search_leads')) {
      return 'Lead Scraper never called gmb_search_leads — no leads were scraped.';
    }
    if (empty && !extractCampaignIdFromText(findings)) {
      return 'Lead Scraper finished without returning campaignId or lead data.';
    }
  }

  if (stage === 'enrich') {
    if (!used('list_leads') && empty) {
      return 'Email Enricher did not call list_leads or return enrichment results.';
    }
    if (used('update_lead_email') && !used('list_leads')) {
      return 'Email Enricher called update_lead_email without list_leads — no active campaign context.';
    }
    const onlyUpdate =
      toolsUsed.length > 0 && toolsUsed.every((t) => t.includes('update_lead_email'));
    if (onlyUpdate) {
      return 'Email Enricher only repeated update_lead_email without browser enrichment or list_leads.';
    }
  }

  if (stage === 'outreach') {
    if (used('start_outreach') || used('list_leads')) {
      return null;
    }
    if (used('email_send') && !used('list_leads')) {
      return 'Outreach attempted email_send before listing verified leads.';
    }
  }

  return null;
}

/** Tool names from agent run log events (tool_finished). */
export async function listAgentRunTools(agentRunId: string): Promise<string[]> {
  const events = await listAgentRunEventsSince(agentRunId, -1);
  const tools: string[] = [];
  for (const ev of events) {
    if (ev.type !== 'log') continue;
    const data = ev.data as Record<string, unknown> | null;
    if (data?.message !== 'tool_finished') continue;
    const tool = typeof data.tool === 'string' ? data.tool : null;
    if (tool) tools.push(tool);
  }
  return tools;
}
