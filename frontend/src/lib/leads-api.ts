const defaultBase = "http://localhost:4000";

function apiBase(): string {
  return (process.env.NEXT_PUBLIC_API_BASE_URL ?? defaultBase).replace(/\/$/, "");
}

export type LeadCampaignStatus = "draft" | "scraping" | "ready" | "outreach" | "completed" | "failed";

export interface LeadCampaignStats {
  totalLeads: number;
  withEmail: number;
  contacted: number;
  failed: number;
}

export interface LeadCampaignDTO {
  id: string;
  orgId: string;
  createdById: string;
  name: string;
  status: LeadCampaignStatus;
  searchQuery: string;
  location: string | null;
  maxResults: number;
  outreachConfig: Record<string, unknown>;
  agentRunId: string | null;
  scrapeJobId: string | null;
  stats: LeadCampaignStats;
  createdAt: string;
  updatedAt: string;
}

export interface LeadDTO {
  id: string;
  campaignId: string;
  businessName: string;
  email: string | null;
  phone: string | null;
  website: string | null;
  address: string | null;
  status: string;
  emailVerified?: boolean;
  emailSource?: string | null;
  rating: number | null;
  reviewCount: number | null;
  createdAt: string;
}

async function parseJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

export async function listLeadCampaigns(): Promise<LeadCampaignDTO[]> {
  const res = await fetch(`${apiBase()}/api/v1/leads/campaigns`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to load campaigns");
  const data = await parseJson<{ campaigns: LeadCampaignDTO[] }>(res);
  return data.campaigns;
}

export async function createLeadCampaign(body: {
  name: string;
  searchQuery: string;
  location?: string;
  maxResults?: number;
  startScrape?: boolean;
}): Promise<LeadCampaignDTO> {
  const res = await fetch(`${apiBase()}/api/v1/leads/campaigns`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await parseJson<{ campaign: LeadCampaignDTO; error?: { message: string } }>(res);
  if (!res.ok) throw new Error(data.error?.message ?? "Failed to create campaign");
  return data.campaign;
}

export async function getLeadCampaign(id: string): Promise<LeadCampaignDTO> {
  const res = await fetch(`${apiBase()}/api/v1/leads/campaigns/${encodeURIComponent(id)}`, {
    credentials: "include",
  });
  const data = await parseJson<{ campaign: LeadCampaignDTO; error?: { message: string } }>(res);
  if (!res.ok) throw new Error(data.error?.message ?? "Failed to load campaign");
  return data.campaign;
}

export async function listCampaignLeads(
  campaignId: string,
  opts?: { hasEmail?: boolean; includeAll?: boolean; limit?: number },
): Promise<{ leads: LeadDTO[]; total: number }> {
  const q = new URLSearchParams();
  if (opts?.hasEmail) q.set("has_email", "true");
  if (opts?.includeAll) q.set("include_all", "true");
  if (opts?.limit) q.set("limit", String(opts.limit));
  const res = await fetch(
    `${apiBase()}/api/v1/leads/campaigns/${encodeURIComponent(campaignId)}/leads?${q}`,
    { credentials: "include" },
  );
  if (!res.ok) throw new Error("Failed to load leads");
  return parseJson(res);
}

export async function startCampaignOutreach(
  campaignId: string,
  body: {
    channel?: string;
    provider?: string;
    agentId?: string;
    template?: { subject?: string; bodyTemplate?: string };
  },
): Promise<{ campaign: LeadCampaignDTO; runId: string | null }> {
  const res = await fetch(
    `${apiBase()}/api/v1/leads/campaigns/${encodeURIComponent(campaignId)}/outreach`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  const data = await parseJson<{
    campaign: LeadCampaignDTO;
    runId: string | null;
    error?: { message: string };
  }>(res);
  if (!res.ok) throw new Error(data.error?.message ?? "Failed to start outreach");
  return data;
}

export function campaignExportUrl(campaignId: string): string {
  return `${apiBase()}/api/v1/leads/campaigns/${encodeURIComponent(campaignId)}/export`;
}

export async function createLeadGenTeam(): Promise<{ teamId: string; name: string }> {
  const res = await fetch(`${apiBase()}/api/v1/leads/team-template`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  });
  const data = await parseJson<{ team: { id: string; name: string }; error?: { message: string } }>(res);
  if (!res.ok) throw new Error(data.error?.message ?? "Failed to create team template");
  return { teamId: data.team.id, name: data.team.name };
}
