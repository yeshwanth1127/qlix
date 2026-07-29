"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { TrendingDown, TriangleAlert } from "lucide-react";
import { useSession } from "@/components/qlix/session-context";
import { SectionHeading } from "@/components/qlix/section-heading";
import { MetricCard } from "@/components/qlix/metric-card";
import { SketchBox, SketchSection, sketchButton, sketchLabel } from "@/components/qlix/sketch";
import { canAccessBilling } from "@/lib/org-permissions";
import { getBillingOverview, type BillingOverviewResponse } from "@/lib/billing-api";
import { formatBillingMoney } from "@/lib/billing-display-money";

export default function OrganizationBillingPage() {
  const { session, loading: sessionLoading } = useSession();
  const [data, setData] = useState<BillingOverviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const allowed = useMemo(() => {
    if (!session) return false;
    if (session.user.billingExempt) return false;
    if (session.organization.workspaceKind !== "organization") return false;
    return canAccessBilling(session.user.role);
  }, [session]);

  useEffect(() => {
    if (sessionLoading) return;
    if (!allowed) {
      setLoading(false);
      setData(null);
      return;
    }
    setLoading(true);
    setError(null);
    void getBillingOverview()
      .then((res) => {
        if (!res) {
          setError("Could not load billing (try signing in again).");
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
  }, [allowed, sessionLoading]);

  if (sessionLoading || loading) {
    return <p className={sketchLabel}>Loading billing…</p>;
  }

  if (!session) {
    return <p className={sketchLabel}>Please sign in again</p>;
  }

  if (session.user.billingExempt) {
    return (
      <div className="space-y-3">
        <SectionHeading title="Billing" description="Plan, usage, and action credits." />
        <SketchBox className="p-5">
          <p className="text-[13px] text-black">This account is not billed.</p>
          <p className="mt-1 text-[12px] text-black/60">
            No charges are applied to this workspace. You can still review token consumption and inference cost on the
            Usage page.
          </p>
          <Link
            href="/organization/usage"
            className={`${sketchLabel} mt-3 inline-block underline underline-offset-2`}
          >
            Go to Usage
          </Link>
        </SketchBox>
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="space-y-3">
        <SectionHeading title="Billing" description="Plan, usage, and action credits." />
        <SketchBox className="p-5">
          <p className="text-[13px] text-black">You do not have access to billing in this workspace.</p>
          <p className="mt-1 text-[12px] text-black/60">
            Billing is visible to organization <span className="font-medium text-black">owners</span> only.
          </p>
          <Link
            href="/organization/overview"
            className={`${sketchLabel} mt-3 inline-block underline underline-offset-2`}
          >
            Back to overview
          </Link>
        </SketchBox>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-2">
        <p className="text-[13px] text-black">{error ?? "Could not load billing."}</p>
        <button type="button" onClick={() => window.location.reload()} className={sketchButton}>
          Retry
        </button>
      </div>
    );
  }

  const balance = Number(data.wallet.balance);
  const overdrawn = Number.isFinite(balance) && balance < 0;

  return (
    <div className="w-full space-y-8">
      <header className="flex flex-col gap-3">
        <SectionHeading title="Billing" description={`Usage and action credits for ${data.organization.name}.`} />
        <div className="font-serif text-[11px] uppercase tracking-widest text-black/50">
          Billing cycle: <span className="font-mono text-black">{data.billingCycle}</span>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <MetricCard
          label="Action credits"
          value={formatBillingMoney(data.wallet.balance)}
          subtext={overdrawn ? "Overdrawn — review usage & add credits" : "Available balance"}
        />
        <MetricCard
          label="Spend (MTD)"
          value={formatBillingMoney(data.monthToDate.spend)}
          subtext={`${data.monthToDate.successfulEvents.toLocaleString()} successful events`}
        />
        <MetricCard
          label="Failed attempts"
          value={data.monthToDate.failedEvents.toLocaleString()}
          subtext="Not billed (debugging is free)"
        />
      </div>

      <SketchSection title="Services & usage">
        <p className="mb-3 text-[12px] leading-relaxed text-black/60">
          Each row is a billable Qlix surface. You are charged the price once per{" "}
          <span className="font-medium text-black">successful</span> event reported for that service (ingest{" "}
          <span className="font-mono text-black">eventType</span> e.g.{" "}
          <span className="font-mono">passport</span>, <span className="font-mono">audit</span>, or legacy{" "}
          <span className="font-mono">passport_verify</span> / <span className="font-mono">log_entry</span>).
        </p>
        <SketchBox className="overflow-hidden">
          <table className="w-full border-collapse text-left text-[13px]">
            <thead className="border-b border-black">
              <tr>
                <th className={`${sketchLabel} px-4 py-3 text-left`}>Service</th>
                <th className={`${sketchLabel} px-4 py-3 text-left`}>Price / success</th>
                <th className={`${sketchLabel} px-4 py-3 text-left`}>Successes (MTD)</th>
                <th className={`${sketchLabel} px-4 py-3 text-left`}>Spend (MTD)</th>
              </tr>
            </thead>
            <tbody>
              {data.services.length === 0 && !(data.unlistedServices?.length) ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-black/50">
                    No billing services configured.
                  </td>
                </tr>
              ) : (
                <>
                  {data.services.map((row, idx, arr) => (
                    <tr
                      key={row.serviceKey}
                      className={`transition-colors hover:bg-black/5${
                        idx < arr.length - 1 || (data.unlistedServices?.length ?? 0) > 0
                          ? " border-b border-black/20"
                          : ""
                      }`}
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-black">{row.displayName}</div>
                        <div className="font-mono text-[11px] text-black/50">{row.serviceKey}</div>
                      </td>
                      <td className="px-4 py-3 font-mono text-black">
                        {formatBillingMoney(row.unitPrice)}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-black">{row.mtdSuccesses.toLocaleString()}</td>
                      <td className="px-4 py-3 font-mono text-black">
                        {formatBillingMoney(row.mtdSpend)}
                      </td>
                    </tr>
                  ))}
                  {(data.unlistedServices ?? []).map((row, idx, arr) => (
                    <tr
                      key={`unlisted-${row.serviceKey}`}
                      className={`bg-black/[0.03] transition-colors hover:bg-black/5${
                        idx < arr.length - 1 ? " border-b border-black/20" : ""
                      }`}
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-black">Unlisted: {row.displayName}</div>
                        <div className="font-mono text-[11px] text-black/50">{row.serviceKey}</div>
                      </td>
                      <td className="px-4 py-3 font-mono text-black">—</td>
                      <td className="px-4 py-3 tabular-nums text-black">{row.mtdSuccesses.toLocaleString()}</td>
                      <td className="px-4 py-3 font-mono text-black">
                        {formatBillingMoney(row.mtdSpend)}
                      </td>
                    </tr>
                  ))}
                </>
              )}
            </tbody>
          </table>
        </SketchBox>
        <p className="mt-3 text-[12px] text-black/60">
          Org plan label: <span className="font-medium text-black">{data.plan.name}</span> (catalog prices are global;
          add rows in <span className="font-mono">billing_services</span> for new surfaces).
        </p>
      </SketchSection>

      {overdrawn ? (
        <SketchBox className="flex items-start gap-3 p-4">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-black" strokeWidth={2} />
          <div className="min-w-0">
            <div className={sketchLabel}>Credits overdrawn</div>
            <div className="mt-1 text-[12px] leading-relaxed text-black/60">
              Your balance is negative. Add credits or adjust pricing to avoid service disruption later.
            </div>
          </div>
        </SketchBox>
      ) : null}

      <div className="flex items-center gap-2 text-[12px] text-black/50">
        <TrendingDown className="size-3.5" strokeWidth={1.75} aria-hidden />
        Failed attempts are tracked for troubleshooting but never charged.
      </div>
    </div>
  );
}
