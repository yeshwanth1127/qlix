"use client";

import { useState } from "react";
import { RefreshCw, Loader2, ChevronRight } from "lucide-react";
import { cancelTeamRun, getTeamRun, type TeamRunDTO, type TeamRunEventDTO } from "@/lib/teams-api";
import { cn } from "@/lib/utils/cn";
import { SketchBox, SketchPageHeader, SketchRow, sketchButton, sketchLabel } from "@/components/qlix/sketch";

interface TeamRunHistoryViewProps {
  readonly teamId: string;
  readonly runs: TeamRunDTO[];
  readonly onRefresh: () => Promise<void>;
}

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
      <SketchPageHeader
        title="Run History"
        className="mb-4"
        actions={
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className={sketchButton}
          >
            <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
            Refresh
          </button>
        }
      />

      {runs.length === 0 && (
        <p className="py-8 text-center text-xs text-black/50">No runs yet. Start a run from the Run tab.</p>
      )}

      {stopError && (
        <p className="mb-3 text-xs text-black">{stopError}</p>
      )}

      <div className="space-y-2">
        {runs.map((run) => {
          const isExpanded = !!expanded[run.id];
          const isExpanding = expanding === run.id;
          const detail = expanded[run.id];
          const canStop = run.status === "running" || run.status === "queued";
          const isStopping = stopping === run.id;

          return (
            <SketchBox key={run.id} className="overflow-hidden">
              <SketchRow
                onClick={() => toggleExpand(run)}
                className="flex items-start gap-3 border-0"
              >
                <span className="mt-0.5 font-serif text-[10px] uppercase text-black/50">{run.status}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-black">{run.goal}</p>
                  <div className="mt-0.5 flex items-center gap-3 text-xs text-black/50">
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
                    className={`${sketchButton} shrink-0`}
                  >
                    {isStopping ? "Stopping…" : "Stop"}
                  </button>
                )}
                {isExpanding
                  ? <Loader2 size={13} className="animate-spin text-black/30" />
                  : <ChevronRight size={13} className={cn("text-black/30 transition-transform", isExpanded && "rotate-90")} />
                }
              </SketchRow>

              {isExpanded && detail && (
                <div className="border-t border-black px-4 py-3">
                  {Boolean(detail.result?.synthesis) && (
                    <div className="mb-3">
                      <p className={`${sketchLabel} mb-1`}>Result</p>
                      <p className="whitespace-pre-wrap text-xs leading-relaxed text-black/70">
                        {String(detail.result?.synthesis ?? "")}
                      </p>
                    </div>
                  )}

                  {detail.events.length > 0 && (
                    <div>
                      <p className={`${sketchLabel} mb-1`}>Event log ({detail.events.length})</p>
                      <div className="max-h-40 space-y-0.5 overflow-y-auto font-mono text-xs">
                        {detail.events.map((e) => (
                          <div key={e.id} className="flex items-center gap-2 text-black/50">
                            <span className="text-black/30">{e.seq.toString().padStart(3, "0")}</span>
                            <span className="text-black/70">{e.eventType}</span>
                            {e.agentId && <span className="text-black/40">({e.agentId.slice(0, 10)}…)</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </SketchBox>
          );
        })}
      </div>
    </div>
  );
}
