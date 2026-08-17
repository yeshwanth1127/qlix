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
  Brain,
  CheckCircle,
  ChevronDown,
  Download,
  FileText,
  Globe,
  Loader2,
  Mail,
  MessageSquarePlus,
  Paperclip,
  PanelLeft,
  Phone,
  RotateCw,
  Search,
  Send,
  ShieldCheck,
  ShieldAlert,
  Square,
  Table2,
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
  listTeamRunPendingJit,
  listTeamRuns,
  setTeamRunWaitTtl,
  startTeamRun,
  streamTeamRun,
  TeamRunStartError,
  TEAM_INTENT_CLARIFICATION_CODE,
  type TeamDTO,
  type TeamRunDTO,
  type TeamRunEventDTO,
  type TeamRunArtifact,
  type ChatAttachmentChip,
  type TeamRunPendingJit,
} from "@/lib/teams-api";
import { decideJit, isSessionChatJitScope } from "@/lib/jit-api";
import { JitApprovalCard } from "@/components/qlix/agents/JitApprovalCard";
import {
  buildTeamRunModelGroups,
  fetchModelCatalog,
  formatModelOptionLabel,
  type ModelCatalogEntry,
  type ReasoningEffort,
} from "@/lib/agents-api";
import { ReasoningEffortPicker } from "@/components/qlix/agents/ReasoningEffortPicker";
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
import { sketchButtonPrimary } from "@/components/qlix/sketch";
import { AgentMessageContent } from "@/components/qlix/agents/AgentMessageContent";
import {
  TeamRunGraph,
  type AgentState as GraphAgentState,
  type AgentStatus as GraphAgentStatus,
} from "@/components/qlix/teams/TeamRunGraph";
import { LiveArtifactPanel } from "@/components/qlix/teams/LiveArtifactPanel";
import {
  liveArtifactFromCheckpoint,
  liveArtifactFromEventPayload,
  mergeLiveArtifact,
  replayLiveArtifactFromEvents,
  type LiveArtifactPreview,
} from "@/components/qlix/teams/liveArtifactState";
import {
  conversationRunsFor,
  conversationTitle,
  groupTeamConversations,
  type TeamConversation,
} from "@/components/qlix/teams/teamConversations";

// ─── Types ────────────────────────────────────────────────────────────────────

/** Agent state shape lives with the graph so both views render the same contract. */
type AgentState = GraphAgentState;
type AgentStatus = GraphAgentStatus;

type RunViewMode = "chat" | "graph";

type ProcessedEvent =
  | { kind: "run_started"; eventId: string; timestampMs: number }
  | { kind: "supervisor_plan"; eventId: string; timestampMs: number; payload: Record<string, unknown> }
  | { kind: "task_delegated"; eventId: string; timestampMs: number; payload: Record<string, unknown>; agentId: string | null }
  | {
      kind: "tool_call";
      eventId: string;
      timestampMs: number;
      tool: string;
      agentId: string;
      actionLabel?: string;
      status: "running" | "done" | "error";
      sources?: Array<{ url: string; title?: string }>;
    }
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
  | {
      kind: "status_step";
      eventId: string;
      timestampMs: number;
      agentId: string;
      label: string;
      status: "done" | "error" | "retry";
      detail?: string;
    }
  | {
      kind: "jit_pending";
      eventId: string;
      timestampMs: number;
      agentId: string;
      label: string;
      detail?: string;
      jitRequestId?: string;
      jitChannel: "dashboard" | "whatsapp";
      jitScope: string;
      jitContext?: string;
      jitWhatsappExpected?: boolean;
      jitWhatsappStatus?: "disconnected" | "not_linked";
    }
  | {
      kind: "jit_resolved";
      eventId: string;
      timestampMs: number;
      agentId: string;
      label: string;
      detail?: string;
      decision: "approved" | "denied" | "expired";
    }
  | { kind: "subtask_completed"; eventId: string; timestampMs: number; payload: Record<string, unknown>; agentId: string | null }
  | { kind: "run_result"; eventId: string; timestampMs: number; synthesis?: string }
  | { kind: "run_failed_event"; eventId: string; timestampMs: number; error: string }
  | { kind: "wait_armed"; eventId: string; timestampMs: number; reason: string; contactCount: number }
  | {
      kind: "wait_ttl_requested";
      eventId: string;
      timestampMs: number;
      reason: string;
      optionsHours: number[];
      allowCustom: boolean;
      runId: string;
    }
  | { kind: "wait_ttl_set"; eventId: string; timestampMs: number; hours: number; expiresAt: string }
  | {
      kind: "wait_progress";
      eventId: string;
      timestampMs: number;
      received: number;
      remaining: number;
      total: number;
      phase?: string;
      reason?: string;
      sent?: number;
      failed?: number;
    }
  | {
      kind: "live_artifact_updated";
      eventId: string;
      timestampMs: number;
      url: string;
      rowCount: number;
      jid: string;
      interest: string;
    }
  | { kind: "wait_fulfilled"; eventId: string; timestampMs: number; responderCount: number; continuePipeline: boolean; interestSummary?: { interested: number; notInterested: number; unclear: number; included: number } }
  | { kind: "wait_expired"; eventId: string; timestampMs: number; reason: string }
  | { kind: "user_injection"; eventId: string; timestampMs: number; message: string; attachments?: ChatAttachmentChip[] }
  | { kind: "clarification"; eventId: string; timestampMs: number; question: string; userMessage: string }
  | { kind: "result_delivered"; eventId: string; timestampMs: number; sent: boolean; reason?: string; boundary?: string; channel?: string }
  | { kind: "outbound_blocked"; eventId: string; timestampMs: number; message: string };

const TEAM_CHAT_MAX_FILES = 10;
const TEAM_CHAT_MAX_FILE_MB = 50;
const TEAM_CHAT_MAX_FILE_BYTES = TEAM_CHAT_MAX_FILE_MB * 1024 * 1024;
const TEAM_CHAT_FILE_ACCEPT =
  ".pdf,.doc,.docx,.docm,.ppt,.pptx,.pptm,.pps,.ppsx,.xls,.xlsx,.xlsm,.xlsb,.odt,.ods,.odp,.epub,.rtf,.txt,.md,.csv,.json,.png,.jpg,.jpeg,.gif,.webp,.html,.xml";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatWaitDuration(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) return "the selected duration";
  if (hours < 1) {
    const minutes = Math.round(hours * 60);
    return minutes === 1 ? "1 minute" : `${minutes} minutes`;
  }
  if (Number.isInteger(hours)) {
    return hours === 1 ? "1 hour" : `${hours} hours`;
  }
  const whole = Math.floor(hours);
  const minutes = Math.round((hours - whole) * 60);
  if (minutes === 0) return whole === 1 ? "1 hour" : `${whole} hours`;
  if (whole === 0) return minutes === 1 ? "1 minute" : `${minutes} minutes`;
  return `${whole}h ${minutes}m`;
}

type InterestSummary = {
  interested: number;
  notInterested: number;
  unclear: number;
  included: number;
};

function parseInterestSummary(raw: unknown): InterestSummary | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const interested = Number(o.interested ?? 0);
  const notInterested = Number(o.notInterested ?? 0);
  const unclear = Number(o.unclear ?? 0);
  const included = Number(o.included ?? interested + unclear);
  if (![interested, notInterested, unclear, included].every((n) => Number.isFinite(n))) {
    return undefined;
  }
  return { interested, notInterested, unclear, included };
}

function formatWaitFulfilledLine(
  responderCount: number,
  interestSummary?: InterestSummary,
  continuePipeline = true,
): string {
  const base =
    responderCount > 1
      ? `Replies collected (${responderCount})`
      : "Reply collected";
  const next = continuePipeline
    ? " — continuing with the next specialist"
    : " — preparing the result";
  if (!interestSummary) return `${base}${next}.`;
  const bits: string[] = [];
  if (interestSummary.interested > 0) {
    bits.push(
      `${interestSummary.interested} interested`,
    );
  }
  if (interestSummary.unclear > 0) {
    bits.push(`${interestSummary.unclear} unclear`);
  }
  if (interestSummary.notInterested > 0) {
    bits.push(`${interestSummary.notInterested} declined`);
  }
  if (bits.length === 0) return `${base}${next}.`;
  return `${base} (${bits.join(" / ")})${next}.`;
}

/** Agents built from the NL builder default to Exora General when the team has no override. */
const TEAM_RUN_AGENT_DEFAULT_MODEL = "exora/exora-general";

/** Strip embedded attachment dumps from stored run.goal for chat display. */
const FOLLOW_UP_NOTE_START = "--- Previous team conversation (main note) ---";
const FOLLOW_UP_NOTE_END = "--- End previous ---";
const FOLLOW_UP_LABEL = "Follow-up:";

const RETRY_ONLY_GOAL_RE =
  /^(try again|retry|again|please retry|re-?run(?: it)?|re-?try|proceed with the original intent)\.?!?$/i;

function extractFollowUpUserText(goal: string): string {
  const startIdx = goal.indexOf(FOLLOW_UP_NOTE_START);
  const endIdx = goal.indexOf(FOLLOW_UP_NOTE_END);
  if (startIdx < 0 || endIdx < 0 || endIdx < startIdx) return goal;
  let rest = goal.slice(endIdx + FOLLOW_UP_NOTE_END.length).trim();
  if (rest.toLowerCase().startsWith(FOLLOW_UP_LABEL.toLowerCase())) {
    rest = rest.slice(FOLLOW_UP_LABEL.length).trim();
  }
  return rest || goal;
}

function intentFromEnvelope(goal: string): string | null {
  const startIdx = goal.indexOf(FOLLOW_UP_NOTE_START);
  const endIdx = goal.indexOf(FOLLOW_UP_NOTE_END);
  if (startIdx < 0 || endIdx < 0 || endIdx < startIdx) return null;
  const body = goal.slice(startIdx + FOLLOW_UP_NOTE_START.length, endIdx);
  const match = body.match(/^(?:Intent|Goal):\s*(.+)$/m);
  const intent = match?.[1]?.trim() ?? "";
  return intent || null;
}

function displayGoalText(goal: string): string {
  const unwrapped = extractFollowUpUserText(goal);
  const marker = "\n\n---\nAttached files";
  const idx = unwrapped.indexOf(marker);
  const head =
    idx >= 0
      ? unwrapped.slice(0, idx).trim() || "Attached files"
      : unwrapped.startsWith("Attached files (")
        ? unwrapped.split("\n")[0]?.trim() || unwrapped
        : unwrapped;
  if (RETRY_ONLY_GOAL_RE.test(head)) {
    const intent = intentFromEnvelope(goal);
    if (intent && !RETRY_ONLY_GOAL_RE.test(intent)) return intent;
  }
  return head;
}

/**
 * Recover confirmed attachments from the enriched run goal / inject text
 * (`buildPromptWithAttachments` format) so reload still shows delivery status.
 */
function parseAttachmentsFromEnrichedPrompt(text: string): ChatAttachmentChip[] | undefined {
  if (!text.includes("Attached files") && !text.includes("\nDownload: ")) return undefined;
  const out: ChatAttachmentChip[] = [];
  const blockRe =
    /###\s+(.+?)\s+\(([^,]+),\s*([^)]+)\)\s*\nDownload:\s+(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(text)) !== null) {
    const fileName = m[1]!.trim();
    const mimeType = m[2]!.trim();
    const sizeLabel = m[3]!.trim();
    const url = m[4]!.trim();
    let sizeBytes: number | undefined;
    const kb = /^([\d.]+)\s*KB$/i.exec(sizeLabel);
    const mb = /^([\d.]+)\s*MB$/i.exec(sizeLabel);
    if (kb) sizeBytes = Math.round(parseFloat(kb[1]!) * 1024);
    else if (mb) sizeBytes = Math.round(parseFloat(mb[1]!) * 1024 * 1024);
    out.push({
      id: `goal-${out.length}-${fileName}`,
      fileName,
      mimeType,
      url,
      ...(sizeBytes != null ? { sizeBytes } : {}),
    });
  }
  return out.length > 0 ? out : undefined;
}

