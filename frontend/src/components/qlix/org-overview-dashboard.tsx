"use client";

import type { ReactNode } from "react";
import { ReflectiveCard } from "./ReflectiveCard";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Bot,
  CheckCircle2,
  KeyRound,
  List,
  Shield,
  ShieldCheck,
  ShieldAlert,
  TrendingUp,
  Users,
  XCircle,
  Zap,
} from "lucide-react";
import type {
  AuditActionType,
  AuditResultUi,
  DashboardAgentRow,
  DashboardHomeResponse,
} from "@/lib/dashboard-api";
import { getOrganizationMembers, type OrgMemberRow } from "@/lib/organization-api";
import { normalizeOrgRole } from "@/lib/org-permissions";
import { formatCompactCount } from "@/lib/workspace";
import { cn } from "@/lib/utils/cn";

/** Primary actions — blue → violet gradient (org overview reference). */
const orgGradientBtnClass =
  "inline-flex items-center justify-center rounded-lg bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 px-3 py-1.5 text-center text-[12px] font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] transition-[filter,transform] hover:brightness-110 active:scale-[0.98]";

function overviewMemberInitials(displayName: string | null, email: string): string {
  const s = (displayName?.trim() || email).trim();
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  }
  return s.slice(0, 2).toUpperCase();
}

function memberRoleBadgeClass(role: string): string {
  const r = normalizeOrgRole(role);
  if (r === "owner") return "border-blue-500/20 bg-blue-500/10 text-blue-400";
  if (r === "admin") return "border-amber-500/20 bg-amber-500/10 text-amber-400";
  return "border-neutral-700 text-neutral-400";
}

function agentStatusPill(status: DashboardAgentRow["status"]) {
  switch (status) {
    case "online":
      return {
        label: "Online",
        className:
          "border border-green-500/20 bg-green-500/10 text-green-500",
      };
    case "idle":
      return {
        label: "Syncing",
        className: "border border-amber-500/20 bg-amber-500/10 text-amber-500",
      };
    default:
      return {
        label: "Offline",
        className: "border border-neutral-700 bg-neutral-800 text-neutral-400",
      };
  }
}

function agentDotClass(status: DashboardAgentRow["status"]) {
  if (status === "online") return "bg-green-500";
  if (status === "idle") return "bg-amber-500";
  return "bg-neutral-600";
}

function OrgActionBadge({ action }: { readonly action: AuditActionType }) {
  if (action === "WRITE") {
    return (
      <span className="rounded border border-blue-800/80 bg-blue-950/40 px-1.5 py-0.5 text-[10px] font-bold text-blue-400">
        WRITE
      </span>
    );
  }
  if (action === "AUTH") {
    return (
      <span className="rounded border border-amber-900/80 bg-amber-950/30 px-1.5 py-0.5 text-[10px] font-bold text-amber-400">
        AUTH
      </span>
    );
  }
  return (
    <span className="rounded border border-purple-900/80 bg-purple-950/35 px-1.5 py-0.5 text-[10px] font-bold text-purple-400">
      READ
    </span>
  );
}

