"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ReflectiveCard } from "@/components/qlix/ReflectiveCard";
import { SectionHeading } from "@/components/qlix/section-heading";
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

  if (loading) return <p className="text-[13px] text-neutral-500">Loading organizations…</p>;
  if (error || !data) return <p className="text-[13px] text-red-500">{error ?? "Could not load organizations."}</p>;

  return (
    <div className="w-full space-y-6">
      <SectionHeading title="Organizations" description="Plans, balances, and month-to-date spend." />

      <ReflectiveCard className="overflow-hidden rounded-xl">
        <table className="w-full border-collapse text-left text-[13px]">
          <thead className="border-b border-[--border-subtle]">
            <tr className="qlix-glass-inset text-[11px] font-medium uppercase tracking-widest text-[--text-tertiary]">
              <th className="px-4 py-3">Organization</th>
              <th className="px-4 py-3">Plan</th>
              <th className="px-4 py-3">Credits</th>
              <th className="px-4 py-3">MTD spend</th>
              <th className="px-4 py-3">MTD successes</th>
            </tr>
          </thead>
          <tbody>
            {data.organizations.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-[--text-tertiary]">
                  No organizations found.
                </td>
              </tr>
            ) : (
              data.organizations.map((org, idx, arr) => (
                <tr
                  key={org.id}
                  className={cn(
                    "transition-colors hover:bg-[var(--glass-row-hover)]",
                    idx < arr.length - 1 ? "border-b border-[--border-subtle]" : "",
                  )}
                >
                  <td className="px-4 py-3">
                    <div className="font-medium text-[--text-primary]">{org.name}</div>
                    <div className="mt-0.5 font-mono text-[11px] text-[--text-tertiary]">{org.id}</div>
                  </td>
                  <td className="px-4 py-3 text-[--text-secondary]">{org.plan}</td>
                  <td className="px-4 py-3 font-mono text-[--text-secondary]">
                    {formatUsd(org.wallet.balance)}
                  </td>
                  <td className="px-4 py-3 font-mono text-[--text-secondary]">
                    {formatUsd(org.monthToDate.spend)}
                  </td>
                  <td className="px-4 py-3 text-[--text-secondary]">{org.monthToDate.successes.toLocaleString()}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </ReflectiveCard>

      <p className="text-[12px] text-[--text-tertiary]">
        Need to adjust plans/credits/rates? Next step is wiring inline actions here (admin-only).
      </p>
      <Link href="/admin/billing/events" className="text-[13px] font-medium text-blue-400 hover:underline">
        Open event log →
      </Link>
    </div>
  );
}

