/**
 * Enforces the lead-outreach UX order: an agent must scrape and *list leads to the
 * user* before it is allowed to send outreach email. We record when a lead-listing
 * tool runs (per agent, time-bounded) and require that signal at email-send time.
 *
 * DB-backed via `EphemeralGrant` (see `../lib/ephemeralGrants.ts`) — previously three
 * in-process `Map`s, safe only under a single backend instance; correct now regardless
 * of instance count.
 */

import { ephemeralHas, ephemeralSet } from '../lib/ephemeralGrants.js';

/** MCP tools that count as "presented the lead list / scraped" for the gate. */
const LEAD_LISTING_ACTION_TYPES = new Set([
  'mcp.qlix-leads.list_leads',
  'mcp.qlix-leads.gmb_search_leads',
  'mcp.qlix-leads.get_campaign',
]);

/** How long a "leads were listed" signal stays valid for subsequent sends. */
const LISTED_TTL_MS = 60 * 60_000;

const NS_LISTED_BY_AGENT = 'lead-outreach-listed-agent';
const NS_LISTED_BY_TEAM_RUN = 'lead-outreach-listed-team-run';
const NS_APPROVED_CAMPAIGN = 'lead-outreach-approved-campaign';

export function isLeadListingActionType(actionType: string): boolean {
  return LEAD_LISTING_ACTION_TYPES.has(actionType);
}

/** Record that an agent just listed/scraped leads (presented them in chat). */
export async function markLeadsListed(agentId: string): Promise<void> {
  await ephemeralSet(NS_LISTED_BY_AGENT, agentId, true, LISTED_TTL_MS);
}

/** Record that the user reviewed leads in UI and approved outreach for this team run. */
export async function markLeadsListedForTeamRun(teamRunId: string): Promise<void> {
  await ephemeralSet(NS_LISTED_BY_TEAM_RUN, teamRunId, true, LISTED_TTL_MS);
}

/** Called when user clicks Approve outreach in Team Run UI. */
export async function approveLeadOutreachForTeamRun(
  teamRunId: string,
  outreachAgentId?: string,
  campaignId?: string | null,
): Promise<void> {
  await markLeadsListedForTeamRun(teamRunId);
  if (outreachAgentId) {
    await markLeadsListed(outreachAgentId);
  }
  if (campaignId) {
    await ephemeralSet(NS_APPROVED_CAMPAIGN, campaignId, true, LISTED_TTL_MS);
  }
}

/**
 * True when the user explicitly reviewed this campaign's leads in the UI and approved
 * outreach. Used to relax the campaign-wide "enrichment must be complete" block —
 * the user saw which leads still lack emails and chose to proceed with the verified ones.
 * Per-recipient verified-email checks still apply.
 */
export async function isCampaignOutreachApproved(campaignId: string): Promise<boolean> {
  return ephemeralHas(NS_APPROVED_CAMPAIGN, campaignId);
}

/** True when the agent listed leads recently enough to justify sending outreach. */
export async function hasListedLeadsRecently(agentId: string): Promise<boolean> {
  return ephemeralHas(NS_LISTED_BY_AGENT, agentId);
}

/** True when an earlier stage in this team run scraped/listed leads. */
export async function hasListedLeadsRecentlyForTeamRun(teamRunId: string): Promise<boolean> {
  return ephemeralHas(NS_LISTED_BY_TEAM_RUN, teamRunId);
}
