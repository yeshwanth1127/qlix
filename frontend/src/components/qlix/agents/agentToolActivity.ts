import type { LucideIcon } from "lucide-react";
import { Brain, Globe, Monitor, ShieldCheck, Terminal, Wrench } from "lucide-react";

export type ToolCategory = "browser" | "brain" | "system" | "agents3" | "approval" | "other";

export type ActivityStep = {
  id: string;
  label: string;
  detail?: string;
  tone: "neutral" | "accent" | "success" | "warn" | "error";
  category?: ToolCategory;
  kind?: "tool_round" | "tool_done" | "jit_pending" | "jit_resolved" | "other";
  toolIds?: string[];
  toolId?: string;
  /** Source URLs a research/browse tool drew its data from (rendered inline). */
  sources?: Array<{ url: string; title?: string }>;
  /** Pending JIT only: id used to approve/deny from the dashboard, and the routing channel. */
  jitRequestId?: string;
  jitChannel?: "dashboard" | "whatsapp";
  jitScope?: string;
  /** Pending JIT only: WhatsApp was the configured approval channel but it isn't connected. */
  jitWhatsappExpected?: boolean;
  jitWhatsappStatus?: "disconnected" | "not_linked";
};

/** Normalize the `sources` payload on a tool_finished event into safe link rows. */
function parseSources(raw: unknown): Array<{ url: string; title?: string }> | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: Array<{ url: string; title?: string }> = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const url = (item as Record<string, unknown>).url;
    if (typeof url !== "string" || !/^https?:\/\//i.test(url)) continue;
    const title = (item as Record<string, unknown>).title;
    out.push({ url, title: typeof title === "string" && title.trim() ? title.trim() : undefined });
  }
  return out.length > 0 ? out : undefined;
}

const TOOL_META: Record<string, { label: string; category: ToolCategory; verb?: string }> = {
  browser_navigate: { label: "Browser", category: "browser", verb: "Navigate to page" },
  browser_click: { label: "Browser", category: "browser", verb: "Click element" },
  browser_type: { label: "Browser", category: "browser", verb: "Type into field" },
  browser_screenshot: { label: "Browser", category: "browser", verb: "Take screenshot" },
  browser_extract: { label: "Browser", category: "browser", verb: "Extract page content" },
  browser_axtree: { label: "Browser", category: "browser", verb: "Read page structure" },
  browser_ab_open: { label: "Browser", category: "browser", verb: "Open URL" },
  browser_ab_snapshot: { label: "Browser", category: "browser", verb: "Page snapshot" },
  browser_ab_click: { label: "Browser", category: "browser", verb: "Click" },
  browser_ab_fill: { label: "Browser", category: "browser", verb: "Fill field" },
  browser_ab_type: { label: "Browser", category: "browser", verb: "Type" },
  browser_ab_screenshot: { label: "Browser", category: "browser", verb: "Screenshot" },
  browser_ab_find: { label: "Browser", category: "browser", verb: "Find & act" },
  browser_ab_get: { label: "Browser", category: "browser", verb: "Get page info" },
  browser_exec: { label: "Browser", category: "browser", verb: "CLI command" },
  research_web_search: { label: "Research", category: "browser", verb: "Web search (Exa)" },
  research_read_url: { label: "Research", category: "browser", verb: "Read URL" },
  research_social_search: { label: "Research", category: "browser", verb: "Social search" },
  research_video: { label: "Research", category: "browser", verb: "Video transcript" },
  create_report_pdf: { label: "Document", category: "brain", verb: "Create PDF report" },
  create_xlsx: { label: "Document", category: "brain", verb: "Create spreadsheet" },
  whatsapp_send: { label: "WhatsApp", category: "other", verb: "Send file" },
  whatsapp_list_contacts: { label: "WhatsApp", category: "other", verb: "List contacts" },
  whatsapp_read_chat: { label: "WhatsApp", category: "other", verb: "Read chat" },
  whatsapp_send_message: { label: "WhatsApp", category: "other", verb: "Send message" },
  brain_query: { label: "AI Brain", category: "brain", verb: "Query knowledge" },
  brain_knowledge_read: { label: "AI Brain", category: "brain", verb: "Read knowledge" },
  shell_exec: { label: "Shell", category: "system", verb: "Run command" },
  code_interpreter: { label: "Code", category: "system", verb: "Run code" },
  luna_local_read_file: { label: "luna_local", category: "agents3", verb: "Read file" },
  luna_local_write_file: { label: "luna_local", category: "agents3", verb: "Write file" },
  luna_local_list_dir: { label: "luna_local", category: "agents3", verb: "List directory" },
  luna_local_open_file: { label: "luna_local", category: "agents3", verb: "Open on desktop" },
  luna_local_search_files: { label: "luna_local", category: "agents3", verb: "Search files" },
  luna_local_patch: { label: "luna_local", category: "agents3", verb: "Apply patch" },
  luna_local_pwd: { label: "luna_local", category: "agents3", verb: "Print cwd" },
  luna_local_cd: { label: "luna_local", category: "agents3", verb: "Change cwd" },
  luna_local_bash: { label: "luna_local", category: "agents3", verb: "Shell (LocalEnv)" },
  luna_local_python: { label: "luna_local", category: "agents3", verb: "Python (LocalEnv)" },
  luna_local_code_task: { label: "luna_local", category: "agents3", verb: "CodeAgent task" },
  luna_local_create_pdf: { label: "luna_local", category: "agents3", verb: "Create PDF" },
  luna_local_create_xlsx: { label: "luna_local", category: "agents3", verb: "Create spreadsheet" },
  luna_local_send_whatsapp_document: { label: "luna_local", category: "agents3", verb: "Send WhatsApp file" },
  gui_control: { label: "luna_local", category: "agents3", verb: "Desktop (GUI)" },
};

