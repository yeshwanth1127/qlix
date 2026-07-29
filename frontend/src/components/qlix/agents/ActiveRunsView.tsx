"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  type ActiveAgentRunDTO,
  type AgentRunHistoryDTO,
  listActiveRuns,
  listRunHistory,
  stopAgentRun,
} from "@/lib/agents-api";
import { ActivityTimeline, LiveToolBar } from "@/components/qlix/agents/AgentRunActivity";
import {
  type ActivityStep,
  summarizeRunnerLog,
} from "@/components/qlix/agents/agentToolActivity";
import {
  SketchBox,
  SketchPageHeader,
  SketchRow,
  SketchSection,
  sketchButton,
  sketchLabel,
} from "@/components/qlix/sketch";
import { useSession } from "@/components/qlix/session-context";
import { cn } from "@/lib/utils/cn";

function apiBase(): string {
  return (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000").replace(/\/$/, "");
}

function formatElapsed(startIso: string | null, createdIso: string): string {
  const start = startIso ? new Date(startIso).getTime() : new Date(createdIso).getTime();
  const sec = Math.max(0, Math.floor((Date.now() - start) / 1000));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function promptPreview(prompt: string, max = 160): string {
  const t = prompt.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

function eventsToSteps(events: AgentRunHistoryDTO["events"]): ActivityStep[] {
  const steps: ActivityStep[] = [];
  for (const e of events) {
    const step = summarizeRunnerLog(e.seq, e.data);
    if (step) steps.push(step);
  }
  return steps;
}

function useAgentRunStream(
  agentId: string,
  runId: string,
  enabled: boolean,
  onTerminal: () => void,
): { activity: ActivityStep[]; streaming: boolean } {
  const [activity, setActivity] = useState<ActivityStep[]>([]);
  const [streaming, setStreaming] = useState(enabled);
  const onTerminalRef = useRef(onTerminal);
  onTerminalRef.current = onTerminal;

  useEffect(() => {
    if (!enabled) {
      setStreaming(false);
      return;
    }
    setActivity([]);
    setStreaming(true);
    const es = new EventSource(
      `${apiBase()}/api/v1/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}/stream`,
      { withCredentials: true },
    );

    es.addEventListener("log", (evt) => {
      try {
        const payload = JSON.parse((evt as MessageEvent).data) as { seq?: number; data?: unknown };
        const step = summarizeRunnerLog(payload.seq ?? 0, payload.data);
        if (!step) return;
        setActivity((prev) => [...prev, step]);
      } catch {
        // ignore
      }
    });

    es.addEventListener("done", () => {
      setStreaming(false);
      es.close();
      onTerminalRef.current();
    });

    es.onerror = () => {
      setStreaming(false);
      es.close();
    };

    return () => {
      es.close();
    };
  }, [agentId, runId, enabled]);

  return { activity, streaming };
}

function RunSummary({
  run,
  routePrefix,
  elapsed,
  actions,
}: {
  readonly run: ActiveAgentRunDTO | AgentRunHistoryDTO;
  readonly routePrefix: string;
  readonly elapsed?: string;
  readonly actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2 font-serif text-[10px] uppercase tracking-widest text-black/60">
          <span>{run.source}</span>
          <span>{run.status}</span>
          {elapsed ? <span>{elapsed}</span> : null}
        </div>
        <Link
          href={`${routePrefix}/agents/${run.agentId}`}
          className="text-sm font-medium text-black underline underline-offset-2"
        >
          {run.agentName}
        </Link>
        <p className="text-[12px] leading-relaxed text-black/70">{promptPreview(run.prompt)}</p>
      </div>
      {actions}
    </div>
  );
}

function ActiveRunCard({
  run,
  routePrefix,
  onStopped,
}: {
  readonly run: ActiveAgentRunDTO;
  readonly routePrefix: string;
  readonly onStopped: () => void;
}) {
  const [stopping, setStopping] = useState(false);
  const [tick, setTick] = useState(0);
  const isActive = run.status === "queued" || run.status === "running";
  const { activity, streaming } = useAgentRunStream(
    run.agentId,
    run.id,
    isActive,
    onStopped,
  );

  useEffect(() => {
    if (!isActive) return;
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [isActive]);

  void tick;

  const stop = async () => {
    setStopping(true);
    const ok = await stopAgentRun(run.agentId, run.id);
    setStopping(false);
    if (ok) onStopped();
  };

  return (
    <SketchBox className="p-4">
      <RunSummary
        run={run}
        routePrefix={routePrefix}
        elapsed={formatElapsed(run.startedAt, run.createdAt)}
        actions={
          isActive ? (
            <button
              type="button"
              onClick={() => void stop()}
              disabled={stopping}
              className={sketchButton}
            >
              {stopping ? "Stopping…" : "Stop"}
            </button>
          ) : null
        }
      />
      <div className="mt-4 space-y-3">
        {(streaming || activity.length > 0) && <LiveToolBar steps={activity} />}
        <ActivityTimeline steps={activity} />
        {isActive && activity.length === 0 && streaming ? (
          <p className="font-serif text-[11px] uppercase text-black/50">Waiting for activity…</p>
        ) : null}
      </div>
    </SketchBox>
  );
}

function HistoryRunCard({
  run,
  routePrefix,
  defaultOpen,
}: {
  readonly run: AgentRunHistoryDTO;
  readonly routePrefix: string;
  readonly defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const steps = useMemo(() => eventsToSteps(run.events), [run.events]);
  const finishedLabel = run.finishedAt ? formatWhen(run.finishedAt) : formatWhen(run.createdAt);

  return (
    <SketchBox className="overflow-hidden">
      <div className="p-4">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="mb-2 font-serif text-[10px] uppercase tracking-widest text-black/50"
        >
          {open ? "− Collapse" : "+ Expand"}
        </button>
        <RunSummary run={run} routePrefix={routePrefix} elapsed={finishedLabel} />
        {!open && steps.length > 0 ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="mt-2 text-left font-serif text-[10px] uppercase text-black/50"
          >
            {steps.length} step{steps.length === 1 ? "" : "s"}
          </button>
        ) : null}
      </div>
      {open ? (
        <div className="space-y-3 border-t border-black px-4 pb-4 pt-3">
          {run.errorMessage ? (
            <p className="border border-black px-3 py-2 text-[11px] text-black">{run.errorMessage}</p>
          ) : null}
          {steps.length > 0 ? (
            <ActivityTimeline steps={steps} />
          ) : (
            <p className="font-serif text-[11px] uppercase text-black/50">No steps recorded</p>
          )}
        </div>
      ) : null}
    </SketchBox>
  );
}

export function ActiveRunsView({ routePrefix }: { readonly routePrefix: string }) {
  const { session } = useSession();
  const isOrg = routePrefix === "/organization";
  const orgId = isOrg ? (session?.organization.id ?? null) : null;
  const [runs, setRuns] = useState<ActiveAgentRunDTO[]>([]);
  const [history, setHistory] = useState<AgentRunHistoryDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshActive = useCallback(async () => {
    const rows = await listActiveRuns(orgId);
    if (rows === null) {
      setError("Could not load active runs.");
      return false;
    }
    setError(null);
    setRuns(rows);
    setLoading(false);
    return true;
  }, [orgId]);

  const refreshHistory = useCallback(async () => {
    const rows = await listRunHistory(orgId, 30);
    if (rows !== null) {
      setHistory(rows);
    }
    setHistoryLoading(false);
  }, [orgId]);

  const refreshAll = useCallback(async () => {
    const ok = await refreshActive();
    await refreshHistory();
    return ok;
  }, [refreshActive, refreshHistory]);

  useEffect(() => {
    void refreshAll();
    const id = window.setInterval(() => void refreshAll(), 5000);
    return () => window.clearInterval(id);
  }, [refreshAll]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-6">
      <SketchPageHeader title="Active Runs" />

      {error ? (
        <p className="text-sm text-black" role="alert">
          {error}
        </p>
      ) : null}

      <SketchSection title="Live">
        {loading ? (
          <SketchBox className="flex min-h-[160px] items-center justify-center p-6">
            <Loader2 className="size-5 animate-spin text-black" aria-hidden />
          </SketchBox>
        ) : runs.length === 0 ? (
          <SketchBox className="min-h-[160px] p-6 text-center">
            <p className="font-serif text-[11px] uppercase tracking-widest text-black/50">
              No active runs right now
            </p>
          </SketchBox>
        ) : (
          <div className="space-y-3">
            {runs.map((run) => (
              <ActiveRunCard
                key={run.id}
                run={run}
                routePrefix={routePrefix}
                onStopped={() => void refreshAll()}
              />
            ))}
          </div>
        )}
      </SketchSection>

      <SketchSection title="History">
        {historyLoading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <SketchRow key={i} className="min-h-[3rem] animate-pulse" />
            ))}
          </div>
        ) : history.length === 0 ? (
          <SketchBox className="p-6 text-center">
            <p className="font-serif text-[11px] uppercase tracking-widest text-black/50">
              No completed runs yet
            </p>
          </SketchBox>
        ) : (
          <SketchBox className="flex flex-col gap-2 p-3">
            {history.map((run, i) =>
              i === 0 ? (
                <HistoryRunCard
                  key={run.id}
                  run={run}
                  routePrefix={routePrefix}
                  defaultOpen
                />
              ) : (
                <SketchRow
                  key={run.id}
                  className="flex flex-wrap items-center justify-between gap-2"
                  onClick={() => {}}
                >
                  <span className="truncate text-[12px] text-black">{run.agentName}</span>
                  <span className="font-serif text-[10px] uppercase text-black/50">{run.status}</span>
                </SketchRow>
              ),
            )}
          </SketchBox>
        )}
      </SketchSection>

      <p className="text-center">
        <Link
          href={`${routePrefix}/agents`}
          className={cn(sketchLabel, "underline underline-offset-2")}
        >
          Open agents
        </Link>
      </p>
    </div>
  );
}
