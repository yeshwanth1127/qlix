"use client";

import { useMemo, useState } from "react";
import { useAuditLog } from "@/lib/hooks/use-audit-log";
import type {
  AuditActionType,
  AuditAgentGroup,
  AuditLogEvent,
  AuditResultUi,
  AuditRiskLevel,
} from "@/lib/dashboard-api";

type ResultFilter = "all" | AuditResultUi;
type ActionFilter = "all" | AuditActionType;

/* ── Semantic color recipes (design-system tokens) ──────────────────────── */

const RESULT_STYLE: Record<
  AuditResultUi,
  { pill: string; dot: string; bar: string }
> = {
  Success: {
    pill: "bg-[--success-subtle] text-[--success]",
    dot: "bg-[--success]",
    bar: "",
  },
  Blocked: {
    pill: "bg-[--warning-subtle] text-[--warning]",
    dot: "bg-[--warning]",
    bar: "border-l-2 border-l-[--warning]",
  },
  Flagged: {
    pill: "bg-[--danger-subtle] text-[--danger]",
    dot: "bg-[--danger]",
    bar: "border-l-2 border-l-[--danger] bg-[--danger-subtle]/30",
  },
};

const RISK_STYLE: Record<AuditRiskLevel, { text: string; dot: string }> = {
  low: { text: "text-[--text-tertiary]", dot: "bg-[--neutral]" },
  medium: { text: "text-[--warning]", dot: "bg-[--warning]" },
  high: { text: "text-[--danger]", dot: "bg-[--danger]" },
};

function actionTextClass(action: AuditActionType): string {
  if (action === "WRITE") return "text-[--warning]";
  if (action === "AUTH") return "text-[--accent]";
  return "text-[--text-secondary]";
}

/* ── Filtering ──────────────────────────────────────────────────────────── */

function eventMatches(
  event: AuditLogEvent,
  query: string,
  resultFilter: ResultFilter,
  actionFilter: ActionFilter,
): boolean {
  if (resultFilter !== "all" && event.result !== resultFilter) return false;
  if (actionFilter !== "all" && event.action !== actionFilter) return false;
  if (query) {
    const haystack =
      `${event.description} ${event.actionType} ${event.surface ?? ""} ${event.approvalStatus}`.toLowerCase();
    if (!haystack.includes(query)) return false;
  }
  return true;
}

function countByResult(groups: AuditAgentGroup[]): Record<AuditResultUi, number> {
  const acc: Record<AuditResultUi, number> = { Success: 0, Blocked: 0, Flagged: 0 };
  for (const g of groups) for (const e of g.events) acc[e.result]++;
  return acc;
}

/* ── Small presentational pieces ────────────────────────────────────────── */

function StatCard({
  label,
  value,
  accent,
}: {
  readonly label: string;
  readonly value: number;
  readonly accent: "neutral" | "success" | "warning" | "danger";
}) {
  const valueColor =
    accent === "success"
      ? "text-[--success]"
      : accent === "warning"
        ? "text-[--warning]"
        : accent === "danger"
          ? "text-[--danger]"
          : "text-[--text-primary]";
  return (
    <div className="rounded-xl border border-[--border-subtle] bg-[--bg-elevated] p-4">
      <p className="text-[11px] font-medium uppercase tracking-widest text-[--text-tertiary]">
        {label}
      </p>
      <p className={`mt-1.5 text-[28px] font-[450] leading-none tracking-[-0.03em] ${valueColor}`}>
        {value.toLocaleString()}
      </p>
    </div>
  );
}

