"use client";

import { useEffect, useState } from "react";
import { ReflectiveCard } from "@/components/qlix/ReflectiveCard";
import { SectionHeading } from "@/components/qlix/section-heading";
import { getAdminBillingEvents, type AdminBillingEventsResponse } from "@/lib/admin-billing-api";
import { cn } from "@/lib/utils/cn";

function formatUsd(input: string): string {
  const n = Number(input);
  if (!Number.isFinite(n)) return `$${input}`;
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 4 });
}

export default function AdminBillingEventsPage() {
  const [data, setData] = useState<AdminBillingEventsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setError(null);
    void getAdminBillingEvents({ take: 100 })
      .then((res) => {
        if (!res) {
          setError("Could not load event log.");
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

  if (loading) return <p className="text-[13px] text-neutral-500">Loading event log…</p>;
  if (error || !data) return <p className="text-[13px] text-red-500">{error ?? "Could not load event log."}</p>;

  return (
    <div className="w-full space-y-6">
      <SectionHeading title="Billing event log" description="Successful billable events across all organizations." />

      <div className="text-[12px] text-[--text-tertiary]">
        Billing cycle: <span className="font-mono text-[--text-secondary]">{data.billingCycle}</span>
      </div>

      <ReflectiveCard className="overflow-hidden rounded-xl">
        <table className="w-full border-collapse text-left text-[13px]">
          <thead className="border-b border-[--border-subtle]">
            <tr className="qlix-glass-inset text-[11px] font-medium uppercase tracking-widest text-[--text-tertiary]">
              <th className="px-4 py-3">Time (UTC)</th>
              <th className="px-4 py-3">Org</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Charge</th>
              <th className="px-4 py-3">Endpoint</th>
            </tr>
          </thead>
          <tbody>
            {data.events.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-[--text-tertiary]">
                  No events recorded yet.
                </td>
              </tr>
            ) : (
              data.events.map((e, idx, arr) => (
                <tr
                  key={e.id}
                  className={cn(
                    "transition-colors hover:bg-[var(--glass-row-hover)]",
                    idx < arr.length - 1 ? "border-b border-[--border-subtle]" : "",
                  )}
                >
                  <td className="px-4 py-3 font-mono text-[--text-secondary]">
                    {new Date(e.occurredAt).toISOString().replace("T", " ").slice(0, 19)}
                  </td>
                  <td className="px-4 py-3 text-[--text-secondary]">{e.org.name}</td>
                  <td className="px-4 py-3 font-mono text-[--text-secondary]">{e.eventType}</td>
                  <td className="px-4 py-3 font-mono text-[--text-secondary]">{formatUsd(e.amountCharged)}</td>
                  <td className="px-4 py-3 font-mono text-[11px] text-[--text-tertiary]">{e.apiEndpoint ?? "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </ReflectiveCard>
    </div>
  );
}

