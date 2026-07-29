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
  ChevronDown,
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
import { SketchBox, SketchRow, sketchButton, sketchInput, sketchLabel } from "@/components/qlix/sketch";
import { LeadReviewCard } from "@/components/qlix/teams/LeadReviewCard";

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
  actionLabel?: string;
  timestampMs: number;
}

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

// ─── Constants ────────────────────────────────────────────────────────────────

const SKETCH_PALETTE: ColorPalette = {
  bg: "bg-white",
  text: "text-black",
  border: "border-black",
};

const SUPERVISOR_PALETTE = SKETCH_PALETTE;
const WORKER_PALETTES: ColorPalette[] = [SKETCH_PALETTE];

const STATE_DOT: Record<AgentState, string> = {
  idle: "bg-black/20",
  thinking: "bg-black/50 animate-pulse",
  tool_active: "bg-black/70 animate-pulse",
  completed: "bg-black",
  failed: "bg-black/30",
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

function getToolIconColor(_tool: string): string {
  return "text-black/60";
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
    <SketchBox
      className={cn(
        "px-3 py-2.5 transition-all duration-300",
        isActive && status.state !== "completed" && status.state !== "failed" && "border-2",
      )}
    >
      <div className="mb-1.5 flex items-center gap-2">
        <div
          className={cn(
            "flex size-7 shrink-0 items-center justify-center border border-black text-[11px] font-bold",
            palette.bg,
            palette.text,
          )}
        >
          {status.name.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-medium text-black">{status.name}</p>
          <p className={cn("text-[9px] font-semibold uppercase tracking-wider text-black/50", palette.text)}>
            {status.role}
          </p>
        </div>
        <div className={cn("size-2 shrink-0 rounded-full", STATE_DOT[status.state])} />
      </div>

      <div className="flex min-w-0 items-center gap-1.5">
        {ToolIcon && status.state === "tool_active" && (
          <ToolIcon size={10} className={toolColor} />
        )}
        <p className="truncate text-[10px] text-black/50">
          {status.state === "tool_active"
            ? status.currentAction ?? status.currentTool ?? STATE_LABEL[status.state]
            : status.currentAction ?? STATE_LABEL[status.state]}
        </p>
      </div>

      {(status.toolCount > 0 || status.tasksDone > 0) && (
        <div className="mt-1.5 flex gap-3">
          {status.toolCount > 0 && (
            <span className="text-[9px] text-black/40">{status.toolCount} tools</span>
          )}
          {status.tasksDone > 0 && (
            <span className="text-[9px] text-black/50">{status.tasksDone} done</span>
          )}
        </div>
      )}
    </SketchBox>
  );
}

// ─── Timeline cards ───────────────────────────────────────────────────────────

function RunStartedCard({ timestampMs }: { timestampMs: number }) {
  return (
    <div className="flex items-center gap-2.5 py-0.5">
      <div className="size-1.5 shrink-0 rounded-full bg-black/30" />
      <span className="text-[10px] text-black/50">Run started</span>
      <span className="text-[10px] text-black/30">{formatTime(timestampMs)}</span>
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
    <SketchBox className="overflow-hidden">
      <div className="flex items-center gap-2 border-b border-black px-3 py-2">
        <Brain size={12} className="shrink-0 text-black" />
        <span className="text-[11px] font-medium text-black">{supervisorName}</span>
        <span className="ml-1 text-[10px] text-black/40">planned {subtasks.length} subtask{subtasks.length !== 1 ? "s" : ""}</span>
        <span className="ml-auto text-[10px] text-black/30">{formatTime(timestampMs)}</span>
      </div>
      {subtasks.length > 0 && (
        <div className="space-y-2 px-3 py-2.5">
          {subtasks.map((st, i) => {
            const palette = paletteById(st.agentId ?? null);
            return (
              <div key={st.subtaskId ?? i} className="flex items-start gap-2">
                <ArrowRight size={10} className={cn("mt-0.5 shrink-0 text-black/50", palette.text)} />
                <div className="min-w-0">
                  <span className={cn("text-[10px] font-medium text-black", palette.text)}>
                    {agentNameById(st.agentId ?? null)}
                  </span>
                  <p className="mt-0.5 text-[10px] leading-relaxed text-black/50">{st.goal}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </SketchBox>
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
    <SketchBox className="overflow-hidden">
      <div className="flex items-center gap-2 border-b border-black px-3 py-1.5">
        <span className="text-[10px] text-black/50">{supervisorName}</span>
        <ArrowRight size={10} className="shrink-0 text-black/50" />
        <span className="text-[10px] font-semibold text-black">{agentName}</span>
        <span className="ml-auto text-[10px] text-black/30">{formatTime(timestampMs)}</span>
      </div>
      {goal && (
        <div className="px-3 py-2">
          <p className="text-[11px] leading-relaxed text-black/60">{goal}</p>
        </div>
      )}
    </SketchBox>
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
    <SketchBox className="overflow-hidden">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-black/5"
        onClick={() => setExpanded((v) => !v)}
      >
        <Brain size={14} className="shrink-0 text-black" />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium text-black">Company brain queried</p>
          <p className="truncate text-[10px] text-black/50">
            {citationCount > 0
              ? `${citationCount} policy source${citationCount === 1 ? "" : "s"}`
              : "No matching policy"}
            {policyPreview ? ` — ${policyPreview}` : ""}
          </p>
        </div>
        <span className="shrink-0 border border-black px-1.5 py-0.5 text-[9px] font-medium text-black">
          {agentName}
        </span>
        <span className="shrink-0 text-[10px] text-black/30">{formatTime(timestampMs)}</span>
        <ChevronRight
          size={11}
          className={cn("shrink-0 text-black/40 transition-transform", expanded && "rotate-90")}
        />
      </button>
      {expanded && (
        <div className="space-y-2 border-t border-black px-3 py-2">
          <p className="text-[10px] font-medium text-black">
            Retrieved from ingested documents
          </p>
          {citationTitles.length > 0 && (
            <ul className="list-inside list-disc space-y-0.5 text-[10px] text-black/70">
              {citationTitles.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          )}
          {sections.map((s, i) => (
            <SketchBox key={i} className="px-2 py-1.5">
              <p className="text-[10px] font-medium text-black">
                {s.index != null ? `[${s.index}] ` : ""}
                {s.documentTitle ?? s.collectionName ?? "Policy excerpt"}
                {s.collectionName && s.documentTitle ? (
                  <span className="font-normal text-black/50"> · {s.collectionName}</span>
                ) : null}
              </p>
              {s.excerpt && (
                <pre className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap font-sans text-[10px] leading-relaxed text-black/60">
                  {s.excerpt}
                </pre>
              )}
            </SketchBox>
          ))}
          {citationCount === 0 && (
            <p className="text-[10px] text-black/60">
              No policy chunks matched. Ingest documents in AI Brain and ensure this agent has brain.query scope.
            </p>
          )}
        </div>
      )}
    </SketchBox>
  );
}

function ToolCallCard({ entry }: { entry: ToolEntry }) {
  const [expanded, setExpanded] = useState(false);
  const ToolIcon = getToolIcon(entry.tool);
  const iconColor = getToolIconColor(entry.tool);
  const hasFrame = !!entry.frame;
  const intent =
    entry.actionLabel ??
    entry.frame?.label ??
    formatToolId(entry.tool).short;

  return (
    <SketchBox className="overflow-hidden">
      <button
        type="button"
        className="flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-black/5"
        onClick={() => setExpanded((v) => !v)}
      >
        <ToolIcon size={12} className={cn(iconColor, "mt-0.5 shrink-0")} />
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-medium leading-snug text-black/80">{intent}</span>
          <span className="mt-0.5 block truncate font-mono text-[9px] text-black/40">{entry.tool}</span>
        </span>
        <span className="shrink-0 border border-black px-1.5 py-0.5 text-[9px] font-medium text-black">
          {entry.agentName}
        </span>
        {hasFrame && <Globe size={9} className="shrink-0 text-black/40" />}
        <ChevronRight
          size={11}
          className={cn("shrink-0 text-black/30 transition-transform", expanded && "rotate-90")}
        />
      </button>

      {expanded && hasFrame && entry.frame && (
        <div className="space-y-1.5 border-t border-black p-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`data:${entry.frame.mime};base64,${entry.frame.imageBase64}`}
            alt={entry.frame.label}
            className="max-h-52 w-full border border-black object-contain"
          />
          {entry.frame.label && (
            <p className="px-0.5 text-[10px] text-black/50">{entry.frame.label}</p>
          )}
        </div>
      )}

      {expanded && !hasFrame && (
        <div className="border-t border-black px-3 py-2">
          <p className="text-[10px] text-black/40">No browser frame captured for this tool.</p>
        </div>
      )}
    </SketchBox>
  );
}

type ThinkingStep = TeamReasoningStep;

function ThinkingGroupCard({
  steps,
  running,
  isThinking,
  activeLabel,
}: {
  steps: ThinkingStep[];
  running: boolean;
  isThinking: boolean;
  activeLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const showLiveThinking = running && isThinking;

  if (steps.length === 0 && !showLiveThinking) return null;

  const lastIdx = steps.length - 1;
  const headerLabel = showLiveThinking ? "Thinking" : "Reasoning";
  const summary =
    showLiveThinking && activeLabel
      ? activeLabel
      : showLiveThinking
        ? "Working through the next step…"
        : steps.length > 0
          ? `${steps.length} step${steps.length === 1 ? "" : "s"}`
          : undefined;

  return (
    <SketchBox className="overflow-hidden">
      <button
        type="button"
        className="flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-black/5"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {showLiveThinking ? (
          <Loader2 size={11} className="mt-0.5 shrink-0 animate-spin text-black/50" />
        ) : (
          <Brain size={11} className="mt-0.5 shrink-0 text-black/50" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-medium text-black">{headerLabel}</span>
          {!open && summary ? (
            <span className="mt-0.5 block truncate text-[10px] text-black/45">{summary}</span>
          ) : null}
        </span>
        <ChevronDown
          size={11}
          className={cn("mt-0.5 shrink-0 text-black/40 transition-transform", open && "rotate-180")}
        />
      </button>
      {open && steps.length > 0 && (
        <div className="relative max-h-40 overflow-y-auto overscroll-contain border-t border-black px-3 py-2">
          <span
            className="pointer-events-none absolute bottom-2 left-3 top-2 w-px bg-black/15"
            aria-hidden
          />
          <div className="space-y-1 pl-3">
            {steps.map((s, i) => {
              const active = running && i === lastIdx;
              const Icon =
                s.tone === "error"
                  ? XCircle
                  : s.category
                    ? toolCategoryIcon(s.category)
                    : Brain;
              return (
                <div
                  key={s.id}
                  className={cn(
                    "flex items-start gap-1.5 text-[10px] leading-snug",
                    active ? "text-black/75" : "text-black/45",
                  )}
                >
                  <Icon size={10} className="mt-0.5 shrink-0" />
                  <span className="min-w-0 flex-1">
                    {s.label}
                    {s.detail && s.detail !== s.toolId ? (
                      <span className="text-black/40"> · {s.detail}</span>
                    ) : null}
                    {s.agentName ? (
                      <span className="ml-1 border border-black/20 px-1 py-px text-[9px] text-black/50">
                        {s.agentName}
                      </span>
                    ) : null}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {open && steps.length === 0 && showLiveThinking && (
        <div className="border-t border-black px-3 py-2">
          <p className="text-[10px] text-black/45">Waiting for the model…</p>
        </div>
      )}
    </SketchBox>
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
    <SketchBox className="overflow-hidden">
      <div className="flex items-center gap-2 border-b border-black px-3 py-1.5">
        <CheckCircle size={11} className="shrink-0 text-black" />
        <span className="text-[10px] font-semibold text-black">{agentName}</span>
        <span className="text-[10px] text-black/50">completed</span>
        {duration && (
          <span className="ml-auto text-[10px] text-black/30">{duration}</span>
        )}
        <span className="ml-1 text-[10px] text-black/30">{formatTime(timestampMs)}</span>
      </div>
      {summary && (
        <div className="px-3 py-2">
          <p className="line-clamp-3 text-[11px] leading-relaxed text-black/60">{summary}</p>
        </div>
      )}
    </SketchBox>
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
    <SketchBox className="overflow-hidden">
      <div className="flex items-center gap-2 border-b border-black px-3 py-2">
        <Star size={12} className="shrink-0 text-black" />
        <span className="text-[11px] font-semibold text-black">Final Result</span>
        <span className="ml-auto text-[10px] text-black/30">{formatTime(timestampMs)}</span>
      </div>
      <div className="px-3 py-3">
        <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-black/80">{result}</p>
      </div>
    </SketchBox>
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
    <SketchRow className="flex items-center justify-between gap-2 border-black">
      <div className="min-w-0">
        <p className="truncate text-[11px] font-medium text-black">{artifact.name}</p>
        <p className="text-[10px] text-black/40">{agentNameById(artifact.agentId)}</p>
      </div>
      <button
        type="button"
        onClick={download}
        className={`${sketchButton} shrink-0 p-1`}
        title="Download"
      >
        <Download size={12} />
      </button>
    </SketchRow>
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
  const [leadReviewCampaignId, setLeadReviewCampaignId] = useState<string | null>(null);
  const [leadReviewApproved, setLeadReviewApproved] = useState(false);

  // Browser frames: agentId → frames[]
  const [browserFrames, setBrowserFrames] = useState<Record<string, BrowserFrame[]>>({});
  // Map from tool_finished event id → browser frame (arrives just after)
  const [toolFrames, setToolFrames] = useState<Record<string, BrowserFrame>>({});
  const [mobilePane, setMobilePane] = useState<"agents" | "timeline" | "tools">("timeline");

  const streamCleanup = useRef<(() => void) | null>(null);
  const timelineScrollRef = useRef<HTMLDivElement>(null);
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

  // ── Auto-scroll timeline (contained — does not scroll the page) ─────────────
  useEffect(() => {
    const el = timelineScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [processedEvents.length, reasoningSteps.length, isAgentThinking, isRunning]);

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
    setLeadReviewCampaignId(null);
    setLeadReviewApproved(false);
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
        setGoal(detail.run.goal);
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

  // ── Empty / pre-run state ──────────────────────────────────────────────────
  if (!run && !submitting) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white">
        <div className="border-b border-black px-6 py-5">
          <label className={`${sketchLabel} mb-2 block normal-case`}>
            What should this team accomplish?
          </label>
          <div className="flex items-end gap-2">
            <textarea
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="Research the top 5 competitors in the AI agent market and summarize their pricing…"
              className={`${sketchInput} min-h-[72px] flex-1 resize-none`}
              rows={3}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void handleStart();
              }}
            />
            <button
              type="button"
              onClick={() => void handleStart()}
              disabled={!goal.trim()}
              className={`${sketchButton} gap-1.5 disabled:cursor-not-allowed disabled:opacity-30`}
            >
              <Play size={13} />
              Run
            </button>
          </div>
          <p className="mt-1.5 text-[10px] text-black/40">⌘+Enter to run</p>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <p className={`${sketchLabel} mb-3`}>
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
            <p className="mt-8 text-center text-sm text-black/50">
              Add a supervisor and at least one worker to this team before running.
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-white md:flex-row">
      <div
        className="flex shrink-0 border-b border-black md:hidden"
        role="tablist"
        aria-label="Run panels"
      >
        {(
          [
            ["agents", "Agents"],
            ["timeline", "Timeline"],
            ["tools", "Tools"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={mobilePane === id}
            onClick={() => setMobilePane(id)}
            className={cn(
              "flex-1 px-2 py-2.5 font-serif text-[10px] uppercase tracking-widest transition-colors",
              mobilePane === id
                ? "bg-black text-white"
                : "bg-white text-black hover:bg-black/5",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div
        className={cn(
          "min-h-0 w-full shrink-0 flex-col overflow-hidden border-r border-black md:flex md:w-[232px]",
          mobilePane === "agents" ? "flex flex-1 md:flex-none" : "hidden",
        )}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-black px-3 py-2.5">
          <span className={sketchLabel}>Agents</span>
          {isRunning && <Loader2 size={11} className="animate-spin text-black" />}
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto p-3">
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

        <div className="shrink-0 border-t border-black px-3 py-2.5">
          <p className={`${sketchLabel} mb-1 text-[9px]`}>Goal</p>
          <p className="line-clamp-4 text-[10px] leading-relaxed text-black/60">
            {run?.goal ?? goal}
          </p>
        </div>
      </div>

      <div
        className={cn(
          "min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
          mobilePane === "timeline" ? "flex" : "hidden md:flex",
        )}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-black px-3 py-2.5 sm:px-4">
          {isRunning ? (
            <>
              <Loader2 size={12} className="animate-spin text-black" />
              <span className="text-xs text-black">Running…</span>
            </>
          ) : isPaused ? (
            <>
              <Mail size={12} className="text-black" />
              <span className="text-xs text-black">Awaiting lead review</span>
            </>
          ) : runStatus === "completed" ? (
            <>
              <CheckCircle size={12} className="text-black" />
              <span className="text-xs text-black">Completed</span>
            </>
          ) : runStatus === "failed" ? (
            <>
              <XCircle size={12} className="text-black" />
              <span className="text-xs text-black">Failed</span>
            </>
          ) : runStatus === "canceled" ? (
            <>
              <Square size={12} className="text-black" />
              <span className="text-xs text-black">Stopped</span>
            </>
          ) : null}

          <div className="flex-1" />

          {error && (
            <span className="max-w-[180px] truncate text-[10px] text-black" title={error}>
              {error}
            </span>
          )}

          {isRunning && run && (
            <button
              type="button"
              onClick={() => void handleStop()}
              disabled={canceling}
              className={`${sketchButton} gap-1 py-1 text-[10px] disabled:opacity-40`}
            >
              <Square size={10} />
              {canceling ? "Stopping…" : "Stop"}
            </button>
          )}

          {isPaused && run && (
            <button
              type="button"
              onClick={() => void handleStop()}
              disabled={canceling}
              className={`${sketchButton} gap-1 py-1 text-[10px] disabled:opacity-40`}
            >
              <Square size={10} />
              {canceling ? "Stopping…" : "Cancel"}
            </button>
          )}

          {!isRunning && !isPaused && (
            <button type="button" onClick={handleNewRun} className={`${sketchButton} gap-1 py-1 text-[10px]`}>
              New run
            </button>
          )}
        </div>

        {(reasoningSteps.length > 0 || (isRunning && isAgentThinking)) && (
          <div className="shrink-0 border-b border-black px-4 py-2">
            <ThinkingGroupCard
              steps={reasoningSteps}
              running={isRunning}
              isThinking={isAgentThinking}
              activeLabel={reasoningActiveLabel}
            />
          </div>
        )}

        <div
          ref={timelineScrollRef}
          className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-4 py-3"
        >
          {processedEvents.map((ev) => {
            if (ev.kind === "lead_review") {
              return null;
            }
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
                actionLabel: ev.actionLabel ?? toolFrames[ev.eventId]?.label,
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
                <SketchBox key={ev.eventId} className="flex items-center gap-2 px-3 py-2.5">
                  <XCircle size={12} className="shrink-0 text-black" />
                  <p className="text-[11px] text-black">{ev.error}</p>
                </SketchBox>
              );
            }

            if (ev.kind === "user_injection") {
              return (
                <SketchBox key={ev.eventId} className="flex items-start gap-2 px-3 py-2.5">
                  <MessageSquare size={11} className="mt-0.5 shrink-0 text-black" />
                  <p className="text-[11px] text-black/70">{ev.message}</p>
                </SketchBox>
              );
            }

            if (ev.kind === "result_delivered") {
              return (
                <SketchBox key={ev.eventId} className="flex items-center gap-2 px-3 py-2.5">
                  <Phone size={11} className="shrink-0 text-black" />
                  <p className="text-[11px] text-black/70">
                    {ev.sent
                      ? "Result sent to WhatsApp (check your linked device — may appear in “Message yourself”)"
                      : `WhatsApp delivery failed${ev.reason ? `: ${ev.reason}` : ""}`}
                  </p>
                </SketchBox>
              );
            }

            return null;
          })}
        </div>

        {isRunning && run && !isPaused && (
          <div className="flex shrink-0 items-center gap-2 border-t border-black px-3 py-2">
            <input
              value={injectionText}
              onChange={(e) => setInjectionText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleInject(); } }}
              placeholder="Guide the agent… (e.g. skip login, use this URL instead)"
              className={`${sketchInput} min-w-0 flex-1 py-1.5 text-[12px]`}
              disabled={injecting}
            />
            <button
              type="button"
              onClick={() => void handleInject()}
              disabled={!injectionText.trim() || injecting}
              className={`${sketchButton} shrink-0 gap-1 py-1.5 text-[11px] disabled:cursor-not-allowed disabled:opacity-30`}
            >
              {injecting ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
            </button>
          </div>
        )}

        {run && leadReviewState.campaignId && isPaused && !leadReviewState.approved && (
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
        )}
      </div>

      <div
        className={cn(
          "min-h-0 w-full shrink-0 flex-col overflow-hidden border-l border-black md:flex md:w-[272px]",
          mobilePane === "tools" ? "flex flex-1 md:flex-none" : "hidden",
        )}
      >
        {(allBrowserFrames.length > 0 || liveBrowserAction) && (
          <div className="max-h-[min(240px,38vh)] shrink-0 overflow-hidden border-b border-black">
            <AgentBrowserLiveView
              frames={allBrowserFrames}
              active={isRunning}
              compact
              actionHint={liveBrowserAction?.label ?? allBrowserFrames.at(-1)?.label}
              className="h-full max-h-[min(240px,38vh)] border-0"
            />
          </div>
        )}

        {allBrowserFrames.length === 0 && isRunning && (
          <div className="flex shrink-0 flex-col gap-1 border-b border-black px-3 py-3">
            <Globe size={18} className="text-black/20" />
            {liveBrowserAction ? (
              <>
                <p className="text-[10px] font-medium text-black/70">{liveBrowserAction.agentName}</p>
                <p className="text-[10px] leading-snug text-black/55">{liveBrowserAction.label}</p>
              </>
            ) : (
              <p className="text-center text-[10px] text-black/40">
                Browser frames appear here when an agent navigates the web
              </p>
            )}
          </div>
        )}

        {artifacts.length > 0 && (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex shrink-0 items-center gap-1.5 border-b border-black px-3 py-2">
              <FileText size={11} className="text-black/50" />
              <span className={sketchLabel}>
                Artifacts ({artifacts.length})
              </span>
            </div>
            <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto overscroll-contain p-2">
              {artifacts.map((a, i) => (
                <ArtifactItem key={`${a.id}-${i}`} artifact={a} agentNameById={agentNameById} />
              ))}
            </div>
          </div>
        )}

        {allBrowserFrames.length === 0 && artifacts.length === 0 && !isRunning && (
          <div className="flex min-h-0 flex-1 items-center justify-center px-4">
            <p className="text-center text-[10px] leading-relaxed text-black/30">
              Browser activity and artifacts produced by agents appear here
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