function ResultBadge({ result }: { readonly result: AuditResultUi }) {
  const s = RESULT_STYLE[result];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${s.pill}`}
    >
      <span className={`size-1.5 rounded-full ${s.dot}`} />
      {result}
    </span>
  );
}

function ActionTag({ event }: { readonly event: AuditLogEvent }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={`rounded-md border border-[--border-subtle] bg-[--bg-overlay] px-2 py-0.5 font-mono text-[10px] font-medium tracking-wider ${actionTextClass(
          event.action,
        )}`}
      >
        {event.action}
      </span>
      {event.surface ? (
        <span className="text-[11px] text-[--text-tertiary]">{event.surface}</span>
      ) : null}
    </span>
  );
}

function RiskCell({ risk }: { readonly risk: AuditRiskLevel }) {
  const s = RISK_STYLE[risk];
  return (
    <span className={`inline-flex items-center gap-1.5 text-[12px] font-medium capitalize ${s.text}`}>
      <span className={`size-1.5 rounded-full ${s.dot}`} />
      {risk}
    </span>
  );
}

/** Tiny colored dot + count, shown in a group header when any blocked/flagged exist. */
function GroupResultDots({ events }: { readonly events: AuditLogEvent[] }) {
  const counts = useMemo(() => {
    const c = { Blocked: 0, Flagged: 0 };
    for (const e of events) {
      if (e.result === "Blocked") c.Blocked++;
      else if (e.result === "Flagged") c.Flagged++;
    }
    return c;
  }, [events]);
  if (counts.Blocked === 0 && counts.Flagged === 0) return null;
  return (
    <span className="inline-flex items-center gap-2.5">
      {counts.Flagged > 0 ? (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[--danger]">
          <span className="size-1.5 rounded-full bg-[--danger]" />
          {counts.Flagged}
        </span>
      ) : null}
      {counts.Blocked > 0 ? (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[--warning]">
          <span className="size-1.5 rounded-full bg-[--warning]" />
          {counts.Blocked}
        </span>
      ) : null}
    </span>
  );
}

/* ── Main view ──────────────────────────────────────────────────────────── */

export function AuditLogView() {
  const { data, error, loading, refresh } = useAuditLog();
  const [query, setQuery] = useState("");
  const [resultFilter, setResultFilter] = useState<ResultFilter>("all");
  const [actionFilter, setActionFilter] = useState<ActionFilter>("all");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const normalizedQuery = query.trim().toLowerCase();

  const totals = useMemo(
    () => (data ? countByResult(data.groups) : { Success: 0, Blocked: 0, Flagged: 0 }),
    [data],
  );

  const filteredGroups = useMemo(() => {
    if (!data) return [] as AuditAgentGroup[];
    return data.groups
      .map((group) => ({
        ...group,
        events: group.events.filter((e) =>
          eventMatches(e, normalizedQuery, resultFilter, actionFilter),
        ),
      }))
      .filter((group) => group.events.length > 0);
  }, [data, normalizedQuery, resultFilter, actionFilter]);

  const visibleEventCount = useMemo(
    () => filteredGroups.reduce((sum, g) => sum + g.events.length, 0),
    [filteredGroups],
  );

  const filtersActive =
    normalizedQuery !== "" || resultFilter !== "all" || actionFilter !== "all";

  if (loading) {
    return (
      <div className="animate-qlix-fade-in space-y-6">
        <div className="h-5 w-40 rounded bg-[--bg-hover]" style={{ animation: "qlix-shimmer 1.4s ease-in-out infinite" }} />
        <div className="grid gap-4 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-[88px] rounded-xl border border-[--border-subtle] bg-[--bg-hover]"
              style={{ animation: "qlix-shimmer 1.4s ease-in-out infinite" }}
            />
          ))}
        </div>
        <div className="h-64 rounded-xl border border-[--border-subtle] bg-[--bg-hover]" style={{ animation: "qlix-shimmer 1.4s ease-in-out infinite" }} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-3 rounded-xl border border-[--danger]/30 bg-[--danger-subtle] p-5">
        <p className="text-[13px] text-[--danger]">{error ?? "Could not load audit log."}</p>
        <button
          type="button"
          onClick={() => void refresh()}
          className="h-8 rounded-lg border border-[--border-default] bg-[--bg-overlay] px-4 text-[13px] font-medium text-[--text-primary] transition-colors hover:bg-[--bg-hover] active:scale-[0.98]"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="animate-qlix-fade-in flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-base font-medium tracking-[-0.01em] text-[--text-primary]">
            Audit log
          </h1>
          <p className="mt-1 text-[13px] text-[--text-secondary]">
            Tamper-evident record of every agent and admin action, grouped by agent.
            {data.truncated ? ` Showing the latest ${data.limit.toLocaleString()}.` : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          className="h-8 shrink-0 rounded-lg border border-[--border-default] bg-[--bg-overlay] px-4 text-[13px] font-medium text-[--text-secondary] transition-colors hover:bg-[--bg-hover] hover:text-[--text-primary] active:scale-[0.98]"
        >
          Refresh
        </button>
      </div>

      {/* Summary stats */}
      <section className="grid gap-4 sm:grid-cols-4">
        <StatCard label="Total actions" value={data.totalEvents} accent="neutral" />
        <StatCard label="Success" value={totals.Success} accent="success" />
        <StatCard label="Blocked" value={totals.Blocked} accent="warning" />
        <StatCard label="Flagged" value={totals.Flagged} accent="danger" />
      </section>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search description, action, surface…"
          className="h-8 min-w-[220px] flex-1 rounded-lg border border-[--border-default] bg-[--bg-overlay] px-3 text-[13px] text-[--text-primary] placeholder:text-[--text-tertiary] focus:border-[--border-strong] focus:outline-none focus:ring-1 focus:ring-[--accent-border]"
        />
        <select
          value={resultFilter}
          onChange={(e) => setResultFilter(e.target.value as ResultFilter)}
          className="h-8 rounded-lg border border-[--border-default] bg-[--bg-overlay] px-2.5 text-[13px] text-[--text-secondary] focus:border-[--border-strong] focus:outline-none focus:ring-1 focus:ring-[--accent-border]"
        >
          <option value="all">All results</option>
          <option value="Success">Success</option>
          <option value="Blocked">Blocked</option>
          <option value="Flagged">Flagged</option>
        </select>
        <select
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value as ActionFilter)}
          className="h-8 rounded-lg border border-[--border-default] bg-[--bg-overlay] px-2.5 text-[13px] text-[--text-secondary] focus:border-[--border-strong] focus:outline-none focus:ring-1 focus:ring-[--accent-border]"
        >
          <option value="all">All actions</option>
          <option value="READ">Read</option>
          <option value="WRITE">Write</option>
          <option value="AUTH">Auth</option>
        </select>
        {filtersActive ? (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setResultFilter("all");
              setActionFilter("all");
            }}
            className="h-8 rounded-lg px-3 text-[13px] font-medium text-[--text-tertiary] transition-colors hover:text-[--text-primary]"
          >
            Clear
          </button>
        ) : null}
      </div>

      {/* Grouped log */}
      {filteredGroups.length === 0 ? (
        <div className="rounded-xl border border-[--border-subtle] bg-[--bg-elevated] p-10 text-center">
          <p className="text-[13px] text-[--text-tertiary]">
            {data.totalEvents === 0
              ? "No audit events recorded yet."
              : "No events match the current filters."}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {filtersActive ? (
            <p className="text-[12px] text-[--text-tertiary]">
              {visibleEventCount.toLocaleString()} event{visibleEventCount === 1 ? "" : "s"} shown
              across {filteredGroups.length} agent{filteredGroups.length === 1 ? "" : "s"}
            </p>
          ) : null}

          {filteredGroups.map((group) => {
            const isCollapsed = collapsed[group.agentId] ?? false;
            return (
              <div
                key={group.agentId}
                className="overflow-hidden rounded-xl border border-[--border-subtle] bg-[--bg-elevated]"
              >
                {/* Group header */}
                <button
                  type="button"
                  onClick={() =>
                    setCollapsed((prev) => ({ ...prev, [group.agentId]: !isCollapsed }))
                  }
                  className="flex w-full items-center justify-between gap-3 border-b border-[--border-subtle] bg-[--bg-subtle] px-4 py-3 text-left transition-colors hover:bg-[--bg-hover]"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <svg
                      viewBox="0 0 16 16"
                      className={`size-3.5 shrink-0 text-[--text-tertiary] transition-transform duration-150 ${
                        isCollapsed ? "" : "rotate-90"
                      }`}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.6}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M6 4l4 4-4 4" />
                    </svg>
                    <span className="truncate text-[13px] font-medium text-[--text-primary]">
                      {group.agentName}
                    </span>
                    {group.agentKind === "org_brain" ? (
                      <span className="inline-flex items-center rounded-full bg-[--accent-subtle] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[--accent]">
                        Brain
                      </span>
                    ) : null}
                    <span className="hidden truncate font-mono text-[11px] text-[--text-tertiary] sm:inline">
                      {group.didShort}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <GroupResultDots events={group.events} />
                    <span className="rounded-full border border-[--border-subtle] bg-[--bg-overlay] px-2 py-0.5 text-[11px] font-medium text-[--text-secondary]">
                      {group.eventCount} event{group.eventCount === 1 ? "" : "s"}
                    </span>
                  </div>
                </button>

                {/* Events table */}
                {isCollapsed ? null : (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-left">
                      <thead>
                        <tr className="border-b border-[--border-subtle] bg-[--bg-subtle]">
                          <th className="px-4 py-2.5 text-[11px] font-medium uppercase tracking-widest text-[--text-tertiary]">
                            Time (UTC)
                          </th>
                          <th className="px-4 py-2.5 text-[11px] font-medium uppercase tracking-widest text-[--text-tertiary]">
                            Action
                          </th>
                          <th className="px-4 py-2.5 text-[11px] font-medium uppercase tracking-widest text-[--text-tertiary]">
                            Details
                          </th>
                          <th className="px-4 py-2.5 text-[11px] font-medium uppercase tracking-widest text-[--text-tertiary]">
                            Risk
                          </th>
                          <th className="px-4 py-2.5 text-right text-[11px] font-medium uppercase tracking-widest text-[--text-tertiary]">
                            Result
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.events.map((event) => (
                          <tr
                            key={event.id}
                            className={`border-b border-[--border-subtle] transition-colors last:border-0 hover:bg-[--bg-hover] ${RESULT_STYLE[event.result].bar}`}
                          >
                            <td className="whitespace-nowrap px-4 py-3 font-mono text-[12px] text-[--text-secondary]">
                              <span className="text-[--text-tertiary]">{event.dateUtc}</span>{" "}
                              {event.timeUtc}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3">
                              <ActionTag event={event} />
                            </td>
                            <td className="px-4 py-3 text-[13px] text-[--text-primary]">
                              {event.description}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3">
                              <RiskCell risk={event.riskLevel} />
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-right">
                              <ResultBadge result={event.result} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