export function isBrowserToolId(toolId: string): boolean {
  return (
    toolId.startsWith("browser_ab_") ||
    toolId.startsWith("browser_") ||
    toolId === "browser_exec"
  );
}

export type InferenceToolDetail = {
  name: string;
  label?: string;
  tool_args?: Record<string, string>;
};

/** Parsed `tool_details` from an inference_tool_round log (includes search targets for browser tools). */
export function parseInferenceToolDetails(payload: Record<string, unknown>): InferenceToolDetail[] {
  const raw = payload.tool_details;
  if (!Array.isArray(raw)) return [];
  const out: InferenceToolDetail[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const name = typeof o.name === "string" ? o.name : "";
    if (!name) continue;
    const label = typeof o.label === "string" && o.label.trim() ? o.label.trim() : undefined;
    let tool_args: Record<string, string> | undefined;
    if (o.tool_args && typeof o.tool_args === "object" && !Array.isArray(o.tool_args)) {
      tool_args = o.tool_args as Record<string, string>;
    }
    out.push({ name, label, tool_args });
  }
  return out;
}

function parseToolCallParams(payload: Record<string, unknown>): Record<string, unknown> {
  if (payload.tool_args && typeof payload.tool_args === "object" && !Array.isArray(payload.tool_args)) {
    return payload.tool_args as Record<string, unknown>;
  }
  if (payload.params && typeof payload.params === "object" && !Array.isArray(payload.params)) {
    return payload.params as Record<string, unknown>;
  }
  const raw = payload.arguments ?? payload.args;
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

function formatBrowserToolIntent(toolId: string, params: Record<string, unknown>): string {
  if (toolId === "browser_navigate" || toolId === "browser_ab_open") {
    const url = String(params.url ?? "").trim();
    return url ? `Open ${url.slice(0, 120)}` : "Open page";
  }
  if (toolId === "browser_click" || toolId === "browser_ab_click" || toolId === "browser_ab_dblclick") {
    const sel = String(params.selector ?? params.value ?? params.text ?? "").trim();
    return sel ? `Click “${sel.slice(0, 80)}”` : "Click element";
  }
  if (toolId === "browser_type" || toolId === "browser_ab_type" || toolId === "browser_ab_fill" || toolId === "browser_type") {
    const sel = String(params.selector ?? "").trim();
    const text = String(params.text ?? params.value ?? "").trim();
    const preview = text.length > 40 ? `${text.slice(0, 40)}…` : text;
    if (sel && preview) return `Type “${preview}” into ${sel.slice(0, 60)}`;
    if (preview) return `Type “${preview}”`;
    return sel ? `Fill ${sel.slice(0, 60)}` : "Type into field";
  }
  if (toolId === "browser_ab_snapshot" || toolId === "browser_axtree") {
    return "Scan page structure for contact info";
  }
  if (toolId === "browser_ab_screenshot" || toolId === "browser_screenshot") {
    return "Capture page screenshot";
  }
  if (toolId === "browser_ab_find") {
    const loc = String(params.locator ?? "").trim();
    const val = String(params.value ?? "").trim();
    const name = String(params.name ?? "").trim();
    const act = String(params.action ?? "").trim();
    const target = val || name;
    if (target) {
      const via = loc ? ` (${loc})` : "";
      const tail = act ? ` · ${act}` : "";
      return `Looking for “${target.slice(0, 80)}”${via}${tail}`;
    }
    if (loc) return `Find by ${loc}${act ? ` · ${act}` : ""}`;
    return "Search the page";
  }
  if (toolId === "browser_ab_get" || toolId === "browser_extract") {
    const what = String(params.what ?? "text").trim() || "text";
    const sel = String(params.selector ?? params.query ?? "").trim();
    if (sel) return `Read ${what} from “${sel.slice(0, 60)}”`;
    return `Read page ${what}`;
  }
  if (toolId === "browser_ab_wait") {
    const sel = String(params.selector ?? params.text ?? "").trim();
    return sel ? `Wait for “${sel.slice(0, 60)}”` : "Wait on page";
  }
  if (toolId === "browser_ab_scroll" || toolId === "browser_ab_scrollintoview") {
    const sel = String(params.selector ?? "").trim();
    return sel ? `Scroll to ${sel.slice(0, 60)}` : "Scroll page";
  }
  if (toolId === "browser_exec") {
    const argv = params.argv;
    if (Array.isArray(argv) && argv.length > 0) {
      return `CLI: ${argv.map(String).join(" ").slice(0, 100)}`;
    }
  }
  const human = toolId.replace(/^browser_ab_/, "").replace(/^browser_/, "").replace(/_/g, " ");
  return human ? human.charAt(0).toUpperCase() + human.slice(1) : toolId;
}

function isGenericBrowserIntent(label: string, toolId: string): boolean {
  const trimmed = label.trim();
  if (!trimmed) return true;
  const generic = new Set([
    "Search the page",
    "Click element",
    "Open page",
    "Type into field",
    "Find & act",
    "Find",
    "Page snapshot",
    "Screenshot",
  ]);
  if (generic.has(trimmed)) return true;
  return trimmed === formatToolId(toolId).short;
}

/** Human-readable description of what a browser tool is doing on the page (mirrors runner labels). */
export function describeBrowserToolAction(
  toolId: string,
  payload: Record<string, unknown>,
): string | null {
  if (!isBrowserToolId(toolId)) {
    return typeof payload.label === "string" && payload.label.trim() ? payload.label.trim() : null;
  }
  const params = parseToolCallParams(payload);
  const fromParams = formatBrowserToolIntent(toolId, params);
  if (Object.keys(params).length > 0 && !isGenericBrowserIntent(fromParams, toolId)) {
    return fromParams;
  }
  const label = typeof payload.label === "string" ? payload.label.trim() : "";
  if (label && !isGenericBrowserIntent(label, toolId)) return label;
  return fromParams;
}

/** Best-effort browser intent: direct args, runner label, or inference_tool_round tool_details. */
export function resolveBrowserToolIntent(
  toolId: string,
  payload: Record<string, unknown>,
  inferenceHints?: Map<string, string>,
): string {
  const direct = describeBrowserToolAction(toolId, payload);
  if (direct && !isGenericBrowserIntent(direct, toolId)) return direct;

  const hinted = inferenceHints?.get(toolId);
  if (hinted && !isGenericBrowserIntent(hinted, toolId)) return hinted;

  for (const detail of parseInferenceToolDetails(payload)) {
    if (detail.name !== toolId) continue;
    if (detail.label && !isGenericBrowserIntent(detail.label, toolId)) return detail.label;
    if (detail.tool_args) {
      const fromArgs = describeBrowserToolAction(toolId, { tool_args: detail.tool_args });
      if (fromArgs && !isGenericBrowserIntent(fromArgs, toolId)) return fromArgs;
    }
  }

  if (direct) return direct;
  return formatToolId(toolId).short;
}

export function toolCategoryIcon(category: ToolCategory): LucideIcon {
  switch (category) {
    case "browser":
      return Globe;
    case "brain":
      return Brain;
    case "system":
      return Terminal;
    case "agents3":
      return Monitor;
    case "approval":
      return ShieldCheck;
    default:
      return Wrench;
  }
}

function isAgents3ToolId(toolId: string): boolean {
  return toolId === "gui_control" || toolId.startsWith("luna_local_");
}

export function formatToolId(toolId: string): { short: string; category: ToolCategory; group: string } {
  const meta = TOOL_META[toolId];
  if (meta) {
    return {
      short: meta.verb ?? meta.label,
      category: meta.category,
      group: meta.label,
    };
  }
  if (isAgents3ToolId(toolId)) {
    const human = toolId.replace(/^luna_local_/, "").replace(/_/g, " ");
    return {
      short: human.charAt(0).toUpperCase() + human.slice(1),
      category: "agents3",
      group: "luna_local",
    };
  }
  const human = toolId.replace(/^browser_ab_/, "").replace(/^browser_/, "").replace(/_/g, " ");
  const category: ToolCategory = toolId.startsWith("browser_")
    ? "browser"
    : toolId.startsWith("brain_")
      ? "brain"
      : toolId.startsWith("system_") || toolId.startsWith("shell_")
        ? "system"
        : "other";
  return {
    short: human.charAt(0).toUpperCase() + human.slice(1),
    category,
    group: category === "browser" ? "Browser" : category === "brain" ? "AI Brain" : "Tool",
  };
}

function formatToolList(toolIds: string[]): string {
  return toolIds
    .map((id) => {
      const f = formatToolId(id);
      if (f.group === "Browser" || f.group === "luna_local") return `${f.group}: ${f.short}`;
      return `${f.group}: ${f.short}`;
    })
    .join(" · ");
}

/**
 * Step kinds that represent the LLM actually invoking a tool (or a tool-gated
 * approval). Everything else — run lifecycle, engine warmup, "calling model",
 * routing, etc. — is plumbing and is not surfaced as agent activity.
 */
const TOOL_ACTIVITY_KINDS = new Set<ActivityStep["kind"]>([
  "tool_round",
  "tool_done",
  "jit_pending",
  "jit_resolved",
]);

/**
 * Public entry point. Only surfaces activity tied to a real tool call; returns
 * null for default/lifecycle events so the activity feed stays empty until the
 * model actually calls a tool.
 */
export function summarizeRunnerLog(seq: number, raw: unknown): ActivityStep | null {
  const step = buildActivityStep(seq, raw);
  if (!step) return null;
  return TOOL_ACTIVITY_KINDS.has(step.kind) ? step : null;
}

const TEAM_THINKING_SKIP = new Set([
  "run_started",
  "browser_engine_info",
  "route_decision",
  "luna_start",
  "run_result",
  "inference_request",
  "inference_success",
  "browser_frame",
  "tool_finished",
  "tool_started",
]);

/** Runner log `message` values (snake_case), not orchestrator prose. */
function isRunnerLogMessage(message: string): boolean {
  if (TEAM_THINKING_SKIP.has(message)) return true;
  return /^[a-z][a-z0-9_]*$/.test(message);
}

/** Runner log payload → team-run thinking line (excludes milestones and tool results). */
export function teamThinkingStepFromLog(eventId: string, raw: unknown): ActivityStep | null {
  if (!raw || typeof raw !== "object") return null;
  const msg = String((raw as Record<string, unknown>).message ?? "");
  if (!msg || TEAM_THINKING_SKIP.has(msg)) return null;
  const step = buildActivityStep(0, raw);
  if (!step) return null;
  return { ...step, id: eventId };
}

/** Orchestrator / bridge status payload → team-run thinking line. */
export function teamThinkingStepFromStatus(
  eventId: string,
  payload: Record<string, unknown>,
): ActivityStep | null {
  const message = typeof payload.message === "string" ? payload.message.trim() : "";
  if (message && isRunnerLogMessage(message)) {
    return teamThinkingStepFromLog(eventId, payload);
  }
  if (message) {
    return { id: eventId, label: message, tone: "neutral", kind: "other" };
  }
  if (payload.status === "failed") {
    const error = typeof payload.error === "string" ? payload.error.trim() : "";
    if (error) {
      return { id: eventId, label: error, tone: "error", kind: "other" };
    }
  }
  return null;
}

export type TeamReasoningStep = ActivityStep & { agentName?: string };

export type TeamReasoningState = {
  steps: TeamReasoningStep[];
  /** True while the model is between inference_request and its response/tool round. */
  isThinking: boolean;
  /** Latest meaningful line shown in the collapsed header while thinking. */
  activeLabel?: string;
};

type TeamReasoningEvent = {
  id: string;
  eventType: string;
  agentId: string | null;
  payload: unknown;
};

/** Collapse runner noise into a single live “Thinking” state plus expandable reasoning steps. */
export function collectTeamReasoningSteps(
  events: TeamReasoningEvent[],
  agentNameById: (id: string | null) => string,
): TeamReasoningState {
  const steps: TeamReasoningStep[] = [];
  let isThinking = false;
  let activeLabel: string | undefined;

  for (const e of events) {
    const p = (e.payload ?? {}) as Record<string, unknown>;
    const rawMsg = typeof p.message === "string" ? p.message : "";
    const tool = typeof p.tool === "string" ? p.tool : undefined;

    if (rawMsg === "inference_request") {
      isThinking = true;
      continue;
    }
    if (rawMsg === "inference_success" || rawMsg === "inference_tool_round" || rawMsg === "tool_started") {
      isThinking = false;
    }

    let step: ActivityStep | null = null;
    if (e.eventType === "task_status_update") {
      step = teamThinkingStepFromStatus(e.id, p);
    } else if (e.eventType === "tool_called") {
      if (rawMsg === "browser_frame" || (tool && rawMsg === "tool_finished")) continue;
      step = teamThinkingStepFromLog(e.id, p);
    }
    if (!step) continue;

    const agentName = agentNameById(e.agentId);
    activeLabel = step.detail ? `${step.label} · ${step.detail}` : step.label;

    const prev = steps[steps.length - 1];
    if (
      prev &&
      prev.label === step.label &&
      prev.detail === step.detail &&
      prev.agentName === agentName
    ) {
      continue;
    }

    steps.push({ ...step, agentName });
  }

  return { steps, isThinking, activeLabel };
}

function buildActivityStep(seq: number, raw: unknown): ActivityStep | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  const msg = String(d.message ?? "");
  if (!msg) return null;
  const id = `step-${seq}`;

  switch (msg) {
    case "run_started": {
      const skills = d.skills;
      const detail =
        Array.isArray(skills) && skills.length > 0
          ? formatToolList(skills.map(String))
          : undefined;
      return { id, label: "Run started", detail, tone: "accent", kind: "other" };
    }
    case "luna_start":
      return { id, label: "Agent engine ready", tone: "neutral", kind: "other" };
    case "browser_engine_info": {
      const engine = String(d.engine ?? "unknown");
      const binary = String(d.binary ?? "");
      const cli = String(d.cli_version ?? "");
      const npm = String(d.npm_global_version ?? "");
      const expected = String(d.expected_npm_version ?? "");
      const parts = [
        engine === "agent_browser" ? "npm agent-browser" : engine,
        binary ? binary.split(/[/\\]/).pop() ?? binary : "",
        cli || npm || (expected ? `expected v${expected}` : ""),
      ].filter(Boolean);
      return {
        id,
        label: "Browser backend",
        detail: parts.join(" · "),
        tone: "neutral",
        kind: "other",
        category: "browser",
      };
    }
    case "route_decision": {
      const mode = String(d.mode ?? "");
      const detail =
        mode === "direct"
          ? "Single-shot runner path"
          : mode === "orchestrator"
            ? "Orchestrator path"
            : mode;
      return { id, label: "Routing", detail, tone: "accent", kind: "other" };
    }
    case "inference_request":
      return { id, label: "Calling model", detail: String(d.model ?? ""), tone: "neutral", kind: "other" };
    case "inference_success": {
      const usage = d.usage as Record<string, unknown> | undefined;
      const tokens =
        usage && typeof usage.total_tokens === "number" ? `${usage.total_tokens} tokens` : undefined;
      const executed = d.tool_calls_executed;
      const tools =
        Array.isArray(executed) && executed.length > 0
          ? `Tools used: ${formatToolList(executed.map(String))}`
          : "";
      const detail = [tokens, tools].filter(Boolean).join(" · ");
      return { id, label: "Model responded", detail: detail || undefined, tone: "success", kind: "other" };
    }
    case "inference_tool_round": {
      const tools = Array.isArray(d.tools) ? d.tools.map(String).filter(Boolean) : [];
      const details = parseInferenceToolDetails(d);
      const primary = tools[0] ? formatToolId(tools[0]) : null;
      const allAgents3 = tools.length > 0 && tools.every(isAgents3ToolId);
      if (tools.length === 1 && primary) {
        const toolId = tools[0]!;
        const detail = details.find((x) => x.name === toolId);
        const browserIntent =
          detail?.label ??
          (detail?.tool_args
            ? describeBrowserToolAction(toolId, { tool_args: detail.tool_args })
            : null);
        const meta = TOOL_META[toolId];
        return {
          id,
          label: browserIntent ?? meta?.verb ?? primary.short,
          detail: browserIntent ? primary.group : primary.group,
          tone: "accent",
          kind: "tool_round",
          category: primary.category,
          toolIds: tools,
        };
      }
      return {
        id,
        label: allAgents3 ? "Running luna_local steps" : `Calling ${tools.length} tools`,
        detail: tools.length > 0 ? formatToolList(tools) : undefined,
        tone: "accent",
        kind: "tool_round",
        category: primary?.category ?? "other",
        toolIds: tools,
      };
    }
    case "tool_started": {
      const toolId = String(d.tool ?? "");
      const f = formatToolId(toolId);
      const browserAction = describeBrowserToolAction(toolId, d);
      return {
        id,
        label: browserAction ?? (f.group === "luna_local" ? `luna_local — ${f.short}` : `Running — ${f.group}`),
        detail: browserAction ? f.short : f.group === "luna_local" ? toolId : f.short,
        tone: "accent",
        kind: "tool_round",
        category: f.category,
        toolIds: [toolId],
        toolId,
      };
    }
    case "agents3_step": {
      const toolId = String(d.tool ?? "");
      const phase = String(d.phase ?? "step");
      const f = formatToolId(toolId);
      const stepNum = d.step != null ? Number(d.step) : null;
      const maxSteps = d.max_steps != null ? Number(d.max_steps) : null;
      const stepLabel =
        stepNum != null && Number.isFinite(stepNum)
          ? maxSteps != null && Number.isFinite(maxSteps)
            ? `Step ${stepNum}/${maxSteps}`
            : `Step ${stepNum}`
          : undefined;
      const phaseDetail = String(d.detail ?? "").trim();
      const action = phaseDetail || phase.replace(/_/g, " ");
      return {
        id,
        label: action ? `luna_local: ${action}` : `luna_local — ${f.short}`,
        detail: stepLabel || f.short,
        tone: "accent",
        kind: "other",
        category: "agents3",
        toolId,
      };
    }
    case "tool_finished": {
      const toolId = String(d.tool ?? "");
      const f = formatToolId(toolId);
      const browserAction = describeBrowserToolAction(toolId, d);
      const patchSummary =
        typeof d.patchSummary === "string" && d.patchSummary.trim()
          ? d.patchSummary.trim()
          : undefined;
      // `ok` is absent on older runners — treat missing as success for back-compat.
      const failed = d.ok === false;
      if (failed) {
        const error = String(d.error ?? "").trim();
        return {
          id,
          label: f.group === "luna_local" ? `Failed — luna_local` : `Failed — ${f.group}`,
          detail: error || browserAction || `${f.short} failed`,
          tone: "error",
          kind: "tool_done",
          category: f.category,
          toolId,
        };
      }
      const baseDetail = browserAction
        ? f.short
        : `${f.short}${toolId ? ` (${toolId})` : ""}`;
      return {
        id,
        label: browserAction ?? (f.group === "luna_local" ? `Done — luna_local` : `Done — ${f.group}`),
        detail: patchSummary ? `${baseDetail} · ${patchSummary}` : baseDetail,
        tone: "success",
        kind: "tool_done",
        category: f.category,
        toolId,
        sources: parseSources(d.sources),
      };
    }
    case "orchestrator_fallback":
      return {
        id,
        label: "Orchestrator fallback",
        detail: String(d.error ?? ""),
        tone: "warn",
        kind: "other",
      };
    case "run_result": {
      const turns = d.turns != null ? `${Number(d.turns)} turn(s)` : "";
      const tc = d.tool_calls;
      const tools =
        Array.isArray(tc) && tc.length > 0 ? `Tools: ${formatToolList(tc.map(String))}` : "";
      const detail = [turns, tools].filter(Boolean).join(" · ");
      return { id, label: "Run completed", detail: detail || undefined, tone: "success", kind: "other" };
    }
    case "jit_approval_pending": {
      const scopeLabel = String(d.scopeLabel ?? d.scope ?? "action");
      const channel = String(d.channel ?? "");
      const context = String(d.context ?? "").trim();
      const jitRequestId =
        typeof d.jitRequestId === "string" && d.jitRequestId ? d.jitRequestId : undefined;
      const whatsappExpected = d.whatsappExpected === true;
      const whatsappStatus =
        d.whatsappStatus === "disconnected" || d.whatsappStatus === "not_linked"
          ? d.whatsappStatus
          : undefined;
      // Session-scoped scopes (e.g. email.send): one "yes" covers the whole conversation.
      const sessionScoped =
        String(d.scope ?? "") === "email.send" ||
        String(d.scope ?? "") === "social.publish" ||
        String(d.scope ?? "") === "crm.write" ||
        String(d.scope ?? "") === "crm.delete" ||
        String(d.scope ?? "") === "slack.send" ||
        String(d.scope ?? "") === "whatsapp.contact_send";
      const detailParts = [
        channel === "whatsapp"
          ? "Reply on WhatsApp to approve or deny"
          : "Waiting for your approval in Qlix",
        scopeLabel ? `Scope: ${scopeLabel}` : "",
        sessionScoped ? "Approving covers this whole conversation" : "",
        context,
      ].filter(Boolean);
      return {
        id,
        label: "Waiting for your approval",
        detail: detailParts.join(" · "),
        tone: "warn",
        kind: "jit_pending",
        category: "approval",
        jitRequestId,
        jitChannel: channel === "whatsapp" ? "whatsapp" : "dashboard",
        jitScope: String(d.scope ?? ""),
        jitWhatsappExpected: whatsappExpected,
        jitWhatsappStatus: whatsappStatus,
      };
    }
    case "jit_approval_granted": {
      const scopeLabel = String(d.scopeLabel ?? d.scope ?? "");
      const auto = d.auto === true;
      const conversationGrant = String(d.reason ?? "") === "conversation";
      const label = !auto
        ? "You approved the action"
        : conversationGrant
          ? "Approved for this conversation"
          : "Pre-approved for this run";
      return {
        id,
        label,
        detail: scopeLabel ? `Scope: ${scopeLabel}` : undefined,
        tone: "success",
        kind: "jit_resolved",
        category: "approval",
      };
    }
    case "jit_approval_denied":
      return {
        id,
        label: "You denied the action",
        detail: String(d.scopeLabel ?? d.scope ?? ""),
        tone: "warn",
        kind: "jit_resolved",
        category: "approval",
      };
    case "jit_approval_expired":
      return {
        id,
        label: "Approval request expired",
        detail: String(d.scopeLabel ?? d.scope ?? ""),
        tone: "warn",
        kind: "jit_resolved",
        category: "approval",
      };
    default:
      return {
        id,
        label: msg.replace(/_/g, " "),
        tone: "neutral",
        kind: "other",
      };
  }
}

