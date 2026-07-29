"use client";

import { useEffect, useState } from "react";
import { Activity, DollarSign, ShieldAlert } from "lucide-react";
import { MetricCard } from "@/components/qlix/metric-card";
import { SectionHeading } from "@/components/qlix/section-heading";
import { SketchBox, sketchButton, sketchLabel } from "@/components/qlix/sketch";
import { getAdminBillingMetrics, type AdminBillingMetricsResponse } from "@/lib/admin-billing-api";

function formatUsd(input: string): string {
  const n = Number(input);
  if (!Number.isFinite(n)) return `$${input}`;
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 4 });
}

export default function AdminOverviewPage() {
  const [data, setData] = useState<AdminBillingMetricsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setError(null);
    void getAdminBillingMetrics()
      .then((res) => {
        if (!res) {
          setError("Could not load admin metrics.");
          setData(null);
          return;
        }
        setData(res);
      })
      .catch(() => {
        setError("Network error");
        setData(null);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <p className={sketchLabel}>Loading admin overview…</p>;
  }

  if (error || !data) {
    return (
      <div className="space-y-2">
        <p className="text-[13px] text-black">{error ?? "Could not load admin overview."}</p>
        <button type="button" onClick={() => window.location.reload()} className={sketchButton}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="w-full space-y-8">
      <SectionHeading title="Super admin overview" description="Platform users, agents, visitors, and billing health." />

      <div className="space-y-3">
        <div className={sketchLabel}>Platform</div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <MetricCard
            label="Active users"
            value={data.activeUsers.toLocaleString()}
            subtext="Enabled registered accounts"
          />
          <MetricCard
            label="Registered agents"
            value={data.registeredAgents.toLocaleString()}
            subtext={`${data.activeAgents.toLocaleString()} active`}
          />
          <MetricCard
            label="Homepage visitors"
            value={data.homepageUniqueVisitors.toLocaleString()}
            subtext="Unique browsers"
          />
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div className={sketchLabel}>Billing</div>
          <div className="font-serif text-[10px] uppercase tracking-widest text-black/50">
            Cycle: <span className="font-mono text-black">{data.billingCycle}</span>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="Successes (MTD)"
            value={data.successesThisMonth.toLocaleString()}
            subtext="Billable successes"
          />
          <MetricCard label="Revenue (MTD)" value={formatUsd(data.revenueThisMonth)} subtext="Internal credits debited" />
          <MetricCard label="Avg per success" value={formatUsd(data.avgPerSuccess)} subtext="Across all orgs" />
          <MetricCard
            label="Failed attempts"
            value={data.failedAttemptsThisMonth.toLocaleString()}
            subtext="Free (debugging)"
          />
        </div>
      </div>

      <SketchBox className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className={sketchLabel}>Next actions</div>
            <div className="mt-2 text-[12px] leading-relaxed text-black/60">
              Use <span className="font-medium text-black">Organizations</span> to apply credits or change plans, and{" "}
              <span className="font-medium text-black">Event log</span> to investigate anomalies.
            </div>
          </div>
          <div className="flex items-center gap-2 text-black/40" aria-hidden>
            <DollarSign className="size-4" strokeWidth={1.75} />
            <Activity className="size-4" strokeWidth={1.75} />
            <ShieldAlert className="size-4" strokeWidth={1.75} />
          </div>
        </div>
      </SketchBox>
    </div>
  );
}
