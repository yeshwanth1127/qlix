"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Play,
  Loader2,
  CheckCircle,
  XCircle,
  Square,
  Download,
  Globe,
  ArrowRight,
  ChevronRight,
  Search,
  Terminal,
  Brain,
  Zap,
  FileText,
  Mail,
  Wrench,
  Star,
  Send,
  MessageSquare,
  Phone,
} from "lucide-react";
import {
  cancelTeamRun,
  injectTeamRunMessage,
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
import { cn } from "@/lib/utils/cn";

// ─── Types ────────────────────────────────────────────────────────────────────

type AgentState = "idle" | "thinking" | "tool_active" | "completed" | "failed";

interface AgentStatus {
  agentId: string;
  name: string;
  role: "supervisor" | "worker";
  state: AgentState;
  currentAction?: string;
  currentTool?: string;
  toolCount: number;
  tasksDone: number;
}

interface ColorPalette {
  bg: string;
  text: string;
  border: string;
}

interface ToolEntry {
  eventId: string;
  tool: string;
  agentId: string;
  agentName: string;
  palette: ColorPalette;
  frame?: BrowserFrame;
  timestampMs: number;
}

type ProcessedEvent =
  | { kind: "run_started"; eventId: string; timestampMs: number }
  | { kind: "supervisor_plan"; eventId: string; timestampMs: number; payload: Record<string, unknown> }
  | { kind: "task_delegated"; eventId: string; timestampMs: number; payload: Record<string, unknown>; agentId: string | null }
  | { kind: "tool_call"; eventId: string; timestampMs: number; tool: string; agentId: string }
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
  | { kind: "result_delivered"; eventId: string; timestampMs: number; sent: boolean; reason?: string };

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

// ─── Constants ────────────────────────────────────────────────────────────────

const SUPERVISOR_PALETTE: ColorPalette = {
  bg: "bg-purple-500/15",
  text: "text-purple-300",
  border: "border-purple-500/25",
};

const WORKER_PALETTES: ColorPalette[] = [
  { bg: "bg-blue-500/15", text: "text-blue-300", border: "border-blue-500/25" },
  { bg: "bg-cyan-500/15", text: "text-cyan-300", border: "border-cyan-500/25" },
  { bg: "bg-teal-500/15", text: "text-teal-300", border: "border-teal-500/25" },
  { bg: "bg-indigo-500/15", text: "text-indigo-300", border: "border-indigo-500/25" },
  { bg: "bg-violet-500/15", text: "text-violet-300", border: "border-violet-500/25" },
];

const STATE_DOT: Record<AgentState, string> = {
  idle: "bg-white/20",
  thinking: "bg-blue-400 animate-pulse",
  tool_active: "bg-amber-400 animate-pulse",
  completed: "bg-emerald-400",
  failed: "bg-red-400",
};

const STATE_LABEL: Record<AgentState, string> = {
  idle: "Idle",
  thinking: "Thinking…",
  tool_active: "Using tool",
  completed: "Done",
  failed: "Failed",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getToolIcon(tool: string) {
  if (tool === "email_read" || tool === "email_send") return Mail;
  if (tool.startsWith("browser_ab_") || tool.startsWith("browser_")) return Globe;
  if (tool === "web_search") return Search;
  if (tool === "http_request") return Zap;
  if (tool.startsWith("file_")) return FileText;
  if (tool.startsWith("code_") || tool === "shell_exec" || tool === "repl") return Terminal;
  if (tool.startsWith("memory_") || tool.startsWith("knowledge_") || tool.startsWith("brain")) return Brain;
  return Wrench;
}

function getToolIconColor(tool: string): string {
  if (tool === "email_read") return "text-sky-400";
  if (tool === "email_send") return "text-rose-400";
  if (tool.startsWith("browser_ab_") || tool.startsWith("browser_")) return "text-sky-400";
  if (tool === "web_search") return "text-blue-400";
  if (tool === "http_request") return "text-cyan-400";
  if (tool.startsWith("file_")) return "text-amber-400";
  if (tool.startsWith("code_") || tool === "shell_exec" || tool === "repl") return "text-orange-400";
  if (tool.startsWith("memory_") || tool.startsWith("knowledge_") || tool.startsWith("brain")) return "text-purple-400";
  return "text-white/35";
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
  return new Date(ms).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// ─── AgentCard ────────────────────────────────────────────────────────────────

function AgentCard({
  status,
  palette,
  isActive,
}: {
  status: AgentStatus;
  palette: ColorPalette;
  isActive: boolean;
}) {
  const ToolIcon = status.currentTool ? getToolIcon(status.currentTool) : null;
  const toolColor = status.currentTool ? getToolIconColor(status.currentTool) : "";

  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2.5 transition-all duration-300",
        isActive && status.state !== "completed" && status.state !== "failed"
          ? cn(palette.border, palette.bg)
          : "border-white/8 bg-white/[0.02]",
      )}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <div
          className={cn(
            "size-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0",
            palette.bg,
            palette.text,
          )}
        >
          {status.name.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium text-white/75 truncate">{status.name}</p>
          <p className={cn("text-[9px] font-semibold uppercase tracking-wider", palette.text)}>
            {status.role}
          </p>
        </div>
        <div className={cn("size-2 rounded-full shrink-0", STATE_DOT[status.state])} />
      </div>

      <div className="flex items-center gap-1.5 min-w-0">
        {ToolIcon && status.state === "tool_active" && (
          <ToolIcon size={10} className={toolColor} />
        )}
        <p className="text-[10px] text-white/35 truncate">
          {status.state === "tool_active" && status.currentTool
            ? status.currentTool
            : status.currentAction ?? STATE_LABEL[status.state]}
        </p>
      </div>

      {(status.toolCount > 0 || status.tasksDone > 0) && (
        <div className="flex gap-3 mt-1.5">
          {status.toolCount > 0 && (
            <span className="text-[9px] text-white/20">{status.toolCount} tools</span>
          )}
          {status.tasksDone > 0 && (
            <span className="text-[9px] text-emerald-500/50">{status.tasksDone} done</span>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Timeline cards ───────────────────────────────────────────────────────────

function RunStartedCard({ timestampMs }: { timestampMs: number }) {
  return (
    <div className="flex items-center gap-2.5 py-0.5">
      <div className="size-1.5 rounded-full bg-white/15 shrink-0" />
      <span className="text-[10px] text-white/25">Run started</span>
      <span className="text-[10px] text-white/12">{formatTime(timestampMs)}</span>
    </div>
  );
}

function SupervisorPlanCard({
  payload,
  supervisorName,
  timestampMs,
  agentNameById,
  paletteById,
}: {
  payload: Record<string, unknown>;
  supervisorName: string;
  timestampMs: number;
  agentNameById: (id: string | null) => string;
  paletteById: (id: string | null) => ColorPalette;
}) {
  type SubtaskEntry = { subtaskId?: string; agentId?: string; goal?: string };
  const subtasks = (payload.subtasks as SubtaskEntry[]) ?? [];

  return (
    <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-purple-500/15">
        <Brain size={12} className="text-purple-400 shrink-0" />
        <span className="text-[11px] font-medium text-purple-300">{supervisorName}</span>
        <span className="text-[10px] text-white/20 ml-1">planned {subtasks.length} subtask{subtasks.length !== 1 ? "s" : ""}</span>
        <span className="text-[10px] text-white/15 ml-auto">{formatTime(timestampMs)}</span>
      </div>
      {subtasks.length > 0 && (
        <div className="px-3 py-2.5 space-y-2">
          {subtasks.map((st, i) => {
            const palette = paletteById(st.agentId ?? null);
            return (
              <div key={st.subtaskId ?? i} className="flex items-start gap-2">
                <ArrowRight size={10} className={cn("mt-0.5 shrink-0", palette.text)} />
                <div className="min-w-0">
                  <span className={cn("text-[10px] font-medium", palette.text)}>
                    {agentNameById(st.agentId ?? null)}
                  </span>
                  <p className="text-[10px] text-white/40 leading-relaxed mt-0.5">{st.goal}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TaskDelegatedCard({
  payload,
  supervisorName,
  palette,
  timestampMs,
}: {
  payload: Record<string, unknown>;
  supervisorName: string;
  palette: ColorPalette;
  timestampMs: number;
}) {
  const agentName = (payload.agentName as string | undefined) ?? "Worker";
  const goal = (payload.goal as string | undefined) ?? "";

  return (
    <div className={cn("rounded-lg border overflow-hidden", palette.border)}>
      <div className={cn("flex items-center gap-2 px-3 py-1.5 border-b", palette.border, palette.bg)}>
        <span className="text-[10px] text-white/30">{supervisorName}</span>
        <ArrowRight size={10} className={cn("shrink-0", palette.text)} />
        <span className={cn("text-[10px] font-semibold", palette.text)}>{agentName}</span>
        <span className="text-[10px] text-white/15 ml-auto">{formatTime(timestampMs)}</span>
      </div>
      {goal && (
        <div className="px-3 py-2">
          <p className="text-[11px] text-white/50 leading-relaxed">{goal}</p>
        </div>
      )}
    </div>
  );
}

function BrainQueryCard({
  agentName,
  palette,
  timestampMs,
  citationCount,
  policyPreview,
  citationTitles,
  citations,
  contextSections,
}: {
  agentName: string;
  palette: ColorPalette;
  timestampMs: number;
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
}) {
  const [expanded, setExpanded] = useState(true);
  const sections =
    contextSections.length > 0
      ? contextSections
      : citations.map((c, i) => ({
          index: i + 1,
          collectionName: c.collectionName,
          documentTitle: c.documentTitle,
          excerpt: c.excerpt,
        }));

  return (
    <div className="rounded-lg border border-purple-500/35 bg-purple-500/10 overflow-hidden ring-1 ring-purple-500/20">
      <button
        type="button"
        className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-purple-500/15 transition-colors text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <Brain size={14} className="text-purple-300 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-medium text-purple-200">Company brain queried</p>
          <p className="text-[10px] text-purple-200/60 truncate">
            {citationCount > 0
              ? `${citationCount} policy source${citationCount === 1 ? "" : "s"}`
              : "No matching policy"}
            {policyPreview ? ` — ${policyPreview}` : ""}
          </p>
        </div>
        <span
          className={cn(
            "text-[9px] font-medium px-1.5 py-0.5 rounded shrink-0",
            palette.bg,
            palette.text,
          )}
        >
          {agentName}
        </span>
        <span className="text-[10px] text-white/20 shrink-0">{formatTime(timestampMs)}</span>
        <ChevronRight
          size={11}
          className={cn("text-purple-300/50 shrink-0 transition-transform", expanded && "rotate-90")}
        />
      </button>
      {expanded && (
        <div className="border-t border-purple-500/25 px-3 py-2 space-y-2">
          <p className="text-[10px] font-medium text-purple-100/90">
            Retrieved from ingested documents
          </p>
          {citationTitles.length > 0 && (
            <ul className="list-disc list-inside text-[10px] text-purple-100/80 space-y-0.5">
              {citationTitles.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          )}
          {sections.map((s, i) => (
            <div key={i} className="rounded border border-purple-500/20 bg-black/20 px-2 py-1.5">
              <p className="text-[10px] font-medium text-purple-200/90">
                {s.index != null ? `[${s.index}] ` : ""}
                {s.documentTitle ?? s.collectionName ?? "Policy excerpt"}
                {s.collectionName && s.documentTitle ? (
                  <span className="text-purple-200/50 font-normal"> · {s.collectionName}</span>
                ) : null}
              </p>
              {s.excerpt && (
                <pre className="text-[10px] text-white/55 mt-1 leading-relaxed whitespace-pre-wrap font-sans max-h-48 overflow-y-auto">
                  {s.excerpt}
                </pre>
              )}
            </div>
          ))}
          {citationCount === 0 && (
            <p className="text-[10px] text-amber-300/80">
              No policy chunks matched. Ingest documents in AI Brain and ensure this agent has brain.query scope.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function ToolCallCard({ entry }: { entry: ToolEntry }) {
  const [expanded, setExpanded] = useState(false);
  const ToolIcon = getToolIcon(entry.tool);
  const iconColor = getToolIconColor(entry.tool);
  const hasFrame = !!entry.frame;

  return (
    <div className="rounded-lg border border-white/8 bg-white/[0.02] overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/[0.04] transition-colors text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <ToolIcon size={12} className={cn(iconColor, "shrink-0")} />
        <span className="font-mono text-[11px] text-white/55 flex-1 min-w-0 truncate">
          {entry.tool}
        </span>
        <span
          className={cn(
            "text-[9px] font-medium px-1.5 py-0.5 rounded shrink-0",
            entry.palette.bg,
            entry.palette.text,
          )}
        >
          {entry.agentName}
        </span>
        {hasFrame && <Globe size={9} className="text-sky-400/50 shrink-0" />}
        <ChevronRight
          size={11}
          className={cn("text-white/20 shrink-0 transition-transform", expanded && "rotate-90")}
        />
      </button>

      {expanded && hasFrame && entry.frame && (
        <div className="border-t border-white/8 p-2 space-y-1.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`data:${entry.frame.mime};base64,${entry.frame.imageBase64}`}
            alt={entry.frame.label}
            className="w-full rounded border border-white/10 object-contain max-h-52"
          />
          {entry.frame.label && (
            <p className="text-[10px] text-white/30 px-0.5">{entry.frame.label}</p>
          )}
        </div>
      )}

      {expanded && !hasFrame && (
        <div className="border-t border-white/8 px-3 py-2">
          <p className="text-[10px] text-white/20">No browser frame captured for this tool.</p>
        </div>
      )}
    </div>
  );
}

function SubtaskCompletedCard({
  payload,
  agentName,
  palette,
  timestampMs,
  startTimestampMs,
}: {
  payload: Record<string, unknown>;
  agentName: string;
  palette: ColorPalette;
  timestampMs: number;
  startTimestampMs?: number;
}) {
  const summary = payload.summary as string | undefined;
  const duration = startTimestampMs ? formatDuration(timestampMs - startTimestampMs) : null;

  return (
    <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-emerald-500/15">
        <CheckCircle size={11} className="text-emerald-400 shrink-0" />
        <span className={cn("text-[10px] font-semibold", palette.text)}>{agentName}</span>
        <span className="text-[10px] text-emerald-500/60">completed</span>
        {duration && (
          <span className="text-[10px] text-white/20 ml-auto">{duration}</span>
        )}
        <span className="text-[10px] text-white/15 ml-1">{formatTime(timestampMs)}</span>
      </div>
      {summary && (
        <div className="px-3 py-2">
          <p className="text-[11px] text-white/40 leading-relaxed line-clamp-3">{summary}</p>
        </div>
      )}
    </div>
  );
}

function FinalResultCard({
  result,
  timestampMs,
}: {
  result: string;
  timestampMs: number;
}) {
  return (
    <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-emerald-500/15">
        <Star size={12} className="text-emerald-400 shrink-0" />
        <span className="text-[11px] font-semibold text-emerald-300">Final Result</span>
        <span className="text-[10px] text-white/15 ml-auto">{formatTime(timestampMs)}</span>
      </div>
      <div className="px-3 py-3">
        <p className="text-[12px] text-white/65 leading-relaxed whitespace-pre-wrap">{result}</p>
      </div>
    </div>
  );
}

function ArtifactItem({
  artifact,
  agentNameById,
}: {
  artifact: TeamRunArtifact;
  agentNameById: (id: string | null) => string;
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
    <div className="flex items-center justify-between gap-2 rounded-lg border border-white/8 bg-white/[0.02] px-3 py-2">
      <div className="min-w-0">
        <p className="text-[11px] font-medium text-white/55 truncate">{artifact.name}</p>
        <p className="text-[10px] text-white/20">{agentNameById(artifact.agentId)}</p>
      </div>
      <button
        type="button"
        onClick={download}
        className="shrink-0 rounded p-1 text-white/25 hover:text-white/60 hover:bg-white/8 transition-colors"
        title="Download"
      >
        <Download size={12} />
      </button>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface TeamRunViewProps {
  readonly team: TeamDTO;
  readonly onRunStarted?: (runId: string) => void;
}

export function TeamRunView({ team, onRunStarted }: TeamRunViewProps) {
  const [goal, setGoal] = useState("");
  const [run, setRun] = useState<TeamRunDTO | null>(null);
  const [events, setEvents] = useState<TeamRunEventDTO[]>([]);
  const [artifacts, setArtifacts] = useState<TeamRunArtifact[]>([]);
  const [finalResult, setFinalResult] = useState<string | null>(null);
  const [runStatus, setRunStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [injectionText, setInjectionText] = useState("");
  const [injecting, setInjecting] = useState(false);

  // Browser frames: agentId → frames[]
  const [browserFrames, setBrowserFrames] = useState<Record<string, BrowserFrame[]>>({});
  // Map from tool_finished event id → browser frame (arrives just after)
  const [toolFrames, setToolFrames] = useState<Record<string, BrowserFrame>>({});

  const streamCleanup = useRef<(() => void) | null>(null);
  const timelineBottomRef = useRef<HTMLDivElement>(null);
  const frameCounterRef = useRef(0);
  // Track the last tool_finished event id per agent to link browser_frame to it
  const pendingToolEventByAgent = useRef<Record<string, string>>({});

  // ── Agent list (stable order: supervisor first, then workers) ──────────────
  const allAgents = useMemo(() => {
    const list: Array<{
      agentId: string;
      name: string;
      role: "supervisor" | "worker";
      paletteIdx: number;
    }> = [];
    if (team.supervisorAgentId) {
      list.push({
        agentId: team.supervisorAgentId,
        name: team.supervisorAgent?.name ?? "Supervisor",
        role: "supervisor",
        paletteIdx: -1,
      });
    }
    (team.members ?? []).forEach((m, i) => {
      list.push({
        agentId: m.agentId,
        name: m.agent?.name ?? m.agentId.slice(0, 10),
        role: "worker",
        paletteIdx: i,
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

  const paletteById = useCallback(
    (id: string | null): ColorPalette => {
      if (!id) return SUPERVISOR_PALETTE;
      const ag = allAgents.find((a) => a.agentId === id);
      if (!ag) return WORKER_PALETTES[0];
      if (ag.role === "supervisor") return SUPERVISOR_PALETTE;
      return WORKER_PALETTES[ag.paletteIdx % WORKER_PALETTES.length];
    },
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

    for (const e of events) {
      const p = e.payload as Record<string, unknown>;
      const aid = e.agentId;

      if (e.eventType === "run_started" && team.supervisorAgentId) {
        const s = states.get(team.supervisorAgentId);
        if (s) states.set(team.supervisorAgentId, { ...s, state: "thinking", currentAction: "Planning subtasks…" });
      } else if (e.eventType === "supervisor_step" && aid) {
        const s = states.get(aid);
        if (s) {
          const step = p.step as string;
          states.set(aid, {
            ...s,
            state: "thinking",
            currentAction: step === "decompose" ? "Planning subtasks…" : "Synthesizing results…",
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
            currentAction: "Queried company brain",
            toolCount: s.toolCount + 1,
          });
        }
      } else if (e.eventType === "tool_called" && aid) {
        const s = states.get(aid);
        const tool = p.tool as string | undefined;
        const msg = p.message as string | undefined;
        if (s && tool && msg === "tool_finished") {
          if (tool === "brain.query") {
            states.set(aid, {
              ...s,
              state: "tool_active",
              currentTool: "brain.query",
              currentAction: "Queried company brain",
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
            states.set(team.supervisorAgentId, { ...sv, state: "thinking", currentAction: "Waiting for workers…" });
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
    for (const e of events) {
      const p = e.payload as Record<string, unknown>;
      const ts = parseTimestampMs(e.timestampMs);

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
              result.push({ kind: "tool_call", eventId: e.id, timestampMs: ts, tool, agentId: e.agentId ?? "" });
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
      }
    }
    return result;
  }, [events]);

  // ── All browser frames flat list for live view panel ──────────────────────
  const allBrowserFrames = useMemo(
    () => Object.values(browserFrames).flat(),
    [browserFrames],
  );

  const isRunning = runStatus === "running" || submitting;

  // ── Auto-scroll timeline ───────────────────────────────────────────────────
  useEffect(() => {
    timelineBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [processedEvents.length]);

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
  async function handleStart() {
    if (!goal.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    setEvents([]);
    setArtifacts([]);
    setFinalResult(null);
    setRunStatus(null);
    setBrowserFrames({});
    setToolFrames({});
    pendingToolEventByAgent.current = {};
    streamCleanup.current?.();

    try {
      const newRun = await startTeamRun(team.id, goal.trim());
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
        },
        onComplete: (data) => {
          setRunStatus(data.status);
          if (typeof data.result === "object" && data.result !== null) {
            const r = data.result as Record<string, unknown>;
            if (typeof r.synthesis === "string") setFinalResult(r.synthesis);
          }
        },
        onError: (msg) => {
          setError(msg);
          setRunStatus("failed");
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
      setError(err instanceof Error ? err.message : "Failed to cancel run");
    } finally {
      setCanceling(false);
    }
  }

  async function handleInject() {
    if (!run || !injectionText.trim() || injecting) return;
    setInjecting(true);
    try {
      await injectTeamRunMessage(team.id, run.id, injectionText.trim());
      setInjectionText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setInjecting(false);
    }
  }

  function handleNewRun() {
    streamCleanup.current?.();
    streamCleanup.current = null;
    setRun(null);
    setEvents([]);
    setArtifacts([]);
    setFinalResult(null);
    setRunStatus(null);
    setError(null);
    setBrowserFrames({});
    setToolFrames({});
    pendingToolEventByAgent.current = {};
  }

  // ── Empty / pre-run state ──────────────────────────────────────────────────
  if (!run && !submitting) {
    return (
      <div className="flex h-full flex-col">
        <div className="border-b border-white/8 px-6 py-5">
          <label className="block text-xs font-medium text-white/40 mb-2">
            What should this team accomplish?
          </label>
          <div className="flex gap-2 items-end">
            <textarea
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="Research the top 5 competitors in the AI agent market and summarize their pricing…"
              className="flex-1 resize-none rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2 text-sm text-white/75 placeholder-white/15 focus:outline-none focus:border-indigo-500/50 min-h-[72px]"
              rows={3}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void handleStart();
              }}
            />
            <button
              onClick={() => void handleStart()}
              disabled={!goal.trim()}
              className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium bg-indigo-600 hover:bg-indigo-500 text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <Play size={13} />
              Run
            </button>
          </div>
          <p className="mt-1.5 text-[10px] text-white/20">⌘+Enter to run</p>
        </div>

        <div className="flex-1 px-6 py-4 overflow-y-auto">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-white/25 mb-3">
            Team — {allAgents.length} agent{allAgents.length !== 1 ? "s" : ""}
          </p>
          <div className="grid grid-cols-2 gap-2">
            {allAgents.map((ag) => {
              const palette = ag.role === "supervisor" ? SUPERVISOR_PALETTE : WORKER_PALETTES[ag.paletteIdx % WORKER_PALETTES.length];
              return (
                <AgentCard
                  key={ag.agentId}
                  status={{ agentId: ag.agentId, name: ag.name, role: ag.role, state: "idle", toolCount: 0, tasksDone: 0 }}
                  palette={palette}
                  isActive={false}
                />
              );
            })}
          </div>
          {allAgents.length === 0 && (
            <p className="text-sm text-white/25 text-center mt-8">
              Add a supervisor and at least one worker to this team before running.
            </p>
          )}
        </div>
      </div>
    );
  }

  // ── Active / completed run: 3-column layout ────────────────────────────────
  return (
    <div className="flex h-full min-h-0 overflow-hidden">

      {/* ── LEFT: Agent roster ─────────────────────────────────────────────── */}
      <div className="w-[232px] shrink-0 flex flex-col border-r border-white/8 min-h-0">
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-white/8 shrink-0">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-white/30">
            Agents
          </span>
          {isRunning && <Loader2 size={11} className="animate-spin text-indigo-400" />}
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {allAgents.map((ag) => {
            const palette = ag.role === "supervisor" ? SUPERVISOR_PALETTE : WORKER_PALETTES[ag.paletteIdx % WORKER_PALETTES.length];
            const status = agentStates.get(ag.agentId) ?? {
              agentId: ag.agentId,
              name: ag.name,
              role: ag.role,
              state: "idle" as AgentState,
              toolCount: 0,
              tasksDone: 0,
            };
            const isActive = status.state === "thinking" || status.state === "tool_active";
            return (
              <AgentCard key={ag.agentId} status={status} palette={palette} isActive={isActive} />
            );
          })}
        </div>

        {/* Goal (read-only, collapsed at bottom) */}
        <div className="border-t border-white/8 px-3 py-2.5 shrink-0">
          <p className="text-[9px] font-semibold uppercase tracking-wider text-white/20 mb-1">Goal</p>
          <p className="text-[10px] text-white/35 leading-relaxed line-clamp-4">
            {run?.goal ?? goal}
          </p>
        </div>
      </div>

      {/* ── CENTER: Activity timeline ───────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-h-0 min-w-0">

        {/* Run status bar */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/8 shrink-0">
          {isRunning ? (
            <>
              <Loader2 size={12} className="animate-spin text-indigo-400" />
              <span className="text-xs text-indigo-300">Running…</span>
            </>
          ) : runStatus === "completed" ? (
            <>
              <CheckCircle size={12} className="text-emerald-400" />
              <span className="text-xs text-emerald-400">Completed</span>
            </>
          ) : runStatus === "failed" ? (
            <>
              <XCircle size={12} className="text-red-400" />
              <span className="text-xs text-red-400">Failed</span>
            </>
          ) : runStatus === "canceled" ? (
            <>
              <Square size={12} className="text-yellow-400" />
              <span className="text-xs text-yellow-400">Stopped</span>
            </>
          ) : null}

          <div className="flex-1" />

          {error && (
            <span className="text-[10px] text-red-400 truncate max-w-[180px]" title={error}>
              {error}
            </span>
          )}

          {isRunning && run && (
            <button
              onClick={() => void handleStop()}
              disabled={canceling}
              className="flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-40"
            >
              <Square size={10} />
              {canceling ? "Stopping…" : "Stop"}
            </button>
          )}

          {!isRunning && (
            <button
              onClick={handleNewRun}
              className="flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium border border-white/10 text-white/30 hover:text-white/60 hover:bg-white/5 transition-colors"
            >
              New run
            </button>
          )}
        </div>

        {/* Timeline scroll area */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 min-h-0">
          {processedEvents.map((ev) => {
            if (ev.kind === "run_started") {
              return <RunStartedCard key={ev.eventId} timestampMs={ev.timestampMs} />;
            }

            if (ev.kind === "supervisor_plan") {
              return (
                <SupervisorPlanCard
                  key={ev.eventId}
                  payload={ev.payload}
                  supervisorName={agentNameById(team.supervisorAgentId ?? null)}
                  timestampMs={ev.timestampMs}
                  agentNameById={agentNameById}
                  paletteById={paletteById}
                />
              );
            }

            if (ev.kind === "task_delegated") {
              const workerId = (ev.payload.agentId as string | undefined) ?? ev.agentId;
              return (
                <TaskDelegatedCard
                  key={ev.eventId}
                  payload={ev.payload}
                  supervisorName={agentNameById(team.supervisorAgentId ?? null)}
                  palette={paletteById(workerId ?? null)}
                  timestampMs={ev.timestampMs}
                />
              );
            }

            if (ev.kind === "brain_query") {
              return (
                <BrainQueryCard
                  key={ev.eventId}
                  agentName={agentNameById(ev.agentId)}
                  palette={paletteById(ev.agentId)}
                  timestampMs={ev.timestampMs}
                  citationCount={ev.citationCount}
                  policyPreview={ev.policyPreview}
                  citationTitles={ev.citationTitles}
                  citations={ev.citations}
                  contextSections={ev.contextSections}
                />
              );
            }

            if (ev.kind === "tool_call") {
              const entry: ToolEntry = {
                eventId: ev.eventId,
                tool: ev.tool,
                agentId: ev.agentId,
                agentName: agentNameById(ev.agentId),
                palette: paletteById(ev.agentId),
                frame: toolFrames[ev.eventId],
                timestampMs: ev.timestampMs,
              };
              return <ToolCallCard key={ev.eventId} entry={entry} />;
            }

            if (ev.kind === "subtask_completed") {
              const agentId = (ev.payload.agentId as string | undefined) ?? ev.agentId;
              return (
                <SubtaskCompletedCard
                  key={ev.eventId}
                  payload={ev.payload}
                  agentName={agentNameById(agentId ?? null)}
                  palette={paletteById(agentId ?? null)}
                  timestampMs={ev.timestampMs}
                  startTimestampMs={agentId ? delegationTimestamps.get(agentId) : undefined}
                />
              );
            }

            if (ev.kind === "run_result" && finalResult) {
              return <FinalResultCard key={ev.eventId} result={finalResult} timestampMs={ev.timestampMs} />;
            }

            if (ev.kind === "run_failed_event") {
              return (
                <div
                  key={ev.eventId}
                  className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2.5"
                >
                  <XCircle size={12} className="text-red-400 shrink-0" />
                  <p className="text-[11px] text-red-300">{ev.error}</p>
                </div>
              );
            }

            if (ev.kind === "user_injection") {
              return (
                <div
                  key={ev.eventId}
                  className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2.5"
                >
                  <MessageSquare size={11} className="text-amber-400 shrink-0 mt-0.5" />
                  <p className="text-[11px] text-amber-200/80">{ev.message}</p>
                </div>
              );
            }

            if (ev.kind === "result_delivered") {
              return (
                <div
                  key={ev.eventId}
                  className={cn(
                    "flex items-center gap-2 rounded-lg border px-3 py-2.5",
                    ev.sent
                      ? "border-emerald-500/20 bg-emerald-500/5"
                      : "border-amber-500/20 bg-amber-500/5",
                  )}
                >
                  <Phone size={11} className={cn("shrink-0", ev.sent ? "text-emerald-400" : "text-amber-400")} />
                  <p className={cn("text-[11px]", ev.sent ? "text-emerald-200/80" : "text-amber-200/80")}>
                    {ev.sent
                      ? "Result sent to WhatsApp (check your linked device — may appear in “Message yourself”)"
                      : `WhatsApp delivery failed${ev.reason ? `: ${ev.reason}` : ""}`}
                  </p>
                </div>
              );
            }

            return null;
          })}

          {/* Live "thinking" indicator */}
          {isRunning && (
            <div className="flex items-center gap-2 py-1 pl-0.5">
              <span className="size-1 rounded-full bg-indigo-400 animate-bounce [animation-delay:0ms]" />
              <span className="size-1 rounded-full bg-indigo-400 animate-bounce [animation-delay:150ms]" />
              <span className="size-1 rounded-full bg-indigo-400 animate-bounce [animation-delay:300ms]" />
              <span className="text-[10px] text-white/20 ml-0.5">Working…</span>
            </div>
          )}

          <div ref={timelineBottomRef} />
        </div>

        {/* Guidance input — visible while run is active */}
        {isRunning && run && (
          <div className="shrink-0 border-t border-white/8 px-3 py-2 flex items-center gap-2">
            <input
              value={injectionText}
              onChange={(e) => setInjectionText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleInject(); } }}
              placeholder="Guide the agent… (e.g. skip login, use this URL instead)"
              className="flex-1 rounded-md border border-white/8 bg-white/[0.03] px-2.5 py-1.5 text-[12px] text-white/70 placeholder-white/20 focus:outline-none focus:border-amber-500/40 min-w-0"
              disabled={injecting}
            />
            <button
              onClick={() => void handleInject()}
              disabled={!injectionText.trim() || injecting}
              className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[11px] font-medium bg-amber-600/80 hover:bg-amber-500/80 text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
            >
              {injecting ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
            </button>
          </div>
        )}
      </div>

      {/* ── RIGHT: Output panel ─────────────────────────────────────────────── */}
      <div className="w-[272px] shrink-0 flex flex-col border-l border-white/8 min-h-0">

        {/* Live browser view */}
        {allBrowserFrames.length > 0 && (
          <div className="shrink-0 border-b border-white/8">
            <AgentBrowserLiveView
              frames={allBrowserFrames}
              active={isRunning}
              className="border-0"
            />
          </div>
        )}

        {/* No browser yet, show placeholder when running */}
        {allBrowserFrames.length === 0 && isRunning && (
          <div className="shrink-0 border-b border-white/8 px-3 py-4 flex flex-col items-center gap-2">
            <Globe size={18} className="text-white/10" />
            <p className="text-[10px] text-white/20 text-center">
              Browser frames appear here when an agent navigates the web
            </p>
          </div>
        )}

        {/* Artifacts */}
        {artifacts.length > 0 && (
          <div className="shrink-0 border-b border-white/8">
            <div className="flex items-center gap-1.5 px-3 py-2 border-b border-white/8">
              <FileText size={11} className="text-white/30" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-white/30">
                Artifacts ({artifacts.length})
              </span>
            </div>
            <div className="p-2 space-y-1.5 max-h-44 overflow-y-auto">
              {artifacts.map((a, i) => (
                <ArtifactItem key={`${a.id}-${i}`} artifact={a} agentNameById={agentNameById} />
              ))}
            </div>
          </div>
        )}

        {/* Right panel empty state (before anything arrives) */}
        {allBrowserFrames.length === 0 && artifacts.length === 0 && !isRunning && (
          <div className="flex-1 flex items-center justify-center px-4">
            <p className="text-[10px] text-white/15 text-center leading-relaxed">
              Browser activity and artifacts produced by agents appear here
            </p>
          </div>
        )}

        {/* Spacer when there IS content but right panel still has room */}
        {(allBrowserFrames.length > 0 || artifacts.length > 0) && <div className="flex-1" />}
      </div>
    </div>
  );
}
