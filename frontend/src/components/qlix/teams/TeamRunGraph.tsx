"use client";

import { useMemo } from "react";
import { CheckCircle2, Loader2, XCircle, Zap } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { TeamDTO } from "@/lib/teams-api";

/**
 * Live graph view of a team run.
 *
 * The team's `stageOrder` is the layout: members sharing a stage sit side by side on
 * one row and run at the same time, and rows run top to bottom. That is exactly how
 * the orchestrator executes a pipeline, so the picture and the run cannot drift apart.
 *
 * State comes from the same SSE-derived `agentStates` map the chat timeline uses —
 * this is a second rendering of that state, not a second source of it.
 */

export type AgentState = "idle" | "thinking" | "tool_active" | "completed" | "failed";

export interface AgentStatus {
  agentId: string;
  name: string;
  role: "supervisor" | "worker";
  state: AgentState;
  currentAction?: string;
  currentTool?: string;
  toolCount: number;
  tasksDone: number;
}

const HAIRLINE = "border-[color:var(--ink-border)]";
const INK_SOFT = "text-[color:var(--ink-soft)]";
const INK_FAINT = "text-[color:var(--ink-faint)]";
const MICRO_LABEL = "text-[10px] font-medium uppercase tracking-[0.16em]";

const STATE_DOT: Record<AgentState, string> = {
  idle: "bg-[color:var(--ink-faint)]",
  thinking: "bg-[color:var(--sketch-purple)] animate-pulse",
  tool_active: "bg-[color:var(--sketch-purple)] animate-pulse",
  completed: "bg-[color:var(--sketch-green)]",
  failed: "bg-[color:var(--sketch-red)]",
};

const STATE_LABEL: Record<AgentState, string> = {
  idle: "Waiting",
  thinking: "Thinking…",
  tool_active: "Working",
  completed: "Done",
  failed: "Stopped",
};

interface Stage {
  readonly stageOrder: number;
  readonly agentIds: readonly string[];
}

/**
 * Bucket members by `stageOrder`. Members arrive pre-sorted by (stageOrder, addedAt),
 * so insertion order inside a bucket already matches the order the orchestrator uses.
 */
function buildStages(team: TeamDTO): Stage[] {
  const byStage = new Map<number, string[]>();
  for (const member of team.members ?? []) {
    const bucket = byStage.get(member.stageOrder);
    if (bucket) bucket.push(member.agentId);
    else byStage.set(member.stageOrder, [member.agentId]);
  }
  return [...byStage.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([stageOrder, agentIds]) => ({ stageOrder, agentIds }));
}

function initialOf(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}

