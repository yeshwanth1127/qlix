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
import { formatDateTimeInDisplayTz } from "@/lib/display-datetime";
import { cn } from "@/lib/utils/cn";
import {
  SketchBox,
  SketchListSkeleton,
  SketchMetric,
  SketchPageHeader,
  SketchRow,
  sketchButtonGhost,
  sketchButtonSecondary,
  sketchInput,
  sketchLabel,
  sketchResultTone,
} from "@/components/qlix/sketch";

type ResultFilter = "all" | AuditResultUi;
type ActionFilter = "all" | AuditActionType;

function formatSystemTime(timestampMs: number): string {
  return formatDateTimeInDisplayTz(timestampMs);
}

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

function isMutedEvent(event: AuditLogEvent): boolean {
  const t = `${event.actionType} ${event.surface ?? ""}`.toLowerCase();
  return t.includes("policy") || t.includes("system");
}

function auditRowTone(event: AuditLogEvent): string {
  if (event.result === "Blocked") return sketchResultTone.blocked;
  if (event.result === "Flagged") return sketchResultTone.flagged;
  if (isMutedEvent(event)) return sketchResultTone.muted;
  return sketchResultTone.success;
}

function ResultLabel({ result }: { readonly result: AuditResultUi }) {
  return (
    <span
      className={cn(
        "text-[10px] font-medium uppercase tracking-[0.12em]",
        result === "Blocked" && "text-[color:var(--warning)]",
        result === "Flagged" && "text-[color:var(--sketch-red)]",
        result === "Success" && "text-black/45",
      )}
    >
      {result}
    </span>
  );
}

function ActionLabel({ action }: { readonly action: AuditActionType }) {
  return <span className={sketchLabel}>{action}</span>;
}

function RiskLabel({ risk }: { readonly risk: AuditRiskLevel }) {
  return <span className={cn(sketchLabel, "text-[10px] text-black/50")}>{risk}</span>;
}

function ActionTag({ event }: { readonly event: AuditLogEvent }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <ActionLabel action={event.action} />
      {event.surface ? (
        <span className="text-[11px] text-black/40">{event.surface}</span>
      ) : null}
    </span>
  );
}

function GroupResultCounts({ events }: { readonly events: AuditLogEvent[] }) {
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
    <span className="inline-flex items-center gap-2.5 text-[10px] font-medium uppercase tracking-[0.12em] text-black/45">
      {counts.Flagged > 0 ? (
        <span className="text-[color:var(--sketch-red)]">Flagged {counts.Flagged}</span>
      ) : null}
      {counts.Blocked > 0 ? (
        <span className="text-[color:var(--warning)]">Blocked {counts.Blocked}</span>
      ) : null}
    </span>
  );
}

