"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, Loader2 } from "lucide-react";
import {
  cancelSchedule,
  listSchedules,
  updateSchedule,
  type ScheduledEventDTO,
} from "@/lib/schedules-api";
import {
  SketchBox,
  SketchPageHeader,
  SketchSection,
  sketchButton,
  sketchButtonPrimary,
  sketchLabel,
} from "@/components/qlix/sketch";
import { cn } from "@/lib/utils/cn";

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function timingLabel(s: ScheduledEventDTO): string {
  if (s.scheduleType === "cron") return s.cronExpression ?? "cron";
  if (s.scheduleType === "once") return `once · ${formatWhen(s.onceAt)}`;
  if (s.scheduleType === "interval") {
    const secs = s.intervalSeconds ?? 0;
    if (secs >= 3600 && secs % 3600 === 0) return `every ${secs / 3600}h`;
    if (secs >= 60 && secs % 60 === 0) return `every ${secs / 60}m`;
    return `every ${secs}s`;
  }
  return s.scheduleType;
}

function statusTone(status: string): string {
  if (status === "active") return "text-[color:var(--sketch-green)]";
  if (status === "paused") return "text-black/50";
  if (status === "completed") return "text-black/40";
  if (status === "cancelled") return "text-[color:var(--sketch-red)]";
  return "text-black/50";
}

function promptPreview(prompt: string, max = 180): string {
  const t = prompt.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

type AgentGroup = {
  agentId: string;
  agentName: string;
  agentStatus: string | null;
  schedules: ScheduledEventDTO[];
};

export function SchedulesView({ routePrefix }: { routePrefix: "/individual" | "/organization" }) {
  const [schedules, setSchedules] = useState<ScheduledEventDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showCancelled, setShowCancelled] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const rows = await listSchedules({ includeCancelled: showCancelled });
      setSchedules(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load schedules");
    } finally {
      setLoading(false);
    }
  }, [showCancelled]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  const groups = useMemo((): AgentGroup[] => {
    const map = new Map<string, AgentGroup>();
    for (const s of schedules) {
      let group = map.get(s.agentId);
      if (!group) {
        group = {
          agentId: s.agentId,
          agentName: s.agentName?.trim() || `Agent ${s.agentId.slice(0, 8)}…`,
          agentStatus: s.agentStatus ?? null,
          schedules: [],
        };
        map.set(s.agentId, group);
      }
      group.schedules.push(s);
    }
    return [...map.values()].sort((a, b) => a.agentName.localeCompare(b.agentName));
  }, [schedules]);

  async function toggleEnabled(s: ScheduledEventDTO) {
    setBusyId(s.id);
    setError(null);
    try {
      await updateSchedule(s.id, {
        enabled: !s.enabled,
        status: s.enabled ? "paused" : "active",
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusyId(null);
    }
  }

  async function onCancel(s: ScheduledEventDTO) {
    if (!window.confirm(`Cancel schedule${s.label ? ` “${s.label}”` : ""}? It will not fire again.`)) {
      return;
    }
    setBusyId(s.id);
    setError(null);
    try {
      await cancelSchedule(s.id);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cancel failed");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-6 overflow-auto pb-6">
      <SketchPageHeader
        title="Schedules"
        subtitle="Cron, once, and interval events that enqueue agent runs — grouped by agent."
        actions={
          <label className="flex items-center gap-2 text-[12px] text-black/60">
            <input
              type="checkbox"
              checked={showCancelled}
              onChange={(e) => setShowCancelled(e.target.checked)}
              className="size-3.5 accent-black"
            />
            Show cancelled
          </label>
        }
      />

      {error ? (
        <p className="text-[13px] text-[color:var(--sketch-red)]">{error}</p>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-2 text-[13px] text-black/50">
          <Loader2 className="size-4 animate-spin" />
          Loading schedules…
        </div>
      ) : groups.length === 0 ? (
        <SketchBox className="flex flex-col items-start gap-3 p-6">
          <CalendarClock className="size-5 text-black/35" />
          <div>
            <p className="text-[14px] text-black">No scheduled events yet</p>
            <p className="mt-1 max-w-md text-[13px] text-black/50">
              Agents (and exa) can create cron / once / interval jobs via qlix-schedule. When due, the
              prompt is enqueued as a normal agent run.
            </p>
          </div>
          <Link href={`${routePrefix}/agents`} className={sketchButtonPrimary}>
            Go to agents →
          </Link>
        </SketchBox>
      ) : (
        groups.map((group) => (
          <SketchSection
            key={group.agentId}
            title={`${group.agentName} · ${group.schedules.length} schedule${
              group.schedules.length === 1 ? "" : "s"
            }${group.agentStatus ? ` · ${group.agentStatus}` : ""}`}
            headerRight={
              <Link
                href={`${routePrefix}/agents/${encodeURIComponent(group.agentId)}`}
                className={cn(sketchButton, "text-[12px]")}
              >
                Open agent
              </Link>
            }
          >
            <SketchBox className="p-0">
              <ul className="divide-y divide-black/10">
                {group.schedules.map((s) => (
                  <li key={s.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-mono text-[12px] text-black">{timingLabel(s)}</span>
                        <span className={cn("text-[11px] uppercase tracking-wide", statusTone(s.status))}>
                          {s.status}
                        </span>
                        <span className="text-[11px] text-black/35">{s.scheduleType}</span>
                        {s.source ? (
                          <span className="text-[11px] text-black/35">via {s.source}</span>
                        ) : null}
                      </div>
                      {s.label ? (
                        <p className="mt-1 text-[13px] text-black/80">{s.label}</p>
                      ) : null}
                      <p className="mt-1 text-[12px] text-black/60">{promptPreview(s.prompt)}</p>
                      <p className={cn(sketchLabel, "mt-2 font-normal text-black/40")}>
                        next {formatWhen(s.nextRunAt)}
                        {s.lastEnqueuedAt ? ` · last run ${formatWhen(s.lastEnqueuedAt)}` : ""}
                        {` · ${s.runCount} run${s.runCount === 1 ? "" : "s"}`}
                        {s.maxRuns != null ? ` / ${s.maxRuns}` : ""}
                      </p>
                      {s.lastError ? (
                        <p className="mt-1 text-[12px] text-[color:var(--sketch-red)]">{s.lastError}</p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      {s.status !== "cancelled" && s.status !== "completed" ? (
                        <button
                          type="button"
                          disabled={busyId === s.id}
                          className={sketchButton}
                          onClick={() => void toggleEnabled(s)}
                        >
                          {busyId === s.id ? "…" : s.enabled ? "Pause" : "Resume"}
                        </button>
                      ) : null}
                      {s.status !== "cancelled" ? (
                        <button
                          type="button"
                          disabled={busyId === s.id}
                          className={sketchButton}
                          onClick={() => void onCancel(s)}
                        >
                          Cancel
                        </button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </SketchBox>
          </SketchSection>
        ))
      )}
    </div>
  );
}
