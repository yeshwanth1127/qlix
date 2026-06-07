"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { TrendingDown, TriangleAlert } from "lucide-react";
import { useSession } from "@/components/qlix/session-context";
import { SectionHeading } from "@/components/qlix/section-heading";
import { MetricCard } from "@/components/qlix/metric-card";
import { canAccessBilling } from "@/lib/org-permissions";
import { getBillingOverview, type BillingOverviewResponse } from "@/lib/billing-api";
import {
  formatBillingMoney,
  getBillingUsdInrDisplayRate,
  persistBillingDisplayCurrency,
  readStoredBillingDisplayCurrency,
  type BillingDisplayCurrency,
} from "@/lib/billing-display-money";
import { cn } from "@/lib/utils/cn";

export default function OrganizationBillingPage() {
  const { session, loading: sessionLoading } = useSession();
  const [data, setData] = useState<BillingOverviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [displayCurrency, setDisplayCurrency] = useState<BillingDisplayCurrency>("usd");

  useEffect(() => {
    const stored = readStoredBillingDisplayCurrency();
    if (stored) setDisplayCurrency(stored);
  }, []);

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
    return <p className="text-[13px] text-neutral-500">Loading billing…</p>;
  }

  if (!session) {
    return <p className="text-[13px] text-neutral-500">Please sign in again.</p>;
  }

  if (session.user.billingExempt) {
    return (
      <div className="space-y-3">
        <SectionHeading title="Billing" description="Plan, usage, and action credits." />
        <div className="rounded-xl border border-[--border-subtle] bg-[--bg-elevated] p-5">
          <p className="text-[13px] text-[--text-secondary]">This account is not billed.</p>
          <p className="mt-1 text-[12px] text-[--text-tertiary]">
            No charges are applied to this workspace. You can still review token consumption and inference cost on the
            Usage page.
          </p>
          <Link
            href="/organization/usage"
            className="mt-3 inline-block text-[13px] font-medium text-blue-400 hover:underline"
          >
            Go to Usage
          </Link>
        </div>
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="space-y-3">
        <SectionHeading title="Billing" description="Plan, usage, and action credits." />
        <div className="rounded-xl border border-[--border-subtle] bg-[--bg-elevated] p-5">
          <p className="text-[13px] text-[--text-secondary]">
            You do not have access to billing in this workspace.
          </p>
          <p className="mt-1 text-[12px] text-[--text-tertiary]">
            Billing is visible to organization <span className="font-medium text-[--text-secondary]">owners</span> only.
          </p>
          <Link href="/organization/overview" className="mt-3 inline-block text-[13px] font-medium text-blue-400 hover:underline">
            Back to overview
          </Link>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-2">
        <p className="text-[13px] text-red-500">{error ?? "Could not load billing."}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="text-[13px] font-medium text-blue-400 hover:underline"
        >
          Retry
        </button>
      </div>
    );
  }

  const balance = Number(data.wallet.balance);
  const overdrawn = Number.isFinite(balance) && balance < 0;

  const inrRate = getBillingUsdInrDisplayRate();

  return (
    <div className="w-full space-y-8">
      <header className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <SectionHeading title="Billing" description={`Usage and action credits for ${data.organization.name}.`} />
          <div
            className="flex shrink-0 flex-col items-stretch gap-1.5 sm:items-end"
            role="group"
            aria-label="Display currency"
          >
            <div className="qlix-glass-muted inline-flex rounded-lg p-0.5">
              <button
                type="button"
                onClick={() => {
                  setDisplayCurrency("usd");
                  persistBillingDisplayCurrency("usd");
                }}
                className={cn(
                  "rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors",
                  displayCurrency === "usd"
                    ? "qlix-glass-box rounded-md text-[--text-primary]"
                    : "text-[--text-tertiary] hover:text-[--text-secondary]",
                )}
              >
                US&nbsp;($)
              </button>
              <button
                type="button"
                onClick={() => {
                  setDisplayCurrency("inr");
                  persistBillingDisplayCurrency("inr");
                }}
                className={cn(
                  "rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors",
                  displayCurrency === "inr"
                    ? "qlix-glass-box rounded-md text-[--text-primary]"
                    : "text-[--text-tertiary] hover:text-[--text-secondary]",
                )}
              >
                India&nbsp;(₹)
              </button>
            </div>
            {displayCurrency === "inr" ? (
              <p className="max-w-[220px] text-right text-[11px] leading-snug text-[--text-tertiary]">
                Rupees are approximate ({inrRate} INR per USD). Balances and charges are stored in USD.
              </p>
            ) : null}
          </div>
        </div>
        <div className="text-[12px] text-[--text-tertiary]">
          Billing cycle: <span className="font-mono text-[--text-secondary]">{data.billingCycle}</span>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <MetricCard
          label="Action credits"
          value={formatBillingMoney(data.wallet.balance, displayCurrency)}
          subtext={overdrawn ? "Overdrawn — review usage & add credits" : "Available balance"}
        />
        <MetricCard
          label="Spend (MTD)"
          value={formatBillingMoney(data.monthToDate.spend, displayCurrency)}
          subtext={`${data.monthToDate.successfulEvents.toLocaleString()} successful events`}
        />
        <MetricCard
          label="Failed attempts"
          value={data.monthToDate.failedEvents.toLocaleString()}
          subtext="Not billed (debugging is free)"
        />
      </div>

      <section className="space-y-3">
        <div className="flex flex-col gap-1">
          <h3 className="text-[14px] font-medium text-[--text-primary]">Services &amp; usage</h3>
          <p className="text-[12px] leading-relaxed text-[--text-tertiary]">
            Each row is a billable Qlix surface. You are charged the price once per{" "}
            <span className="font-medium text-[--text-secondary]">successful</span> event reported for that service
            (ingest <span className="font-mono text-[--text-secondary]">eventType</span> e.g.{" "}
            <span className="font-mono">passport</span>, <span className="font-mono">audit</span>, or legacy{" "}
            <span className="font-mono">passport_verify</span> / <span className="font-mono">log_entry</span>).
          </p>
        </div>
        <div className="qlix-glass-box overflow-hidden rounded-xl">
          <table className="w-full border-collapse text-left text-[13px]">
            <thead className="border-b border-[--border-subtle]">
              <tr className="qlix-glass-inset text-[11px] font-medium uppercase tracking-widest text-[--text-tertiary]">
                <th className="px-4 py-3">Service</th>
                <th className="px-4 py-3">Price / success</th>
                <th className="px-4 py-3">Successes (MTD)</th>
                <th className="px-4 py-3">Spend (MTD)</th>
              </tr>
            </thead>
            <tbody>
              {data.services.length === 0 && !(data.unlistedServices?.length) ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-[--text-tertiary]">
                    No billing services configured.
                  </td>
                </tr>
              ) : (
                <>
                  {data.services.map((row, idx, arr) => (
                    <tr
                      key={row.serviceKey}
                      className={cn(
                        "transition-colors hover:bg-[var(--glass-row-hover)]",
                        idx < arr.length - 1 || (data.unlistedServices?.length ?? 0) > 0
                          ? "border-b border-[--border-subtle]"
                          : "",
                      )}
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-[--text-primary]">{row.displayName}</div>
                        <div className="font-mono text-[11px] text-[--text-tertiary]">{row.serviceKey}</div>
                      </td>
                      <td className="px-4 py-3 font-mono text-[--text-secondary]">
                        {formatBillingMoney(row.unitPrice, displayCurrency)}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-[--text-secondary]">
                        {row.mtdSuccesses.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 font-mono text-[--text-secondary]">
                        {formatBillingMoney(row.mtdSpend, displayCurrency)}
                      </td>
                    </tr>
                  ))}
                  {(data.unlistedServices ?? []).map((row, idx, arr) => (
                    <tr
                      key={`unlisted-${row.serviceKey}`}
                      className={cn(
                        "bg-amber-500/5 transition-colors hover:bg-[var(--glass-row-hover)]",
                        idx < arr.length - 1 ? "border-b border-[--border-subtle]" : "",
                      )}
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-amber-100/90">Unlisted: {row.displayName}</div>
                        <div className="font-mono text-[11px] text-[--text-tertiary]">{row.serviceKey}</div>
                      </td>
                      <td className="px-4 py-3 font-mono text-[--text-secondary]">—</td>
                      <td className="px-4 py-3 tabular-nums text-[--text-secondary]">
                        {row.mtdSuccesses.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 font-mono text-[--text-secondary]">
                        {formatBillingMoney(row.mtdSpend, displayCurrency)}
                      </td>
                    </tr>
                  ))}
                </>
              )}
            </tbody>
          </table>
        </div>
        <p className="text-[12px] text-[--text-tertiary]">
          Org plan label: <span className="font-medium text-[--text-secondary]">{data.plan.name}</span> (catalog
          prices are global; add rows in <span className="font-mono">billing_services</span> for new surfaces).
        </p>
      </section>

      {overdrawn ? (
        <div className="flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
          <TriangleAlert className="mt-0.5 size-4 text-amber-400" strokeWidth={2} />
          <div className="min-w-0">
            <div className="text-[13px] font-medium text-amber-200">Credits overdrawn</div>
            <div className="mt-0.5 text-[12px] leading-relaxed text-amber-200/70">
              Your balance is negative. Add credits or adjust pricing to avoid service disruption later.
            </div>
          </div>
        </div>
      ) : null}

      <div className="flex items-center gap-2 text-[12px] text-[--text-tertiary]">
        <TrendingDown className="size-3.5" strokeWidth={1.75} aria-hidden />
        Failed attempts are tracked for troubleshooting but never charged.
      </div>
    </div>
  );
}




