/**
 * Enforces the lead-outreach UX order: an agent must scrape and *list leads to the
 * user* before it is allowed to send outreach email. We record when a lead-listing
 * tool runs (per agent, time-bounded) and require that signal at email-send time.
 *
 * Backend runs as a single process (PM2 instances: 1), so an in-memory map is a
 * reliable, low-overhead store here — mirroring the run-scoped JIT grant tracker.
 */

/** MCP tools that count as "presented the lead list / scraped" for the gate. */
const LEAD_LISTING_ACTION_TYPES = new Set([
  'mcp.qlix-leads.list_leads',
  'mcp.qlix-leads.gmb_search_leads',
  'mcp.qlix-leads.get_campaign',
]);

/** How long a "leads were listed" signal stays valid for subsequent sends. */
const LISTED_TTL_MS = 60 * 60_000;

/** agentId -> epoch ms of the most recent lead-listing action. */
const lastListedByAgent = new Map<string, number>();

/** teamRunId -> epoch ms — prior pipeline stages listed/scraped leads for this team run. */
const lastListedByTeamRun = new Map<string, number>();

/** campaignId -> epoch ms — user reviewed this campaign's leads in the UI and approved outreach. */
const approvedCampaigns = new Map<string, number>();

export function isLeadListingActionType(actionType: string): boolean {
  return LEAD_LISTING_ACTION_TYPES.has(actionType);
}

/** Record that an agent just listed/scraped leads (presented them in chat). */
export function markLeadsListed(agentId: string): void {
  lastListedByAgent.set(agentId, Date.now());
}

/** Record that the user reviewed leads in UI and approved outreach for this team run. */
export function markLeadsListedForTeamRun(teamRunId: string): void {
  lastListedByTeamRun.set(teamRunId, Date.now());
}

/** Called when user clicks Approve outreach in Team Run UI. */
export function approveLeadOutreachForTeamRun(
  teamRunId: string,
  outreachAgentId?: string,
  campaignId?: string | null,
): void {
  markLeadsListedForTeamRun(teamRunId);
  if (outreachAgentId) {
    markLeadsListed(outreachAgentId);
  }
  if (campaignId) {
    approvedCampaigns.set(campaignId, Date.now());
  }
}

/**
 * True when the user explicitly reviewed this campaign's leads in the UI and approved
 * outreach. Used to relax the campaign-wide "enrichment must be complete" block —
 * the user saw which leads still lack emails and chose to proceed with the verified ones.
 * Per-recipient verified-email checks still apply.
 */
export function isCampaignOutreachApproved(campaignId: string): boolean {
  const at = approvedCampaigns.get(campaignId);
  if (at == null) return false;
  if (Date.now() - at > LISTED_TTL_MS) {
    approvedCampaigns.delete(campaignId);
    return false;
  }
  return true;
}

/** True when the agent listed leads recently enough to justify sending outreach. */
export function hasListedLeadsRecently(agentId: string): boolean {
  const at = lastListedByAgent.get(agentId);
  if (at == null) return false;
  if (Date.now() - at > LISTED_TTL_MS) {
    lastListedByAgent.delete(agentId);
    return false;
  }
  return true;
}

/** True when an earlier stage in this team run scraped/listed leads. */
export function hasListedLeadsRecentlyForTeamRun(teamRunId: string): boolean {
  const at = lastListedByTeamRun.get(teamRunId);
  if (at == null) return false;
  if (Date.now() - at > LISTED_TTL_MS) {
    lastListedByTeamRun.delete(teamRunId);
    return false;
  }
  return true;
}
