"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { SectionHeading } from "@/components/qlix/section-heading";
import { SketchBox, sketchButton, sketchLabel } from "@/components/qlix/sketch";
import { getAdminBillingOrgs, type AdminBillingOrgsResponse } from "@/lib/admin-billing-api";
import { cn } from "@/lib/utils/cn";

function formatUsd(input: string): string {
  const n = Number(input);
  if (!Number.isFinite(n)) return `$${input}`;
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 4 });
}

export default function AdminBillingOrgsPage() {
  const [data, setData] = useState<AdminBillingOrgsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setError(null);
    void getAdminBillingOrgs({ take: 100 })
      .then((res) => {
        if (!res) {
          setError("Could not load organizations.");
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

  if (loading) return <p className={sketchLabel}>Loading organizations…</p>;

  if (error || !data) {
    return (
      <div className="space-y-2">
        <p className="text-[13px] text-black">{error ?? "Could not load organizations."}</p>
        <button type="button" onClick={() => window.location.reload()} className={sketchButton}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="w-full space-y-6">
      <SectionHeading title="Organizations" description="Plans, balances, and month-to-date spend." />

      <SketchBox className="overflow-hidden">
        <table className="w-full border-collapse text-left text-[13px]">
          <thead className="border-b border-black">
            <tr>
              <th className={cn(sketchLabel, "px-4 py-3 text-left")}>Organization</th>
              <th className={cn(sketchLabel, "px-4 py-3 text-left")}>Plan</th>
              <th className={cn(sketchLabel, "px-4 py-3 text-left")}>Credits</th>
              <th className={cn(sketchLabel, "px-4 py-3 text-left")}>MTD spend</th>
              <th className={cn(sketchLabel, "px-4 py-3 text-left")}>MTD successes</th>
            </tr>
          </thead>
          <tbody>
            {data.organizations.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-black/50">
                  No organizations found.
                </td>
              </tr>
            ) : (
              data.organizations.map((org, idx, arr) => (
                <tr
                  key={org.id}
                  className={cn(
                    "transition-colors hover:bg-black/5",
                    idx < arr.length - 1 ? "border-b border-black/20" : "",
                  )}
                >
                  <td className="px-4 py-3">
                    <div className="font-medium text-black">{org.name}</div>
                    <div className="mt-0.5 font-mono text-[11px] text-black/50">{org.id}</div>
                  </td>
                  <td className="px-4 py-3 text-black">{org.plan}</td>
                  <td className="px-4 py-3 font-mono text-black">{formatUsd(org.wallet.balance)}</td>
                  <td className="px-4 py-3 font-mono text-black">{formatUsd(org.monthToDate.spend)}</td>
                  <td className="px-4 py-3 text-black">{org.monthToDate.successes.toLocaleString()}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </SketchBox>

      <p className="text-[12px] text-black/50">
        Need to adjust plans/credits/rates? Next step is wiring inline actions here (admin-only).
      </p>
      <Link href="/admin/billing/events" className={cn(sketchLabel, "underline underline-offset-2")}>
        Open event log →
      </Link>
    </div>
  );
}
