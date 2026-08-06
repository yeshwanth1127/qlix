"use client";

import Link from "next/link";
import type { AuditActionType, AuditResultUi } from "@/lib/dashboard-api";
import { useDashboardHome } from "@/lib/hooks/use-dashboard-home";
import { useConnectorsOverview } from "@/lib/hooks/use-connectors-overview";
import { cn } from "@/lib/utils/cn";
import { userFirstName } from "@/lib/workspace";
import { OverviewConnectorsPanel } from "./overview-connectors-panel";
import {
  SketchBox,
  SketchMetric,
  SketchPageHeader,
  SketchPageSkeleton,
  SketchRow,
  SketchSection,
  sketchButtonPrimary,
  sketchButtonSecondary,
  sketchLabel,
  sketchResultTone,
} from "./sketch";

const RP = "/individual";

function ActionLabel({ action }: { action: AuditActionType }) {
  return <span className={sketchLabel}>{action}</span>;
}

function ResultLabel({ result }: { result: AuditResultUi }) {
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

function auditRowTone(result: AuditResultUi): string {
  if (result === "Blocked") return sketchResultTone.blocked;
  if (result === "Flagged") return sketchResultTone.flagged;
  return sketchResultTone.success;
}

export function IndividualHomeView() {
  const { data, error, loading, refresh } = useDashboardHome();
  const {
    liveConnectors,
    loading: connectorsLoading,
  } = useConnectorsOverview();

  if (loading) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <SketchPageHeader title="Overview" />
        <SketchPageSkeleton metrics={1} rows={6} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-3 py-12">
        <p className="text-[13px] text-black">{error ?? "Could not load dashboard."}</p>
        <button type="button" onClick={() => void refresh()} className={sketchButtonSecondary}>
          Retry
        </button>
      </div>
    );
  }

  if (data.metrics.kind !== "individual") {
    return (
      <p className="text-[13px] text-black/60">This overview is for individual workspaces only.</p>
    );
  }

  const m = data.metrics;
  const firstName = userFirstName(data.user.displayName, data.user.email);
  const agents = data.agents;
  const auditRows = data.auditEvents;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="qlix-section-in" style={{ "--qlix-stagger-i": 0 } as React.CSSProperties}>
        <SketchPageHeader title={`Overview — ${firstName}`} />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 lg:grid-cols-12">
        <div
          className="qlix-section-in flex flex-col gap-5 lg:col-span-4"
          style={{ "--qlix-stagger-i": 1 } as React.CSSProperties}
        >
          <SketchMetric value={m.activeAgents} label="Active Agents" tone="purple" />
          <SketchSection title="My Agents" className="min-h-0 flex-1">
            <SketchBox tone="blue" className="flex flex-1 flex-col gap-2 p-3">
              {agents.length === 0 ? (
                <div className="flex flex-col items-start gap-3 py-2">
                  <p className={cn(sketchLabel, "normal-case tracking-normal text-black/45")}>
                    You haven&apos;t registered any agents yet.
                  </p>
                  <Link href={`${RP}/agents`} className={sketchButtonPrimary}>
                    Register your first agent →
                  </Link>
                </div>
              ) : (
                agents.map((agent) => (
                  <Link key={agent.id} href={`${RP}/agents/${agent.id}`}>
                    <SketchRow className="flex items-center justify-between">
                      <span className="truncate text-[13px] text-black">{agent.name}</span>
                      <span className={cn(sketchLabel, "shrink-0 text-[10px]")}>{agent.status}</span>
                    </SketchRow>
                  </Link>
                ))
              )}
            </SketchBox>
          </SketchSection>
          <OverviewConnectorsPanel
            connectorsHref={`${RP}/connectors`}
            liveConnectors={liveConnectors}
            loading={connectorsLoading}
          />
        </div>

        <div
          className="qlix-section-in flex min-h-0 flex-col gap-3 lg:col-span-8"
          style={{ "--qlix-stagger-i": 2 } as React.CSSProperties}
        >
          <div className="flex flex-col gap-2">
            {auditRows.length === 0 ? (
              <SketchRow>
                <span className={cn(sketchLabel, "normal-case tracking-normal text-black/45")}>
                  No events in this time range. Try adjusting filters.
                </span>
              </SketchRow>
            ) : (
              auditRows.slice(0, 6).map((row) => (
                <SketchRow
                  key={row.id}
                  className={cn(
                    "flex flex-wrap items-center justify-between gap-2",
                    auditRowTone(row.result),
                  )}
                >
                  <span className="truncate text-[12px] text-black">{row.description}</span>
                  <div className="flex shrink-0 items-center gap-3">
                    <ActionLabel action={row.action} />
                    <ResultLabel result={row.result} />
                  </div>
                </SketchRow>
              ))
            )}
          </div>

          <div className="flex items-center justify-between border-y border-black/10 py-2.5">
            <Link
              href={`${RP}/audit`}
              className={cn(sketchLabel, "transition-colors hover:text-[color:var(--sketch-purple)]")}
            >
              + See More
            </Link>
            <span className={sketchLabel}>Today&apos;s Actions</span>
          </div>

          <SketchBox tone="green" className="min-h-[200px] flex-1 p-4">
            {auditRows.length === 0 ? (
              <p className={cn(sketchLabel, "normal-case tracking-normal text-black/40")}>
                Activity log
              </p>
            ) : (
              <div className="space-y-2">
                {auditRows.map((row) => (
                  <div
                    key={row.id}
                    className={cn(
                      "flex flex-wrap gap-x-4 gap-y-1 border-b border-black/10 pb-2 text-[12px] text-black last:border-0",
                      auditRowTone(row.result),
                      "pl-2",
                    )}
                  >
                    <span className="font-mono text-[11px] text-black/45">{row.timeUtc}</span>
                    <span>{row.agentName}</span>
                    <span className="text-black/65">{row.description}</span>
                  </div>
                ))}
              </div>
            )}
          </SketchBox>
        </div>
      </div>
    </div>
  );
}
