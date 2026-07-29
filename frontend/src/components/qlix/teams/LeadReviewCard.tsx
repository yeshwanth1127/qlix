"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronUp, Loader2, Mail, Globe, RefreshCw, AlertCircle } from "lucide-react";
import { listCampaignLeads, type LeadDTO } from "@/lib/leads-api";
import { approveLeadOutreach, retryLeadEnrichment } from "@/lib/teams-api";
import { cn } from "@/lib/utils/cn";
import { sketchButton, sketchLabel } from "@/components/qlix/sketch";

interface LeadReviewCardProps {
  readonly teamId: string;
  readonly runId: string;
  readonly campaignId: string;
  readonly approved: boolean;
  readonly runPaused: boolean;
  readonly onApproved: () => void;
  readonly onRetryStarted?: () => void;
  readonly onRetryPaused?: () => void;
  readonly onRetryFailed?: () => void;
}

export function LeadReviewCard({
  teamId,
  runId,
  campaignId,
  approved,
  runPaused,
  onApproved,
  onRetryStarted,
  onRetryPaused,
  onRetryFailed,
}: LeadReviewCardProps) {
  const [leads, setLeads] = useState<LeadDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [expanded, setExpanded] = useState(true);

  const loadLeads = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await listCampaignLeads(campaignId, { includeAll: true, limit: 100 });
      setLeads(data.leads);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load leads");
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => {
    void loadLeads();
  }, [loadLeads, refreshKey]);

  useEffect(() => {
    if (retrying && runPaused) {
      setRetrying(false);
      setRefreshKey((k) => k + 1);
      onRetryPaused?.();
    }
  }, [retrying, runPaused, onRetryPaused]);

  const handleApprove = useCallback(async () => {
    if (approving || approved || loading || leads.length === 0 || retrying) return;
    setApproving(true);
    setApproveError(null);
    try {
      await approveLeadOutreach(teamId, runId);
      onApproved();
    } catch (err) {
      setApproveError(err instanceof Error ? err.message : "Failed to approve outreach");
    } finally {
      setApproving(false);
    }
  }, [approving, approved, loading, leads.length, retrying, teamId, runId, onApproved]);

  const handleRetry = useCallback(async () => {
    if (retrying || approved || loading || approving) return;
    setRetrying(true);
    setRetryError(null);
    onRetryStarted?.();
    try {
      await retryLeadEnrichment(teamId, runId);
    } catch (err) {
      onRetryFailed?.();
      setRetryError(err instanceof Error ? err.message : "Failed to retry enrichment");
    }
  }, [retrying, approved, loading, approving, teamId, runId, onRetryStarted, onRetryFailed]);

  const withEmail = leads.filter((l) => l.email?.trim()).length;
  const needsEnrichment = leads.filter((l) => l.website?.trim() && !l.email?.trim()).length;
  const busy = loading || retrying || approving;

  return (
    <div
      role="region"
      aria-label="Lead review required"
      className="shrink-0 border-t-2 border-amber-600 bg-amber-50 shadow-[0_-8px_24px_rgba(0,0,0,0.12)]"
    >
      <div className="flex items-start gap-3 border-b border-amber-600/30 px-4 py-3">
        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center border-2 border-amber-600 bg-white">
          <AlertCircle size={16} className="text-amber-700" aria-hidden />
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-900">
            Action required
          </p>
          <p className="mt-0.5 text-[12px] font-medium text-black">
            Review scraped leads before outreach can continue
          </p>
          {!loading && leads.length > 0 && (
            <p className="mt-1 text-[10px] text-black/60">
              {leads.length} lead{leads.length === 1 ? "" : "s"} · {withEmail} with email
              {needsEnrichment > 0 ? ` · ${needsEnrichment} still need enrichment` : ""}
            </p>
          )}
          {retrying && !runPaused && (
            <p className="mt-1 text-[10px] text-black/70">
              Agent is visiting lead websites to find emails…
            </p>
          )}
          {(loadError || approveError || retryError) && (
            <p className="mt-1 text-[10px] text-red-700">
              {loadError ?? approveError ?? retryError}
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5 sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className={`${sketchButton} gap-1 py-1.5 text-[10px]`}
            aria-expanded={expanded}
          >
            <ChevronUp size={11} className={cn("transition-transform", !expanded && "rotate-180")} />
            {expanded ? "Hide leads" : "Show leads"}
          </button>
          <button
            type="button"
            onClick={() => void handleRetry()}
            disabled={busy}
            className={`${sketchButton} gap-1 py-1.5 text-[10px] disabled:opacity-40`}
          >
            {retrying ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
            {retrying ? "Enriching…" : "Retry enrichment"}
          </button>
          <button
            type="button"
            onClick={() => void handleApprove()}
            disabled={busy || leads.length === 0}
            className={`${sketchButton} gap-1 border-green-700 bg-green-600 py-1.5 text-[10px] text-white hover:bg-green-700 disabled:opacity-40`}
          >
            {approving ? <Loader2 size={11} className="animate-spin" /> : <Mail size={11} />}
            {approving ? "Starting…" : "Approve outreach"}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="max-h-52 overflow-y-auto overscroll-contain bg-white/80 px-4 py-2">
          {loading ? (
            <div className="flex items-center gap-2 py-3 text-[11px] text-black/50">
              <Loader2 size={12} className="animate-spin" />
              Loading leads…
            </div>
          ) : leads.length === 0 ? (
            <p className="py-3 text-[11px] text-black/50">No leads found for this campaign.</p>
          ) : (
            <table className="w-full text-left text-[10px]">
              <thead className="sticky top-0 bg-white/95">
                <tr className="border-b border-black/20 text-black/50">
                  <th className={`${sketchLabel} px-2 py-1 normal-case`}>Business</th>
                  <th className={`${sketchLabel} px-2 py-1 normal-case`}>Website</th>
                  <th className={`${sketchLabel} px-2 py-1 normal-case`}>Email</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => (
                  <tr key={lead.id} className="border-b border-black/10">
                    <td className="px-2 py-1.5 font-medium text-black">{lead.businessName}</td>
                    <td className="px-2 py-1.5 text-black/70">
                      {lead.website ? (
                        <span className="inline-flex items-center gap-0.5">
                          <Globe size={9} />
                          {lead.website.replace(/^https?:\/\//, "").slice(0, 32)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-black/70">{lead.email ?? "needs enrichment"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