const selectClass = cn(sketchInput, "h-9 w-auto px-2.5 py-0 text-[13px]");

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
      <div className="flex flex-col gap-6">
        <SketchPageHeader title="Audit Log" />
        <div className="grid gap-4 sm:grid-cols-4">
          <SketchMetric value="—" label="Total Actions" />
          <SketchMetric value="—" label="Success" />
          <SketchMetric value="—" label="Blocked" />
          <SketchMetric value="—" label="Flagged" />
        </div>
        <SketchListSkeleton rows={8} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-3 py-12">
        <p className="text-[13px] text-black">{error ?? "Could not load audit log."}</p>
        <button type="button" onClick={() => void refresh()} className={sketchButtonSecondary}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <SketchPageHeader
        title="Audit Log"
        actions={
          <button type="button" onClick={() => void refresh()} className={sketchButtonSecondary}>
            Refresh
          </button>
        }
      />
      <p className="-mt-4 text-[13px] leading-relaxed text-black/50">
        Tamper-evident record of every agent and admin action, grouped by agent.
        {data.truncated ? ` Showing the latest ${data.limit.toLocaleString()}.` : ""}
      </p>

      <section className="grid gap-4 sm:grid-cols-4">
        <SketchMetric value={data.totalEvents} label="Total Actions" />
        <SketchMetric value={totals.Success} label="Success" tone="green" />
        <SketchMetric value={totals.Blocked} label="Blocked" tone="amber" />
        <SketchMetric value={totals.Flagged} label="Flagged" tone="rose" />
      </section>

      <div className="flex flex-wrap items-center gap-2.5">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search description, action, surface…"
          className={cn(sketchInput, "h-9 w-full min-w-0 flex-1 py-0 sm:min-w-[220px]")}
        />
        <select
          value={resultFilter}
          onChange={(e) => setResultFilter(e.target.value as ResultFilter)}
          className={selectClass}
        >
          <option value="all">All results</option>
          <option value="Success">Success</option>
          <option value="Blocked">Blocked</option>
          <option value="Flagged">Flagged</option>
        </select>
        <select
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value as ActionFilter)}
          className={selectClass}
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
            className={sketchButtonGhost}
          >
            Clear
          </button>
        ) : null}
      </div>

      {filteredGroups.length === 0 ? (
        <SketchBox className="p-12 text-center">
          <p className={cn(sketchLabel, "normal-case tracking-normal text-black/45")}>
            {data.totalEvents === 0
              ? "No audit events recorded yet."
              : "No events in this time range. Try adjusting filters."}
          </p>
        </SketchBox>
      ) : (
        <div className="flex flex-col gap-4">
          {filtersActive ? (
            <p className={sketchLabel}>
              {visibleEventCount.toLocaleString()} event{visibleEventCount === 1 ? "" : "s"} shown
              across {filteredGroups.length} agent{filteredGroups.length === 1 ? "" : "s"}
            </p>
          ) : null}

          {filteredGroups.map((group) => {
            const isCollapsed = collapsed[group.agentId] ?? false;
            return (
              <SketchBox key={group.agentId} className="overflow-hidden">
                <SketchRow
                  onClick={() =>
                    setCollapsed((prev) => ({ ...prev, [group.agentId]: !isCollapsed }))
                  }
                  className="flex items-center justify-between border-b border-black/10"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <svg
                      viewBox="0 0 16 16"
                      className={cn(
                        "size-3.5 shrink-0 text-black/40 transition-transform duration-200 ease-out",
                        !isCollapsed && "rotate-90",
                      )}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.6}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M6 4l4 4-4 4" />
                    </svg>
                    <span className="truncate text-[13px] font-medium text-black">{group.agentName}</span>
                    {group.agentKind === "org_brain" ? (
                      <span className={sketchLabel}>Brain</span>
                    ) : null}
                    <span className="hidden truncate font-mono text-[11px] text-black/40 sm:inline">
                      {group.didShort}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <GroupResultCounts events={group.events} />
                    <span className={cn(sketchLabel, "text-[10px]")}>
                      {group.eventCount} event{group.eventCount === 1 ? "" : "s"}
                    </span>
                  </div>
                </SketchRow>

                {isCollapsed ? null : (
                  <>
                    <div className="divide-y divide-black/8 md:hidden">
                      {group.events.map((event) => (
                        <div
                          key={event.id}
                          className={cn("space-y-2 px-3 py-3", auditRowTone(event))}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-mono text-[11px] text-black/45">
                              {formatSystemTime(event.timestampMs)}
                            </span>
                            <ResultLabel result={event.result} />
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <ActionTag event={event} />
                            <RiskLabel risk={event.riskLevel} />
                          </div>
                          <p className="text-[13px] leading-snug text-black">{event.description}</p>
                        </div>
                      ))}
                    </div>
                    <div className="hidden overflow-x-auto md:block">
                      <table className="w-full border-collapse text-left">
                        <thead>
                          <tr className="border-b border-black/10">
                            <th className={cn("px-4 py-2.5 text-left", sketchLabel)}>Time (IST)</th>
                            <th className={cn("px-4 py-2.5 text-left", sketchLabel)}>Action</th>
                            <th className={cn("px-4 py-2.5 text-left", sketchLabel)}>Details</th>
                            <th className={cn("px-4 py-2.5 text-left", sketchLabel)}>Risk</th>
                            <th className={cn("px-4 py-2.5 text-right", sketchLabel)}>Result</th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.events.map((event) => (
                            <tr
                              key={event.id}
                              className={cn(
                                "border-b border-black/8 transition-colors duration-200 last:border-0 hover:bg-[#E2F0CC]/70",
                                auditRowTone(event),
                              )}
                            >
                              <td className="whitespace-nowrap px-4 py-3 font-mono text-[12px] text-black/50">
                                {formatSystemTime(event.timestampMs)}
                              </td>
                              <td className="whitespace-nowrap px-4 py-3">
                                <ActionTag event={event} />
                              </td>
                              <td className="px-4 py-3 text-[13px] text-black">{event.description}</td>
                              <td className="whitespace-nowrap px-4 py-3">
                                <RiskLabel risk={event.riskLevel} />
                              </td>
                              <td className="whitespace-nowrap px-4 py-3 text-right">
                                <ResultLabel result={event.result} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </SketchBox>
            );
          })}
        </div>
      )}
    </div>
  );
}