function OrgResultCell({ result }: { readonly result: AuditResultUi }) {
  if (result === "Success") {
    return (
      <div className="flex items-center gap-1.5 font-mono text-[12px] font-medium text-green-400">
        <CheckCircle2 className="size-3.5 shrink-0" strokeWidth={2} aria-hidden />
        SUCCESS
      </div>
    );
  }
  if (result === "Flagged") {
    return (
      <div className="flex items-center gap-1.5 font-mono text-[12px] font-medium text-amber-400">
        <ShieldAlert className="size-3.5 shrink-0" strokeWidth={2} aria-hidden />
        FLAGGED
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5 font-mono text-[12px] font-medium text-red-400">
      <XCircle className="size-3.5 shrink-0" strokeWidth={2} aria-hidden />
      DENIED
    </div>
  );
}

function OrgMetricCard({
  label,
  value,
  sub,
  icon: Icon,
  iconClassName,
}: {
  readonly label: string;
  readonly value: string;
  readonly sub: ReactNode;
  readonly icon: typeof Bot;
  readonly iconClassName?: string;
}) {
  return (
    <ReflectiveCard className="rounded-lg" contentClassName="flex flex-col justify-between p-5">
      <div className="mb-4 flex items-start justify-between gap-2">
        <span className="text-[10px] font-medium uppercase tracking-widest text-neutral-400">
          {label}
        </span>
        <Icon className={cn("size-[18px] shrink-0", iconClassName ?? "text-neutral-500")} strokeWidth={2} />
      </div>
      <div>
        <div className="mb-1 text-3xl font-bold text-white">{value}</div>
        <div className="text-[12px] font-medium">{sub}</div>
      </div>
    </ReflectiveCard>
  );
}

export function OrgOverviewDashboard({ data }: { readonly data: DashboardHomeResponse }) {
  const [memberPreview, setMemberPreview] = useState<OrgMemberRow[]>([]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      void getOrganizationMembers().then((res) => {
        if (res?.members) {
          setMemberPreview(res.members.filter((u) => u.isActive).slice(0, 6));
        }
      });
    }, 0);
    return () => window.clearTimeout(t);
  }, []);

  const m = data.metrics;
  if (m.kind !== "organization") return null;

  const weekSub =
    m.actionsWeekOverWeekPercent === null
      ? "Normal traffic patterns"
      : `${m.actionsWeekOverWeekPercent >= 0 ? "+" : ""}${m.actionsWeekOverWeekPercent}% vs last week`;

  const onlineCount = data.agents.filter((a) => a.status === "online").length;

  return (
    <div className="w-full">
      <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold leading-8 tracking-[-0.02em] text-white">
            Organization Overview
          </h2>
          <p className="mt-1 max-w-2xl text-[14px] leading-relaxed text-neutral-500">
            Global performance and security monitoring for {data.organization.name}.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button
            type="button"
            className="qlix-glass-muted qlix-glass-box-interactive rounded-lg px-3 py-1.5 text-[12px] font-medium text-neutral-200"
          >
            Download report
          </button>
          <Link href="/organization/agents" className={orgGradientBtnClass}>
            Deploy agent
          </Link>
        </div>
      </header>

      <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <OrgMetricCard
          label="Registered agents"
          value={formatCompactCount(m.registeredAgents)}
          sub={
            <span className="flex items-center gap-1 text-green-400">
              <TrendingUp className="size-3.5" strokeWidth={2} aria-hidden />
              {m.agentsActiveToday} active today
            </span>
          }
          icon={Bot}
          iconClassName="text-blue-400"
        />
        <OrgMetricCard
          label="Actions this week"
          value={formatCompactCount(m.actionsThisWeek)}
          sub={<span className="text-neutral-500">{weekSub}</span>}
          icon={Zap}
          iconClassName="text-orange-300"
        />
        <OrgMetricCard
          label="Policy violations"
          value={String(m.policyViolations)}
          sub={
            m.policyViolations === 0 ? (
              <span className="text-green-500">Compliance maintained</span>
            ) : (
              <span className="text-amber-500">Review audit log</span>
            )
          }
          icon={Shield}
          iconClassName={m.policyViolations > 0 ? "text-red-500" : "text-neutral-400"}
        />
        <OrgMetricCard
          label="Active credentials"
          value="—"
          sub={
            <Link
              href="/organization/credentials"
              className="text-amber-500 transition-colors hover:text-amber-400 hover:underline"
            >
              Track expiring in Credentials
            </Link>
          }
          icon={KeyRound}
          iconClassName="text-neutral-500"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="flex flex-col lg:col-span-8">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="flex items-center text-[18px] font-medium leading-6 tracking-[-0.01em] text-white">
              <span className="mr-2 text-neutral-400" aria-hidden>
                <List className="size-[18px]" strokeWidth={1.75} />
              </span>
              Agent registry
            </h3>
            <span className="text-[12px] font-medium text-neutral-500">
              {onlineCount} active {onlineCount === 1 ? "agent" : "agents"} online
            </span>
          </div>
          <ReflectiveCard className="overflow-x-auto rounded-lg">
            <table className="w-full border-collapse text-left">
              <thead className="border-b border-neutral-800">
                <tr className="qlix-glass-inset">
                  <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-widest text-neutral-500">
                    Agent ID
                  </th>
                  <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-widest text-neutral-500">
                    Team
                  </th>
                  <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-widest text-neutral-500">
                    Activity
                  </th>
                  <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-widest text-neutral-500">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="text-[13px]">
                {data.agents.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-neutral-500">
                      No agents registered yet.{" "}
                      <Link href="/organization/agents" className="font-medium text-blue-500 hover:underline">
                        Register an agent
                      </Link>
                    </td>
                  </tr>
                ) : (
                  data.agents.map((row, i) => {
                    const pill = agentStatusPill(row.status);
                    return (
                      <tr
                        key={row.id}
                        className={cn(
                          "transition-colors hover:bg-[var(--glass-row-hover)]",
                          i < data.agents.length - 1 ? "border-b border-neutral-800/50" : "",
                        )}
                      >
                        <td className="px-4 py-3">
                          <Link href={`/organization/agents/${row.id}`} className="flex items-center gap-2">
                            <span
                              className={cn("size-2 shrink-0 rounded-full", agentDotClass(row.status))}
                              aria-hidden
                            />
                            <span className="font-mono text-[13px] text-blue-400">{row.didShort}</span>
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-neutral-400">—</td>
                        <td className="px-4 py-3 text-neutral-500">{row.statusDetail}</td>
                        <td className="px-4 py-3">
                          <span
                            className={cn(
                              "inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase",
                              pill.className,
                            )}
                          >
                            {pill.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </ReflectiveCard>
        </div>

        <div className="flex flex-col lg:col-span-4">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="flex items-center text-[18px] font-medium leading-6 tracking-[-0.01em] text-white">
              <span className="mr-2 text-neutral-400" aria-hidden>
                <Users className="size-[18px]" strokeWidth={1.75} />
              </span>
              Organization members
            </h3>
          </div>
          <ReflectiveCard className="flex flex-1 flex-col overflow-hidden rounded-lg">
            <div className="flex flex-1 flex-col gap-4 p-4">
              {memberPreview.length === 0 ? (
                <p className="text-[12px] text-neutral-500">
                  No members loaded.{" "}
                  <Link href="/organization/members" className="font-medium text-blue-400 hover:underline">
                    Open members
                  </Link>
                </p>
              ) : (
                memberPreview.map((member) => (
                  <div key={member.id} className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-3">
                      <div
                        className="qlix-glass-input flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-medium text-neutral-300"
                        aria-hidden
                      >
                        {overviewMemberInitials(member.displayName, member.email)}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-xs font-semibold text-white">
                          {member.displayName?.trim() || member.email}
                        </div>
                        <div className="truncate text-[10px] text-neutral-500">{member.email}</div>
                      </div>
                    </div>
                    <span
                      className={cn(
                        "shrink-0 rounded border px-2 py-0.5 text-[10px] font-medium capitalize",
                        memberRoleBadgeClass(member.role),
                      )}
                    >
                      {normalizeOrgRole(member.role)}
                    </span>
                  </div>
                ))
              )}
            </div>
            <div className="border-t border-neutral-800 p-4">
              <Link
                href="/organization/members"
                className="qlix-glass-muted qlix-glass-box-interactive block w-full rounded py-2 text-center text-[12px] font-medium text-white"
              >
                Manage members
              </Link>
            </div>
          </ReflectiveCard>
        </div>
      </div>

      <div className="mt-8">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex flex-wrap items-center gap-2 text-[18px] font-medium leading-6 tracking-[-0.01em] text-white">
            <ShieldCheck className="mr-0.5 size-[18px] shrink-0 text-neutral-400" strokeWidth={1.75} aria-hidden />
            Recent audit log
            <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-400">
              Live
            </span>
          </h3>
          <Link
            href="/organization/audit"
            className="text-[12px] font-medium text-blue-400 hover:text-blue-300 hover:underline"
          >
            View full audit trail
          </Link>
        </div>
        <ReflectiveCard className="overflow-x-auto rounded-lg">
          <table className="w-full border-collapse text-left">
            <thead className="border-b border-neutral-800">
              <tr className="qlix-glass-inset">
                <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-widest text-neutral-500">
                  Timestamp
                </th>
                <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-widest text-neutral-500">
                  Agent
                </th>
                <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-widest text-neutral-500">
                  Action type
                </th>
                <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-widest text-neutral-500">
                  Resource
                </th>
                <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-widest text-neutral-500">
                  Result
                </th>
              </tr>
            </thead>
            <tbody className="text-[13px]">
              {data.auditEvents.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-neutral-500">
                    No audit events yet.
                  </td>
                </tr>
              ) : (
                data.auditEvents.slice(0, 10).map((row, i, arr) => (
                  <tr
                    key={row.id}
                    className={cn(
                      "transition-colors hover:bg-[var(--glass-row-hover)]",
                      i < arr.length - 1 ? "border-b border-neutral-800/50" : "",
                    )}
                  >
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-neutral-400">{row.timeUtc}</td>
                    <td className="px-4 py-3 font-mono text-[13px] text-blue-400">{row.agentName}</td>
                    <td className="px-4 py-3">
                      <OrgActionBadge action={row.action} />
                    </td>
                    <td
                      className="max-w-[220px] truncate px-4 py-3 text-neutral-400"
                      title={row.description}
                    >
                      {row.description}
                    </td>
                    <td className="px-4 py-3">
                      <OrgResultCell result={row.result} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </ReflectiveCard>
      </div>
    </div>
  );
}
