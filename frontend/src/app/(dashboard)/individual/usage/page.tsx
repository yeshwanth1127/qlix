"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/components/qlix/session-context";
import { SectionHeading } from "@/components/qlix/section-heading";
import { MetricCard } from "@/components/qlix/metric-card";
import { getUsageSummary, type UsageSummaryItem } from "@/lib/usage-api";
import {
  formatBillingMoney,
  getBillingUsdInrDisplayRate,
  persistBillingDisplayCurrency,
  readStoredBillingDisplayCurrency,
  type BillingDisplayCurrency,
} from "@/lib/billing-display-money";
import { cn } from "@/lib/utils/cn";

export default function IndividualUsagePage() {
  const { session, loading: sessionLoading } = useSession();
  const [summary, setSummary] = useState<UsageSummaryItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [displayCurrency, setDisplayCurrency] = useState<BillingDisplayCurrency>("usd");

  useEffect(() => {
    const stored = readStoredBillingDisplayCurrency();
    if (stored) setDisplayCurrency(stored);
  }, []);

  useEffect(() => {
    if (sessionLoading) return;
    if (!session) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    getUsageSummary()
      .then((res) => {
        if (!res) {
          setError("Could not load usage (try signing in again).");
          setSummary([]);
          return;
        }
        setSummary(res.summary);
      })
      .catch(() => {
        setError("Network error");
        setSummary([]);
      })
      .finally(() => setLoading(false));
  }, [session, sessionLoading]);

  if (sessionLoading || loading) {
    return <p className="text-[13px] text-neutral-500">Loading usage…</p>;
  }

  if (!session) {
    return <p className="text-[13px] text-neutral-500">Please sign in again.</p>;
  }

  if (error) {
    return (
      <div className="space-y-2">
        <p className="text-[13px] text-red-500">{error}</p>
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

  const totalRuns = summary.reduce((sum, a) => sum + a.totalRuns, 0);
  const totalTokens = summary.reduce((sum, a) => sum + a.totalTokens, 0);
  const totalCost = summary.reduce((sum, a) => sum + Number(a.totalCostUsd), 0);
  const inrRate = getBillingUsdInrDisplayRate();

  return (
    <div className="w-full space-y-8">
      <header className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <SectionHeading title="Usage" description="Token consumption and inference costs by agent." />
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
                Rupees are approximate ({inrRate} INR per USD).
              </p>
            ) : null}
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <MetricCard label="Total runs" value={totalRuns.toLocaleString()} subtext="This month" />
        <MetricCard label="Total tokens" value={totalTokens.toLocaleString()} subtext="Input + output" />
        <MetricCard
          label="Inference cost"
          value={formatBillingMoney(totalCost.toString(), displayCurrency)}
          subtext="This month"
        />
      </div>

      <section className="space-y-3">
        <div className="flex flex-col gap-1">
          <h3 className="text-[14px] font-medium text-[--text-primary]">Agents</h3>
          <p className="text-[12px] leading-relaxed text-[--text-tertiary]">
            Token consumption breakdown by agent.
          </p>
        </div>
        {summary.length === 0 ? (
          <div className="qlix-glass-box rounded-xl p-6 text-center">
            <p className="text-[13px] text-[--text-tertiary]">No usage data yet. Run an agent to see statistics.</p>
          </div>
        ) : (
          <div className="qlix-glass-box overflow-hidden rounded-xl">
            <table className="w-full border-collapse text-left text-[13px]">
              <thead className="border-b border-[--border-subtle]">
                <tr className="qlix-glass-inset text-[11px] font-medium uppercase tracking-widest text-[--text-tertiary]">
                  <th className="px-4 py-3">Agent</th>
                  <th className="px-4 py-3">Runs</th>
                  <th className="px-4 py-3">Input tokens</th>
                  <th className="px-4 py-3">Output tokens</th>
                  <th className="px-4 py-3">Cost</th>
                </tr>
              </thead>
              <tbody>
                {summary.map((row, idx, arr) => (
                  <tr
                    key={row.agentId}
                    className={cn(
                      "transition-colors hover:bg-[var(--glass-row-hover)]",
                      idx < arr.length - 1 ? "border-b border-[--border-subtle]" : "",
                    )}
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-[--text-primary]">{row.agentName}</div>
                      <div className="font-mono text-[11px] text-[--text-tertiary]">{row.agentId}</div>
                    </td>
                    <td className="px-4 py-3 tabular-nums text-[--text-secondary]">{row.totalRuns.toLocaleString()}</td>
                    <td className="px-4 py-3 tabular-nums text-[--text-secondary]">{row.promptTokens.toLocaleString()}</td>
                    <td className="px-4 py-3 tabular-nums text-[--text-secondary]">
                      {row.completionTokens.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 font-mono text-[--text-secondary]">
                      {formatBillingMoney(row.totalCostUsd, displayCurrency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
