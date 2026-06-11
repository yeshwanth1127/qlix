"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import {
  Bot,
  Cpu,
  Download,
  Eye,
  KeyRound,
  List,
  ListFilter,
  Loader2,
  Network,
  ShieldCheck,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import type { AuditActionType, AuditResultUi } from "@/lib/dashboard-api";
import { useDashboardHome } from "@/lib/hooks/use-dashboard-home";
import { formatCompactCount, userFirstName } from "@/lib/workspace";
import { cn } from "@/lib/utils/cn";
import { ReflectiveCard } from "./ReflectiveCard";

const RP = "/individual";

function pickAgentIconVariant(id: string): "bot" | "cpu" | "network" | "eye" {
  let sum = 0;
  for (let i = 0; i < id.length; i++) sum += id.charCodeAt(i);
  return (["bot", "cpu", "network", "eye"] as const)[sum % 4];
}

function AgentAvatarIcon({ variant }: { variant: "bot" | "cpu" | "network" | "eye" }) {
  const className = "size-[14px] shrink-0";
  if (variant === "bot") return <Bot className={cn(className, "text-blue-400")} strokeWidth={2} aria-hidden />;
  if (variant === "cpu") return <Cpu className={cn(className, "text-neutral-400")} strokeWidth={2} aria-hidden />;
  if (variant === "network")
    return <Network className={cn(className, "text-blue-400")} strokeWidth={2} aria-hidden />;
  return <Eye className={cn(className, "text-blue-400")} strokeWidth={2} aria-hidden />;
}

function MetricIcon({ kind }: { kind: "agents" | "actions" | "credentials" }) {
  const className = "size-[18px] shrink-0";
  if (kind === "agents") return <Bot className={cn(className, "text-blue-500")} strokeWidth={2} aria-hidden />;
  if (kind === "actions") return <Zap className={cn(className, "text-orange-300")} strokeWidth={2} aria-hidden />;
  return <KeyRound className={cn(className, "text-neutral-400")} strokeWidth={2} aria-hidden />;
}

function ActionBadge({ action }: { action: AuditActionType }) {
  if (action === "WRITE") {
    return (
      <span className="rounded border border-blue-900 bg-blue-950/20 px-1.5 py-0.5 text-[10px] font-bold text-blue-400">
        WRITE
      </span>
    );
  }
  if (action === "AUTH") {
    return (
      <span className="rounded border border-amber-900 bg-amber-950/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-500">
        AUTH
      </span>
    );
  }
  return (
    <span className="rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-[10px] font-bold text-neutral-400">
      READ
    </span>
  );
}

function ResultCell({ result }: { result: AuditResultUi }) {
  if (result === "Success") return <span className="text-green-500">Success</span>;
  if (result === "Flagged") return <span className="text-amber-500">Flagged</span>;
  return <span className="text-red-500">Blocked</span>;
}

