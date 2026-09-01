"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { AuditResultUi, DashboardHomeResponse } from "@/lib/dashboard-api";
import { getOrganizationMembers, type OrgMemberRow } from "@/lib/organization-api";
import { normalizeOrgRole } from "@/lib/org-permissions";
import { useConnectorsOverview } from "@/lib/hooks/use-connectors-overview";
import { cn } from "@/lib/utils/cn";
import { formatCompactCount } from "@/lib/workspace";
import { OverviewConnectorsPanel } from "./overview-connectors-panel";
import {
  SketchBox,
  SketchMetric,
  SketchPageHeader,
  SketchRow,
  SketchSection,
  sketchButtonPrimary,
  sketchLabel,
  sketchResultTone,
} from "./sketch";

function overviewMemberInitials(displayName: string | null, email: string): string {
  const s = (displayName?.trim() || email).trim();
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  }
  return s.slice(0, 2).toUpperCase();
}

function auditRowTone(result: AuditResultUi): string {
  if (result === "Blocked") return sketchResultTone.blocked;
  if (result === "Flagged") return sketchResultTone.flagged;
  return sketchResultTone.success;
}

export function OrgOverviewDashboard({ data }: { readonly data: DashboardHomeResponse }) {
  const [memberPreview, setMemberPreview] = useState<OrgMemberRow[]>([]);
  const {
    liveConnectors,
    loading: connectorsLoading,
  } = useConnectorsOverview();

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

  const auditRows = data.auditEvents;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="qlix-section-in" style={{ "--qlix-stagger-i": 0 } as React.CSSProperties}>
        <SketchPageHeader
          title="Overview"
          actions={
            <Link href="/organization/agents" className={sketchButtonPrimary}>
              + Deploy Agent
            </Link>
          }
        />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 lg:grid-cols-12">
        <div
          className="qlix-section-in flex flex-col gap-5 lg:col-span-4"
          style={{ "--qlix-stagger-i": 1 } as React.CSSProperties}
        >
          <SketchMetric
            value={formatCompactCount(m.registeredAgents)}
            label="Registered Agents"
            tone="purple"
          />
          <SketchSection title="Agent Registry">
            <SketchBox tone="blue" className="flex flex-col gap-2 p-3">
              {data.agents.length === 0 ? (
                <div className="flex flex-col items-start gap-3 py-2">
                  <p className={cn(sketchLabel, "normal-case tracking-normal text-black/45")}>
                    You haven&apos;t registered any agents yet.
                  </p>
                  <Link href="/organization/agents" className={sketchButtonPrimary}>
                    Register your first agent →
                  </Link>
                </div>
              ) : (
                data.agents.slice(0, 6).map((agent) => (
                  <Link key={agent.id} href={`/organization/agents/${agent.id}`}>
                    <SketchRow className="flex items-center justify-between">
                      <span className="truncate font-mono text-[12px] text-black">{agent.didShort}</span>
                      <span className={cn(sketchLabel, "shrink-0 text-[10px]")}>{agent.status}</span>
                    </SketchRow>
                  </Link>
                ))
              )}
            </SketchBox>
          </SketchSection>
          <OverviewConnectorsPanel
            connectorsHref="/organization/connectors"
            liveConnectors={liveConnectors}
            loading={connectorsLoading}
          />
        </div>

        <div
          className="qlix-section-in flex min-h-0 flex-col gap-3 lg:col-span-8"
          style={{ "--qlix-stagger-i": 2 } as React.CSSProperties}
        >
          <div className="grid grid-cols-2 gap-3">
            <SketchMetric
              value={formatCompactCount(m.actionsThisWeek)}
              label="Actions This Week"
              tone="green"
              className="p-4"
            />
            <SketchMetric
              value={String(m.policyViolations)}
              label="Policy Violations"
              tone="rose"
              className="p-4"
            />
          </div>

          <SketchSection title="Members">
            <SketchBox tone="amber" className="flex flex-col gap-2 p-3">
              {memberPreview.length === 0 ? (
                <Link
                  href="/organization/members"
                  className={cn(sketchLabel, "transition-colors hover:text-[color:var(--sketch-purple)]")}
                >
                  Open members
                </Link>
              ) : (
                memberPreview.map((member) => (
                  <SketchRow key={member.id} className="flex items-center justify-between">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-black/15 text-[10px] font-medium tracking-wide">
                        {overviewMemberInitials(member.displayName, member.email)}
                      </span>
                      <span className="truncate text-[12px] text-black">
                        {member.displayName?.trim() || member.email}
                      </span>
                    </div>
                    <span className={cn(sketchLabel, "shrink-0 text-[10px]")}>
                      {normalizeOrgRole(member.role)}
                    </span>
                  </SketchRow>
                ))
              )}
            </SketchBox>
          </SketchSection>

          <div className="flex flex-col gap-2">
            {auditRows.length === 0 ? (
              <SketchRow>
                <span className={cn(sketchLabel, "normal-case tracking-normal text-black/45")}>
                  No audit events
                </span>
              </SketchRow>
            ) : (
              auditRows.slice(0, 5).map((row) => (
                <SketchRow
                  key={row.id}
                  className={cn(
                    "flex flex-wrap items-center justify-between gap-2",
                    auditRowTone(row.result),
                  )}
                >
                  <span className="truncate text-[12px] text-black">{row.description}</span>
                  <span
                    className={cn(
                      "text-[10px] font-medium uppercase tracking-[0.12em]",
                      row.result === "Blocked" && "text-[color:var(--warning)]",
                      row.result === "Flagged" && "text-[color:var(--sketch-red)]",
                      row.result === "Success" && "text-black/45",
                    )}
                  >
                    {row.result}
                  </span>
                </SketchRow>
              ))
            )}
          </div>

          <div className="flex items-center justify-between border-y border-black/10 py-2.5">
            <Link
              href="/organization/audit"
              className={cn(sketchLabel, "transition-colors hover:text-[color:var(--sketch-purple)]")}
            >
              + See More
            </Link>
            <span className={sketchLabel}>Audit Log</span>
          </div>

          <SketchBox tone="blue" className="min-h-[160px] flex-1 p-4">
            <OrgAuditTable rows={auditRows} />
          </SketchBox>
        </div>
      </div>
    </div>
  );
}

function OrgAuditTable({ rows }: { readonly rows: DashboardHomeResponse["auditEvents"] }) {
  if (rows.length === 0) {
    return (
      <p className={cn(sketchLabel, "normal-case tracking-normal text-black/40")}>Recent activity</p>
    );
  }

  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div
          key={row.id}
          className={cn(
            "grid grid-cols-[auto_1fr_auto] gap-3 border-b border-black/10 pb-2 pl-2 text-[12px] text-black last:border-0",
            auditRowTone(row.result),
          )}
        >
          <span className="font-mono text-[11px] text-black/45">{row.timeIst}</span>
          <span className="truncate">
            {row.agentName} — {row.description}
          </span>
          <span className={cn(sketchLabel, "text-[10px]")}>{row.action}</span>
        </div>
      ))}
    </div>
  );
}