/** Fixed-width gutter keeps stage labels, connectors, and node rows on one axis. */
function GraphRow({
  label,
  children,
}: {
  readonly label?: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className={cn("w-16 shrink-0 text-right", MICRO_LABEL, INK_FAINT)}>{label}</div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/**
 * Right-angle connector from the row above into `count` nodes below.
 *
 * Node centres are computable without measuring the DOM because each stage row is an
 * equal-column grid: node `i` of `n` is centred at `(i + 0.5) / n`. The viewBox is
 * stretched to fit, and `non-scaling-stroke` keeps the hairline even under that stretch.
 * `active` tints the lines and adds a traveling pulse once work has reached this junction.
 */
function StageConnector({
  count,
  active = false,
}: {
  readonly count: number;
  readonly active?: boolean;
}) {
  const centers = Array.from({ length: count }, (_, i) => ((i + 0.5) / count) * 100);
  const first = centers[0] ?? 50;
  const last = centers[centers.length - 1] ?? 50;

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className={cn(
        "h-8 w-full transition-colors duration-500",
        active ? "text-[color:var(--sketch-purple)]/55" : "text-[color:var(--ink-border)]",
      )}
      aria-hidden
    >
      <g
        stroke="currentColor"
        strokeWidth={1.25}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        fill="none"
      >
        <line x1={50} y1={0} x2={50} y2={count === 1 ? 100 : 50} />
        {count > 1 && (
          <>
            <line x1={first} y1={50} x2={last} y2={50} />
            {centers.map((c) => (
              <line key={c} x1={c} y1={50} x2={c} y2={100} />
            ))}
          </>
        )}
      </g>
      {active && (
        <circle r={2.2} fill="var(--sketch-purple)">
          <animateMotion
            dur="1.6s"
            repeatCount="indefinite"
            path={`M 50 0 L 50 100`}
          />
        </circle>
      )}
    </svg>
  );
}

/** Compact glyph that replaces the plain dot with a state-aware icon. */
function StateGlyph({ state }: { readonly state: AgentState }) {
  if (state === "completed") {
    return <CheckCircle2 size={13} className="shrink-0 text-emerald-600" aria-hidden />;
  }
  if (state === "failed") {
    return (
      <XCircle size={13} className="shrink-0 text-[color:var(--sketch-red)]" aria-hidden />
    );
  }
  if (state === "thinking" || state === "tool_active") {
    return (
      <Loader2
        size={12}
        className="shrink-0 animate-spin text-[color:var(--sketch-purple)]"
        aria-hidden
      />
    );
  }
  return <span className={cn("size-1.5 shrink-0 rounded-full", STATE_DOT[state])} aria-hidden />;
}

function GraphNode({ status }: { readonly status: AgentStatus }) {
  const isSupervisor = status.role === "supervisor";
  const isActive = status.state === "thinking" || status.state === "tool_active";
  const isDone = status.state === "completed";
  const isFailed = status.state === "failed";

  return (
    <div
      className={cn(
        "group relative flex min-w-0 flex-col gap-2 overflow-hidden rounded-2xl border px-3.5 py-3 backdrop-blur-sm transition-all duration-300",
        isFailed
          ? "border-[color:var(--sketch-red)]/40 bg-gradient-to-br from-red-50/85 to-white/50 shadow-[0_6px_20px_-14px_rgba(220,38,38,0.4)]"
          : isDone
            ? "border-emerald-700/20 bg-gradient-to-br from-emerald-50/85 to-white/50 shadow-[0_6px_20px_-14px_rgba(16,185,129,0.35)]"
            : isActive
              ? "border-[color:var(--sketch-purple)]/35 bg-gradient-to-br from-orange-50/85 to-white/55 shadow-[0_10px_26px_-14px_rgba(249,115,22,0.4)]"
              : cn(HAIRLINE, "bg-[#E2F0CC]/45"),
      )}
    >
      <div className="flex items-center gap-2">
        <span className="relative flex shrink-0 items-center justify-center">
          {isActive && (
            <span
              className="qlix-orb-ping absolute inline-flex size-8 rounded-full bg-[color:var(--sketch-purple)]/25"
              aria-hidden
            />
          )}
          <span
            className={cn(
              "relative grid size-7 place-items-center rounded-full text-[10px] font-semibold shadow-sm transition-transform duration-300",
              isSupervisor
                ? "bg-gradient-to-br from-black to-[#2b2b2e] text-white"
                : cn("border bg-[#E2F0CC]/85 text-black", HAIRLINE),
              isActive && "scale-[1.08]",
            )}
          >
            {initialOf(status.name)}
          </span>
        </span>
        <p className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-black">
          {status.name}
        </p>
        <StateGlyph state={status.state} />
      </div>

      <p
        className={cn(
          "truncate text-[11px] leading-relaxed",
          isActive ? "qlix-text-shimmer" : INK_SOFT,
        )}
      >
        {status.currentAction ?? STATE_LABEL[status.state]}
      </p>

      {status.toolCount > 0 && (
        <span
          className={cn(
            "inline-flex w-fit items-center gap-1 rounded-full px-1.5 py-0.5 text-[9.5px] font-medium",
            "bg-black/[0.05] text-black/55",
          )}
        >
          <Zap size={9} />
          {status.toolCount} {status.toolCount === 1 ? "step" : "steps"}
        </span>
      )}
    </div>
  );
}

const NO_STATES: ReadonlyMap<string, AgentStatus> = new Map();

export interface TeamRunGraphProps {
  readonly team: TeamDTO;
  /**
   * Live per-agent state. Omit it to render the team's shape on its own — every node
   * falls back to idle, which is what the pipeline looks like between runs.
   */
  readonly agentStates?: ReadonlyMap<string, AgentStatus>;
  /** Shown above the graph so the picture always says what it is working on. */
  readonly goal?: string | null;
}

export function TeamRunGraph({ team, agentStates = NO_STATES, goal }: TeamRunGraphProps) {
  const stages = useMemo(() => buildStages(team), [team]);

  /** Names come from the team itself, so nodes read correctly with no run in flight. */
  const nameById = useMemo(() => {
    const names = new Map<string, string>();
    if (team.supervisorAgentId) {
      names.set(team.supervisorAgentId, team.supervisorAgent?.name ?? "Supervisor");
    }
    for (const member of team.members ?? []) {
      names.set(member.agentId, member.agent?.name ?? member.agentId.slice(0, 10));
    }
    return names;
  }, [team]);

  const statusFor = (agentId: string, role: "supervisor" | "worker"): AgentStatus =>
    agentStates.get(agentId) ?? {
      agentId,
      name: nameById.get(agentId) ?? agentId.slice(0, 10),
      role,
      state: "idle",
      toolCount: 0,
      tasksDone: 0,
    };

  const supervisorStatus = team.supervisorAgentId
    ? statusFor(team.supervisorAgentId, "supervisor")
    : null;

  /** A stage has "handed off" once any of its agents has started or finished work. */
  const stageHasStarted = (agentIds: readonly string[]) =>
    agentIds.some((id) => {
      const s = agentStates.get(id)?.state;
      return s === "thinking" || s === "tool_active" || s === "completed" || s === "failed";
    });

  if (stages.length === 0) {
    return (
      <p className={cn("py-16 text-center text-[12.5px]", INK_SOFT)}>
        Add agents to {team.name} to see its pipeline here.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {goal && (
        <GraphRow label="Goal">
          <p className={cn("truncate text-[12.5px] leading-relaxed", INK_SOFT)} title={goal}>
            {goal}
          </p>
        </GraphRow>
      )}

      {supervisorStatus && (
        <>
          <GraphRow label="Leads">
            <div className="mx-auto max-w-[260px]">
              <GraphNode status={supervisorStatus} />
            </div>
          </GraphRow>
          <GraphRow>
            <StageConnector
              count={stages[0]!.agentIds.length}
              active={
                supervisorStatus.state === "thinking" ||
                supervisorStatus.state === "tool_active" ||
                stageHasStarted(stages[0]!.agentIds)
              }
            />
          </GraphRow>
        </>
      )}

      {stages.map((stage, index) => (
        <div key={stage.stageOrder} className="flex flex-col gap-1.5">
          {index > 0 && (
            <GraphRow>
              <StageConnector
                count={stage.agentIds.length}
                active={stageHasStarted(stages[index - 1]!.agentIds)}
              />
            </GraphRow>
          )}

          <GraphRow label={`Step ${index + 1}`}>
            <div
              className="grid gap-3"
              style={{ gridTemplateColumns: `repeat(${stage.agentIds.length}, minmax(0, 1fr))` }}
            >
              {stage.agentIds.map((agentId) => (
                <GraphNode key={agentId} status={statusFor(agentId, "worker")} />
              ))}
            </div>
          </GraphRow>

          {stage.agentIds.length > 1 && (
            <GraphRow>
              <p className={cn("text-center", MICRO_LABEL, INK_FAINT)}>
                {stage.agentIds.length} agents at the same time
              </p>
            </GraphRow>
          )}
        </div>
      ))}
    </div>
  );
}
