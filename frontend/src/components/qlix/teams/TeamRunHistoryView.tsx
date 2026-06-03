"use client";

import { useState } from "react";
import { RefreshCw, Clock, CheckCircle, XCircle, Loader2, ChevronRight } from "lucide-react";
import { cancelTeamRun, getTeamRun, type TeamRunDTO, type TeamRunEventDTO } from "@/lib/teams-api";
import { cn } from "@/lib/utils/cn";

interface TeamRunHistoryViewProps {
  readonly teamId: string;
  readonly runs: TeamRunDTO[];
  readonly onRefresh: () => Promise<void>;
}

const STATUS_ICON: Record<string, React.ReactNode> = {
  completed: <CheckCircle size={13} className="text-emerald-400" />,
  failed: <XCircle size={13} className="text-red-400" />,
  running: <Loader2 size={13} className="animate-spin text-indigo-400" />,
  queued: <Clock size={13} className="text-white/40" />,
  canceled: <XCircle size={13} className="text-white/30" />,
};

function durationLabel(run: TeamRunDTO): string {
  if (!run.startedAt) return "—";
  const end = run.completedAt ? new Date(run.completedAt) : new Date();
  const secs = Math.floor((end.getTime() - new Date(run.startedAt).getTime()) / 1000);
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

export function TeamRunHistoryView({ teamId, runs, onRefresh }: TeamRunHistoryViewProps) {
  const [expanding, setExpanding] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, { events: TeamRunEventDTO[]; result: Record<string, unknown> | null }>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [stopping, setStopping] = useState<string | null>(null);
  const [stopError, setStopError] = useState<string | null>(null);

  async function handleStopRun(e: React.MouseEvent, run: TeamRunDTO) {
    e.stopPropagation();
    if (stopping) return;
    setStopError(null);
    setStopping(run.id);
    try {
      await cancelTeamRun(teamId, run.id);
      await onRefresh();
    } catch (err) {
      setStopError(err instanceof Error ? err.message : "Failed to stop run");
    } finally {
      setStopping(null);
    }
  }

  async function handleRefresh() {
    setRefreshing(true);
    await onRefresh();
    setRefreshing(false);
  }

  async function toggleExpand(run: TeamRunDTO) {
    if (expanded[run.id]) {
      setExpanded((prev) => { const n = { ...prev }; delete n[run.id]; return n; });
      return;
    }
    setExpanding(run.id);
    try {
      const data = await getTeamRun(teamId, run.id);
      setExpanded((prev) => ({ ...prev, [run.id]: { events: data.events, result: data.run.result as Record<string, unknown> | null } }));
    } catch {
      // ignore
    } finally {
      setExpanding(null);
    }
  }

  return (
    <div className="px-6 py-4">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white/70">Run History</h3>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-white/40 hover:text-white/70 hover:bg-white/5 transition-colors disabled:opacity-40"
        >
          <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {runs.length === 0 && (
        <p className="py-8 text-center text-xs text-white/30">No runs yet. Start a run from the Run tab.</p>
      )}

      {stopError && (
        <p className="mb-3 text-xs text-red-400">{stopError}</p>
      )}

      <div className="space-y-2">
        {runs.map((run) => {
          const isExpanded = !!expanded[run.id];
          const isExpanding = expanding === run.id;
          const detail = expanded[run.id];
          const canStop = run.status === "running" || run.status === "queued";
          const isStopping = stopping === run.id;

          return (
            <div key={run.id} className="rounded-lg border border-white/10 bg-white/5 overflow-hidden">
              <button
                onClick={() => toggleExpand(run)}
                className="w-full px-4 py-3 text-left hover:bg-white/5 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <span className="mt-0.5">{STATUS_ICON[run.status] ?? <Clock size={13} />}</span>
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm text-white/80">{run.goal}</p>
                    <div className="mt-0.5 flex items-center gap-3 text-xs text-white/30">
                      <span>{new Date(run.createdAt).toLocaleDateString()} {new Date(run.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                      <span>·</span>
                      <span>{durationLabel(run)}</span>
                      {run.artifacts && Array.isArray(run.artifacts) && (
                        <>
                          <span>·</span>
                          <span>{(run.artifacts as unknown[]).length} artifact{(run.artifacts as unknown[]).length !== 1 ? "s" : ""}</span>
                        </>
                      )}
                    </div>
                  </div>
                  {canStop && (
                    <button
                      type="button"
                      onClick={(e) => void handleStopRun(e, run)}
                      disabled={isStopping}
                      className="shrink-0 rounded border border-red-500/40 bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-300 hover:bg-red-500/20 disabled:opacity-50"
                    >
                      {isStopping ? "Stopping…" : "Stop"}
                    </button>
                  )}
                  {isExpanding
                    ? <Loader2 size={13} className="animate-spin text-white/30" />
                    : <ChevronRight size={13} className={cn("text-white/30 transition-transform", isExpanded && "rotate-90")} />
                  }
                </div>
              </button>

              {isExpanded && detail && (
                <div className="border-t border-white/10 bg-black/20 px-4 py-3">
                  {/* Result */}
                  {Boolean(detail.result?.synthesis) && (
                    <div className="mb-3">
                      <p className="mb-1 text-xs font-semibold text-emerald-400">Result</p>
                      <p className="text-xs text-white/70 whitespace-pre-wrap leading-relaxed">
                        {String(detail.result?.synthesis ?? "")}
                      </p>
                    </div>
                  )}

                  {/* Event log */}
                  {detail.events.length > 0 && (
                    <div>
                      <p className="mb-1 text-xs font-semibold text-white/40">Event log ({detail.events.length})</p>
                      <div className="font-mono text-xs space-y-0.5 max-h-40 overflow-y-auto">
                        {detail.events.map((e) => (
                          <div key={e.id} className="flex items-center gap-2 text-white/40">
                            <span className="text-white/20">{e.seq.toString().padStart(3, "0")}</span>
                            <span className="text-white/50">{e.eventType}</span>
                            {e.agentId && <span className="text-white/25">({e.agentId.slice(0, 10)}…)</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
