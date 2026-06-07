import type { LucideIcon } from "lucide-react";
import { Brain, Globe, Monitor, ShieldCheck, Terminal, Wrench } from "lucide-react";

export type ToolCategory = "browser" | "brain" | "system" | "agents3" | "approval" | "other";

export type ActivityStep = {
  id: string;
  label: string;
  detail?: string;
  tone: "neutral" | "accent" | "success" | "warn";
  category?: ToolCategory;
  kind?: "tool_round" | "tool_done" | "jit_pending" | "jit_resolved" | "other";
  toolIds?: string[];
  toolId?: string;
};

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
  brain_query: { label: "AI Brain", category: "brain", verb: "Query knowledge" },
  brain_knowledge_read: { label: "AI Brain", category: "brain", verb: "Read knowledge" },
  shell_exec: { label: "Shell", category: "system", verb: "Run command" },
  code_interpreter: { label: "Code", category: "system", verb: "Run code" },
  s3_read_file: { label: "Agent-S3", category: "agents3", verb: "Read file" },
  s3_write_file: { label: "Agent-S3", category: "agents3", verb: "Write file" },
  s3_list_dir: { label: "Agent-S3", category: "agents3", verb: "List directory" },
  s3_open_file: { label: "Agent-S3", category: "agents3", verb: "Open on desktop" },
  s3_bash: { label: "Agent-S3", category: "agents3", verb: "Shell (LocalEnv)" },
  s3_python: { label: "Agent-S3", category: "agents3", verb: "Python (LocalEnv)" },
  s3_code_task: { label: "Agent-S3", category: "agents3", verb: "CodeAgent task" },
  gui_control: { label: "Agent-S3", category: "agents3", verb: "Desktop (GUI)" },
};

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
  return toolId === "gui_control" || toolId.startsWith("s3_");
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
    const human = toolId.replace(/^s3_/, "").replace(/_/g, " ");
    return {
      short: human.charAt(0).toUpperCase() + human.slice(1),
      category: "agents3",
      group: "Agent-S3",
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
      if (f.group === "Browser" || f.group === "Agent-S3") return `${f.group}: ${f.short}`;
      return `${f.group}: ${f.short}`;
    })
    .join(" · ");
}

export function summarizeRunnerLog(seq: number, raw: unknown): ActivityStep | null {
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
      const primary = tools[0] ? formatToolId(tools[0]) : null;
      const allAgents3 = tools.length > 0 && tools.every(isAgents3ToolId);
      return {
        id,
        label:
          tools.length === 1
            ? primary?.group === "Agent-S3"
              ? `Agent-S3 — ${primary.short}`
              : `Using ${primary?.group ?? "tool"}`
            : allAgents3
              ? "Agent-S3 tools"
              : "Using tools",
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
      return {
        id,
        label: f.group === "Agent-S3" ? `Agent-S3 — ${f.short}` : `Running — ${f.group}`,
        detail: f.group === "Agent-S3" ? toolId : f.short,
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
      const detail = [stepLabel, phaseDetail || phase.replace(/_/g, " ")].filter(Boolean).join(" · ");
      return {
        id,
        label: `Agent-S3 — ${f.short}`,
        detail: detail || undefined,
        tone: "accent",
        kind: "other",
        category: "agents3",
        toolId,
      };
    }
    case "tool_finished": {
      const toolId = String(d.tool ?? "");
      const f = formatToolId(toolId);
      return {
        id,
        label: f.group === "Agent-S3" ? `Done — Agent-S3` : `Done — ${f.group}`,
        detail: `${f.short}${toolId ? ` (${toolId})` : ""}`,
        tone: "success",
        kind: "tool_done",
        category: f.category,
        toolId,
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
      const detailParts = [
        channel === "whatsapp"
          ? "Reply on WhatsApp to approve or deny"
          : "Waiting for your approval in Qlix",
        scopeLabel ? `Scope: ${scopeLabel}` : "",
        context,
      ].filter(Boolean);
      return {
        id,
        label: "Waiting for your approval",
        detail: detailParts.join(" · "),
        tone: "warn",
        kind: "jit_pending",
        category: "approval",
      };
    }
    case "jit_approval_granted": {
      const scopeLabel = String(d.scopeLabel ?? d.scope ?? "");
      const auto = d.auto === true;
      return {
        id,
        label: auto ? "Pre-approved for this run" : "You approved the action",
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