export function getActiveToolsFromSteps(steps: ActivityStep[]): Array<{
  toolId: string;
  group: string;
  short: string;
  category: ToolCategory;
}> {
  const pending = new Map<string, ReturnType<typeof formatToolId>>();
  for (const step of steps) {
    if (step.kind === "tool_round" && step.toolIds) {
      for (const tid of step.toolIds) {
        pending.set(tid, formatToolId(tid));
      }
    }
    if (step.kind === "tool_done" && step.toolId) {
      pending.delete(step.toolId);
    }
  }
  return [...pending.entries()].map(([toolId, f]) => ({
    toolId,
    group: f.group,
    short: f.short,
    category: f.category,
  }));
}

/** True while a JIT approval was requested and not yet granted/denied/expired. */
export function isWaitingForJitApproval(steps: ActivityStep[]): boolean {
  let pendingIdx = -1;
  let resolvedIdx = -1;
  for (let i = 0; i < steps.length; i += 1) {
    const s = steps[i];
    if (s?.kind === "jit_pending") pendingIdx = i;
    if (s?.kind === "jit_resolved") resolvedIdx = i;
  }
  return pendingIdx >= 0 && resolvedIdx < pendingIdx;
}

export function getPendingJitStep(steps: ActivityStep[]): ActivityStep | null {
  if (!isWaitingForJitApproval(steps)) return null;
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    if (steps[i]?.kind === "jit_pending") return steps[i] ?? null;
  }
  return null;
}
