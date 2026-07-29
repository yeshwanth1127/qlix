"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/components/qlix/session-context";
import { SectionHeading } from "@/components/qlix/section-heading";
import { MetricCard } from "@/components/qlix/metric-card";
import { SketchBox, SketchSection, sketchButton, sketchLabel } from "@/components/qlix/sketch";
import { getUsageSummary, type UsageSummaryItem } from "@/lib/usage-api";
import { formatUsd } from "@/lib/billing-display-money";
import { cn } from "@/lib/utils/cn";

export default function IndividualUsagePage() {
  const { session, loading: sessionLoading } = useSession();
  const [summary, setSummary] = useState<UsageSummaryItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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
    return <p className={sketchLabel}>Loading usage…</p>;
  }

  if (!session) {
    return <p className={sketchLabel}>Please sign in again</p>;
  }

  if (error) {
    return (
      <div className="space-y-2">
        <p className="text-[13px] text-black">{error}</p>
        <button type="button" onClick={() => window.location.reload()} className={sketchButton}>
          Retry
        </button>
      </div>
    );
  }

  const totalRuns = summary.reduce((sum, a) => sum + a.totalRuns, 0);
  const totalTokens = summary.reduce((sum, a) => sum + a.totalTokens, 0);
  const totalCost = summary.reduce((sum, a) => sum + Number(a.totalCostUsd), 0);

  return (
    <div className="w-full space-y-8">
      <header className="flex flex-col gap-3">
        <SectionHeading title="Usage" description="Token consumption and inference costs by agent." />
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <MetricCard label="Total runs" value={totalRuns.toLocaleString()} subtext="This month" />
        <MetricCard label="Total tokens" value={totalTokens.toLocaleString()} subtext="Input + output" />
        <MetricCard label="Inference cost" value={formatUsd(totalCost.toString())} subtext="This month" />
      </div>

      <SketchSection title="Agents">
        <p className="mb-3 text-[12px] leading-relaxed text-black/60">
          Token consumption breakdown by agent.
        </p>
        {summary.length === 0 ? (
          <SketchBox className="p-6 text-center">
            <p className="font-serif text-[11px] uppercase tracking-widest text-black/50">
              No usage data yet — run an agent to see statistics
            </p>
          </SketchBox>
        ) : (
          <SketchBox className="overflow-hidden">
            <table className="w-full border-collapse text-left text-[13px]">
              <thead className="border-b border-black">
                <tr>
                  <th className={cn(sketchLabel, "px-4 py-3 text-left")}>Agent</th>
                  <th className={cn(sketchLabel, "px-4 py-3 text-left")}>Runs</th>
                  <th className={cn(sketchLabel, "px-4 py-3 text-left")}>Input tokens</th>
                  <th className={cn(sketchLabel, "px-4 py-3 text-left")}>Output tokens</th>
                  <th className={cn(sketchLabel, "px-4 py-3 text-left")}>Cost</th>
                </tr>
              </thead>
              <tbody>
                {summary.map((row, idx, arr) => (
                  <tr
                    key={row.agentId}
                    className={cn(
                      "transition-colors hover:bg-black/5",
                      idx < arr.length - 1 ? "border-b border-black/20" : "",
                    )}
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-black">{row.agentName}</div>
                      <div className="font-mono text-[11px] text-black/50">{row.agentId}</div>
                    </td>
                    <td className="px-4 py-3 tabular-nums text-black">{row.totalRuns.toLocaleString()}</td>
                    <td className="px-4 py-3 tabular-nums text-black">{row.promptTokens.toLocaleString()}</td>
                    <td className="px-4 py-3 tabular-nums text-black">{row.completionTokens.toLocaleString()}</td>
                    <td className="px-4 py-3 font-mono text-black">{formatUsd(row.totalCostUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </SketchBox>
        )}
      </SketchSection>
    </div>
  );
}
