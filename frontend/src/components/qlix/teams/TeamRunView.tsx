"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import {
  ArrowRight,
  Brain,
  CheckCircle,
  ChevronDown,
  Download,
  FileText,
  Globe,
  Loader2,
  Mail,
  Phone,
  Search,
  Send,
  Square,
  Terminal,
  Users,
  Wrench,
  X,
  XCircle,
  Zap,
} from "lucide-react";
import {
  cancelTeamRun,
  getTeamRun,
  injectTeamRunMessage,
  listTeamRuns,
  startTeamRun,
  streamTeamRun,
  type TeamDTO,
  type TeamRunDTO,
  type TeamRunEventDTO,
  type TeamRunArtifact,
} from "@/lib/teams-api";
import {
  AgentBrowserLiveView,
  type BrowserFrame,
} from "@/components/qlix/agents/AgentBrowserLiveView";
import {
  collectTeamReasoningSteps,
  describeBrowserToolAction,
  formatToolId,
  isBrowserToolId,
  parseInferenceToolDetails,
  resolveBrowserToolIntent,
  toolCategoryIcon,
  type TeamReasoningStep,
} from "@/components/qlix/agents/agentToolActivity";
import { cn } from "@/lib/utils/cn";
import { SketchBox } from "@/components/qlix/sketch";
import { LeadReviewCard } from "@/components/qlix/teams/LeadReviewCard";
import {
  TeamRunGraph,
  type AgentState as GraphAgentState,
  type AgentStatus as GraphAgentStatus,
} from "@/components/qlix/teams/TeamRunGraph";

// ─── Types ────────────────────────────────────────────────────────────────────

/** Agent state shape lives with the graph so both views render the same contract. */
type AgentState = GraphAgentState;
type AgentStatus = GraphAgentStatus;

type RunViewMode = "chat" | "graph";

type ProcessedEvent =
  | { kind: "run_started"; eventId: string; timestampMs: number }
  | { kind: "supervisor_plan"; eventId: string; timestampMs: number; payload: Record<string, unknown> }
  | { kind: "task_delegated"; eventId: string; timestampMs: number; payload: Record<string, unknown>; agentId: string | null }
  | { kind: "tool_call"; eventId: string; timestampMs: number; tool: string; agentId: string; actionLabel?: string }
  | {
      kind: "brain_query";
      eventId: string;
      timestampMs: number;
      agentId: string;
      citationCount: number;
      policyPreview: string;
      citationTitles: string[];
      citations: Array<{ documentTitle?: string; collectionName?: string; excerpt?: string }>;
      contextSections: Array<{
        index?: number;
        collectionName?: string;
        documentTitle?: string;
        excerpt?: string;
      }>;
    }
  | { kind: "subtask_completed"; eventId: string; timestampMs: number; payload: Record<string, unknown>; agentId: string | null }
  | { kind: "run_result"; eventId: string; timestampMs: number }
  | { kind: "run_failed_event"; eventId: string; timestampMs: number; error: string }
  | { kind: "user_injection"; eventId: string; timestampMs: number; message: string }
  | { kind: "result_delivered"; eventId: string; timestampMs: number; sent: boolean; reason?: string }
  | { kind: "lead_review"; eventId: string; timestampMs: number; campaignId: string };

function brainQueryFromPayload(
  eventId: string,
  timestampMs: number,
  agentId: string | null,
  p: Record<string, unknown>,
): ProcessedEvent {
  const rawCitations = Array.isArray(p.citations) ? p.citations : [];
  const rawSections = Array.isArray(p.contextSections) ? p.contextSections : [];
  return {
    kind: "brain_query",
    eventId,
    timestampMs,
    agentId: agentId ?? "",
    citationCount: (p.citationCount as number | undefined) ?? 0,
    policyPreview: (p.policyPreview as string | undefined) ?? "",
    citationTitles: Array.isArray(p.citationTitles) ? (p.citationTitles as string[]) : [],
    citations: rawCitations.map((c) => {
      const row = c as Record<string, unknown>;
      return {
        documentTitle: row.documentTitle as string | undefined,
        collectionName: row.collectionName as string | undefined,
        excerpt: row.excerpt as string | undefined,
      };
    }),
    contextSections: rawSections.map((s) => {
      const row = s as Record<string, unknown>;
      return {
        index: typeof row.index === "number" ? row.index : undefined,
        collectionName: row.collectionName as string | undefined,
        documentTitle: row.documentTitle as string | undefined,
        excerpt: row.excerpt as string | undefined,
      };
    }),
  };
}

// ─── Tokens ───────────────────────────────────────────────────────────────────

/** `text-black/NN` is force-inked inside the console, so muted copy uses the ink vars. */
const INK_SOFT = "text-[color:var(--ink-soft)]";
const INK_FAINT = "text-[color:var(--ink-faint)]";
const HAIRLINE = "border-[color:var(--ink-border)]";

const quietButton =
  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] text-[color:var(--ink-soft)] transition-colors hover:bg-black/[0.05] hover:text-black disabled:pointer-events-none disabled:opacity-40";

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Renders the glyph for a step directly — returning icon *components* from a
 *  helper would create components during render. */
function ToolGlyph({
  kind,
  tool,
  size = 12,
  className,
}: {
  readonly kind?: "tool" | "brain";
  readonly tool?: string;
  readonly size?: number;
  readonly className?: string;
}) {
  const t = tool ?? "";
  if (kind === "brain") return <Brain size={size} className={className} />;
  if (t === "email_read" || t === "email_send") return <Mail size={size} className={className} />;
  if (t.startsWith("browser_")) return <Globe size={size} className={className} />;
  if (t === "web_search") return <Search size={size} className={className} />;
  if (t === "http_request") return <Zap size={size} className={className} />;
  if (t.startsWith("file_")) return <FileText size={size} className={className} />;
  if (t.startsWith("code_") || t === "shell_exec" || t === "repl") {
    return <Terminal size={size} className={className} />;
  }
  if (t.startsWith("memory_") || t.startsWith("knowledge_") || t.startsWith("brain")) {
    return <Brain size={size} className={className} />;
  }
  return <Wrench size={size} className={className} />;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

function parseTimestampMs(raw: string | number | unknown): number {
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") {
    const n = parseInt(raw, 10);
    return isNaN(n) ? Date.now() : n;
  }
  return Date.now();
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function initialOf(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "•";
}

// ─── Chat primitives ──────────────────────────────────────────────────────────

function Avatar({ name, role }: { readonly name: string; readonly role: "supervisor" | "worker" }) {
  return (
    <span
      className={cn(
        "grid size-7 shrink-0 place-items-center rounded-full text-[11px] font-semibold",
        role === "supervisor"
          ? "bg-black text-white"
          : cn("border bg-white/70 text-black", HAIRLINE),
      )}
      aria-hidden
    >
      {initialOf(name)}
    </span>
  );
}

function ChatMessage({
  name,
  role,
  timestampMs,
  children,
}: {
  readonly name: string;
  readonly role: "supervisor" | "worker";
  readonly timestampMs?: number;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <Avatar name={name} role={role} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-[12.5px] font-medium text-black">{name}</span>
          {timestampMs != null && (
            <span className={cn("text-[10.5px]", INK_FAINT)}>{formatTime(timestampMs)}</span>
          )}
        </div>
        <div className="mt-1.5">{children}</div>
      </div>
    </div>
  );
}

function UserMessage({ text }: { readonly text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] whitespace-pre-wrap rounded-3xl rounded-br-lg bg-black px-4 py-2.5 text-[13px] leading-relaxed text-white">
        {text}
      </div>
    </div>
  );
}

