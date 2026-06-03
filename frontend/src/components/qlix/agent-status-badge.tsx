import type { DashboardAgentRow } from "@/lib/dashboard-api";
import { cn } from "@/lib/utils/cn";

export type AgentPresence = DashboardAgentRow["status"];

interface AgentStatusBadgeProps {
  readonly status: AgentPresence;
}

export function AgentStatusBadge({ status }: AgentStatusBadgeProps) {
  const styles =
    status === "online"
      ? "bg-[--success-subtle] text-[--success]"
      : status === "idle"
        ? "bg-[--warning-subtle] text-[--warning]"
        : "bg-[--neutral-subtle] text-[--text-tertiary]";

  const label =
    status === "online" ? "Online" : status === "idle" ? "Idle" : "Offline";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium",
        styles,
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          status === "online" && "bg-[--success]",
          status === "idle" && "bg-[--warning]",
          status === "offline" && "bg-[--neutral]",
        )}
        aria-hidden
      />
      {label}
    </span>
  );
}