/** Backend-confirmed when we have a sandbox download URL (included in the agent prompt). */
function attachmentReachedAgents(a: ChatAttachmentChip): boolean {
  return typeof a.url === "string" && a.url.length > 0;
}

function parseInjectionAttachments(raw: unknown): ChatAttachmentChip[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: ChatAttachmentChip[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const a = item as Record<string, unknown>;
    if (typeof a.fileName !== "string" || !a.fileName.trim()) continue;
    out.push({
      ...(typeof a.id === "string" ? { id: a.id } : {}),
      fileName: a.fileName,
      ...(typeof a.mimeType === "string" ? { mimeType: a.mimeType } : {}),
      ...(typeof a.url === "string" ? { url: a.url } : {}),
      ...(typeof a.sizeBytes === "number" ? { sizeBytes: a.sizeBytes } : {}),
    });
  }
  return out.length > 0 ? out : undefined;
}

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

function jitPendingFromPayload(
  eventId: string,
  timestampMs: number,
  agentId: string | null,
  p: Record<string, unknown>,
): Extract<ProcessedEvent, { kind: "jit_pending" }> {
  const scope = String(p.scope ?? "");
  const scopeLabel = String(p.scopeLabel ?? (scope || "action"));
  const channel = String(p.channel ?? "");
  const context = String(p.context ?? "").trim();
  const whatsappExpected = p.whatsappExpected === true;
  const whatsappStatus =
    p.whatsappStatus === "disconnected" || p.whatsappStatus === "not_linked"
      ? p.whatsappStatus
      : undefined;
  const detailParts = [
    channel === "whatsapp"
      ? "Reply on WhatsApp to approve or deny"
      : "Waiting for your approval in Qlix",
    scopeLabel ? `Scope: ${scopeLabel}` : "",
    isSessionChatJitScope(scope) ? "Approving covers this whole conversation" : "",
    context,
  ].filter(Boolean);
  return {
    kind: "jit_pending",
    eventId,
    timestampMs,
    agentId: agentId ?? "",
    label: "Waiting for your approval",
    detail: detailParts.join(" · ") || undefined,
    jitRequestId:
      typeof p.jitRequestId === "string" && p.jitRequestId ? p.jitRequestId : undefined,
    jitChannel: channel === "whatsapp" ? "whatsapp" : "dashboard",
    jitScope: scope,
    jitContext: context || undefined,
    jitWhatsappExpected: whatsappExpected || undefined,
    jitWhatsappStatus: whatsappStatus,
  };
}

function jitResolvedFromPayload(
  eventId: string,
  timestampMs: number,
  agentId: string | null,
  p: Record<string, unknown>,
): Extract<ProcessedEvent, { kind: "jit_resolved" }> {
  const msg = String(p.message ?? "");
  const scopeLabel = String(p.scopeLabel ?? p.scope ?? "");
  const decisionRaw = String(p.decision ?? "");
  let decision: "approved" | "denied" | "expired" = "approved";
  if (msg === "jit_approval_denied" || decisionRaw === "denied") decision = "denied";
  else if (msg === "jit_approval_expired" || decisionRaw === "expired") decision = "expired";

  const auto = p.auto === true;
  const conversationGrant = String(p.reason ?? "") === "conversation";
  let label = "You approved the action";
  if (decision === "denied") label = "You denied the action";
  else if (decision === "expired") label = "Approval request expired";
  else if (auto) {
    label = conversationGrant ? "Approved for this conversation" : "Pre-approved for this run";
  }

  return {
    kind: "jit_resolved",
    eventId,
    timestampMs,
    agentId: agentId ?? "",
    label,
    detail: scopeLabel ? `Scope: ${scopeLabel}` : undefined,
    decision,
  };
}

function pendingJitToSyntheticEvent(
  pending: TeamRunPendingJit,
  teamId: string,
  teamRunId: string,
): TeamRunEventDTO {
  return {
    id: `synthetic-jit-${pending.jitRequestId}`,
    runId: teamRunId,
    teamId,
    agentId: pending.agentId,
    seq: 0,
    eventType: "scope_requested",
    payload: {
      message: "jit_approval_pending",
      scope: pending.scope,
      scopeLabel: pending.scopeLabel,
      channel: "dashboard",
      context: pending.context,
      jitRequestId: pending.jitRequestId,
    },
    prevHash: "",
    timestampMs: String(Date.parse(pending.requestedAt) || Date.now()),
  };
}

function mergePendingJitIntoEvents(
  events: TeamRunEventDTO[],
  pending: TeamRunPendingJit[],
  teamId: string,
  teamRunId: string,
): TeamRunEventDTO[] {
  if (pending.length === 0) return events;
  const known = new Set<string>();
  for (const e of events) {
    if (e.eventType !== "scope_requested") continue;
    const id = (e.payload as Record<string, unknown> | null)?.jitRequestId;
    if (typeof id === "string" && id) known.add(id);
  }
  const extras = pending
    .filter((p) => !known.has(p.jitRequestId))
    .map((p) => pendingJitToSyntheticEvent(p, teamId, teamRunId));
  return extras.length > 0 ? [...events, ...extras] : events;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Renders the glyph for a step directly — returning icon *components* from a
 *  helper would create components during render. */
function ToolGlyph({
  kind,
  tool,
  size = 12,
  className,
}: {
  readonly kind?: "tool" | "brain" | "status" | "jit_pending" | "jit_resolved";
  readonly tool?: string;
  readonly size?: number;
  readonly className?: string;
}) {
  const t = tool ?? "";
  if (kind === "jit_pending" || kind === "jit_resolved") {
    return <ShieldCheck size={size} className={className} />;
  }
  if (kind === "brain") return <Brain size={size} className={className} />;
  if (kind === "status") return <Zap size={size} className={className} />;
  if (t === "email_read" || t === "email_send") return <Mail size={size} className={className} />;
  if (t.startsWith("browser_") || t.includes("research_read") || t.includes("read_url")) {
    return <Globe size={size} className={className} />;
  }
  if (t.includes("web_search") || t.includes("research_web")) return <Search size={size} className={className} />;
  if (t === "http_request") return <Zap size={size} className={className} />;
  if (t.startsWith("file_") || t.includes("xlsx") || t.includes("pdf")) {
    return <FileText size={size} className={className} />;
  }
  if (t.startsWith("code_") || t === "shell_exec" || t === "repl") {
    return <Terminal size={size} className={className} />;
  }
  if (t.startsWith("memory_") || t.startsWith("knowledge_") || t.startsWith("brain")) {
    return <Brain size={size} className={className} />;
  }
  if (t.startsWith("crm") || t.includes("whatsapp")) return <Users size={size} className={className} />;
  return <Wrench size={size} className={className} />;
}

function parseToolSources(raw: unknown): Array<{ url: string; title?: string }> | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: Array<{ url: string; title?: string }> = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const url = (item as Record<string, unknown>).url;
    if (typeof url !== "string" || !/^https?:\/\//i.test(url)) continue;
    const title = (item as Record<string, unknown>).title;
    out.push({
      url,
      title: typeof title === "string" && title.trim() ? title.trim() : undefined,
    });
  }
  return out.length > 0 ? out : undefined;
}

