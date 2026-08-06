"use client";

import { AlertTriangle, Cloud, Cpu, Laptop } from "lucide-react";
import type { AgentDTO, AgentKind, AgentRuntime } from "@/lib/agents-api";
import { cn } from "@/lib/utils/cn";

export type AgentRunnerStatusInput = Pick<
  AgentDTO,
  | "runtime"
  | "status"
  | "cloudProvisioningStatus"
  | "cloudLastHeartbeatAt"
  | "hybridLastHeartbeatAt"
  | "agentKind"
>;

/** Org brain is query/RAG-only on the Qlix API — no Docker cloud runner. */
export function deriveOrgBrainDisplayStatus(
  agent: Pick<AgentDTO, "status">,
): string {
  return agent.status === "active" ? "active" : agent.status;
}

export function deriveAgentDisplayStatus(agent: AgentRunnerStatusInput): string {
  if (agent.agentKind === "org_brain") {
    return deriveOrgBrainDisplayStatus(agent);
  }
  if (agent.runtime === "hybrid") {
    const hb = agent.hybridLastHeartbeatAt;
    if (!hb) return "offline";
    const t = new Date(hb).getTime();
    if (Number.isNaN(t)) return "offline";
    return Date.now() - t < 20_000 ? "online" : "offline";
  }
  if (agent.runtime !== "cloud") return agent.status;
  if (agent.cloudProvisioningStatus === "failed") return "runner_failed";
  if (!agent.cloudLastHeartbeatAt) return agent.cloudProvisioningStatus ?? "provisioning";
  const t = new Date(agent.cloudLastHeartbeatAt).getTime();
  if (Number.isNaN(t)) return agent.cloudProvisioningStatus ?? "provisioning";
  const fresh = Date.now() - t < 20_000;
  if (fresh) return "online";
  return "offline";
}

export function formatDidCompact(did: string): string {
  if (did.length <= 28) return did;
  return `${did.slice(0, 16)}…${did.slice(-10)}`;
}

/** Uppercase list-row status tint (Agents split view). */
export function agentListStatusClassName(status: string): string {
  const key = status.toLowerCase().replace(/\s+/g, "_");
  if (key === "online" || key === "active") {
    return "text-[color:var(--success)]";
  }
  if (key === "provisioning" || key === "restarting" || key === "running") {
    return "text-[color:var(--warning)]";
  }
  if (key === "runner_failed" || key === "failed") {
    return "text-[color:var(--sketch-red)]";
  }
  return "text-black";
}

const STATUS_META: Record<
  string,
  { label: string; className: string; pulse?: boolean; icon?: "warn" }
> = {
  online: {
    label: "Online",
    className:
      "bg-emerald-500/15 text-emerald-700 ring-emerald-500/35 dark:bg-emerald-500/20 dark:text-emerald-300",
    pulse: true,
  },
  active: {
    label: "Active",
    className:
      "bg-emerald-500/15 text-emerald-700 ring-emerald-500/35 dark:bg-emerald-500/20 dark:text-emerald-300",
    pulse: true,
  },
  offline: {
    label: "Offline",
    className: "bg-slate-500/12 text-slate-600 ring-slate-500/25 dark:text-slate-400",
  },
  idle: {
    label: "Idle",
    className: "bg-slate-500/12 text-slate-600 ring-slate-500/25 dark:text-slate-400",
  },
  provisioning: {
    label: "Setting up",
    className:
      "bg-amber-500/15 text-amber-800 ring-amber-500/35 dark:bg-amber-500/20 dark:text-amber-200",
    pulse: true,
  },
  restarting: {
    label: "Restarting",
    className:
      "bg-amber-500/15 text-amber-800 ring-amber-500/35 dark:bg-amber-500/20 dark:text-amber-200",
    pulse: true,
  },
  running: {
    label: "Running",
    className:
      "bg-cyan-500/15 text-cyan-800 ring-cyan-500/35 dark:bg-cyan-500/20 dark:text-cyan-200",
    pulse: true,
  },
  runner_failed: {
    label: "Couldn't start",
    className:
      "bg-rose-500/15 text-rose-800 ring-rose-500/40 dark:bg-rose-500/20 dark:text-rose-300",
    icon: "warn",
  },
  failed: {
    label: "Failed",
    className:
      "bg-rose-500/15 text-rose-800 ring-rose-500/40 dark:bg-rose-500/20 dark:text-rose-300",
    icon: "warn",
  },
};

export function AgentStatusBadge({ status }: { readonly status: string }) {
  const key = status.toLowerCase().replace(/\s+/g, "_");
  const meta = STATUS_META[key] ?? {
    label: status.replace(/_/g, " "),
    className: "bg-[--bg-subtle] text-[--text-secondary] ring-[--border-subtle]",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset",
        meta.className,
      )}
    >
      {meta.pulse ? (
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-40 motion-reduce:animate-none" />
          <span className="relative inline-flex size-1.5 rounded-full bg-current" />
        </span>
      ) : null}
      {meta.icon === "warn" ? <AlertTriangle className="size-3 shrink-0 opacity-90" aria-hidden /> : null}
      {meta.label}
    </span>
  );
}

export function RuntimeBadge({
  runtime,
  agentKind,
}: {
  readonly runtime: AgentRuntime;
  readonly agentKind?: AgentKind;
}) {
  if (agentKind === "org_brain") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] font-medium text-violet-700 ring-1 ring-inset ring-violet-500/30 dark:bg-violet-500/20 dark:text-violet-300">
        <Cloud className="size-3" aria-hidden />
        Qlix API
      </span>
    );
  }
  const isCloud = runtime === "cloud";
  const isHybrid = runtime === "hybrid";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ring-1 ring-inset",
        isCloud
          ? "bg-violet-500/15 text-violet-700 ring-violet-500/30 dark:bg-violet-500/20 dark:text-violet-300"
          : isHybrid
            ? "bg-cyan-500/15 text-cyan-800 ring-cyan-500/30 dark:bg-cyan-500/20 dark:text-cyan-200"
            : "bg-teal-500/12 text-teal-800 ring-teal-500/25 dark:bg-teal-500/15 dark:text-teal-300",
      )}
    >
      {isCloud ? (
        <Cloud className="size-3" aria-hidden />
      ) : isHybrid ? (
        <Laptop className="size-3" aria-hidden />
      ) : (
        <Cpu className="size-3" aria-hidden />
      )}
      {runtime}
    </span>
  );
}

export function agentStatusHint(status: string, runtime?: AgentRuntime): string | null {
  switch (status.toLowerCase()) {
    case "runner_failed":
      return "Your agent couldn't start. Open agent details and restart it.";
    case "offline":
      // Cloud agents run on Qlix's servers — there's no starter pack to run locally.
      return runtime === "cloud"
        ? "Your agent is offline right now — it should reconnect shortly. If it stays offline, restart it from the agent's page."
        : "Offline. Unzip the starter pack and double-click Start Qlix Agent on your computer.";
    case "provisioning":
      return "Your agent is starting. This usually completes within a minute.";
    case "restarting":
      return "Getting your agent ready (usually a few minutes). Keep this page open or check back shortly.";
    default:
      return null;
  }
}