export function IndividualHomeView() {
  const { data, error, loading, refresh } = useDashboardHome();

  const shell = (main: ReactNode) => <>{main}</>;

  if (loading) {
    return shell(
      <div className="mx-auto flex max-w-5xl items-center justify-center gap-2 py-24 text-neutral-500">
        <Loader2 className="size-5 animate-spin" aria-hidden />
        <span className="text-[13px]">Loading workspace data…</span>
      </div>,
    );
  }

  if (error || !data) {
    return shell(
      <div className="mx-auto max-w-5xl space-y-3 py-12">
        <p className="text-[13px] text-red-400">{error ?? "Could not load dashboard."}</p>
        <button
          type="button"
          onClick={() => void refresh()}
          className="text-[13px] font-medium text-blue-400 hover:underline"
        >
          Retry
        </button>
      </div>,
    );
  }

  if (data.metrics.kind !== "individual") {
    return shell(
      <p className="mx-auto max-w-5xl text-[13px] text-neutral-500">
        This overview is for individual workspaces only.
      </p>,
    );
  }

  const m = data.metrics;
  const firstName = userFirstName(data.user.displayName, data.user.email);

  const metricCards = [
    {
      key: "agents",
      label: "Active Agents",
      value: String(m.activeAgents),
      subtext: `${m.agentsOnline} online now`,
      icon: "agents" as const,
    },
    {
      key: "actions",
      label: "Actions Today",
      value: formatCompactCount(m.actionsToday),
      subtext:
        m.actionsVsYesterdayPercent === null
          ? "No prior day baseline"
          : `${m.actionsVsYesterdayPercent >= 0 ? "+" : ""}${m.actionsVsYesterdayPercent}% vs yesterday`,
      icon: "actions" as const,
    },
    {
      key: "cred",
      label: "Credentials",
      value: String(m.credentialsValid),
      subtext: m.credentialsValid === 0 ? "None recorded yet" : "Valid in ledger",
      icon: "credentials" as const,
    },
  ];

  const agents = data.agents;
  const auditRows = data.auditEvents;

  return shell(
    <div className="mx-auto max-w-5xl">
      <header className="mb-8">
        <h2 className="text-2xl font-medium leading-8 tracking-[-0.02em] text-white">
          Welcome back, {firstName}
        </h2>
        <p className="text-[14px] leading-5 text-neutral-500">{data.organization.name}</p>
      </header>

      <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-3">
        {metricCards.map((card) => (
          <ReflectiveCard
            key={card.key}
            className="rounded-lg"
            contentClassName="flex flex-col justify-between p-5"
          >
            <div className="mb-4 flex items-start justify-between">
              <span className="text-[10px] font-medium uppercase tracking-widest text-neutral-400">
                {card.label}
              </span>
              <MetricIcon kind={card.icon} />
            </div>
            <div>
              <div className="mb-1 text-3xl font-bold text-white">{card.value}</div>
              {card.icon === "actions" ? (
                <div className="flex items-center text-[12px] font-medium text-green-400">
                  <TrendingUp className="mr-1 size-[14px]" strokeWidth={2} aria-hidden />
                  {card.subtext}
                </div>
              ) : (
                <div
                  className={cn(
                    "text-[12px] font-medium",
                    card.icon === "agents" ? "text-blue-400" : "text-neutral-500",
                  )}
                >
                  {card.subtext}
                </div>
              )}
            </div>
          </ReflectiveCard>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="flex flex-col lg:col-span-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="flex items-center text-[18px] font-medium leading-6 tracking-[-0.01em] text-white">
              <span className="mr-2 text-neutral-400" aria-hidden>
                <List className="size-[18px]" strokeWidth={1.75} />
              </span>
              My Agents
            </h3>
            <Link href={`${RP}/agents`} className="text-[12px] font-medium text-blue-500 hover:underline">
              View All
            </Link>
          </div>
          <ReflectiveCard className="overflow-hidden rounded-lg">
            <div className="divide-y divide-neutral-800">
              {agents.length === 0 ? (
                <p className="p-6 text-[13px] text-neutral-500">No agents registered yet.</p>
              ) : (
                agents.map((agent) => {
                  const variant = pickAgentIconVariant(agent.id);
                  const onlineDot =
                    agent.status === "online"
                      ? "bg-green-500"
                      : agent.status === "idle"
                        ? "bg-amber-500"
                        : "bg-neutral-600";
                  const statusLabel =
                    agent.status === "online"
                      ? "Online"
                      : agent.status === "idle"
                        ? "Idle"
                        : "Offline";
                  const mutedStatus = agent.status === "offline";

                  return (
                    <Link
                      key={agent.id}
                      href={`${RP}/agents/${agent.id}`}
                      className="group flex items-center justify-between p-4 transition-colors hover:bg-[var(--glass-row-hover)]"
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={cn(
                            "flex size-8 items-center justify-center rounded border",
                            agent.status !== "offline"
                              ? "border-blue-500/20 bg-blue-500/10"
                              : "border-neutral-700 bg-neutral-800",
                          )}
                        >
                          <AgentAvatarIcon variant={variant} />
                        </div>
                        <div>
                          <div className="text-[13px] font-bold text-white">{agent.name}</div>
                          <div className="font-mono text-[11px] text-neutral-500">{agent.didShort}</div>
                          <div className="text-[10px] text-neutral-600">
                            {agent.actionsToday} actions today · {agent.statusDetail}
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <span className={cn("size-1.5 rounded-full", onlineDot)} />
                          <span
                            className={cn(
                              "text-[11px] font-medium",
                              mutedStatus ? "text-neutral-500" : "text-neutral-300",
                            )}
                          >
                            {statusLabel}
                          </span>
                        </div>
              </div>
            </Link>
                  );
                })
              )}
            </div>
          </ReflectiveCard>
        </div>

        <div className="flex flex-col lg:col-span-7">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="flex items-center text-[18px] font-medium leading-6 tracking-[-0.01em] text-white">
              <span className="mr-2 text-neutral-400" aria-hidden>
                <ShieldCheck className="size-[18px]" strokeWidth={1.75} />
              </span>
              Recent Audit
            </h3>
            <div className="flex gap-2">
              <button
                type="button"
                className="p-1 text-neutral-500 transition-colors hover:text-white"
                aria-label="Filter"
              >
                <ListFilter className="size-[18px]" strokeWidth={1.75} />
              </button>
              <button
                type="button"
                className="p-1 text-neutral-500 transition-colors hover:text-white"
                aria-label="Download"
              >
                <Download className="size-[18px]" strokeWidth={1.75} />
              </button>
            </div>
          </div>
          <ReflectiveCard className="overflow-x-auto rounded-lg">
            <table className="w-full border-collapse text-left">
              <thead className="border-b border-neutral-800">
                <tr className="qlix-glass-inset">
                  <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-widest text-neutral-500">
                    Time (UTC)
                  </th>
                  <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-widest text-neutral-500">
                    Agent
                  </th>
                  <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-widest text-neutral-500">
                    Details
                  </th>
                  <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-widest text-neutral-500">
                    Action
                  </th>
                  <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-widest text-neutral-500">
                    Result
                  </th>
                </tr>
              </thead>
              <tbody className="text-[13px]">
                {auditRows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-neutral-500">
                      No audit events in your workspace yet.
                    </td>
                  </tr>
                ) : (
                  auditRows.map((row, i) => (
                    <tr
                      key={row.id}
                      className={cn(
                        "transition-colors hover:bg-[var(--glass-row-hover)]",
                        i < auditRows.length - 1 ? "border-b border-neutral-800/50" : "",
                      )}
                    >
                      <td className="px-4 py-3 font-mono text-neutral-400">{row.timeUtc}</td>
                      <td className="px-4 py-3 font-medium text-white">{row.agentName}</td>
                      <td
                        className="max-w-[200px] truncate px-4 py-3 text-neutral-400"
                        title={row.description}
                      >
                        {row.description}
                      </td>
                      <td className="px-4 py-3">
                        <ActionBadge action={row.action} />
                      </td>
                      <td className="px-4 py-3">
                        <ResultCell result={row.result} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </ReflectiveCard>
        </div>
      </div>

      <ReflectiveCard className="mt-8 rounded-lg" contentClassName="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-4 sm:gap-6">
          <div className="qlix-glass-input flex size-12 shrink-0 items-center justify-center rounded-full text-neutral-500">
            <Users className="size-6" strokeWidth={1.5} aria-hidden />
          </div>
          <div>
            <div className="text-[14px] font-bold text-white">Invite your collaborators</div>
            <p className="text-[12px] text-neutral-500">
              Organizations share API keys and registries across your team.
            </p>
          </div>
        </div>
        <Link
          href="/"
          className="shrink-0 rounded bg-white px-4 py-2 text-center text-[12px] font-bold text-black transition-colors hover:bg-neutral-200"
        >
          Get Started
        </Link>
      </ReflectiveCard>
    </div>,
  );
}
