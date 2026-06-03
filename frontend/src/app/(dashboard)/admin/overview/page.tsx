"use client";

import { useEffect, useState } from "react";
import { Activity, DollarSign, ShieldAlert } from "lucide-react";
import { MetricCard } from "@/components/qlix/metric-card";
import { ReflectiveCard } from "@/components/qlix/ReflectiveCard";
import { SectionHeading } from "@/components/qlix/section-heading";
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
    return <p className="text-[13px] text-neutral-500">Loading admin overview…</p>;
  }

  if (error || !data) {
    return <p className="text-[13px] text-red-500">{error ?? "Could not load admin overview."}</p>;
  }

  return (
    <div className="w-full space-y-8">
      <SectionHeading title="Super admin overview" description="Global usage, revenue, and failure monitoring." />

      <div className="text-[12px] text-[--text-tertiary]">
        Billing cycle: <span className="font-mono text-[--text-secondary]">{data.billingCycle}</span>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
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

      <ReflectiveCard className="rounded-xl" contentClassName="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[13px] font-medium text-[--text-primary]">Next actions</div>
            <div className="mt-1 text-[12px] leading-relaxed text-[--text-tertiary]">
              Use <span className="font-medium text-[--text-secondary]">Organizations</span> to apply credits or change plans, and{" "}
              <span className="font-medium text-[--text-secondary]">Event log</span> to investigate anomalies.
            </div>
          </div>
          <div className="flex items-center gap-2 text-[--text-tertiary]" aria-hidden>
            <DollarSign className="size-4" strokeWidth={1.75} />
            <Activity className="size-4" strokeWidth={1.75} />
            <ShieldAlert className="size-4" strokeWidth={1.75} />
          </div>
        </div>
      </ReflectiveCard>
    </div>
  );
}