/** Keep noisy / duplicate runner chatter out of the dulled execution rail. */
function statusStepLabel(message: string, payload: Record<string, unknown>): string | null {
  const msg = message.trim();
  if (!msg) return null;
  if (
    msg === "inference_tool_round" ||
    msg === "inference_request" ||
    msg === "browser_frame" ||
    msg === "tool_started" ||
    msg === "tool_finished"
  ) {
    return null;
  }
  if (msg.startsWith("Retrying ")) return msg;
  if (msg.includes(" is working on:")) return null;
  if (msg.startsWith("Pipeline order locked")) return null;
  if (msg.startsWith("Luna-Teams is preparing dispatches")) return null;
  if (msg.startsWith("Luna-Teams is selecting")) return null;
  if (msg === "Luna-Teams is preparing the final result…") return null;
  if (/ started$/.test(msg)) return null;
  if (msg.startsWith("Supervisor retry")) return msg;
  if (typeof payload.error === "string" && payload.error.trim()) {
    return payload.error.trim();
  }
  // Generic human-readable status lines
  if (msg.length <= 180 && !msg.includes("{") && !/_/.test(msg.split(" ")[0] ?? "")) {
    return msg;
  }
  return null;
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

function UserMessage({
  text,
  attachments,
  delivery = "confirmed",
}: {
  readonly text: string;
  readonly attachments?: readonly ChatAttachmentChip[];
  /** `uploading` while the multipart request is in flight; `confirmed` after backend ack. */
  readonly delivery?: "uploading" | "confirmed";
}) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] space-y-2">
        {text ? (
          <div className="whitespace-pre-wrap rounded-3xl rounded-br-lg bg-black px-4 py-2.5 text-[13px] leading-relaxed text-white">
            {text}
          </div>
        ) : null}
        {attachments && attachments.length > 0 ? (
          <ul className="flex flex-wrap justify-end gap-1.5">
            {attachments.map((a, i) => {
              const reached = delivery === "confirmed" && attachmentReachedAgents(a);
              const pending = delivery === "uploading";
              const chip = (
                <span
                  className={cn(
                    "inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px]",
                    reached
                      ? "border-emerald-600/25 bg-emerald-50 text-emerald-950"
                      : pending
                        ? "border-black/15 bg-white/90 text-black/65"
                        : "border-amber-600/30 bg-amber-50 text-amber-950",
                  )}
                  title={
                    reached
                      ? "File reached the backend and was included in the agent prompt"
                      : pending
                        ? "Uploading file to the backend…"
                        : "File was not confirmed by the backend"
                  }
                >
                  {pending ? (
                    <Loader2 className="size-3 shrink-0 animate-spin" aria-hidden />
                  ) : reached ? (
                    <CheckCircle className="size-3 shrink-0 text-emerald-700" aria-hidden />
                  ) : (
                    <XCircle className="size-3 shrink-0 text-amber-700" aria-hidden />
                  )}
                  <FileText className="size-3 shrink-0 opacity-70" aria-hidden />
                  <span className="truncate max-w-[11rem]">{a.fileName}</span>
                  {typeof a.sizeBytes === "number" ? (
                    <span className="shrink-0 opacity-50">{formatFileSize(a.sizeBytes)}</span>
                  ) : null}
                </span>
              );
              return (
                <li key={a.id ?? `${a.fileName}-${i}`}>
                  {reached && a.url ? (
                    <a href={a.url} target="_blank" rel="noreferrer" className="hover:opacity-80">
                      {chip}
                    </a>
                  ) : (
                    chip
                  )}
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

function SystemLine({
  icon: Icon,
  tone = "muted",
  active = false,
  children,
}: {
  readonly icon?: ComponentType<{ size?: number; className?: string }>;
  readonly tone?: "muted" | "info" | "success" | "warning" | "danger";
  readonly active?: boolean;
  readonly children: ReactNode;
}) {
  const toneClass = {
    muted: "border-black/[0.06] bg-black/[0.025] text-[color:var(--ink-faint)]",
    info: "border-violet-500/15 bg-violet-50/70 text-violet-900/70",
    success: "border-emerald-600/15 bg-emerald-50/80 text-emerald-900/75",
    warning: "border-amber-500/20 bg-amber-50/80 text-amber-950/70",
    danger: "border-red-500/15 bg-red-50/75 text-[color:var(--sketch-red)]",
  }[tone];
  return (
    <div
      className={cn(
        "mx-auto flex w-fit max-w-full items-center justify-center gap-2 rounded-full border px-3 py-1.5 text-center text-[11px] leading-relaxed transition-colors",
        toneClass,
        active && "motion-safe:animate-pulse",
      )}
      role="status"
      aria-live={active ? "polite" : undefined}
    >
      {active ? (
        <span className="relative flex size-2 shrink-0" aria-hidden>
          <span className="absolute inline-flex size-full rounded-full bg-violet-500/45 motion-safe:animate-ping" />
          <span className="relative inline-flex size-2 rounded-full bg-violet-600" />
        </span>
      ) : Icon ? (
        <Icon size={11} className="shrink-0" />
      ) : null}
      <span>{children}</span>
    </div>
  );
}

// ─── Message bodies ───────────────────────────────────────────────────────────

function PlanBody({
  payload,
  agentNameById,
  agentStates,
}: {
  readonly payload: Record<string, unknown>;
  readonly agentNameById: (id: string | null) => string;
  readonly agentStates: ReadonlyMap<string, AgentStatus>;
}) {
  type SubtaskEntry = { subtaskId?: string; agentId?: string; goal?: string };
  const subtasks = (payload.subtasks as SubtaskEntry[]) ?? [];

  return (
    <div className="overflow-hidden rounded-2xl border border-violet-500/15 bg-gradient-to-br from-violet-50/65 via-white/80 to-white">
      <div className="flex items-center justify-between border-b border-violet-500/10 px-3.5 py-2.5">
        <div>
          <p className="text-[12.5px] font-semibold text-violet-950/85">Execution plan</p>
          <p className="mt-0.5 text-[10.5px] text-violet-900/50">
            {subtasks.length} specialist step{subtasks.length === 1 ? "" : "s"}
          </p>
        </div>
        <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-medium text-violet-800">
          Live
        </span>
      </div>
      {subtasks.length > 0 && (
        <ol className="divide-y divide-black/[0.05] px-3.5">
          {subtasks.map((st, i) => {
            const state = st.agentId ? agentStates.get(st.agentId)?.state ?? "idle" : "idle";
            const running = state === "thinking" || state === "tool_active";
            const failed = state === "failed";
            const completed = state === "completed";
            return (
              <li key={st.subtaskId ?? i} className="flex items-center gap-2.5 py-2.5 text-[12.5px]">
                <span
                  className={cn(
                    "grid size-5 shrink-0 place-items-center rounded-full text-[9.5px] font-semibold tabular-nums",
                    completed
                      ? "bg-emerald-100 text-emerald-800"
                      : failed
                        ? "bg-red-100 text-red-700"
                        : running
                          ? "bg-violet-100 text-violet-800"
                          : "bg-black/[0.05] text-black/45",
                  )}
                >
                  {completed ? <CheckCircle size={12} /> : failed ? <XCircle size={12} /> : i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-black/85">
                    {agentNameById(st.agentId ?? null)}
                  </p>
                  {st.goal ? <p className={cn("mt-0.5 truncate text-[10.5px]", INK_FAINT)}>{st.goal}</p> : null}
                </div>
                <span
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[9.5px] font-medium",
                    completed
                      ? "bg-emerald-100/80 text-emerald-800"
                      : failed
                        ? "bg-red-100/80 text-red-700"
                        : running
                          ? "bg-violet-100 text-violet-800"
                          : "bg-black/[0.04] text-black/45",
                  )}
                >
                  {running ? <Loader2 size={9} className="motion-safe:animate-spin" /> : null}
                  {completed ? "Completed" : failed ? "Failed" : running ? "Running" : "Waiting"}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function ActivityBody({
  entries,
  frames,
  running: _running,
  jitDeciding,
  jitError,
  onJitDecision,
}: {
  readonly entries: ActivityEntry[];
  readonly frames: Record<string, BrowserFrame>;
  readonly running: boolean;
  readonly jitDeciding?: Record<string, boolean>;
  readonly jitError?: string | null;
  readonly onJitDecision?: (jitRequestId: string, approved: boolean) => void;
}) {
  return (
    <ol className="space-y-1.5">
      {entries.map((entry) => {
        const frame = frames[entry.id];
        const isJitPending = entry.kind === "jit_pending";
        const isRunningStep = entry.status === "running" || isJitPending;
        const isError = entry.status === "error";
        const isRetry = entry.status === "retry";
        if (isJitPending) {
          return (
            <li key={entry.id} className="min-w-0">
              <JitApprovalCard
                step={{
                  label: entry.label,
                  detail: entry.detail,
                  jitRequestId: entry.jitRequestId,
                  jitChannel: entry.jitChannel,
                  jitScope: entry.jitScope,
                  jitContext: entry.jitContext,
                  jitWhatsappExpected: entry.jitWhatsappExpected,
                  jitWhatsappStatus: entry.jitWhatsappStatus,
                }}
                deciding={Boolean(entry.jitRequestId && jitDeciding?.[entry.jitRequestId])}
                error={jitError}
                onDecide={(approved) => {
                  if (!entry.jitRequestId || !onJitDecision) return;
                  onJitDecision(entry.jitRequestId, approved);
                }}
              />
            </li>
          );
        }
        return (
          <li key={entry.id} className="min-w-0">
            <div
              className={cn(
                "flex items-start gap-2 rounded-xl border px-2.5 py-2 transition-colors",
                isRunningStep
                  ? "border-violet-500/15 bg-violet-50/65"
                  : isError
                    ? "border-red-500/15 bg-red-50/60"
                    : isRetry
                      ? "border-amber-500/20 bg-amber-50/60"
                      : "border-emerald-600/10 bg-emerald-50/55",
              )}
            >
              {isRunningStep ? (
                <Loader2 size={12} className="mt-0.5 shrink-0 text-violet-600 motion-safe:animate-spin" />
              ) : isError ? (
                <XCircle size={11} className="mt-0.5 shrink-0 text-[color:var(--sketch-red)]/80" />
              ) : isRetry ? (
                <RotateCw size={11} className="mt-0.5 shrink-0 text-amber-700/80" />
              ) : (
                <span className="relative mt-0.5 grid size-4 shrink-0 place-items-center text-emerald-700">
                  <ToolGlyph kind={entry.kind} tool={entry.tool} size={12} />
                  <CheckCircle className="absolute -bottom-1 -right-1 size-2.5 fill-emerald-50" />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span
                    className={cn(
                      "text-[12.5px] leading-snug",
                      isError
                        ? "text-[color:var(--sketch-red)]/85"
                        : isRunningStep
                          ? "text-violet-950/80"
                          : isRetry
                            ? "text-amber-950/80"
                            : "text-emerald-950/80",
                    )}
                  >
                    {entry.label}
                  </span>
                  <span
                    className={cn(
                      "ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-[9.5px] font-medium",
                      isRunningStep
                        ? "bg-violet-100 text-violet-700"
                        : isError
                          ? "bg-red-100 text-red-700"
                          : isRetry
                            ? "bg-amber-100 text-amber-800"
                            : "bg-emerald-100 text-emerald-800",
                    )}
                  >
                    {isRunningStep
                      ? "Running"
                      : isError
                        ? "Failed"
                        : isRetry
                          ? "Retrying"
                          : "Succeeded"}
                  </span>
                </div>
                {entry.detail ? (
                  <p className={cn("mt-0.5 text-[11px] leading-relaxed", INK_FAINT)}>{entry.detail}</p>
                ) : null}
                {entry.sources && entry.sources.length > 0 ? (
                  <ul className="mt-1 space-y-0.5">
                    {entry.sources.slice(0, 3).map((s) => (
                      <li key={s.url} className="min-w-0">
                        <a
                          href={s.url}
                          target="_blank"
                          rel="noreferrer"
                          className={cn(
                            "block truncate text-[10.5px] underline decoration-black/15 underline-offset-2 hover:decoration-black/40",
                            INK_FAINT,
                          )}
                        >
                          {s.title || s.url}
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
            {frame ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`data:${frame.mime};base64,${frame.imageBase64}`}
                alt={frame.label}
                className={cn("mt-2 max-h-56 w-full rounded-lg border object-contain opacity-90", HAIRLINE)}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
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
    <div className="overflow-hidden rounded-2xl border border-emerald-600/15 bg-emerald-50/55">
      <div className="flex items-center gap-2 border-b border-emerald-600/10 px-3.5 py-2">
        <CheckCircle size={13} className="shrink-0 text-emerald-700" />
        <span className="text-[11px] font-semibold text-emerald-900/80">Step completed</span>
        {durationMs != null && <span className="ml-auto text-[10px] text-emerald-900/45">{formatDuration(durationMs)}</span>}
      </div>
      <div className="px-3.5 py-3">
        <p className="mb-1 text-[9.5px] font-semibold uppercase tracking-[0.14em] text-emerald-800/55">
          Step output
        </p>
        {summary ? (
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-emerald-950/75">{summary}</p>
        ) : (
          <p className="text-[12px] text-emerald-900/50">Completed successfully. No text output was returned.</p>
        )}
      </div>
    </div>
  );
}

function ResultBody({ result }: { readonly result: string }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-emerald-600/20 bg-gradient-to-br from-emerald-50/80 via-white to-white shadow-[0_8px_30px_rgba(16,185,129,0.07)]">
      <div className="flex items-center gap-2 border-b border-emerald-600/10 px-4 py-2.5">
        <CheckCircle size={14} className="text-emerald-700" />
        <span className="text-[11px] font-semibold text-emerald-950/80">Team result</span>
      </div>
      <div className="px-4 py-3.5">
        <AgentMessageContent content={result} completed />
      </div>
    </div>
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
      <div className="min-w-0 flex-1 rounded-2xl border border-violet-500/15 bg-violet-50/55 px-3 py-2">
        <button
          type="button"
          onClick={() => steps.length > 0 && setOpen((v) => !v)}
          aria-expanded={open}
          className={cn(
            "flex w-full items-center gap-2 rounded-xl py-1 text-left",
            steps.length > 0 && "transition-colors hover:bg-black/[0.04]",
          )}
        >
          <span className="flex shrink-0 items-center gap-1" aria-hidden>
            <span className="size-1.5 rounded-full bg-violet-500 motion-safe:animate-bounce" />
            <span className="size-1.5 rounded-full bg-violet-500 motion-safe:animate-bounce [animation-delay:150ms]" />
            <span className="size-1.5 rounded-full bg-violet-500 motion-safe:animate-bounce [animation-delay:300ms]" />
          </span>
          <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-violet-950/70">
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
  const active = status.state === "thinking" || status.state === "tool_active";
  return (
    <div
      className={cn(
        "flex items-center gap-2.5 rounded-xl border px-2.5 py-2 transition-colors",
        active
          ? "border-violet-500/15 bg-violet-50/70"
          : status.state === "completed"
            ? "border-emerald-600/10 bg-emerald-50/55"
            : status.state === "failed"
              ? "border-red-500/10 bg-red-50/50"
              : "border-transparent hover:bg-white/60",
      )}
    >
      <Avatar name={status.name} role={status.role} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12.5px] font-medium text-black">{status.name}</p>
        <p className={cn("truncate text-[11px]", INK_SOFT)}>
          {status.currentAction ?? STATE_LABEL[status.state]}
        </p>
      </div>
      {active ? (
        <Loader2 className="size-3 shrink-0 text-violet-600 motion-safe:animate-spin" aria-hidden />
      ) : (
        <span className={cn("size-1.5 shrink-0 rounded-full", STATE_DOT[status.state])} aria-hidden />
      )}
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
  const fileContent =
    artifact.type === "file" && artifact.content && typeof artifact.content === "object"
      ? (artifact.content as { url?: string; rowCount?: number })
      : null;
  const sandboxUrl = typeof fileContent?.url === "string" ? fileContent.url : null;

  function download() {
    if (sandboxUrl) {
      window.open(sandboxUrl, "_blank", "noopener,noreferrer");
      return;
    }
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
      title={sandboxUrl ? "Open download link" : "Download"}
      className="group flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-white/60"
    >
      <FileText size={12} className={cn("shrink-0", INK_FAINT)} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] text-black">{artifact.name}</span>
        <span className={cn("block truncate text-[10.5px]", INK_FAINT)}>
          {fileContent?.rowCount != null
            ? `${fileContent.rowCount} row${fileContent.rowCount === 1 ? "" : "s"}`
            : agentNameById(artifact.agentId)}
        </span>
      </span>
      <Download size={12} className={cn("shrink-0 opacity-0 transition-opacity group-hover:opacity-100", INK_SOFT)} />
    </button>
  );
}

// ─── Chat item model ──────────────────────────────────────────────────────────

interface ActivityEntry {
  id: string;
  kind: "tool" | "brain" | "status" | "jit_pending" | "jit_resolved";
  tool?: string;
  label: string;
  detail?: string;
  /** `retry` is neither success nor failure — the stage is being attempted again. */
  status?: "running" | "done" | "error" | "retry";
  sources?: Array<{ url: string; title?: string }>;
  jitRequestId?: string;
  jitChannel?: "dashboard" | "whatsapp";
  jitScope?: string;
  jitContext?: string;
  jitWhatsappExpected?: boolean;
  jitWhatsappStatus?: "disconnected" | "not_linked";
}

type ChatItem =
  | { kind: "started"; id: string; ts: number }
  | { kind: "plan"; id: string; ts: number; payload: Record<string, unknown> }
  | { kind: "handoff"; id: string; ts: number; agentName: string }
  | { kind: "activity"; id: string; ts: number; agentId: string; entries: ActivityEntry[] }
  | { kind: "completed"; id: string; ts: number; agentId: string | null; summary?: string }
  | { kind: "result"; id: string; ts: number; synthesis?: string }
  | { kind: "failed"; id: string; ts: number; error: string }
  | { kind: "wait_armed"; id: string; ts: number; reason: string; contactCount: number }
  | {
      kind: "wait_ttl_requested";
      id: string;
      ts: number;
      reason: string;
      optionsHours: number[];
      allowCustom: boolean;
      runId: string;
    }
  | { kind: "wait_ttl_set"; id: string; ts: number; hours: number; expiresAt: string }
  | {
      kind: "wait_progress";
      id: string;
      ts: number;
      received: number;
      remaining: number;
      total: number;
      phase?: string;
      reason?: string;
      sent?: number;
      failed?: number;
    }
  | {
      kind: "live_artifact_updated";
      id: string;
      ts: number;
      url: string;
      rowCount: number;
      jid: string;
      interest: string;
    }
  | { kind: "wait_fulfilled"; id: string; ts: number; responderCount: number; continuePipeline: boolean; interestSummary?: { interested: number; notInterested: number; unclear: number; included: number } }
  | { kind: "wait_expired"; id: string; ts: number; reason: string }
  | { kind: "user"; id: string; ts: number; message: string; attachments?: ChatAttachmentChip[] }
  | { kind: "clarification"; id: string; ts: number; question: string }
  | { kind: "delivered"; id: string; ts: number; sent: boolean; reason?: string; boundary?: string; channel?: string }
  | { kind: "blocked"; id: string; ts: number; message: string };

// ─── Main Component ───────────────────────────────────────────────────────────

interface TeamRunViewProps {
  readonly team: TeamDTO;
  readonly canSend?: boolean;
}

export function TeamRunView({ team, canSend = true }: TeamRunViewProps) {
  const [composer, setComposer] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [pendingFilePurposes, setPendingFilePurposes] = useState<
    Record<string, "authoritative_input" | "reference_asset">
  >({});
  const [fileError, setFileError] = useState<string | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [startedGoal, setStartedGoal] = useState<string | null>(null);
  const [goalAttachments, setGoalAttachments] = useState<ChatAttachmentChip[] | null>(null);
  /** Local pending chips while multipart start is in flight. */
  const [uploadingAttachments, setUploadingAttachments] = useState<ChatAttachmentChip[] | null>(
    null,
  );
  const [selectedModel, setSelectedModel] = useState(
    () => team.config?.defaultModel?.trim() || TEAM_RUN_AGENT_DEFAULT_MODEL,
  );
  const [selectedReasoningEffort, setSelectedReasoningEffort] = useState<ReasoningEffort | null>(
    () => (team.config?.defaultReasoningEffort as ReasoningEffort | undefined) ?? null,
  );
  const [openrouterCatalog, setOpenrouterCatalog] = useState<ModelCatalogEntry[]>([]);
  const [runModelLabel, setRunModelLabel] = useState<string | null>(null);
  const [run, setRun] = useState<TeamRunDTO | null>(null);
  const [events, setEvents] = useState<TeamRunEventDTO[]>([]);
  const [artifacts, setArtifacts] = useState<TeamRunArtifact[]>([]);
  const [finalResult, setFinalResult] = useState<string | null>(null);
  const [runStatus, setRunStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [injecting, setInjecting] = useState(false);
  const [showAgents, setShowAgents] = useState(false);
  const [viewMode, setViewMode] = useState<RunViewMode>("chat");
  const [jitDeciding, setJitDeciding] = useState<Record<string, boolean>>({});
  const [waitTtlSubmitting, setWaitTtlSubmitting] = useState(false);
  const [waitTtlError, setWaitTtlError] = useState<string | null>(null);
  const [customWaitValue, setCustomWaitValue] = useState("30");
  const [customWaitUnit, setCustomWaitUnit] = useState<"minutes" | "hours">("minutes");
  const [jitError, setJitError] = useState<string | null>(null);
  const [liveArtifact, setLiveArtifact] = useState<LiveArtifactPreview | null>(null);
  const [liveArtifactOpen, setLiveArtifactOpen] = useState(true);
  const [hydrating, setHydrating] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [conversations, setConversations] = useState<TeamConversation[]>([]);
  const [activeRootId, setActiveRootId] = useState<string | null>(null);
  const showChat = viewMode === "chat";
  const hydrateGen = useRef(0);

  // Browser frames: agentId → frames[]
  const [browserFrames, setBrowserFrames] = useState<Record<string, BrowserFrame[]>>({});
  // Map from tool_finished event id → browser frame (arrives just after)
  const [toolFrames, setToolFrames] = useState<Record<string, BrowserFrame>>({});

  const streamCleanup = useRef<(() => void) | null>(null);
  const timelineScrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
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

  useEffect(() => {
    const fromTeam = team.config?.defaultModel?.trim();
    if (fromTeam) setSelectedModel(fromTeam);
  }, [team.id, team.config?.defaultModel]);

  useEffect(() => {
    let cancelled = false;
    void fetchModelCatalog("openrouter").then((result) => {
      if (cancelled || !result.ok) return;
      setOpenrouterCatalog(result.models);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const modelGroups = useMemo(
    () => buildTeamRunModelGroups(openrouterCatalog),
    [openrouterCatalog],
  );
  const modelOptionIds = useMemo(
    () => new Set(modelGroups.flatMap((g) => g.options.map((o) => o.id))),
    [modelGroups],
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
            currentAction:
              step === "decompose" || step === "dispatch_plan"
                ? "Preparing specialist dispatches…"
                : "Preparing the result…",
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
      } else if (e.eventType === "scope_requested" && aid) {
        const s = states.get(aid);
        if (s) {
          states.set(aid, {
            ...s,
            state: "thinking",
            currentAction: "Waiting for your approval…",
            currentTool: undefined,
          });
        }
      } else if (e.eventType === "approval_granted" && aid) {
        const s = states.get(aid);
        if (s && s.currentAction === "Waiting for your approval…") {
          states.set(aid, {
            ...s,
            state: "thinking",
            currentAction: "Working on task…",
          });
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
          if ((p.step as string) === "decompose" || (p.step as string) === "dispatch_plan") {
            result.push({ kind: "supervisor_plan", eventId: e.id, timestampMs: ts, payload: p });
          }
          // synthesize step surfaces as final result card, not a separate entry
          break;
        case "task_delegated":
          result.push({ kind: "task_delegated", eventId: e.id, timestampMs: ts, payload: p, agentId: e.agentId });
          break;
        case "task_status_update": {
          const msg = typeof p.message === "string" ? p.message : "";
          const label = statusStepLabel(msg, p);
          if (label) {
            const failed = p.status === "failed" || typeof p.error === "string";
            const reason = typeof p.reason === "string" ? p.reason : undefined;
            result.push({
              kind: "status_step",
              eventId: e.id,
              timestampMs: ts,
              agentId: e.agentId ?? "",
              label,
              status: failed ? "error" : p.retry === true ? "retry" : "done",
              ...(reason ? { detail: reason } : {}),
            });
          }
          break;
        }
        case "brain_queried":
          result.push(brainQueryFromPayload(e.id, ts, e.agentId, p));
          break;
        case "scope_requested":
          result.push(jitPendingFromPayload(e.id, ts, e.agentId, p));
          break;
        case "approval_granted":
          result.push(jitResolvedFromPayload(e.id, ts, e.agentId, p));
          break;
        case "tool_called": {
          const tool = p.tool as string | undefined;
          const msg = p.message as string | undefined;
          if (!tool) break;
          if (msg === "tool_started") {
            result.push({
              kind: "tool_call",
              eventId: e.id,
              timestampMs: ts,
              tool,
              agentId: e.agentId ?? "",
              actionLabel: formatToolId(tool).short,
              status: "running",
            });
            break;
          }
          if (msg === "tool_finished") {
            if (tool === "brain.query") {
              result.push(brainQueryFromPayload(e.id, ts, e.agentId, p));
            } else {
              const hints = inferenceHintsByAgent.get(e.agentId ?? "");
              const actionLabel = isBrowserToolId(tool)
                ? resolveBrowserToolIntent(tool, p, hints)
                : describeBrowserToolAction(tool, p) ?? undefined;
              const ok = p.ok !== false;
              result.push({
                kind: "tool_call",
                eventId: e.id,
                timestampMs: ts,
                tool,
                agentId: e.agentId ?? "",
                actionLabel,
                status: ok ? "done" : "error",
                sources: parseToolSources(p.sources),
              });
            }
          }
          break;
        }
        case "subtask_completed":
          result.push({ kind: "subtask_completed", eventId: e.id, timestampMs: ts, payload: p, agentId: e.agentId });
          break;
        case "run_completed":
          result.push({
            kind: "run_result",
            eventId: e.id,
            timestampMs: ts,
            synthesis: typeof p.synthesis === "string" ? p.synthesis : undefined,
          });
          break;
        case "run_failed":
          result.push({ kind: "run_failed_event", eventId: e.id, timestampMs: ts, error: (p.error as string | undefined) ?? "Run failed" });
          break;
        case "wait_armed":
          result.push({
            kind: "wait_armed",
            eventId: e.id,
            timestampMs: ts,
            reason: (p.reason as string | undefined) ?? "Waiting for an external response.",
            contactCount: Number(p.contactCount ?? 0),
          });
          break;
        case "wait_ttl_requested":
          result.push({
            kind: "wait_ttl_requested",
            eventId: e.id,
            timestampMs: ts,
            runId: e.runId,
            reason:
              (p.reason as string | undefined) ??
              "How long should we wait for WhatsApp replies?",
            optionsHours: Array.isArray(p.optionsHours)
              ? (p.optionsHours as unknown[]).map((h) => Number(h)).filter((h) => Number.isFinite(h) && h > 0)
              : [1, 6, 24, 48],
            allowCustom: p.allowCustom !== false,
          });
          break;
        case "wait_ttl_set":
          result.push({
            kind: "wait_ttl_set",
            eventId: e.id,
            timestampMs: ts,
            hours: Number(p.hours ?? 0),
            expiresAt: typeof p.expiresAt === "string" ? p.expiresAt : "",
          });
          break;
        case "wait_progress":
          result.push({
            kind: "wait_progress",
            eventId: e.id,
            timestampMs: ts,
            received: Number(p.received ?? 0),
            remaining: Number(p.remaining ?? 0),
            total: Number(p.total ?? 0),
            phase: typeof p.phase === "string" ? p.phase : undefined,
            reason: typeof p.reason === "string" ? p.reason : undefined,
            sent: p.sent != null ? Number(p.sent) : undefined,
            failed: p.failed != null ? Number(p.failed) : undefined,
          });
          break;
        case "live_artifact_updated":
          result.push({
            kind: "live_artifact_updated",
            eventId: e.id,
            timestampMs: ts,
            url: typeof p.url === "string" ? p.url : "",
            rowCount: Number(p.rowCount ?? 0),
            jid: typeof p.jid === "string" ? p.jid : "",
            interest: typeof p.interest === "string" ? p.interest : "",
          });
          break;
        case "wait_fulfilled":
          result.push({
            kind: "wait_fulfilled",
            eventId: e.id,
            timestampMs: ts,
            responderCount: Number(p.responderCount ?? 1),
            continuePipeline: p.continuePipeline !== false,
            interestSummary: parseInterestSummary(p.interestSummary),
          });
          break;
        case "wait_expired":
          result.push({
            kind: "wait_expired",
            eventId: e.id,
            timestampMs: ts,
            reason: (p.reason as string | undefined) ?? "Wait expired.",
          });
          break;
        case "user_injection":
          result.push({
            kind: "user_injection",
            eventId: e.id,
            timestampMs: ts,
            message: (p.message as string | undefined) ?? "",
            attachments: parseInjectionAttachments(p.attachments),
          });
          break;
        case "clarification_requested":
          result.push({
            kind: "clarification",
            eventId: e.id,
            timestampMs: ts,
            question: (p.question as string | undefined) ?? "",
            userMessage: (p.userMessage as string | undefined) ?? "",
          });
          break;
        case "result_delivered":
          result.push({
            kind: "result_delivered",
            eventId: e.id,
            timestampMs: ts,
            sent: (p.sent as boolean | undefined) ?? false,
            reason: typeof p.reason === "string" ? p.reason : undefined,
            boundary: typeof p.boundary === "string" ? p.boundary : undefined,
            channel: typeof p.channel === "string" ? p.channel : undefined,
          });
          break;
        case "outbound_blocked":
          result.push({
            kind: "outbound_blocked",
            eventId: e.id,
            timestampMs: ts,
            message: typeof p.message === "string" ? p.message : "Blocked: target not found in source data",
          });
          break;
      }
    }
    return result;
  }, [events]);

  /** Chat stream — consecutive tool/brain/status steps by one agent form one execution rail. */
  const chatItems = useMemo<ChatItem[]>(() => {
    const items: ChatItem[] = [];

    for (const ev of processedEvents) {
      if (
        ev.kind === "tool_call" ||
        ev.kind === "brain_query" ||
        ev.kind === "status_step" ||
        ev.kind === "jit_pending" ||
        ev.kind === "jit_resolved"
      ) {
        const agentId = ev.agentId ?? "";
        let entry: ActivityEntry;
        if (ev.kind === "tool_call") {
          entry = {
            id: ev.eventId,
            kind: "tool",
            tool: ev.tool,
            label: ev.actionLabel ?? formatToolId(ev.tool).short,
            status: ev.status,
            ...(ev.sources ? { sources: ev.sources } : {}),
          };
        } else if (ev.kind === "brain_query") {
          entry = {
            id: ev.eventId,
            kind: "brain",
            label:
              ev.citationCount > 0
                ? `Checked company brain — ${ev.citationCount} source${ev.citationCount === 1 ? "" : "s"}`
                : "Checked company brain — nothing matched",
            detail: ev.citationTitles.slice(0, 3).join(" · ") || undefined,
            status: "done",
          };
        } else if (ev.kind === "jit_pending") {
          entry = {
            id: ev.eventId,
            kind: "jit_pending",
            label: ev.label,
            detail: ev.detail,
            status: "running",
            jitRequestId: ev.jitRequestId,
            jitChannel: ev.jitChannel,
            jitScope: ev.jitScope,
            jitContext: ev.jitContext,
            jitWhatsappExpected: ev.jitWhatsappExpected,
            jitWhatsappStatus: ev.jitWhatsappStatus,
          };
        } else if (ev.kind === "jit_resolved") {
          if (
            ev.label === "Approved for this conversation" ||
            ev.label === "Pre-approved for this run"
          ) {
            continue;
          }
          entry = {
            id: ev.eventId,
            kind: "jit_resolved",
            label: ev.label,
            detail: ev.detail,
            status: ev.decision === "denied" || ev.decision === "expired" ? "error" : "done",
          };
        } else {
          entry = {
            id: ev.eventId,
            kind: "status",
            label: ev.label,
            status: ev.status,
            ...(ev.detail ? { detail: ev.detail } : {}),
          };
        }

        // Prefer a matching running tool step when the finished event arrives.
        const last = items[items.length - 1];
        if (
          last &&
          last.kind === "activity" &&
          last.agentId === agentId &&
          entry.kind === "tool" &&
          entry.status !== "running"
        ) {
          const runningIdx = [...last.entries]
            .map((e, i) => ({ e, i }))
            .reverse()
            .find(({ e }) => e.kind === "tool" && e.tool === entry.tool && e.status === "running")?.i;
          if (runningIdx != null) {
            last.entries[runningIdx] = entry;
            continue;
          }
        }

        // Replace outstanding JIT pending card when a decision arrives.
        if (
          last &&
          last.kind === "activity" &&
          last.agentId === agentId &&
          entry.kind === "jit_resolved"
        ) {
          const pendingIdx = [...last.entries]
            .map((e, i) => ({ e, i }))
            .reverse()
            .find(({ e }) => e.kind === "jit_pending")?.i;
          if (pendingIdx != null) {
            last.entries[pendingIdx] = entry;
            continue;
          }
        }

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
        case "run_started":
          items.push({ kind: "started", id: ev.eventId, ts: ev.timestampMs });
          break;
        case "supervisor_plan":
          items.push({ kind: "plan", id: ev.eventId, ts: ev.timestampMs, payload: ev.payload });
          break;
        case "task_delegated":
          items.push({
            kind: "handoff",
            id: ev.eventId,
            ts: ev.timestampMs,
            agentName:
              typeof ev.payload.agentName === "string"
                ? ev.payload.agentName
                : agentNameById((ev.payload.agentId as string | undefined) ?? ev.agentId),
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
          items.push({
            kind: "result",
            id: ev.eventId,
            ts: ev.timestampMs,
            synthesis: ev.synthesis,
          });
          break;
        case "run_failed_event":
          items.push({ kind: "failed", id: ev.eventId, ts: ev.timestampMs, error: ev.error });
          break;
        case "wait_armed":
          break;
        case "wait_ttl_requested":
          items.push({
            kind: "wait_ttl_requested",
            id: ev.eventId,
            ts: ev.timestampMs,
            reason: ev.reason,
            optionsHours: ev.optionsHours,
            allowCustom: ev.allowCustom,
            runId: ev.runId,
          });
          break;
        case "wait_ttl_set":
          items.push({
            kind: "wait_ttl_set",
            id: ev.eventId,
            ts: ev.timestampMs,
            hours: ev.hours,
            expiresAt: ev.expiresAt,
          });
          break;
        case "wait_progress": {
          const next = {
            kind: "wait_progress" as const,
            id: ev.eventId,
            ts: ev.timestampMs,
            received: ev.received,
            remaining: ev.remaining,
            total: ev.total,
            phase: ev.phase,
            reason: ev.reason,
            sent: ev.sent,
            failed: ev.failed,
          };
          const idx = items.findLastIndex((item) => item.kind === "wait_progress");
          if (idx >= 0) items[idx] = next;
          else items.push(next);
          break;
        }
        case "live_artifact_updated": {
          const next = {
            kind: "live_artifact_updated" as const,
            id: ev.eventId,
            ts: ev.timestampMs,
            url: ev.url,
            rowCount: ev.rowCount,
            jid: ev.jid,
            interest: ev.interest,
          };
          const idx = items.findLastIndex((item) => item.kind === "live_artifact_updated");
          if (idx >= 0) items[idx] = next;
          else items.push(next);
          break;
        }
        case "wait_fulfilled":
          items.push({
            kind: "wait_fulfilled",
            id: ev.eventId,
            ts: ev.timestampMs,
            responderCount: ev.responderCount,
            continuePipeline: ev.continuePipeline,
            interestSummary: ev.interestSummary,
          });
          break;
        case "wait_expired":
          items.push({ kind: "wait_expired", id: ev.eventId, ts: ev.timestampMs, reason: ev.reason });
          break;
        case "user_injection":
          items.push({
            kind: "user",
            id: ev.eventId,
            ts: ev.timestampMs,
            message: ev.message,
            attachments: ev.attachments,
          });
          break;
        case "clarification":
          // The message never started a run, so it is replayed from the clarification itself.
          if (ev.userMessage) {
            items.push({
              kind: "user",
              id: `${ev.eventId}-message`,
              ts: ev.timestampMs,
              message: ev.userMessage,
            });
          }
          items.push({
            kind: "clarification",
            id: ev.eventId,
            ts: ev.timestampMs,
            question: ev.question,
          });
          break;
        case "result_delivered":
          items.push({
            kind: "delivered",
            id: ev.eventId,
            ts: ev.timestampMs,
            sent: ev.sent,
            reason: ev.reason,
            boundary: ev.boundary,
            channel: ev.channel,
          });
          break;
        case "outbound_blocked":
          items.push({
            kind: "blocked",
            id: ev.eventId,
            ts: ev.timestampMs,
            message: ev.message,
          });
          break;
        default:
          break;
      }
    }

    return items;
  }, [processedEvents, agentNameById]);

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

  const isPaused = runStatus === "paused" || run?.status === "paused";
  const isRunning = (runStatus === "running" || submitting) && !isPaused;
  const waitTtlAlreadySet = events.some(
    (e) => e.eventType === "wait_ttl_set" && e.runId === run?.id,
  );

  const handleWaitTtl = useCallback(
    async (hours: number) => {
      if (!run?.id || waitTtlSubmitting || waitTtlAlreadySet) return;
      setWaitTtlSubmitting(true);
      setWaitTtlError(null);
      try {
        const result = await setTeamRunWaitTtl(team.id, run.id, hours);
        setEvents((prev) => [
          ...prev,
          {
            id: `local-wait-ttl-${result.expiresAt}`,
            runId: run.id,
            teamId: team.id,
            agentId: null,
            seq: (prev[prev.length - 1]?.seq ?? 0) + 1,
            eventType: "wait_ttl_set",
            payload: {
              hours: result.hours,
              expiresAt: result.expiresAt,
              updatedWaits: result.updatedWaits,
            },
            prevHash: "",
            timestampMs: String(Date.now()),
          },
        ]);
      } catch (err) {
        setWaitTtlError(err instanceof Error ? err.message : "Failed to set wait duration");
      } finally {
        setWaitTtlSubmitting(false);
      }
    },
    [run?.id, team.id, waitTtlAlreadySet, waitTtlSubmitting],
  );

  const handleJitDecision = useCallback(
    async (jitRequestId: string, approved: boolean) => {
      if (jitDeciding[jitRequestId]) return;
      setJitDeciding((p) => ({ ...p, [jitRequestId]: true }));
      setJitError(null);
      const res = await decideJit(jitRequestId, approved);
      if (!res.ok) {
        setJitError(res.errorMessage);
        setJitDeciding((p) => ({ ...p, [jitRequestId]: false }));
        return;
      }

      const agentId =
        events.find((e) => {
          if (e.eventType !== "scope_requested") return false;
          const id = (e.payload as Record<string, unknown> | null)?.jitRequestId;
          return id === jitRequestId;
        })?.agentId ??
        null;

      setEvents((prev) => [
        ...prev,
        {
          id: `local-jit-decision-${jitRequestId}`,
          runId: run?.id ?? "",
          teamId: team.id,
          agentId,
          seq: (prev[prev.length - 1]?.seq ?? 0) + 1,
          eventType: "approval_granted",
          payload: {
            message: approved ? "jit_approval_granted" : "jit_approval_denied",
            decision: approved ? "approved" : "denied",
            jitRequestId,
          },
          prevHash: "",
          timestampMs: String(Date.now()),
        },
      ]);
      setJitDeciding((p) => ({ ...p, [jitRequestId]: false }));
    },
    [events, jitDeciding, run?.id, team.id],
  );

  // Recover approval cards if the live stream missed `scope_requested`.
  useEffect(() => {
    if (!run?.id || (!isRunning && !isPaused)) return;
    let cancelled = false;
    const sync = async () => {
      const pending = await listTeamRunPendingJit(team.id, run.id);
      if (cancelled || pending.length === 0) return;
      setEvents((prev) => mergePendingJitIntoEvents(prev, pending, team.id, run.id));
    };
    void sync();
    const interval = setInterval(() => {
      void sync();
    }, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [run?.id, team.id, isRunning, isPaused]);

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

  const processRunStreamEvent = useCallback((event: TeamRunEventDTO) => {
    processEventForFrames(event);
    const p = event.payload as Record<string, unknown>;

    if (event.eventType === "artifact_produced" && p.artifact) {
      const artifact = p.artifact as TeamRunArtifact;
      setArtifacts((prev) => {
        const index = prev.findIndex((a) => a.id === artifact.id);
        if (index >= 0) {
          return prev.map((a, i) => (i === index ? artifact : a));
        }
        return [...prev, artifact];
      });
    }

    const artifactUpdate = liveArtifactFromEventPayload(event.eventType, event.payload);
    if (artifactUpdate) {
      setLiveArtifact((prev) => mergeLiveArtifact(prev, artifactUpdate));
      setLiveArtifactOpen(true);
    } else if (event.eventType === "live_artifact_updated") {
      const artifactId = typeof p.artifactId === "string" ? p.artifactId : "";
      const url = typeof p.url === "string" ? p.url : "";
      const rowCount = Number(p.rowCount ?? 0);
      if (artifactId && url) {
        setArtifacts((prev) => {
          const index = prev.findIndex((a) => a.id === artifactId);
          if (index < 0) return prev;
          return prev.map((a, i) =>
            i === index
              ? {
                  ...a,
                  content: {
                    ...(typeof a.content === "object" && a.content !== null
                      ? (a.content as Record<string, unknown>)
                      : {}),
                    url,
                    rowCount,
                    ...(Array.isArray(p.columns) ? { columns: p.columns } : {}),
                    ...(Array.isArray(p.rows) ? { rows: p.rows } : {}),
                  },
                }
              : a,
          );
        });
      }
    }
  }, []);

  // ── Start run ──────────────────────────────────────────────────────────────
  async function handleStart(
    text: string,
    files: File[] = [],
    inputPurposes: Array<"authoritative_input" | "reference_asset"> = files.map(
      () => "authoritative_input",
    ),
  ) {
    if (submitting) return;
    if (!text.trim() && files.length === 0) return;
    const finishedStatuses = new Set(["completed", "failed", "canceled"]);
    const isFollowUp = Boolean(
      run &&
      (finishedStatuses.has(runStatus ?? "") || finishedStatuses.has(run.status)),
    );
    const continuesRunId = isFollowUp && run ? run.id : null;
    const localFollowUpId = isFollowUp ? `followup-local-${Date.now()}` : null;
    setSubmitting(true);
    setError(null);
    const display =
      text.trim() ||
      (files.length === 1 ? `Attached ${files[0]!.name}` : `Attached ${files.length} files`);
    const followUpAttachments =
      files.length > 0
        ? files.map((f, i) => ({
            id: `uploading-${i}`,
            fileName: f.name,
            sizeBytes: f.size,
            mimeType: f.type || undefined,
          }))
        : null;

    if (isFollowUp && localFollowUpId && run) {
      setEvents((prev) => [
        ...prev,
        {
          id: localFollowUpId,
          runId: run.id,
          teamId: team.id,
          agentId: null,
          seq: (prev[prev.length - 1]?.seq ?? 0) + 1,
          eventType: "user_injection",
          payload: {
            message: display,
            ...(followUpAttachments ? { attachments: followUpAttachments } : {}),
          },
          prevHash: "local",
          timestampMs: String(Date.now()),
        },
      ]);
    } else {
      setEvents([]);
      setArtifacts([]);
      setLiveArtifact(null);
      setLiveArtifactOpen(true);
      setFinalResult(null);
      setRunStatus(null);
      setBrowserFrames({});
      setToolFrames({});
      setStartedGoal(display);
      setGoalAttachments(null);
      pendingToolEventByAgent.current = {};
    }
    setUploadingAttachments(isFollowUp ? null : followUpAttachments);
    setComposer("");
    setPendingFiles([]);
    setPendingFilePurposes({});
    setFileError(null);
    setFileInputKey((k) => k + 1);
    streamCleanup.current?.();

    try {
      const started = await startTeamRun(
        team.id,
        text.trim(),
        files,
        inputPurposes,
        selectedModel,
        continuesRunId,
        selectedReasoningEffort,
      );
      setRun(started.run);
      if (!isFollowUp) {
        setStartedGoal(started.displayGoal || display);
        setGoalAttachments(started.attachments ?? null);
        setUploadingAttachments(null);
      }
      setRunModelLabel(started.model ?? selectedModel);
      setRunStatus("running");
      void refreshConversations().then((grouped) => {
        const match = grouped.find((item) => item.runs.some((row) => row.id === started.run.id));
        if (match) setActiveRootId(match.rootId);
      });

      const cleanup = streamTeamRun(team.id, started.run.id, {
        onEvent: (event) => {
          setEvents((prev) => {
            if (prev.some((e) => e.id === event.id)) return prev;
            return [...prev, event];
          });
          processRunStreamEvent(event);
        },
        onPaused: () => {
          setRunStatus("paused");
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
      const clarification =
        err instanceof TeamRunStartError && err.code === TEAM_INTENT_CLARIFICATION_CODE
          ? (err.clarification ?? { question: err.message })
          : null;
      // A question back from the team belongs in the transcript, not in the header as an error.
      if (clarification && isFollowUp && run) {
        const eventId = clarification.eventId ?? `clarification-local-${Date.now()}`;
        setEvents((prev) => [
          ...prev.filter((e) => e.id !== localFollowUpId),
          {
            id: eventId,
            runId: clarification.runId ?? run.id,
            teamId: team.id,
            agentId: null,
            seq: (prev[prev.length - 1]?.seq ?? 0) + 1,
            eventType: "clarification_requested",
            payload: { question: clarification.question, userMessage: display },
            prevHash: "local",
            timestampMs: String(Date.now()),
          },
        ]);
        setRunStatus(run.status);
        setPendingFiles(files);
        return;
      }
      setError(err instanceof Error ? err.message : "Failed to start run");
      setRunStatus(isFollowUp ? (run?.status ?? "failed") : "failed");
      if (isFollowUp && localFollowUpId) {
        setEvents((prev) => prev.filter((e) => e.id !== localFollowUpId));
      } else {
        setStartedGoal(null);
        setGoalAttachments(null);
        setUploadingAttachments(null);
      }
      setComposer(text);
      setPendingFiles(files);
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

  async function handleInject(text: string, files: File[] = []) {
    if (!run || injecting) return;
    if (!text.trim() && files.length === 0) return;
    setInjecting(true);
    setComposer("");
    setPendingFiles([]);
    setPendingFilePurposes({});
    setFileError(null);
    setFileInputKey((k) => k + 1);
    try {
      await injectTeamRunMessage(team.id, run.id, text.trim(), files);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message");
      setComposer(text);
      setPendingFiles(files);
    } finally {
      setInjecting(false);
    }
  }

  function addPendingFiles(picked: File[]) {
    if (picked.length === 0) return;
    const oversized = picked.filter((f) => f.size > TEAM_CHAT_MAX_FILE_BYTES);
    if (oversized.length > 0) {
      const names = oversized.map((f) => f.name).join(", ");
      setFileError(
        oversized.length === 1
          ? `"${names}" is too large (max ${TEAM_CHAT_MAX_FILE_MB} MB).`
          : `These files are too large (max ${TEAM_CHAT_MAX_FILE_MB} MB each): ${names}`,
      );
      picked = picked.filter((f) => f.size <= TEAM_CHAT_MAX_FILE_BYTES);
      if (picked.length === 0) return;
    } else {
      setFileError(null);
    }
    setPendingFiles((prev) => {
      const existing = new Set(prev.map((f) => `${f.name}:${f.size}`));
      const merged = [...prev];
      for (const file of picked) {
        if (merged.length >= TEAM_CHAT_MAX_FILES) break;
        const key = `${file.name}:${file.size}`;
        if (!existing.has(key)) {
          existing.add(key);
          merged.push(file);
        }
      }
      if (merged.length >= TEAM_CHAT_MAX_FILES && picked.length > 0) {
        setFileError((prevErr) => prevErr ?? `Maximum ${TEAM_CHAT_MAX_FILES} files`);
      }
      return merged;
    });
  }

  function handleSend() {
    const text = composer.trim();
    const files = [...pendingFiles];
    const inputPurposes = files.map(
      (file) => pendingFilePurposes[`${file.name}:${file.size}`] ?? "authoritative_input",
    );
    if (!text && files.length === 0) return;
    if (!canSend && !(isRunning && run)) return;
    if (isRunning && run && !submitting) {
      void handleInject(text, files);
      return;
    }
    void handleStart(text, files, inputPurposes);
  }

  function resetConversationState() {
    streamCleanup.current?.();
    streamCleanup.current = null;
    setRun(null);
    setEvents([]);
    setArtifacts([]);
    setLiveArtifact(null);
    setLiveArtifactOpen(true);
    setFinalResult(null);
    setRunStatus(null);
    setStartedGoal(null);
    setGoalAttachments(null);
    setUploadingAttachments(null);
    setRunModelLabel(null);
    setError(null);
    setPendingFiles([]);
    setPendingFilePurposes({});
    setFileError(null);
    setFileInputKey((k) => k + 1);
    setBrowserFrames({});
    setToolFrames({});
    pendingToolEventByAgent.current = {};
  }

  function startNewChat() {
    hydrateGen.current += 1;
    resetConversationState();
    setActiveRootId(null);
    setHydrating(false);
    setHistoryOpen(false);
  }

  async function refreshConversations(): Promise<TeamConversation[]> {
    setHistoryLoading(true);
    try {
      const runs = await listTeamRuns(team.id);
      const grouped = groupTeamConversations(runs);
      setConversations(grouped);
      return grouped;
    } catch {
      return conversations;
    } finally {
      setHistoryLoading(false);
    }
  }

  async function loadConversation(runId: string) {
    const gen = ++hydrateGen.current;
    setHydrating(true);
    setError(null);
    setHistoryOpen(false);
    streamCleanup.current?.();
    streamCleanup.current = null;
    try {
      const runs = await listTeamRuns(team.id);
      const grouped = groupTeamConversations(runs);
      setConversations(grouped);
      const chain = conversationRunsFor(runs, runId);
      const ids = chain.length > 0 ? chain.map((item) => item.id) : [runId];
      const details = await Promise.all(ids.map((id) => getTeamRun(team.id, id)));
      if (gen !== hydrateGen.current || details.length === 0) {
        setHydrating(false);
        return;
      }
      const root = details[0]!;
      const latest = details[details.length - 1]!;
      const mergedEvents: TeamRunEventDTO[] = [];
      for (const [index, detail] of details.entries()) {
        if (index > 0) {
          mergedEvents.push({
            id: `conversation-turn-${detail.run.id}`,
            runId: detail.run.id,
            teamId: team.id,
            agentId: null,
            seq: (mergedEvents[mergedEvents.length - 1]?.seq ?? 0) + 1,
            eventType: "user_injection",
            payload: { message: displayGoalText(detail.run.goal) },
            prevHash: "conversation",
            timestampMs: String(new Date(detail.run.createdAt).getTime()),
          });
        }
        mergedEvents.push(...detail.events);
      }
      const match = grouped.find((item) => item.runs.some((row) => row.id === latest.run.id));
      setActiveRootId(match?.rootId ?? root.run.id);
      setRun(latest.run);
      setStartedGoal(root.run.goal);
      setGoalAttachments(parseAttachmentsFromEnrichedPrompt(root.run.goal) ?? null);
      setEvents(mergedEvents);
      setArtifacts(latest.run.artifacts ?? []);
      setRunStatus(latest.run.status);
      setFinalResult(
        typeof (latest.run.result as { synthesis?: unknown } | null)?.synthesis === "string"
          ? String((latest.run.result as { synthesis: string }).synthesis)
          : null,
      );
      setLiveArtifact(
        replayLiveArtifactFromEvents(mergedEvents) ??
          liveArtifactFromCheckpoint(latest.run.checkpointJson) ??
          null,
      );
      setLiveArtifactOpen(true);
      setHydrating(false);
      if (
        latest.run.status === "running" ||
        latest.run.status === "queued" ||
        latest.run.status === "paused"
      ) {
        const lastSeq =
          latest.events.length > 0 ? latest.events[latest.events.length - 1]!.seq : -1;
        attachRunStream(latest.run.id, lastSeq);
      }
    } catch (err) {
      if (gen === hydrateGen.current) {
        setHydrating(false);
        setError(err instanceof Error ? err.message : "Failed to open conversation");
      }
    }
  }

  function attachRunStream(runId: string, afterSeq: number) {
    streamCleanup.current?.();
    streamCleanup.current = streamTeamRun(team.id, runId, {
      onEvent: (event) => {
        setEvents((prev) => (prev.some((e) => e.id === event.id) ? prev : [...prev, event]));
        processRunStreamEvent(event);
      },
      onPaused: () => {
        setRunStatus("paused");
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
    }, afterSeq);
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const grouped = await refreshConversations();
      if (cancelled) return;
      const paused = grouped.find((item) => item.latest.status === "paused");
      if (paused) {
        await loadConversation(paused.latest.id);
        return;
      }
      setHydrating(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load chats once per team
  }, [team.id]);

  const supervisorName = agentNameById(team.supervisorAgentId ?? null);
  const goalText = displayGoalText(startedGoal ?? run?.goal ?? "");
  const displayGoalAttachments = useMemo(() => {
    if (uploadingAttachments && uploadingAttachments.length > 0) return uploadingAttachments;
    if (goalAttachments && goalAttachments.length > 0) return goalAttachments;
    const fromGoal =
      !startedGoal && run?.goal ? parseAttachmentsFromEnrichedPrompt(run.goal) : undefined;
    return fromGoal ?? undefined;
  }, [uploadingAttachments, goalAttachments, run?.goal, startedGoal]);
  const goalAttachmentDelivery =
    uploadingAttachments && uploadingAttachments.length > 0 ? "uploading" : "confirmed";
  const hasConversation = Boolean(goalText) || chatItems.length > 0;
  const planningActive =
    isRunning &&
    !processedEvents.some(
      (event) => event.kind === "supervisor_plan" || event.kind === "task_delegated",
    );

  const activeRunModel = useMemo(() => {
    if (runModelLabel) return runModelLabel;
    for (const e of events) {
      if (e.eventType !== "run_started") continue;
      const p = e.payload as Record<string, unknown>;
      if (typeof p.model === "string" && p.model.trim()) return p.model.trim();
    }
    for (const e of events) {
      if (e.eventType !== "task_status_update") continue;
      const p = e.payload as Record<string, unknown>;
      if (p.message === "inference_request" && typeof p.model === "string" && p.model.trim()) {
        return p.model.trim();
      }
    }
    return null;
  }, [runModelLabel, events]);

  const statusLabel = isRunning
    ? "Running"
    : isPaused
      ? liveArtifact
        ? "Waiting for replies"
        : "Paused"
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

  const placeholder = !canSend
    ? "Agents are still getting ready…"
    : isPaused
    ? "Waiting for WhatsApp replies…"
    : isRunning
      ? "Add guidance while they work…"
      : run
        ? "Continue this conversation…"
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

      {/* ── Main: conversation + live sheet ───────────────────────────────── */}
      <div className="relative flex min-h-0 min-w-0 flex-1">
      {/* ── Conversation ─────────────────────────────────────────────────── */}
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        {historyOpen ? (
          <>
            <button
              type="button"
              aria-label="Close recent chats"
              onClick={() => setHistoryOpen(false)}
              className="absolute inset-0 z-30 bg-black/10"
            />
            <aside
              className="absolute inset-y-0 left-0 z-40 flex w-[min(17rem,82%)] flex-col border-r bg-white shadow-[5px_0_0_rgba(0,0,0,0.08)]"
              style={{ borderColor: "var(--ink-border)" }}
              aria-label="Recent chats"
            >
              <div className={cn("flex items-center justify-between border-b px-3 py-3", HAIRLINE)}>
                <span className="font-serif text-[11px] uppercase tracking-widest text-black">
                  Recent chats
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label="Start a new chat"
                    onClick={startNewChat}
                    className="flex size-7 items-center justify-center text-black/50 hover:text-black"
                  >
                    <MessageSquarePlus className="size-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-label="Close recent chats"
                    onClick={() => setHistoryOpen(false)}
                    className="flex size-7 items-center justify-center text-black/50 hover:text-black"
                  >
                    <X className="size-4" aria-hidden />
                  </button>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-2">
                {historyLoading && conversations.length === 0 ? (
                  <div className={cn("flex items-center gap-2 px-2 py-3 text-[11px]", INK_SOFT)}>
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                    Loading chats…
                  </div>
                ) : conversations.length === 0 ? (
                  <p className={cn("px-2 py-3 text-[11px]", INK_SOFT)}>No recent chats yet.</p>
                ) : (
                  <div className="space-y-1">
                    {conversations.map((conversation) => {
                      const selected = conversation.rootId === activeRootId;
                      return (
                        <button
                          key={conversation.rootId}
                          type="button"
                          onClick={() => void loadConversation(conversation.latest.id)}
                          className={cn(
                            "w-full truncate px-2.5 py-2 text-left text-[11.5px] transition-colors",
                            selected
                              ? "border border-black bg-black text-white"
                              : "border border-transparent text-black hover:border-black/20 hover:bg-black/[0.03]",
                          )}
                        >
                          {conversationTitle(conversation.root.goal)}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </aside>
          </>
        ) : null}

        <div className="flex shrink-0 items-center gap-2 px-6 py-2">
          <button
            type="button"
            onClick={() => {
              setHistoryOpen(true);
              void refreshConversations();
            }}
            className={quietButton}
            aria-label="Recent chats"
            title="Recent chats"
          >
            <PanelLeft size={12} />
          </button>
          <button
            type="button"
            onClick={startNewChat}
            className={quietButton}
            aria-label="New chat"
            title="New chat"
          >
            <MessageSquarePlus size={12} />
          </button>

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
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10.5px] font-medium",
                isRunning
                  ? "border-violet-500/15 bg-violet-50 text-violet-800"
                  : isPaused
                    ? "border-amber-500/20 bg-amber-50 text-amber-800"
                    : runStatus === "completed"
                      ? "border-emerald-600/15 bg-emerald-50 text-emerald-800"
                      : runStatus === "failed"
                        ? "border-red-500/15 bg-red-50 text-red-700"
                        : "border-black/10 bg-black/[0.03] text-black/55",
              )}
            >
              <span className={cn("size-1.5 rounded-full", statusDot)} aria-hidden />
              {statusLabel}
            </span>
          )}

          <div className="flex-1" />

          {liveArtifact ? (
            <button
              type="button"
              onClick={() => setLiveArtifactOpen((open) => !open)}
              className={cn(
                quietButton,
                liveArtifactOpen && "bg-black/[0.06] text-black",
              )}
              aria-pressed={liveArtifactOpen}
            >
              <Table2 size={12} />
              {liveArtifact.previewKind === "table" ? "Sheet" : "File"}
              {liveArtifact.rowCount > 0 ? ` (${liveArtifact.rowCount})` : ""}
            </button>
          ) : null}

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

        </div>

        <div
          ref={timelineScrollRef}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-4"
        >
          <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
            {viewMode === "graph" && (
              <TeamRunGraph team={team} agentStates={agentStates} goal={goalText} />
            )}

            {showChat && hydrating && (
              <div className="flex flex-col items-center gap-2 py-20 text-center">
                <Loader2 size={16} className="animate-spin text-black/35" />
                <p className={cn("text-[12.5px]", INK_SOFT)}>Opening conversation…</p>
              </div>
            )}

            {showChat && !hydrating && !hasConversation && (
              <div className="flex flex-col items-center gap-2 py-20 text-center">
                <p className="text-[15px] font-medium text-black">
                  What should {team.name} work on?
                </p>
                <p className={cn("max-w-sm text-[12.5px] leading-relaxed", INK_SOFT)}>
                  Describe the outcome you want. Luna-Teams coordinates the right specialists and
                  keeps each handoff focused.
                </p>
              </div>
            )}

            {showChat && goalText && (
              <>
                <UserMessage
                  text={goalText}
                  attachments={displayGoalAttachments}
                  delivery={goalAttachmentDelivery}
                />
                {activeRunModel ? (
                  <SystemLine icon={Zap}>
                    Model: {formatModelOptionLabel(activeRunModel)}
                  </SystemLine>
                ) : null}
              </>
            )}

            {showChat && chatItems.map((item) => {
              switch (item.kind) {
                case "started":
                  return (
                    <SystemLine key={item.id} icon={Zap} tone="info" active={planningActive}>
                      Luna-Teams started · preparing specialist dispatches
                    </SystemLine>
                  );
                case "plan":
                  return (
                    <ChatMessage
                      key={item.id}
                      name="Luna-Teams"
                      role="supervisor"
                      timestampMs={item.ts}
                    >
                      <PlanBody
                        payload={item.payload}
                        agentNameById={agentNameById}
                        agentStates={agentStates}
                      />
                    </ChatMessage>
                  );

                case "handoff":
                  return (
                    <SystemLine key={item.id} icon={Send} tone="info">
                      Dispatched focused work to {item.agentName}
                    </SystemLine>
                  );

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
                        jitDeciding={jitDeciding}
                        jitError={jitError}
                        onJitDecision={(jitRequestId, approved) => {
                          void handleJitDecision(jitRequestId, approved);
                        }}
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

                case "result": {
                  const resultText = item.synthesis || finalResult;
                  return resultText ? (
                    <ChatMessage
                      key={item.id}
                      name="Luna-Teams"
                      role="supervisor"
                      timestampMs={item.ts}
                    >
                      <ResultBody result={resultText} />
                    </ChatMessage>
                  ) : null;
                }

                case "failed":
                  return (
                    <SystemLine key={item.id} icon={XCircle} tone="danger">
                      {item.error}
                    </SystemLine>
                  );
                case "wait_armed":
                  return null;
                case "wait_ttl_requested": {
                  const ttlPickerActive = isPaused && item.runId === run?.id;
                  const ttlDisabled = waitTtlSubmitting || waitTtlAlreadySet || !ttlPickerActive;
                  return (
                    <div
                      key={item.id}
                      className="rounded-xl border border-black/10 bg-[color:var(--sketch-paper)]/80 px-3 py-3"
                    >
                      <p className="text-[13px] font-medium text-black/85">{item.reason}</p>
                      <div className="mt-2.5 flex flex-wrap gap-2">
                        {item.optionsHours.map((hours) => (
                          <button
                            key={hours}
                            type="button"
                            disabled={ttlDisabled}
                            onClick={() => void handleWaitTtl(hours)}
                            className={cn(sketchButtonPrimary, "disabled:opacity-50")}
                          >
                            {waitTtlSubmitting && ttlPickerActive ? (
                              <Loader2 className="size-3 animate-spin" aria-hidden />
                            ) : null}
                            {hours === 1 ? "1 hour" : `${hours} hours`}
                          </button>
                        ))}
                      </div>
                      {item.allowCustom ? (
                        <div className="mt-2.5 flex flex-wrap items-center gap-2">
                          <input
                            type="number"
                            min={customWaitUnit === "minutes" ? 15 : 0.25}
                            max={customWaitUnit === "minutes" ? 10080 : 168}
                            step={customWaitUnit === "minutes" ? 5 : 0.25}
                            value={customWaitValue}
                            disabled={ttlDisabled}
                            onChange={(e) => setCustomWaitValue(e.target.value)}
                            className="w-24 rounded-lg border border-black/15 bg-white px-2 py-1.5 text-[12px]"
                            aria-label={`Custom wait ${customWaitUnit}`}
                          />
                          <select
                            value={customWaitUnit}
                            disabled={ttlDisabled}
                            onChange={(e) => {
                              const next = e.target.value === "hours" ? "hours" : "minutes";
                              setCustomWaitUnit(next);
                              setCustomWaitValue(next === "minutes" ? "30" : "2");
                            }}
                            className="rounded-lg border border-black/15 bg-white px-2 py-1.5 text-[12px]"
                            aria-label="Custom wait unit"
                          >
                            <option value="minutes">minutes</option>
                            <option value="hours">hours</option>
                          </select>
                          <button
                            type="button"
                            disabled={ttlDisabled}
                            onClick={() => {
                              const amount = Number(customWaitValue);
                              if (!Number.isFinite(amount) || amount <= 0) {
                                setWaitTtlError("Enter a valid wait duration");
                                return;
                              }
                              const hours =
                                customWaitUnit === "minutes" ? amount / 60 : amount;
                              if (hours < 0.25) {
                                setWaitTtlError("Minimum wait is 15 minutes");
                                return;
                              }
                              if (hours > 168) {
                                setWaitTtlError("Maximum wait is 168 hours (7 days)");
                                return;
                              }
                              void handleWaitTtl(hours);
                            }}
                            className={cn(sketchButtonPrimary, "disabled:opacity-50")}
                          >
                            Custom
                          </button>
                        </div>
                      ) : null}
                      {waitTtlAlreadySet && ttlPickerActive ? (
                        <p className="mt-2 text-[11px] text-black/50">Wait duration set.</p>
                      ) : null}
                      {waitTtlError && ttlPickerActive ? (
                        <p className="mt-2 text-[11px] text-[color:var(--sketch-red)]">{waitTtlError}</p>
                      ) : null}
                    </div>
                  );
                }
                case "wait_ttl_set":
                  return (
                    <SystemLine key={item.id} icon={CheckCircle} tone="warning">
                      Waiting up to {formatWaitDuration(item.hours)}
                      {item.expiresAt
                        ? ` (until ${new Date(item.expiresAt).toLocaleString()})`
                        : ""}
                      .
                    </SystemLine>
                  );
                case "wait_progress": {
                  if (item.phase === "messages_sent") {
                    const sent = item.sent ?? item.received;
                    const failed = item.failed ?? 0;
                    const listening =
                      item.total > 0
                        ? ` Listening for replies (0 of ${item.total} received).`
                        : "";
                    return (
                      <SystemLine key={item.id} icon={Phone} tone={failed > 0 ? "warning" : "success"}>
                        {item.reason?.trim() ||
                          `Sent ${sent ?? 0} WhatsApp message${(sent ?? 0) === 1 ? "" : "s"}${failed > 0 ? ` (${failed} failed)` : ""}.`}
                        {listening}
                      </SystemLine>
                    );
                  }
                  const total = item.total > 0 ? item.total : item.received + item.remaining;
                  return (
                    <SystemLine key={item.id} icon={Phone} tone="warning" active={isPaused && item.remaining > 0}>
                      {item.reason?.trim() && item.phase === "listening"
                        ? item.reason
                        : `WhatsApp replies: ${item.received} of ${total} received${item.remaining > 0 ? " — still waiting." : "."}`}
                    </SystemLine>
                  );
                }
                case "live_artifact_updated":
                  return (
                    <SystemLine key={item.id} icon={FileText} tone="success">
                      Live sheet updated ({item.rowCount} row{item.rowCount === 1 ? "" : "s"}
                      {item.jid ? ` · ${item.jid.split("@")[0]}` : ""}
                      {item.interest ? ` · ${item.interest}` : ""}).
                    </SystemLine>
                  );
                case "wait_fulfilled":
                  return (
                    <SystemLine key={item.id} icon={CheckCircle} tone="success">
                      {formatWaitFulfilledLine(
                        item.responderCount,
                        item.interestSummary,
                        item.continuePipeline,
                      )}
                    </SystemLine>
                  );
                case "wait_expired":
                  return (
                    <SystemLine key={item.id} icon={XCircle} tone="danger">
                      {item.reason}
                    </SystemLine>
                  );

                case "user":
                  return (
                    <UserMessage
                      key={item.id}
                      text={item.message}
                      attachments={item.attachments}
                    />
                  );

                case "clarification":
                  return (
                    <ChatMessage
                      key={item.id}
                      name="Luna-Teams"
                      role="supervisor"
                      timestampMs={item.ts}
                    >
                      <div className="rounded-2xl border border-black/10 bg-[color:var(--sketch-paper)]/80 px-4 py-3">
                        <p className="text-[13px] leading-relaxed text-black/85">{item.question}</p>
                        <p className="mt-2 text-[11px] text-[color:var(--ink-faint)]">
                          Nothing was run — reply here and we&apos;ll pick it up from there.
                        </p>
                      </div>
                    </ChatMessage>
                  );

                case "delivered":
                  return (
                    <SystemLine key={item.id} icon={Phone} tone={item.sent ? "success" : "danger"}>
                      {item.sent
                        ? item.boundary === "wait_resume"
                          ? "Live result file sent to your WhatsApp"
                          : `Result sent to your ${item.channel === "whatsapp" ? "WhatsApp" : "delivery channel"}`
                        : `Couldn't deliver the result${item.reason ? ` — ${item.reason}` : ""}`}
                    </SystemLine>
                  );

                case "blocked":
                  return (
                    <SystemLine key={item.id} icon={ShieldAlert} tone="danger">
                      {item.message}
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

        {/* ── Composer ───────────────────────────────────────────────────── */}
        <div className="shrink-0 px-6 pb-5 pt-2">
          <div className="mx-auto w-full max-w-2xl">
            {pendingFiles.length > 0 ? (
              <ul className="mb-2 flex flex-wrap gap-1.5">
                {pendingFiles.map((f, i) => (
                  <li
                    key={`${f.name}-${f.size}-${i}`}
                    className="inline-flex max-w-full items-center gap-1 rounded-full border border-black/12 bg-white/90 px-2.5 py-1 text-[11px] text-black/70"
                  >
                    <FileText className="size-3 shrink-0" aria-hidden />
                    <span className="truncate max-w-[10rem]">{f.name}</span>
                    <span className="shrink-0 text-black/40">{formatFileSize(f.size)}</span>
                    <button
                      type="button"
                      disabled={injecting || submitting}
                      onClick={() => {
                        const key = `${f.name}:${f.size}`;
                        setPendingFilePurposes((prev) => ({
                          ...prev,
                          [key]:
                            (prev[key] ?? "authoritative_input") === "authoritative_input"
                              ? "reference_asset"
                              : "authoritative_input",
                        }));
                      }}
                      className="ml-1 rounded-full bg-black/5 px-1.5 py-0.5 text-[10px] font-medium text-black/55 hover:bg-black/10"
                      title="Source data may drive actions; reference files provide context only"
                    >
                      {(pendingFilePurposes[`${f.name}:${f.size}`] ?? "authoritative_input") ===
                      "authoritative_input"
                        ? "Source"
                        : "Reference"}
                    </button>
                    <button
                      type="button"
                      disabled={injecting || submitting}
                      onClick={() => {
                        setPendingFiles((prev) => prev.filter((_, idx) => idx !== i));
                        const key = `${f.name}:${f.size}`;
                        setPendingFilePurposes((prev) => {
                          const next = { ...prev };
                          delete next[key];
                          return next;
                        });
                        setFileError(null);
                      }}
                      className="ml-0.5 shrink-0 rounded-full p-0.5 text-black/40 transition-colors hover:bg-black/5 hover:text-black disabled:opacity-40"
                      title="Remove file"
                    >
                      <X className="size-3" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {fileError ? (
              <p className="mb-1.5 text-[11px] text-[color:var(--sketch-red)]">{fileError}</p>
            ) : null}
            <div
              className={cn(
                "flex items-end gap-2 rounded-3xl border bg-white/70 px-3 py-2 backdrop-blur-sm transition-colors focus-within:border-[color:var(--sketch-purple)]/45",
                HAIRLINE,
              )}
            >
              <input
                ref={fileInputRef}
                key={fileInputKey}
                type="file"
                multiple
                accept={TEAM_CHAT_FILE_ACCEPT}
                className="sr-only"
                disabled={injecting || submitting || isPaused || !canSend || pendingFiles.length >= TEAM_CHAT_MAX_FILES}
                onChange={(e) => {
                  addPendingFiles(Array.from(e.target.files ?? []));
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                disabled={injecting || submitting || isPaused || !canSend || pendingFiles.length >= TEAM_CHAT_MAX_FILES}
                onClick={() => fileInputRef.current?.click()}
                title={
                  isPaused
                    ? "Resume or start a new run to attach files"
                    : pendingFiles.length >= TEAM_CHAT_MAX_FILES
                      ? `Maximum ${TEAM_CHAT_MAX_FILES} files`
                      : `Attach files (up to ${TEAM_CHAT_MAX_FILES}, max ${TEAM_CHAT_MAX_FILE_MB} MB each)`
                }
                aria-label="Attach files"
                className="mb-0.5 grid size-8 shrink-0 place-items-center rounded-full border border-black/10 bg-white text-black/55 transition-colors hover:border-black/25 hover:text-black disabled:opacity-30"
              >
                <Paperclip size={14} />
              </button>
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
                disabled={isPaused || !canSend}
                className="max-h-40 min-h-[26px] flex-1 resize-none bg-transparent py-1.5 text-[13px] leading-relaxed text-black outline-none disabled:opacity-50"
              />
              <button
                type="button"
                onClick={handleSend}
                disabled={
                  (!composer.trim() && pendingFiles.length === 0) ||
                  submitting ||
                  injecting ||
                  isPaused ||
                  !canSend
                }
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
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-0.5">
              <label className={cn("inline-flex items-center gap-1.5 text-[11px]", INK_SOFT)}>
                <span className="shrink-0">Model</span>
                <select
                  value={
                    modelOptionIds.has(selectedModel)
                      ? selectedModel
                      : TEAM_RUN_AGENT_DEFAULT_MODEL
                  }
                  onChange={(e) => setSelectedModel(e.target.value)}
                  disabled={isRunning || submitting}
                  title={
                    isRunning
                      ? "Model applies to the next new run"
                      : "LLM used by all agents in this team run"
                  }
                  className="max-w-[20rem] truncate rounded-full border border-black/12 bg-white/90 px-2.5 py-1 text-[11px] text-black/80 outline-none disabled:opacity-50"
                >
                  {!modelOptionIds.has(selectedModel) ? (
                    <option value={selectedModel}>{formatModelOptionLabel(selectedModel)}</option>
                  ) : null}
                  {modelGroups.map((group) => (
                    <optgroup key={group.label} label={group.label}>
                      {group.options.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
              <ReasoningEffortPicker
                size="compact"
                value={selectedReasoningEffort}
                onChange={setSelectedReasoningEffort}
                disabled={isRunning || submitting}
              />
              <p className={cn("text-[10.5px]", INK_FAINT)}>
                {isRunning
                  ? `Enter to send · attach up to ${TEAM_CHAT_MAX_FILES} files · they'll pick it up on the next step`
                  : `Enter to send · attach up to ${TEAM_CHAT_MAX_FILES} files · Shift+Enter for a new line`}
              </p>
            </div>
          </div>
        </div>
      </div>

      {liveArtifact && liveArtifactOpen ? (
        <>
          <button
            type="button"
            className="absolute inset-0 z-20 bg-black/20 lg:hidden"
            onClick={() => setLiveArtifactOpen(false)}
            aria-label="Close document overlay"
          />
          <LiveArtifactPanel
            artifact={liveArtifact}
            isLive={isPaused}
            onClose={() => setLiveArtifactOpen(false)}
            className={cn(
              "z-30 w-[min(480px,42%)] shrink-0",
              "max-lg:fixed max-lg:inset-y-0 max-lg:right-0 max-lg:w-full max-lg:max-w-md max-lg:shadow-2xl",
            )}
          />
        </>
      ) : null}
      </div>
    </div>
  );
}
