"use client";

import { useEffect, useState } from "react";
import { SectionHeading } from "@/components/qlix/section-heading";
import { SketchBox, sketchButton, sketchLabel } from "@/components/qlix/sketch";
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

  if (loading) return <p className={sketchLabel}>Loading event log…</p>;

  if (error || !data) {
    return (
      <div className="space-y-2">
        <p className="text-[13px] text-black">{error ?? "Could not load event log."}</p>
        <button type="button" onClick={() => window.location.reload()} className={sketchButton}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="w-full space-y-6">
      <SectionHeading title="Billing event log" description="Successful billable events across all organizations." />

      <div className="font-serif text-[11px] uppercase tracking-widest text-black/50">
        Billing cycle: <span className="font-mono text-black">{data.billingCycle}</span>
      </div>

      <SketchBox className="overflow-hidden">
        <table className="w-full border-collapse text-left text-[13px]">
          <thead className="border-b border-black">
            <tr>
              <th className={cn(sketchLabel, "px-4 py-3 text-left")}>Time (UTC)</th>
              <th className={cn(sketchLabel, "px-4 py-3 text-left")}>Org</th>
              <th className={cn(sketchLabel, "px-4 py-3 text-left")}>Type</th>
              <th className={cn(sketchLabel, "px-4 py-3 text-left")}>Charge</th>
              <th className={cn(sketchLabel, "px-4 py-3 text-left")}>Endpoint</th>
            </tr>
          </thead>
          <tbody>
            {data.events.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-black/50">
                  No events recorded yet.
                </td>
              </tr>
            ) : (
              data.events.map((e, idx, arr) => (
                <tr
                  key={e.id}
                  className={cn(
                    "transition-colors hover:bg-black/5",
                    idx < arr.length - 1 ? "border-b border-black/20" : "",
                  )}
                >
                  <td className="px-4 py-3 font-mono text-black">
                    {new Date(e.occurredAt).toISOString().replace("T", " ").slice(0, 19)}
                  </td>
                  <td className="px-4 py-3 text-black">{e.org.name}</td>
                  <td className="px-4 py-3 font-mono text-black">{e.eventType}</td>
                  <td className="px-4 py-3 font-mono text-black">{formatUsd(e.amountCharged)}</td>
                  <td className="px-4 py-3 font-mono text-[11px] text-black/50">{e.apiEndpoint ?? "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </SketchBox>
    </div>
  );
}
