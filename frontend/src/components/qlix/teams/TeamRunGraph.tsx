"use client";

import { useMemo } from "react";
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
 */
function StageConnector({ count }: { readonly count: number }) {
  const centers = Array.from({ length: count }, (_, i) => ((i + 0.5) / count) * 100);
  const first = centers[0] ?? 50;
  const last = centers[centers.length - 1] ?? 50;

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className="h-7 w-full text-[color:var(--ink-border)]"
      aria-hidden
    >
      <g stroke="currentColor" strokeWidth={1} vectorEffect="non-scaling-stroke" fill="none">
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
    </svg>
  );
}

function GraphNode({ status }: { readonly status: AgentStatus }) {
  const isSupervisor = status.role === "supervisor";
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-1.5 rounded-2xl border px-3 py-2.5 backdrop-blur-sm transition-colors duration-200",
        HAIRLINE,
        status.state === "idle" ? "bg-white/45" : "bg-white/75",
        status.state === "failed" && "border-[color:var(--sketch-red)]",
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "grid size-6 shrink-0 place-items-center rounded-full text-[10px] font-semibold",
            isSupervisor ? "bg-black text-white" : cn("border bg-white/70 text-black", HAIRLINE),
          )}
          aria-hidden
        >
          {initialOf(status.name)}
        </span>
        <p className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-black">
          {status.name}
        </p>
        <span
          className={cn("size-1.5 shrink-0 rounded-full", STATE_DOT[status.state])}
          aria-hidden
        />
      </div>

      <p className={cn("truncate text-[11px] leading-relaxed", INK_SOFT)}>
        {status.currentAction ?? STATE_LABEL[status.state]}
      </p>

      {status.toolCount > 0 && (
        <p className={cn("text-[10px]", INK_FAINT)}>
          {status.toolCount} {status.toolCount === 1 ? "step" : "steps"}
        </p>
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
            <StageConnector count={stages[0]!.agentIds.length} />
          </GraphRow>
        </>
      )}

      {stages.map((stage, index) => (
        <div key={stage.stageOrder} className="flex flex-col gap-1.5">
          {index > 0 && (
            <GraphRow>
              <StageConnector count={stage.agentIds.length} />
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
