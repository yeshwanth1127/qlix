"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  Brain,
  CheckCircle2,
  ChevronDown,
  Clock,
  History,
  Loader2,
  MessageSquare,
  Phone,
  Square,
  UsersRound,
  XCircle,
} from "lucide-react";
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
import { ReflectiveCard } from "@/components/qlix/ReflectiveCard";
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

function sourceMeta(source: ActiveAgentRunDTO["source"]): {
  label: string;
  icon: typeof MessageSquare;
  className: string;
} {
  switch (source) {
    case "whatsapp":
      return {
        label: "WhatsApp",
        icon: Phone,
        className: "bg-emerald-500/15 text-emerald-700 ring-emerald-500/30 dark:text-emerald-300",
      };
    case "team":
      return {
        label: "Team",
        icon: UsersRound,
        className: "bg-sky-500/15 text-sky-700 ring-sky-500/30 dark:text-sky-300",
      };
    default:
      return {
        label: "Dashboard",
        icon: MessageSquare,
        className: "bg-[var(--glass-muted-bg)] text-[--text-secondary] ring-[--border-subtle]",
      };
  }
}

function statusMeta(status: string): {
  label: string;
  icon: typeof Loader2;
  className: string;
} {
  switch (status) {
    case "running":
      return {
        label: "Running",
        icon: Loader2,
        className: "bg-[--accent]/12 text-[--accent] ring-[--accent]/30",
      };
    case "queued":
      return {
        label: "Queued",
        icon: Clock,
        className: "bg-amber-500/10 text-amber-800 ring-amber-500/25 dark:text-amber-200",
      };
    case "success":
      return {
        label: "Completed",
        icon: CheckCircle2,
        className: "bg-emerald-500/12 text-emerald-700 ring-emerald-500/30 dark:text-emerald-300",
      };
    case "failed":
      return {
        label: "Failed",
        icon: XCircle,
        className: "bg-red-500/12 text-red-700 ring-red-500/30 dark:text-red-300",
      };
    default:
      return {
        label: status,
        icon: Clock,
        className: "bg-[var(--glass-muted-bg)] text-[--text-secondary] ring-[--border-subtle]",
      };
  }
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

function RunCardHeader({
  run,
  routePrefix,
  elapsed,
  actions,
}: {
  readonly run: ActiveAgentRunDTO;
  readonly routePrefix: string;
  readonly elapsed?: string;
  readonly actions?: React.ReactNode;
}) {
  const src = sourceMeta(run.source);
  const SrcIcon = src.icon;
  const st = statusMeta(run.status);
  const StatusIcon = st.icon;

  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1",
              src.className,
            )}
          >
            <SrcIcon className="size-3" aria-hidden />
            {src.label}
          </span>
          {run.useBrain ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/12 px-2 py-0.5 text-[10px] font-medium text-violet-700 ring-1 ring-violet-500/25 dark:text-violet-300">
              <Brain className="size-3" aria-hidden />
              AI Brain
            </span>
          ) : null}
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1",
              st.className,
            )}
          >
            <StatusIcon
              className={cn("size-3", run.status === "running" && "animate-spin")}
              aria-hidden
            />
            {st.label}
          </span>
          {elapsed ? (
            <span className="text-[10px] text-[--text-tertiary]">{elapsed}</span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Bot className="size-4 shrink-0 text-[--text-tertiary]" aria-hidden />
          <Link
            href={`${routePrefix}/agents/${run.agentId}`}
            className="text-sm font-semibold text-[--text-primary] hover:text-[--accent]"
          >
            {run.agentName}
          </Link>
          <span className="text-[10px] uppercase tracking-wide text-[--text-tertiary]">
            {run.agentRuntime}
          </span>
        </div>
        <p className="text-[12px] leading-relaxed text-[--text-secondary]">
          {promptPreview(run.prompt)}
        </p>
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
    <ReflectiveCard className="p-4">
      <RunCardHeader
        run={run}
        routePrefix={routePrefix}
        elapsed={formatElapsed(run.startedAt, run.createdAt)}
        actions={
          isActive ? (
            <button
              type="button"
              onClick={() => void stop()}
              disabled={stopping}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[--border-subtle] px-2.5 py-1.5 text-[11px] font-medium text-[--text-secondary] transition hover:border-red-500/40 hover:text-red-600 disabled:opacity-50"
            >
              {stopping ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <Square className="size-3.5" aria-hidden />
              )}
              Stop
            </button>
          ) : null
        }
      />
      <div className="mt-4 space-y-3">
        {(streaming || activity.length > 0) && <LiveToolBar steps={activity} />}
        <ActivityTimeline steps={activity} />
        {isActive && activity.length === 0 && streaming ? (
          <p className="text-[11px] text-[--text-tertiary]">Waiting for runner activity…</p>
        ) : null}
      </div>
    </ReflectiveCard>
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
  const finishedLabel = run.finishedAt
    ? formatWhen(run.finishedAt)
    : formatWhen(run.createdAt);

  return (
    <ReflectiveCard className="overflow-hidden">
      <div className="flex items-start gap-2 p-4">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={open ? "Collapse run steps" : "Expand run steps"}
          className="mt-1 rounded-md p-0.5 text-[--text-tertiary] transition hover:bg-white/5 hover:text-[--text-primary]"
        >
          <ChevronDown
            className={cn("size-4 transition-transform", open && "rotate-180")}
            aria-hidden
          />
        </button>
        <div className="min-w-0 flex-1">
          <RunCardHeader
            run={run}
            routePrefix={routePrefix}
            elapsed={finishedLabel}
          />
          {!open && steps.length > 0 ? (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="mt-2 text-left text-[11px] text-[--text-tertiary] hover:text-[--accent]"
            >
              {steps.length} step{steps.length === 1 ? "" : "s"} — show steps
            </button>
          ) : null}
        </div>
      </div>
      {open ? (
        <div className="space-y-3 border-t border-[--border-subtle] px-4 pb-4 pt-3">
          {run.errorMessage ? (
            <p className="rounded-md border border-red-500/25 bg-red-500/8 px-3 py-2 text-[11px] text-red-700 dark:text-red-300">
              {run.errorMessage}
            </p>
          ) : null}
          {steps.length > 0 ? (
            <ActivityTimeline steps={steps} />
          ) : (
            <p className="text-[11px] text-[--text-tertiary]">No activity steps recorded for this run.</p>
          )}
        </div>
      ) : null}
    </ReflectiveCard>
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
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-[--text-primary]">Active runs</h1>
        <p className="mt-1 max-w-2xl text-sm text-[--text-secondary]">
          Live progress for queued and running agents, plus a history of completed runs with each
          step taken (tools, model calls, Agent-S3 actions).
        </p>
      </div>

      {error ? (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-[--text-primary]">Live</h2>
        {loading ? (
          <div className="space-y-3">
            {[0, 1].map((i) => (
              <div
                key={i}
                className="h-32 animate-pulse rounded-xl border border-[--border-subtle] bg-[var(--glass-muted-bg)]"
              />
            ))}
          </div>
        ) : runs.length === 0 ? (
          <ReflectiveCard className="p-6 text-center">
            <p className="text-sm text-[--text-secondary]">No active runs right now.</p>
            <p className="mt-2 text-[12px] text-[--text-tertiary]">
              When an agent is triggered from WhatsApp or chat, it will appear here with live tool
              and model activity.
            </p>
          </ReflectiveCard>
        ) : (
          <div className="space-y-4">
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
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <History className="size-4 text-[--text-tertiary]" aria-hidden />
          <h2 className="text-sm font-semibold text-[--text-primary]">Run history</h2>
          <span className="text-[11px] text-[--text-tertiary]">Last 30 completed runs</span>
        </div>
        {historyLoading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-20 animate-pulse rounded-xl border border-[--border-subtle] bg-[var(--glass-muted-bg)]"
              />
            ))}
          </div>
        ) : history.length === 0 ? (
          <ReflectiveCard className="p-6 text-center">
            <p className="text-sm text-[--text-secondary]">No completed runs yet.</p>
          </ReflectiveCard>
        ) : (
          <div className="space-y-3">
            {history.map((run, i) => (
              <HistoryRunCard
                key={run.id}
                run={run}
                routePrefix={routePrefix}
                defaultOpen={i === 0}
              />
            ))}
          </div>
        )}
      </section>

      <p className="text-center text-[12px] text-[--text-tertiary]">
        <Link href={`${routePrefix}/agents`} className="font-medium text-[--accent] hover:underline">
          Open agents →
        </Link>
      </p>
    </div>
  );
}
