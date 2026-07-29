"use client";

import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import {
  createLeadCampaign,
  createLeadGenTeam,
  getLeadCampaign,
  listCampaignLeads,
  listLeadCampaigns,
  startCampaignOutreach,
  campaignExportUrl,
  type LeadCampaignDTO,
  type LeadDTO,
} from "@/lib/leads-api";
import { listAgents, type AgentDTO } from "@/lib/agents-api";
import { cn } from "@/lib/utils/cn";
import { useSession } from "@/components/qlix/session-context";

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-black/10 text-black/70",
  scraping: "bg-amber-100 text-amber-900",
  ready: "bg-emerald-100 text-emerald-900",
  outreach: "bg-violet-100 text-violet-900",
  completed: "bg-black/10 text-black/70",
  failed: "bg-red-100 text-red-900",
};

function StatusBadge({ status }: { readonly status: string }) {
  return (
    <span
      className={cn(
        "inline-block rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide",
        STATUS_COLORS[status] ?? STATUS_COLORS.draft,
      )}
    >
      {status}
    </span>
  );
}

function CampaignDetail({
  campaignId,
  routePrefix,
  agents,
}: {
  readonly campaignId: string;
  readonly routePrefix: string;
  readonly agents: AgentDTO[];
}) {
  const queryClient = useQueryClient();
  const { session } = useSession();
  const { data: campaign, isLoading } = useQuery({
    queryKey: ["lead-campaign", campaignId],
    queryFn: () => getLeadCampaign(campaignId),
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === "scraping" || s === "outreach" ? 3000 : false;
    },
  });

  const { data: leadsData } = useQuery({
    queryKey: ["lead-campaign-leads", campaignId],
    queryFn: () => listCampaignLeads(campaignId, { limit: 100 }),
    enabled: Boolean(campaign),
    refetchInterval: campaign?.status === "scraping" ? 3000 : false,
  });

  const [outreachAgentId, setOutreachAgentId] = useState("");
  const [outreachBusy, setOutreachBusy] = useState(false);
  const [outreachError, setOutreachError] = useState<string | null>(null);

  const handleOutreach = async () => {
    if (!campaign) return;
    setOutreachBusy(true);
    setOutreachError(null);
    try {
      await startCampaignOutreach(campaign.id, {
        channel: "email",
        provider: "gmail",
        agentId: outreachAgentId || undefined,
      });
      await queryClient.invalidateQueries({ queryKey: ["lead-campaign", campaignId] });
    } catch (err) {
      setOutreachError(err instanceof Error ? err.message : "Outreach failed");
    } finally {
      setOutreachBusy(false);
    }
  };

  if (isLoading || !campaign) {
    return <p className="text-[11px] text-black/50">Loading campaign…</p>;
  }

  const leads = leadsData?.leads ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-serif text-lg text-black">{campaign.name}</h2>
          <p className="mt-1 text-[10px] text-black/50">
            {campaign.searchQuery}
            {campaign.location ? ` · ${campaign.location}` : ""}
          </p>
        </div>
        <StatusBadge status={campaign.status} />
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["Total leads", campaign.stats.totalLeads],
          ["Contactable", campaign.stats.withEmail],
          ["Contacted", campaign.stats.contacted],
          ["Failed", campaign.stats.failed],
        ].map(([label, value]) => (
          <div key={label} className="border border-black/10 px-2 py-2">
            <p className="text-[9px] uppercase tracking-wide text-black/45">{label}</p>
            <p className="font-serif text-xl text-black">{value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <a
          href={campaignExportUrl(campaign.id)}
          className="border border-black px-2 py-1 text-[10px] font-semibold hover:bg-black/5"
        >
          Export CSV
        </a>
        {campaign.agentRunId ? (
          <Link
            href={`${routePrefix}/active-runs`}
            className="border border-black px-2 py-1 text-[10px] font-semibold hover:bg-black/5"
          >
            View outreach run
          </Link>
        ) : null}
      </div>

      {campaign.status === "ready" ? (
        <div className="border border-black/15 p-3 space-y-2">
          <p className="text-[10px] font-semibold text-black">Start email outreach</p>
          <select
            value={outreachAgentId}
            onChange={(e) => setOutreachAgentId(e.target.value)}
            className="w-full border border-black/20 bg-white px-2 py-1 text-[11px]"
          >
            <option value="">Select agent (optional)</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={outreachBusy}
            onClick={() => void handleOutreach()}
            className="bg-black px-3 py-1 text-[10px] font-semibold text-white disabled:opacity-50"
          >
            {outreachBusy ? "Starting…" : "Start outreach"}
          </button>
          {outreachError ? <p className="text-[10px] text-red-600">{outreachError}</p> : null}
        </div>
      ) : null}

      <div>
        <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-black/50">Leads</h3>
        {leads.length === 0 ? (
          <p className="text-[11px] text-black/45">
            {campaign.status === "scraping" ? "Scraping in progress…" : "No leads yet."}
          </p>
        ) : (
          <div className="overflow-x-auto border border-black/10 -mx-1 sm:mx-0">
            <table className="w-full min-w-[320px] text-left text-[10px] sm:min-w-[480px]">
              <thead className="border-b border-black/10 bg-black/[0.02]">
                <tr>
                  <th className="px-2 py-1.5 font-semibold">Business</th>
                  <th className="px-2 py-1.5 font-semibold">Email</th>
                  <th className="px-2 py-1.5 font-semibold">Phone</th>
                  <th className="px-2 py-1.5 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead: LeadDTO) => (
                  <tr key={lead.id} className="border-b border-black/5">
                    <td className="px-2 py-1.5">{lead.businessName}</td>
                    <td className="px-2 py-1.5 text-black/70">
                      {lead.email ? (
                        <span>
                          {lead.email}
                          {lead.emailVerified ? (
                            <span className="ml-1 text-[9px] text-emerald-700">verified</span>
                          ) : null}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-black/70">{lead.phone ?? "—"}</td>
                    <td className="px-2 py-1.5">{lead.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export function LeadsView({ routePrefix }: { readonly routePrefix: string }) {
  const queryClient = useQueryClient();
  const { session } = useSession();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [location, setLocation] = useState("");
  const [maxResults, setMaxResults] = useState(25);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [teamBusy, setTeamBusy] = useState(false);

  const { data: campaigns = [], isLoading } = useQuery({
    queryKey: ["lead-campaigns"],
    queryFn: listLeadCampaigns,
  });

  const { data: agents = [] } = useQuery({
    queryKey: ["agents-list-leads", session?.organization.id],
    queryFn: async () => (await listAgents(session?.organization.id ?? null)) ?? [],
    enabled: Boolean(session),
  });

  useEffect(() => {
    if (!selectedId && campaigns.length > 0) {
      setSelectedId(campaigns[0].id);
    }
  }, [campaigns, selectedId]);

  const handleCreate = useCallback(async () => {
    if (!searchQuery.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const campaign = await createLeadCampaign({
        name: name.trim() || `GMB: ${searchQuery.trim().slice(0, 40)}`,
        searchQuery: searchQuery.trim(),
        location: location.trim() || undefined,
        maxResults,
        startScrape: true,
      });
      await queryClient.invalidateQueries({ queryKey: ["lead-campaigns"] });
      setSelectedId(campaign.id);
      setName("");
      setSearchQuery("");
      setLocation("");
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create campaign");
    } finally {
      setCreating(false);
    }
  }, [name, searchQuery, location, maxResults, queryClient]);

  const handleCreateTeam = async () => {
    setTeamBusy(true);
    try {
      const team = await createLeadGenTeam();
      window.location.href = `${routePrefix}/teams/${team.teamId}`;
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create team");
      setTeamBusy(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl text-black">Lead campaigns</h1>
          <p className="mt-1 max-w-xl text-[11px] text-black/55">
            Scrape Google Business leads via the Qlix Leads MCP server, then run governed email outreach.
          </p>
        </div>
        <button
          type="button"
          disabled={teamBusy}
          onClick={() => void handleCreateTeam()}
          className="border border-black px-2 py-1 text-[10px] font-semibold hover:bg-black/5 disabled:opacity-50"
        >
          {teamBusy ? "Creating team…" : "Create pipeline team"}
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <aside className="space-y-3">
          <div className="border border-black/15 p-3 space-y-2">
            <p className="text-[10px] font-semibold text-black">New campaign</p>
            <input
              placeholder="Campaign name (optional)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full border border-black/20 px-2 py-1 text-[11px]"
            />
            <input
              placeholder="Search query e.g. dentists"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full border border-black/20 px-2 py-1 text-[11px]"
            />
            <input
              placeholder="Location (optional)"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="w-full border border-black/20 px-2 py-1 text-[11px]"
            />
            <input
              type="number"
              min={1}
              max={200}
              value={maxResults}
              onChange={(e) => setMaxResults(Number(e.target.value) || 25)}
              className="w-full border border-black/20 px-2 py-1 text-[11px]"
            />
            <button
              type="button"
              disabled={creating || !searchQuery.trim()}
              onClick={() => void handleCreate()}
              className="w-full bg-black py-1.5 text-[10px] font-semibold text-white disabled:opacity-50"
            >
              {creating ? "Creating…" : "Scrape leads"}
            </button>
            {createError ? <p className="text-[10px] text-red-600">{createError}</p> : null}
          </div>

          <div className="border border-black/10">
            <p className="border-b border-black/10 px-2 py-1.5 text-[9px] font-semibold uppercase tracking-wide text-black/45">
              Campaigns
            </p>
            {isLoading ? (
              <p className="p-2 text-[10px] text-black/45">Loading…</p>
            ) : campaigns.length === 0 ? (
              <p className="p-2 text-[10px] text-black/45">No campaigns yet.</p>
            ) : (
              <ul>
                {campaigns.map((c: LeadCampaignDTO) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(c.id)}
                      className={cn(
                        "w-full border-b border-black/5 px-2 py-2 text-left text-[10px] hover:bg-black/[0.03]",
                        selectedId === c.id && "bg-[color:var(--sketch-purple-soft)]",
                      )}
                    >
                      <span className="block truncate font-semibold">{c.name}</span>
                      <span className="mt-0.5 flex items-center gap-1">
                        <StatusBadge status={c.status} />
                        <span className="text-black/45">{c.stats.totalLeads} leads</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        <main className="min-h-[320px] border border-black/10 p-4">
          {selectedId ? (
            <CampaignDetail campaignId={selectedId} routePrefix={routePrefix} agents={agents} />
          ) : (
            <p className="text-[11px] text-black/45">Select or create a campaign.</p>
          )}
        </main>
      </div>
    </div>
  );
}
