"use client";

import Link from "next/link";
import { AgentStatusBadge } from "./agent-status-badge";
import { MetricCard } from "./metric-card";
import { ReflectiveCard } from "./ReflectiveCard";
import { SectionHeading } from "./section-heading";
import { useDashboardHome } from "@/lib/hooks/use-dashboard-home";
import { formatCompactCount, userFirstName } from "@/lib/workspace";

/** App-chrome overview fallback when not using the bespoke individual home layout. */
export function IndividualDashboard() {
  const { data, error, loading, refresh } = useDashboardHome();

  if (loading) {
    return <p className="text-[13px] text-[--text-tertiary]">Loading overview…</p>;
  }

  if (error || !data) {
    return (
      <div className="space-y-2">
        <p className="text-[13px] text-[--danger]">{error ?? "Could not load dashboard."}</p>
        <button
          type="button"
          onClick={() => void refresh()}
          className="text-[13px] font-medium text-[--accent] hover:text-[--accent-hover]"
        >
          Retry
        </button>
      </div>
    );
  }

  if (data.metrics.kind !== "individual") {
    return (
      <p className="text-[13px] text-[--text-tertiary]">Switch to an individual workspace to view this overview.</p>
    );
  }

  const m = data.metrics;
  const first = userFirstName(data.user.displayName, data.user.email);

  const actionSub =
    m.actionsVsYesterdayPercent === null
      ? "No prior day baseline"
      : `${m.actionsVsYesterdayPercent >= 0 ? "+" : ""}${m.actionsVsYesterdayPercent}% vs yesterday`;

  const credSub = m.credentialsValid === 0 ? "None recorded yet" : "Tracked in ledger";

  return (
    <div className="flex flex-col gap-10">
      <div>
        <h1 className="text-base font-medium tracking-[-0.01em] text-[--text-primary]">
          Welcome, {first}
        </h1>
        <p className="mt-1 text-[13px] text-[--text-secondary]">
          {data.organization.name} — personal workspace
        </p>
      </div>

      <section className="grid gap-4 sm:grid-cols-3">
        <MetricCard
          label="Active agents"
          value={String(m.activeAgents)}
          subtext={`${m.agentsOnline} online now`}
        />
        <MetricCard
          label="Actions today"
          value={formatCompactCount(m.actionsToday)}
          subtext={actionSub}
        />
        <MetricCard label="Credentials" value={String(m.credentialsValid)} subtext={credSub} />
      </section>

      <section className="space-y-4">
        <SectionHeading title="My agents" />
        <div className="flex flex-col gap-2">
          {data.agents.length === 0 ? (
            <p className="text-[13px] text-[--text-tertiary]">No agents registered yet.</p>
          ) : (
            data.agents.map((row) => (
              <Link
                key={row.id}
                href={`/individual/agents/${row.id}`}
                className="qlix-glass-box qlix-glass-box-interactive flex flex-wrap items-center justify-between gap-3 rounded-xl p-4"
              >
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium text-[--text-primary]">{row.name}</p>
                  <p className="text-[12px] text-[--text-tertiary]">
                    {row.statusDetail} · {row.actionsToday} actions today · {row.didShort}
                  </p>
                </div>
                <AgentStatusBadge status={row.status} />
              </Link>
            ))
          )}
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-end justify-between gap-4">
          <SectionHeading title="Recent audit log" />
          <Link
            href="/individual/audit"
            className="shrink-0 text-[12px] font-medium text-[--accent] transition-colors hover:text-[--accent-hover]"
          >
            View full log →
          </Link>
        </div>
        <ReflectiveCard className="w-full overflow-hidden rounded-xl">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="qlix-glass-inset border-b border-[--border-subtle]">
                <th className="px-4 py-2.5 text-[11px] font-medium uppercase tracking-widest text-[--text-tertiary]">
                  Time (UTC)
                </th>
                <th className="px-4 py-2.5 text-[11px] font-medium uppercase tracking-widest text-[--text-tertiary]">
                  Agent
                </th>
                <th className="px-4 py-2.5 text-[11px] font-medium uppercase tracking-widest text-[--text-tertiary]">
                  Details
                </th>
              </tr>
            </thead>
            <tbody>
              {data.auditEvents.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-[13px] text-[--text-tertiary]">
                    No audit events yet.
                  </td>
                </tr>
              ) : (
                data.auditEvents.map((row) => (
                  <tr
                    key={row.id}
                    className={
                      row.result === "Flagged"
                        ? "border-b border-[--border-subtle] border-l-2 border-l-[--danger] bg-[--danger-subtle]/30 transition-colors last:border-0"
                        : row.result === "Blocked"
                          ? "border-b border-[--border-subtle] border-l-2 border-l-[--warning] transition-colors last:border-0"
                          : "border-b border-[--border-subtle] transition-colors last:border-0 hover:bg-[var(--glass-row-hover)]"
                    }
                  >
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-[12px] text-[--text-secondary]">
                      {row.timeUtc}
                    </td>
                    <td className="px-4 py-3 text-[13px] text-[--text-primary]">{row.agentName}</td>
                    <td className="px-4 py-3 text-[13px] text-[--text-secondary]">{row.description}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </ReflectiveCard>
      </section>
    </div>
  );
}