function SystemLine({
  icon: Icon,
  tone = "muted",
  children,
}: {
  readonly icon?: ComponentType<{ size?: number; className?: string }>;
  readonly tone?: "muted" | "danger";
  readonly children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-center gap-2 text-center text-[11px] leading-relaxed",
        tone === "danger" ? "text-[color:var(--sketch-red)]" : INK_FAINT,
      )}
    >
      {Icon && <Icon size={11} className="shrink-0" />}
      <span>{children}</span>
    </div>
  );
}

// ─── Message bodies ───────────────────────────────────────────────────────────

function PlanBody({
  payload,
  agentNameById,
}: {
  readonly payload: Record<string, unknown>;
  readonly agentNameById: (id: string | null) => string;
}) {
  type SubtaskEntry = { subtaskId?: string; agentId?: string; goal?: string };
  const subtasks = (payload.subtasks as SubtaskEntry[]) ?? [];

  return (
    <div className="space-y-2">
      <p className={cn("text-[13px] leading-relaxed", INK_SOFT)}>
        Split this into {subtasks.length} step{subtasks.length === 1 ? "" : "s"}.
      </p>
      {subtasks.length > 0 && (
        <ol className="space-y-1.5">
          {subtasks.map((st, i) => (
            <li key={st.subtaskId ?? i} className="flex gap-2.5 text-[12.5px] leading-relaxed">
              <span className={cn("mt-[3px] font-mono text-[10px] tabular-nums", INK_FAINT)}>
                {i + 1}
              </span>
              <span className="min-w-0">
                <span className="font-medium text-black">{agentNameById(st.agentId ?? null)}</span>
                {st.goal && <span className={INK_SOFT}> — {st.goal}</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function HandoffLine({ to, goal }: { readonly to: string; readonly goal?: string }) {
  return (
    <div className={cn("flex items-start gap-2 pl-10 text-[12px] leading-relaxed", INK_FAINT)}>
      <ArrowRight size={11} className="mt-[3px] shrink-0" />
      <p className="min-w-0">
        <span className="font-medium text-black">{to}</span>
        {goal ? <span className={INK_SOFT}> · {goal}</span> : null}
      </p>
    </div>
  );
}

/** One collapsed block for a run of consecutive tool / brain steps by one agent. */
function ActivityBody({
  entries,
  frames,
  running,
}: {
  readonly entries: ActivityEntry[];
  readonly frames: Record<string, BrowserFrame>;
  readonly running: boolean;
}) {
  const [open, setOpen] = useState(false);
  const last = entries[entries.length - 1];
  const summary = last?.label ?? "Working";

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-2 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-black/[0.04]"
      >
        {running ? (
          <Loader2 size={12} className={cn("shrink-0 animate-spin", INK_SOFT)} />
        ) : (
          <ToolGlyph
            kind={last?.kind}
            tool={last?.tool}
            className={cn("shrink-0", INK_FAINT)}
          />
        )}
        <span className={cn("min-w-0 flex-1 truncate text-[12.5px]", INK_SOFT)}>{summary}</span>
        {entries.length > 1 && (
          <span className={cn("shrink-0 text-[11px] tabular-nums", INK_FAINT)}>
            {entries.length}
          </span>
        )}
        <ChevronDown
          size={12}
          className={cn("shrink-0 transition-transform", INK_FAINT, open && "rotate-180")}
        />
      </button>

      {open && (
        <ul className={cn("mt-2 space-y-2.5 border-l pl-3.5", HAIRLINE)}>
          {entries.map((entry) => {
            const frame = frames[entry.id];
            return (
              <li key={entry.id} className="space-y-1.5">
                <div className={cn("flex items-start gap-2 text-[12px] leading-relaxed", INK_SOFT)}>
                  <ToolGlyph
                    kind={entry.kind}
                    tool={entry.tool}
                    size={11}
                    className={cn("mt-[3px] shrink-0", INK_FAINT)}
                  />
                  <span className="min-w-0">
                    {entry.label}
                    {entry.detail && (
                      <span className={cn("block text-[11px]", INK_FAINT)}>{entry.detail}</span>
                    )}
                  </span>
                </div>
                {frame && (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`data:${frame.mime};base64,${frame.imageBase64}`}
                      alt={frame.label}
                      className={cn("max-h-56 w-full rounded-xl border object-contain", HAIRLINE)}
                    />
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function CompletedBody({
  summary,
  durationMs,
}: {
  readonly summary?: string;
  readonly durationMs?: number;
}) {
  return (
    <div className="space-y-1">
      <p className={cn("flex items-center gap-1.5 text-[12.5px]", INK_SOFT)}>
        <CheckCircle size={12} className="shrink-0 text-[color:var(--sketch-green)]" />
        Finished
        {durationMs != null && (
          <span className={INK_FAINT}>· {formatDuration(durationMs)}</span>
        )}
      </p>
      {summary && (
        <p className={cn("text-[13px] leading-relaxed", INK_SOFT)}>{summary}</p>
      )}
    </div>
  );
}

function ResultBody({ result }: { readonly result: string }) {
  return (
    <SketchBox className="px-4 py-3.5">
      <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-black">{result}</p>
    </SketchBox>
  );
}

function TypingIndicator({
  name,
  role,
  label,
  steps,
}: {
  readonly name: string;
  readonly role: "supervisor" | "worker";
  readonly label?: string;
  readonly steps: TeamReasoningStep[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex gap-3">
      <Avatar name={name} role={role} />
      <div className="min-w-0 flex-1 pt-1">
        <button
          type="button"
          onClick={() => steps.length > 0 && setOpen((v) => !v)}
          aria-expanded={open}
          className={cn(
            "-mx-2 flex w-[calc(100%+1rem)] items-center gap-2 rounded-xl px-2 py-1 text-left",
            steps.length > 0 && "transition-colors hover:bg-black/[0.04]",
          )}
        >
          <span className="flex shrink-0 items-center gap-1" aria-hidden>
            <span className="size-1.5 animate-bounce rounded-full bg-[color:var(--ink-faint)]" />
            <span className="size-1.5 animate-bounce rounded-full bg-[color:var(--ink-faint)] [animation-delay:150ms]" />
            <span className="size-1.5 animate-bounce rounded-full bg-[color:var(--ink-faint)] [animation-delay:300ms]" />
          </span>
          <span className={cn("min-w-0 flex-1 truncate text-[12.5px]", INK_SOFT)}>
            {label ?? "Thinking…"}
          </span>
          {steps.length > 0 && (
            <ChevronDown
              size={12}
              className={cn("shrink-0 transition-transform", INK_FAINT, open && "rotate-180")}
            />
          )}
        </button>

        {open && steps.length > 0 && (
          <ul className={cn("mt-2 max-h-48 space-y-1.5 overflow-y-auto border-l pl-3.5", HAIRLINE)}>
            {steps.map((s) => {
              const Icon = s.tone === "error" ? XCircle : s.category ? toolCategoryIcon(s.category) : Brain;
              return (
                <li
                  key={s.id}
                  className={cn("flex items-start gap-2 text-[11.5px] leading-relaxed", INK_FAINT)}
                >
                  <Icon size={10} className="mt-[3px] shrink-0" />
                  <span className="min-w-0">
                    {s.label}
                    {s.detail && s.detail !== s.toolId ? <span> · {s.detail}</span> : null}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

// ─── Sidebar pieces ───────────────────────────────────────────────────────────

function SidebarAgent({ status }: { readonly status: AgentStatus }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 transition-colors hover:bg-white/60">
      <Avatar name={status.name} role={status.role} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12.5px] font-medium text-black">{status.name}</p>
        <p className={cn("truncate text-[11px]", INK_SOFT)}>
          {status.currentAction ?? STATE_LABEL[status.state]}
        </p>
      </div>
      <span className={cn("size-1.5 shrink-0 rounded-full", STATE_DOT[status.state])} aria-hidden />
    </div>
  );
}

function SidebarLabel({ children }: { readonly children: ReactNode }) {
  return (
    <p className="px-2.5 pb-1.5 text-[10px] font-medium uppercase tracking-[0.16em] text-black">
      {children}
    </p>
  );
}

function ArtifactRow({
  artifact,
  agentNameById,
}: {
  readonly artifact: TeamRunArtifact;
  readonly agentNameById: (id: string | null) => string;
}) {
  function download() {
    const content =
      typeof artifact.content === "string"
        ? artifact.content
        : JSON.stringify(artifact.content, null, 2);
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${artifact.name.replace(/\s+/g, "_")}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <button
      type="button"
      onClick={download}
      title="Download"
      className="group flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-white/60"
    >
      <FileText size={12} className={cn("shrink-0", INK_FAINT)} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] text-black">{artifact.name}</span>
        <span className={cn("block truncate text-[10.5px]", INK_FAINT)}>
          {agentNameById(artifact.agentId)}
        </span>
      </span>
      <Download size={12} className={cn("shrink-0 opacity-0 transition-opacity group-hover:opacity-100", INK_SOFT)} />
    </button>
  );
}

// ─── Chat item model ──────────────────────────────────────────────────────────

interface ActivityEntry {
  id: string;
  kind: "tool" | "brain";
  tool?: string;
  label: string;
  detail?: string;
}

type ChatItem =
  | { kind: "plan"; id: string; ts: number; payload: Record<string, unknown> }
  | { kind: "handoff"; id: string; ts: number; agentName: string; goal?: string }
  | { kind: "activity"; id: string; ts: number; agentId: string; entries: ActivityEntry[] }
  | { kind: "completed"; id: string; ts: number; agentId: string | null; summary?: string }
  | { kind: "result"; id: string; ts: number }
  | { kind: "failed"; id: string; ts: number; error: string }
  | { kind: "user"; id: string; ts: number; message: string }
  | { kind: "delivered"; id: string; ts: number; sent: boolean; reason?: string };

// ─── Main Component ───────────────────────────────────────────────────────────

interface TeamRunViewProps {
  readonly team: TeamDTO;
  readonly onRunStarted?: (runId: string) => void;
}

export function TeamRunView({ team, onRunStarted }: TeamRunViewProps) {
  const [composer, setComposer] = useState("");
  const [startedGoal, setStartedGoal] = useState<string | null>(null);
  const [run, setRun] = useState<TeamRunDTO | null>(null);
  const [events, setEvents] = useState<TeamRunEventDTO[]>([]);
  const [artifacts, setArtifacts] = useState<TeamRunArtifact[]>([]);
  const [finalResult, setFinalResult] = useState<string | null>(null);
  const [runStatus, setRunStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [injecting, setInjecting] = useState(false);
  const [leadReviewCampaignId, setLeadReviewCampaignId] = useState<string | null>(null);
  const [leadReviewApproved, setLeadReviewApproved] = useState(false);
  const [showAgents, setShowAgents] = useState(false);
  const [viewMode, setViewMode] = useState<RunViewMode>("chat");
  const showChat = viewMode === "chat";

  // Browser frames: agentId → frames[]
  const [browserFrames, setBrowserFrames] = useState<Record<string, BrowserFrame[]>>({});
  // Map from tool_finished event id → browser frame (arrives just after)
  const [toolFrames, setToolFrames] = useState<Record<string, BrowserFrame>>({});

  const streamCleanup = useRef<(() => void) | null>(null);
  const timelineScrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const frameCounterRef = useRef(0);
  // Track the last tool_finished event id per agent to link browser_frame to it
  const pendingToolEventByAgent = useRef<Record<string, string>>({});

  // ── Agent list (stable order: supervisor first, then workers) ──────────────
  const allAgents = useMemo(() => {
    const list: Array<{
      agentId: string;
      name: string;
      role: "supervisor" | "worker";
    }> = [];
    if (team.supervisorAgentId) {
      list.push({
        agentId: team.supervisorAgentId,
        name: team.supervisorAgent?.name ?? "Supervisor",
        role: "supervisor",
      });
    }
    (team.members ?? []).forEach((m) => {
      list.push({
        agentId: m.agentId,
        name: m.agent?.name ?? m.agentId.slice(0, 10),
        role: "worker",
      });
    });
    return list;
  }, [team]);

  const agentNameById = useCallback(
    (id: string | null): string => {
      if (!id) return "System";
      return allAgents.find((a) => a.agentId === id)?.name ?? id.slice(0, 10);
    },
    [allAgents],
  );

  const agentRoleById = useCallback(
    (id: string | null): "supervisor" | "worker" =>
      allAgents.find((a) => a.agentId === id)?.role ?? "worker",
    [allAgents],
  );

  // ── Derive live agent states from events ───────────────────────────────────
  const agentStates = useMemo<Map<string, AgentStatus>>(() => {
    const states = new Map<string, AgentStatus>();
    for (const ag of allAgents) {
      states.set(ag.agentId, {
        agentId: ag.agentId,
        name: ag.name,
        role: ag.role,
        state: "idle",
        toolCount: 0,
        tasksDone: 0,
      });
    }

    const inferenceHintsByAgent = new Map<string, Map<string, string>>();

    for (const e of events) {
      const p = e.payload as Record<string, unknown>;
      const aid = e.agentId;

      if (e.eventType === "task_status_update" && p.message === "inference_tool_round" && aid) {
        const hints = new Map<string, string>();
        for (const detail of parseInferenceToolDetails(p)) {
          if (detail.label) {
            hints.set(detail.name, detail.label);
            continue;
          }
          if (detail.tool_args) {
            const label = describeBrowserToolAction(detail.name, { tool_args: detail.tool_args });
            if (label) hints.set(detail.name, label);
          }
        }
        if (hints.size > 0) inferenceHintsByAgent.set(aid, hints);
      }

      if (e.eventType === "run_started" && team.supervisorAgentId) {
        const s = states.get(team.supervisorAgentId);
        if (s) states.set(team.supervisorAgentId, { ...s, state: "thinking", currentAction: "Planning the work…" });
      } else if (e.eventType === "supervisor_step" && aid) {
        const s = states.get(aid);
        if (s) {
          const step = p.step as string;
          states.set(aid, {
            ...s,
            state: "thinking",
            currentAction: step === "decompose" ? "Planning the work…" : "Pulling results together…",
          });
        }
      } else if (e.eventType === "task_delegated") {
        const workerId = (p.agentId as string | undefined) ?? aid;
        if (workerId) {
          const s = states.get(workerId);
          if (s) states.set(workerId, { ...s, state: "thinking", currentAction: "Working on task…" });
        }
      } else if (e.eventType === "brain_queried" && aid) {
        const s = states.get(aid);
        if (s) {
          states.set(aid, {
            ...s,
            state: "tool_active",
            currentTool: "brain.query",
            currentAction: "Checked company brain",
            toolCount: s.toolCount + 1,
          });
        }
      } else if (e.eventType === "tool_called" && aid) {
        const s = states.get(aid);
        const tool = p.tool as string | undefined;
        const msg = p.message as string | undefined;
        if (s && tool && msg === "tool_started" && isBrowserToolId(tool)) {
          const hints = inferenceHintsByAgent.get(aid);
          states.set(aid, {
            ...s,
            state: "tool_active",
            currentTool: tool,
            currentAction: resolveBrowserToolIntent(tool, p, hints),
          });
        } else if (s && tool && msg === "tool_finished") {
          if (tool === "brain.query") {
            states.set(aid, {
              ...s,
              state: "tool_active",
              currentTool: "brain.query",
              currentAction: "Checked company brain",
              toolCount: s.toolCount + 1,
            });
          } else {
            states.set(aid, {
              ...s,
              state: "tool_active",
              currentTool: tool,
              currentAction: undefined,
              toolCount: s.toolCount + 1,
            });
          }
        }
      } else if (e.eventType === "subtask_completed") {
        const workerId = (p.agentId as string | undefined) ?? aid;
        if (workerId) {
          const s = states.get(workerId);
          if (s) {
            states.set(workerId, {
              ...s,
              state: "completed",
              currentAction: "Done",
              currentTool: undefined,
              tasksDone: s.tasksDone + 1,
            });
          }
        }
        // Supervisor resumes thinking after each worker finishes
        if (team.supervisorAgentId) {
          const sv = states.get(team.supervisorAgentId);
          if (sv && sv.state !== "completed") {
            states.set(team.supervisorAgentId, { ...sv, state: "thinking", currentAction: "Waiting on agents…" });
          }
        }
      } else if (e.eventType === "run_completed") {
        for (const [id, s] of states) {
          if (s.state !== "failed") {
            states.set(id, { ...s, state: "completed", currentAction: "Done", currentTool: undefined });
          }
        }
      } else if (e.eventType === "run_failed" && aid) {
        const s = states.get(aid);
        if (s) states.set(aid, { ...s, state: "failed", currentAction: undefined });
      }
    }

    return states;
  }, [events, allAgents, team.supervisorAgentId]);

  // ── Map delegation timestamps for duration calculation ─────────────────────
  const delegationTimestamps = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of events) {
      if (e.eventType === "task_delegated") {
        const p = e.payload as Record<string, unknown>;
        const workerId = (p.agentId as string | undefined) ?? e.agentId;
        if (workerId) map.set(workerId, parseTimestampMs(e.timestampMs));
      }
    }
    return map;
  }, [events]);

  // ── Transform raw events into rich timeline items ──────────────────────────
  const processedEvents = useMemo<ProcessedEvent[]>(() => {
    const result: ProcessedEvent[] = [];
    const inferenceHintsByAgent = new Map<string, Map<string, string>>();

    for (const e of events) {
      const p = e.payload as Record<string, unknown>;
      const ts = parseTimestampMs(e.timestampMs);

      if (e.eventType === "task_status_update" && p.message === "inference_tool_round" && e.agentId) {
        const hints = new Map<string, string>();
        for (const detail of parseInferenceToolDetails(p)) {
          if (detail.label) {
            hints.set(detail.name, detail.label);
            continue;
          }
          if (detail.tool_args) {
            const label = describeBrowserToolAction(detail.name, { tool_args: detail.tool_args });
            if (label) hints.set(detail.name, label);
          }
        }
        if (hints.size > 0) inferenceHintsByAgent.set(e.agentId, hints);
      }

      switch (e.eventType) {
        case "run_started":
          result.push({ kind: "run_started", eventId: e.id, timestampMs: ts });
          break;
        case "supervisor_step":
          if ((p.step as string) === "decompose") {
            result.push({ kind: "supervisor_plan", eventId: e.id, timestampMs: ts, payload: p });
          }
          // synthesize step surfaces as final result card, not a separate entry
          break;
        case "task_delegated":
          result.push({ kind: "task_delegated", eventId: e.id, timestampMs: ts, payload: p, agentId: e.agentId });
          break;
        case "brain_queried":
          result.push(brainQueryFromPayload(e.id, ts, e.agentId, p));
          break;
        case "tool_called": {
          const tool = p.tool as string | undefined;
          const msg = p.message as string | undefined;
          if (tool && msg === "tool_finished") {
            if (tool === "brain.query") {
              result.push(brainQueryFromPayload(e.id, ts, e.agentId, p));
            } else {
              const hints = inferenceHintsByAgent.get(e.agentId ?? "");
              const actionLabel = isBrowserToolId(tool)
                ? resolveBrowserToolIntent(tool, p, hints)
                : describeBrowserToolAction(tool, p) ?? undefined;
              result.push({
                kind: "tool_call",
                eventId: e.id,
                timestampMs: ts,
                tool,
                agentId: e.agentId ?? "",
                actionLabel,
              });
            }
          }
          break;
        }
        case "subtask_completed":
          result.push({ kind: "subtask_completed", eventId: e.id, timestampMs: ts, payload: p, agentId: e.agentId });
          break;
        case "run_completed":
          result.push({ kind: "run_result", eventId: e.id, timestampMs: ts });
          break;
        case "run_failed":
          result.push({ kind: "run_failed_event", eventId: e.id, timestampMs: ts, error: (p.error as string | undefined) ?? "Run failed" });
          break;
        case "user_injection":
          result.push({ kind: "user_injection", eventId: e.id, timestampMs: ts, message: (p.message as string | undefined) ?? "" });
          break;
        case "result_delivered":
          result.push({
            kind: "result_delivered",
            eventId: e.id,
            timestampMs: ts,
            sent: (p.sent as boolean | undefined) ?? false,
            reason: typeof p.reason === "string" ? p.reason : undefined,
          });
          break;
        case "lead_review_required":
          if (typeof p.campaignId === "string") {
            result.push({
              kind: "lead_review",
              eventId: e.id,
              timestampMs: ts,
              campaignId: p.campaignId,
            });
          }
          break;
      }
    }
    return result;
  }, [events]);

  /** Chat stream — consecutive tool/brain steps by one agent collapse into a single block. */
  const chatItems = useMemo<ChatItem[]>(() => {
    const items: ChatItem[] = [];

    for (const ev of processedEvents) {
      if (ev.kind === "tool_call" || ev.kind === "brain_query") {
        const agentId = ev.agentId ?? "";
        const entry: ActivityEntry =
          ev.kind === "tool_call"
            ? {
                id: ev.eventId,
                kind: "tool",
                tool: ev.tool,
                label: ev.actionLabel ?? formatToolId(ev.tool).short,
              }
            : {
                id: ev.eventId,
                kind: "brain",
                label:
                  ev.citationCount > 0
                    ? `Checked company brain — ${ev.citationCount} source${ev.citationCount === 1 ? "" : "s"}`
                    : "Checked company brain — nothing matched",
                detail: ev.citationTitles.slice(0, 3).join(" · ") || undefined,
              };

        const last = items[items.length - 1];
        if (last && last.kind === "activity" && last.agentId === agentId) {
          last.entries.push(entry);
        } else {
          items.push({
            kind: "activity",
            id: ev.eventId,
            ts: ev.timestampMs,
            agentId,
            entries: [entry],
          });
        }
        continue;
      }

      switch (ev.kind) {
        case "supervisor_plan":
          items.push({ kind: "plan", id: ev.eventId, ts: ev.timestampMs, payload: ev.payload });
          break;
        case "task_delegated":
          items.push({
            kind: "handoff",
            id: ev.eventId,
            ts: ev.timestampMs,
            agentName: (ev.payload.agentName as string | undefined) ?? "Agent",
            goal: ev.payload.goal as string | undefined,
          });
          break;
        case "subtask_completed":
          items.push({
            kind: "completed",
            id: ev.eventId,
            ts: ev.timestampMs,
            agentId: (ev.payload.agentId as string | undefined) ?? ev.agentId,
            summary: ev.payload.summary as string | undefined,
          });
          break;
        case "run_result":
          items.push({ kind: "result", id: ev.eventId, ts: ev.timestampMs });
          break;
        case "run_failed_event":
          items.push({ kind: "failed", id: ev.eventId, ts: ev.timestampMs, error: ev.error });
          break;
        case "user_injection":
          items.push({ kind: "user", id: ev.eventId, ts: ev.timestampMs, message: ev.message });
          break;
        case "result_delivered":
          items.push({
            kind: "delivered",
            id: ev.eventId,
            ts: ev.timestampMs,
            sent: ev.sent,
            reason: ev.reason,
          });
          break;
        default:
          break;
      }
    }

    return items;
  }, [processedEvents]);

  const reasoningState = useMemo(
    () => collectTeamReasoningSteps(events, agentNameById),
    [events, agentNameById],
  );
  const { steps: reasoningSteps, isThinking: isAgentThinking, activeLabel: reasoningActiveLabel } =
    reasoningState;

  // ── All browser frames flat list for live view panel ──────────────────────
  const allBrowserFrames = useMemo(
    () => Object.values(browserFrames).flat(),
    [browserFrames],
  );

  /** Resolve campaign id from run DTO, checkpoint trace, or streamed events. */
  const leadReviewState = useMemo(() => {
    let campaignId = leadReviewCampaignId ?? run?.leadCampaignId ?? null;
    let awaitingReview = runStatus === "paused" || run?.status === "paused";

    if (!campaignId && run?.supervisorTrace && Array.isArray(run.supervisorTrace)) {
      for (let i = run.supervisorTrace.length - 1; i >= 0; i--) {
        const step = run.supervisorTrace[i] as { step?: string; campaignId?: string } | undefined;
        if (step?.step === "lead_review_checkpoint" && step.campaignId) {
          campaignId = step.campaignId;
          break;
        }
      }
    }

    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i]!;
      if (e.eventType === "lead_review_required") {
        const p = e.payload as Record<string, unknown>;
        if (typeof p.campaignId === "string") {
          campaignId = campaignId ?? p.campaignId;
          awaitingReview = true;
        }
        break;
      }
    }

    if (!awaitingReview) {
      for (let i = events.length - 1; i >= 0; i--) {
        const e = events[i]!;
        if (e.eventType !== "task_status_update") continue;
        const p = e.payload as Record<string, unknown>;
        const msg = p.message as string | undefined;
        if (msg?.includes("review leads and approve outreach")) {
          awaitingReview = true;
          break;
        }
      }
    }

    const approved = leadReviewApproved || Boolean(run?.leadOutreachApprovedAt);
    const activelyRunning = runStatus === "running" || submitting;
    return {
      campaignId,
      awaitingReview: awaitingReview && !approved && !activelyRunning,
      approved,
    };
  }, [events, run, runStatus, leadReviewCampaignId, leadReviewApproved, submitting]);

  const isPaused = leadReviewState.awaitingReview;
  const isRunning = (runStatus === "running" || submitting) && !isPaused;

  const liveBrowserAction = useMemo(() => {
    const inferenceHintsByAgent = new Map<string, Map<string, string>>();
    const pendingRoundByAgent = new Map<string, { label: string; tool: string }>();
    const activeByAgent = new Map<string, { label: string; tool: string }>();

    for (const e of events) {
      const p = e.payload as Record<string, unknown>;
      const aid = e.agentId ?? "";

      if (e.eventType === "task_status_update" && p.message === "inference_tool_round" && aid) {
        const hints = new Map<string, string>();
        for (const detail of parseInferenceToolDetails(p)) {
          if (detail.label) {
            hints.set(detail.name, detail.label);
            continue;
          }
          if (detail.tool_args) {
            const label = describeBrowserToolAction(detail.name, { tool_args: detail.tool_args });
            if (label) hints.set(detail.name, label);
          }
        }
        if (hints.size > 0) {
          inferenceHintsByAgent.set(aid, hints);
          const browser = [...hints.entries()].filter(([name]) => isBrowserToolId(name)).at(-1);
          if (browser) {
            pendingRoundByAgent.set(aid, { tool: browser[0], label: browser[1] });
          }
        }
      }

      if (e.eventType !== "tool_called") continue;
      const tool = p.tool as string | undefined;
      const msg = p.message as string | undefined;
      if (!tool || !isBrowserToolId(tool)) continue;
      const hints = inferenceHintsByAgent.get(aid);
      if (msg === "tool_started") {
        pendingRoundByAgent.delete(aid);
        activeByAgent.set(aid, {
          label: resolveBrowserToolIntent(tool, p, hints),
          tool,
        });
      } else if (msg === "tool_finished") {
        activeByAgent.delete(aid);
        pendingRoundByAgent.delete(aid);
      }
    }

    for (const [aid, pending] of pendingRoundByAgent) {
      if (!activeByAgent.has(aid)) activeByAgent.set(aid, pending);
    }

    const entries = [...activeByAgent.entries()];
    if (entries.length === 0) return null;
    const [agentId, action] = entries[entries.length - 1]!;
    return {
      agentName: agentNameById(agentId || null),
      label: action.label,
      tool: action.tool,
    };
  }, [events, agentNameById]);

  /** Agent the live indicator belongs to — the last one that acted. */
  const activeAgentId = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const aid = events[i]!.agentId;
      if (aid) return aid;
    }
    return team.supervisorAgentId ?? null;
  }, [events, team.supervisorAgentId]);

  // ── Auto-scroll conversation (contained — does not scroll the page) ────────
  useEffect(() => {
    const el = timelineScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [chatItems.length, reasoningSteps.length, isAgentThinking, isRunning]);

  // ── Composer auto-grow ─────────────────────────────────────────────────────
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [composer]);

  useEffect(() => {
    return () => { streamCleanup.current?.(); };
  }, []);

  // ── Process incoming SSE event for browser frames ──────────────────────────
  function processEventForFrames(event: TeamRunEventDTO): void {
    if (event.eventType !== "tool_called") return;
    const p = event.payload as Record<string, unknown>;
    const msg = p.message as string | undefined;
    const tool = p.tool as string | undefined;
    const agentId = event.agentId;

    if (msg === "tool_finished" && agentId && tool) {
      // Track this event id as the pending tool for this agent
      pendingToolEventByAgent.current[agentId] = event.id;
    }

    if (msg === "browser_frame" && agentId) {
      const image_base64 = p.image_base64 as string | undefined;
      if (!image_base64) return;

      const frame: BrowserFrame = {
        id: `frame_${frameCounterRef.current++}`,
        tool: tool ?? "browser",
        label: (p.label as string | undefined) ?? tool ?? "",
        mime: (p.mime as string | undefined) ?? "image/png",
        imageBase64: image_base64,
      };

      // Link this frame to the pending tool_finished event for this agent
      const toolEventId = pendingToolEventByAgent.current[agentId];
      if (toolEventId) {
        setToolFrames((prev) => ({ ...prev, [toolEventId]: frame }));
      }

      // Add to the browser live view panel
      setBrowserFrames((prev) => ({
        ...prev,
        [agentId]: [...(prev[agentId] ?? []), frame],
      }));
    }
  }

  // ── Start run ──────────────────────────────────────────────────────────────
  async function handleStart(text: string) {
    if (!text.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    setEvents([]);
    setArtifacts([]);
    setFinalResult(null);
    setRunStatus(null);
    setLeadReviewCampaignId(null);
    setLeadReviewApproved(false);
    setBrowserFrames({});
    setToolFrames({});
    setStartedGoal(text.trim());
    setComposer("");
    pendingToolEventByAgent.current = {};
    streamCleanup.current?.();

    try {
      const newRun = await startTeamRun(team.id, text.trim());
      setRun(newRun);
      setRunStatus("running");
      onRunStarted?.(newRun.id);

      const cleanup = streamTeamRun(team.id, newRun.id, {
        onEvent: (event) => {
          setEvents((prev) => {
            if (prev.some((e) => e.id === event.id)) return prev;
            return [...prev, event];
          });
          processEventForFrames(event);
          const p = event.payload as Record<string, unknown>;
          if (event.eventType === "artifact_produced" && p.artifact) {
            const artifact = p.artifact as TeamRunArtifact;
            setArtifacts((prev) =>
              prev.some((a) => a.id === artifact.id) ? prev : [...prev, artifact],
            );
          }
          if (event.eventType === "lead_review_required" && typeof p.campaignId === "string") {
            setLeadReviewCampaignId(p.campaignId);
            setRunStatus("paused");
          }
        },
        onPaused: (data) => {
          setRunStatus("paused");
          if (data.campaignId) setLeadReviewCampaignId(data.campaignId);
        },
        onComplete: (data) => {
          setRunStatus(data.status);
          if (typeof data.result === "object" && data.result !== null) {
            const r = data.result as Record<string, unknown>;
            if (typeof r.synthesis === "string") setFinalResult(r.synthesis);
          }
        },
        onError: () => {
          /* EventSource may error on reconnect; keep paused runs alive */
        },
      });
      streamCleanup.current = cleanup;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start run");
      setRunStatus("failed");
    } finally {
      setSubmitting(false);
    }
  }

  // ── Cancel run ─────────────────────────────────────────────────────────────
  async function handleStop() {
    if (!run || canceling) return;
    setCanceling(true);
    try {
      await cancelTeamRun(team.id, run.id);
      streamCleanup.current?.();
      streamCleanup.current = null;
      setRunStatus("canceled");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to stop the run");
    } finally {
      setCanceling(false);
    }
  }

  async function handleInject(text: string) {
    if (!run || !text.trim() || injecting) return;
    setInjecting(true);
    setComposer("");
    try {
      await injectTeamRunMessage(team.id, run.id, text.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setInjecting(false);
    }
  }

  function handleSend() {
    const text = composer.trim();
    if (!text) return;
    if (isRunning && run) {
      void handleInject(text);
      return;
    }
    void handleStart(text);
  }

  function handleNewRun() {
    streamCleanup.current?.();
    streamCleanup.current = null;
    setRun(null);
    setEvents([]);
    setArtifacts([]);
    setFinalResult(null);
    setRunStatus(null);
    setStartedGoal(null);
    setLeadReviewCampaignId(null);
    setLeadReviewApproved(false);
    setError(null);
    setBrowserFrames({});
    setToolFrames({});
    pendingToolEventByAgent.current = {};
  }

  // Reconnect stream + hydrate when opening a team with an in-progress paused run.
  useEffect(() => {
    if (run) return;
    let cancelled = false;

    void (async () => {
      try {
        const runs = await listTeamRuns(team.id);
        const paused = runs.find(
          (r) => r.status === "paused" && !r.leadOutreachApprovedAt,
        );
        if (!paused || cancelled) return;

        const detail = await getTeamRun(team.id, paused.id);
        if (cancelled) return;

        setRun(detail.run);
        setStartedGoal(detail.run.goal);
        setEvents(detail.events);
        setRunStatus("paused");
        if (detail.run.leadCampaignId) {
          setLeadReviewCampaignId(detail.run.leadCampaignId);
        }

        const lastSeq =
          detail.events.length > 0 ? detail.events[detail.events.length - 1]!.seq : -1;
        streamCleanup.current?.();
        streamCleanup.current = streamTeamRun(team.id, paused.id, {
          onEvent: (event) => {
            setEvents((prev) =>
              prev.some((e) => e.id === event.id) ? prev : [...prev, event],
            );
            processEventForFrames(event);
            const p = event.payload as Record<string, unknown>;
            if (event.eventType === "lead_review_required" && typeof p.campaignId === "string") {
              setLeadReviewCampaignId(p.campaignId);
              setRunStatus("paused");
            }
          },
          onPaused: (data) => {
            setRunStatus("paused");
            if (data.campaignId) setLeadReviewCampaignId(data.campaignId);
          },
          onComplete: (data) => {
            setRunStatus(data.status);
            if (typeof data.result === "object" && data.result !== null) {
              const r = data.result as Record<string, unknown>;
              if (typeof r.synthesis === "string") setFinalResult(r.synthesis);
            }
          },
          onError: () => {
            /* EventSource errors on reconnect; paused runs stay open */
          },
        }, lastSeq);
      } catch {
        // ignore — user can start a fresh run
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [team.id, run]);

  const supervisorName = agentNameById(team.supervisorAgentId ?? null);
  const goalText = run?.goal ?? startedGoal;
  const hasConversation = Boolean(goalText) || chatItems.length > 0;

  const statusLabel = isRunning
    ? "Running"
    : isPaused
      ? "Waiting for your review"
      : runStatus === "completed"
        ? "Completed"
        : runStatus === "failed"
          ? "Failed"
          : runStatus === "canceled"
            ? "Stopped"
            : null;

  const statusDot = isRunning
    ? "bg-[color:var(--sketch-purple)] animate-pulse"
    : isPaused
      ? "bg-[color:var(--warning)]"
      : runStatus === "completed"
        ? "bg-[color:var(--sketch-green)]"
        : runStatus === "failed"
          ? "bg-[color:var(--sketch-red)]"
          : "bg-[color:var(--ink-faint)]";

  const placeholder = isPaused
    ? "Review the leads below to continue…"
    : isRunning
      ? "Add guidance while they work…"
      : run
        ? "Start another run…"
        : `What should ${team.name} do?`;

  return (
    <div className="relative flex h-full min-h-0 flex-1 overflow-hidden">
      {/* ── Agents sidebar ───────────────────────────────────────────────── */}
      <aside
        className={cn(
          "absolute inset-y-0 left-0 z-20 flex w-60 min-h-0 flex-col overflow-hidden border-r bg-white/85 backdrop-blur-xl transition-transform duration-200 md:static md:z-auto md:w-56 md:translate-x-0 md:bg-transparent md:backdrop-blur-none",
          HAIRLINE,
          showAgents ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex shrink-0 items-center justify-between gap-2 px-4 pb-2 pt-4">
          <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-black">
            Agents
          </span>
          <button
            type="button"
            onClick={() => setShowAgents(false)}
            className={cn("md:hidden", quietButton)}
            aria-label="Hide agents"
          >
            <X size={13} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto overscroll-contain px-2 pb-3">
          {allAgents.map((ag) => {
            const status = agentStates.get(ag.agentId) ?? {
              agentId: ag.agentId,
              name: ag.name,
              role: ag.role,
              state: "idle" as AgentState,
              toolCount: 0,
              tasksDone: 0,
            };
            return <SidebarAgent key={ag.agentId} status={status} />;
          })}
        </div>

        {(allBrowserFrames.length > 0 || (isRunning && liveBrowserAction)) && (
          <div className={cn("shrink-0 border-t px-2 py-3", HAIRLINE)}>
            <SidebarLabel>Live view</SidebarLabel>
            {allBrowserFrames.length > 0 ? (
              <AgentBrowserLiveView
                frames={allBrowserFrames}
                active={isRunning}
                compact
                actionHint={liveBrowserAction?.label ?? allBrowserFrames.at(-1)?.label}
                className={cn("mx-1 h-40 overflow-hidden rounded-xl border", HAIRLINE)}
              />
            ) : (
              <p className={cn("px-2.5 text-[11px] leading-relaxed", INK_SOFT)}>
                {liveBrowserAction?.label}
              </p>
            )}
          </div>
        )}

        {artifacts.length > 0 && (
          <div className={cn("max-h-56 shrink-0 overflow-y-auto border-t px-2 py-3", HAIRLINE)}>
            <SidebarLabel>Files</SidebarLabel>
            {artifacts.map((a, i) => (
              <ArtifactRow key={`${a.id}-${i}`} artifact={a} agentNameById={agentNameById} />
            ))}
          </div>
        )}
      </aside>

      {showAgents && (
        <button
          type="button"
          onClick={() => setShowAgents(false)}
          aria-label="Close agents"
          className="absolute inset-0 z-10 bg-black/10 md:hidden"
        />
      )}

      {/* ── Conversation ─────────────────────────────────────────────────── */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-2 px-6 py-2">
          <button
            type="button"
            onClick={() => setShowAgents(true)}
            className={cn("md:hidden", quietButton)}
          >
            <Users size={12} />
            Agents
          </button>

          <div
            className={cn("inline-flex items-center gap-0.5 rounded-full border p-0.5", HAIRLINE)}
            role="group"
            aria-label="Run view"
          >
            {(["chat", "graph"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setViewMode(mode)}
                aria-pressed={viewMode === mode}
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-[11px] capitalize transition-colors",
                  viewMode === mode
                    ? "bg-black text-white"
                    : cn(INK_SOFT, "hover:bg-black/[0.05] hover:text-black"),
                )}
              >
                {mode}
              </button>
            ))}
          </div>

          {statusLabel && (
            <span className={cn("inline-flex items-center gap-1.5 text-[11px]", INK_SOFT)}>
              <span className={cn("size-1.5 rounded-full", statusDot)} aria-hidden />
              {statusLabel}
            </span>
          )}

          <div className="flex-1" />

          {error && (
            <span
              className="max-w-[220px] truncate text-[11px] text-[color:var(--sketch-red)]"
              title={error}
            >
              {error}
            </span>
          )}

          {(isRunning || isPaused) && run && (
            <button
              type="button"
              onClick={() => void handleStop()}
              disabled={canceling}
              className={quietButton}
            >
              <Square size={11} />
              {canceling ? "Stopping…" : "Stop"}
            </button>
          )}

          {!isRunning && !isPaused && hasConversation && (
            <button type="button" onClick={handleNewRun} className={quietButton}>
              New run
            </button>
          )}
        </div>

        <div
          ref={timelineScrollRef}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-4"
        >
          <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
            {viewMode === "graph" && (
              <TeamRunGraph team={team} agentStates={agentStates} goal={goalText} />
            )}

            {showChat && !hasConversation && (
              <div className="flex flex-col items-center gap-2 py-20 text-center">
                <p className="text-[15px] font-medium text-black">
                  What should {team.name} work on?
                </p>
                <p className={cn("max-w-sm text-[12.5px] leading-relaxed", INK_SOFT)}>
                  Describe the outcome you want. {supervisorName} plans the steps and hands them to
                  your agents.
                </p>
              </div>
            )}

            {showChat && goalText && <UserMessage text={goalText} />}

            {showChat && chatItems.map((item) => {
              switch (item.kind) {
                case "plan":
                  return (
                    <ChatMessage
                      key={item.id}
                      name={supervisorName}
                      role="supervisor"
                      timestampMs={item.ts}
                    >
                      <PlanBody payload={item.payload} agentNameById={agentNameById} />
                    </ChatMessage>
                  );

                case "handoff":
                  return <HandoffLine key={item.id} to={item.agentName} goal={item.goal} />;

                case "activity":
                  return (
                    <ChatMessage
                      key={item.id}
                      name={agentNameById(item.agentId || null)}
                      role={agentRoleById(item.agentId || null)}
                      timestampMs={item.ts}
                    >
                      <ActivityBody
                        entries={item.entries}
                        frames={toolFrames}
                        running={isRunning}
                      />
                    </ChatMessage>
                  );

                case "completed":
                  return (
                    <ChatMessage
                      key={item.id}
                      name={agentNameById(item.agentId)}
                      role={agentRoleById(item.agentId)}
                      timestampMs={item.ts}
                    >
                      <CompletedBody
                        summary={item.summary}
                        durationMs={
                          item.agentId && delegationTimestamps.has(item.agentId)
                            ? item.ts - delegationTimestamps.get(item.agentId)!
                            : undefined
                        }
                      />
                    </ChatMessage>
                  );

                case "result":
                  return finalResult ? (
                    <ChatMessage
                      key={item.id}
                      name={supervisorName}
                      role="supervisor"
                      timestampMs={item.ts}
                    >
                      <ResultBody result={finalResult} />
                    </ChatMessage>
                  ) : null;

                case "failed":
                  return (
                    <SystemLine key={item.id} icon={XCircle} tone="danger">
                      {item.error}
                    </SystemLine>
                  );

                case "user":
                  return <UserMessage key={item.id} text={item.message} />;

                case "delivered":
                  return (
                    <SystemLine key={item.id} icon={Phone}>
                      {item.sent
                        ? "Result sent to your WhatsApp"
                        : `Couldn't send to WhatsApp${item.reason ? ` — ${item.reason}` : ""}`}
                    </SystemLine>
                  );

                default:
                  return null;
              }
            })}

            {showChat && isRunning && (
              <TypingIndicator
                name={agentNameById(activeAgentId)}
                role={agentRoleById(activeAgentId)}
                label={reasoningActiveLabel ?? liveBrowserAction?.label}
                steps={reasoningSteps}
              />
            )}
          </div>
        </div>

        {run && leadReviewState.campaignId && isPaused && !leadReviewState.approved && (
          <div className="mx-auto w-full max-w-2xl shrink-0 px-6">
            <LeadReviewCard
              teamId={team.id}
              runId={run.id}
              campaignId={leadReviewState.campaignId}
              approved={leadReviewState.approved}
              runPaused={isPaused}
              onApproved={() => {
                setLeadReviewApproved(true);
                setRunStatus("running");
              }}
              onRetryStarted={() => setRunStatus("running")}
              onRetryPaused={() => setRunStatus("paused")}
              onRetryFailed={() => setRunStatus("paused")}
            />
          </div>
        )}

        {/* ── Composer ───────────────────────────────────────────────────── */}
        <div className="shrink-0 px-6 pb-5 pt-2">
          <div className="mx-auto w-full max-w-2xl">
            <div
              className={cn(
                "flex items-end gap-2 rounded-3xl border bg-white/70 px-4 py-2 backdrop-blur-sm transition-colors focus-within:border-[color:var(--sketch-purple)]/45",
                HAIRLINE,
              )}
            >
              <textarea
                ref={composerRef}
                value={composer}
                onChange={(e) => setComposer(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                rows={1}
                placeholder={placeholder}
                disabled={isPaused}
                className="max-h-40 min-h-[26px] flex-1 resize-none bg-transparent py-1.5 text-[13px] leading-relaxed text-black outline-none disabled:opacity-50"
              />
              <button
                type="button"
                onClick={handleSend}
                disabled={!composer.trim() || submitting || injecting || isPaused}
                aria-label={isRunning ? "Send guidance" : "Start run"}
                className="mb-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-black text-white transition-colors hover:bg-[color:var(--sketch-purple)] disabled:opacity-20"
              >
                {submitting || injecting ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Send size={14} />
                )}
              </button>
            </div>
            <p className={cn("mt-1.5 text-center text-[10.5px]", INK_FAINT)}>
              {isRunning
                ? "Enter to send · they'll pick it up on the next step"
                : "Enter to send · Shift+Enter for a new line"}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
