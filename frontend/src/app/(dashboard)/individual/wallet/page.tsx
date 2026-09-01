"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { TriangleAlert, TrendingDown } from "lucide-react";
import { useSession } from "@/components/qlix/session-context";
import { SectionHeading } from "@/components/qlix/section-heading";
import { MetricCard } from "@/components/qlix/metric-card";
import { SketchBox, SketchSection, sketchButton, sketchLabel } from "@/components/qlix/sketch";
import { getWalletBalance, getWalletTransactions, type WalletBalanceResponse, type WalletTransaction } from "@/lib/wallet-api";
import { CurrencyToggle, useDisplayCurrency } from "@/components/qlix/currency-context";
import { cn } from "@/lib/utils/cn";

export default function IndividualWalletPage() {
  const { session, loading: sessionLoading } = useSession();
  const { formatInr } = useDisplayCurrency();
  const [balance, setBalance] = useState<WalletBalanceResponse | null>(null);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (sessionLoading) return;
    if (!session || session.user.billingExempt) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    Promise.all([getWalletBalance(), getWalletTransactions()])
      .then(([balanceData, transactionData]) => {
        setBalance(balanceData);
        setTransactions(transactionData ?? []);
        if (!balanceData) {
          setError("Could not load wallet (try signing in again).");
        }
      })
      .catch(() => {
        setError("Network error");
      })
      .finally(() => setLoading(false));
  }, [session, sessionLoading]);

  if (sessionLoading || loading) {
    return <p className={sketchLabel}>Loading wallet…</p>;
  }

  if (!session) {
    return <p className={sketchLabel}>Please sign in again</p>;
  }

  if (session.user.billingExempt) {
    return (
      <div className="space-y-3">
        <SectionHeading title="Wallet" description="Your action credits and transaction history." />
        <SketchBox className="p-5">
          <p className="text-[13px] text-black">This account is not billed, so it has no wallet.</p>
          <p className="mt-1 text-[12px] text-black/60">
            You can still review token consumption and inference cost on the Usage page.
          </p>
          <Link
            href="/individual/usage"
            className={cn(sketchLabel, "mt-3 inline-block underline underline-offset-2")}
          >
            Go to Usage
          </Link>
        </SketchBox>
      </div>
    );
  }

  if (error || !balance) {
    return (
      <div className="space-y-2">
        <p className="text-[13px] text-black">{error ?? "Could not load wallet."}</p>
        <button type="button" onClick={() => window.location.reload()} className={sketchButton}>
          Retry
        </button>
      </div>
    );
  }

  const balanceNum = Number(balance.balance);
  const overdrawn = Number.isFinite(balanceNum) && balanceNum < 0;

  return (
    <div className="w-full space-y-8">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <SectionHeading title="Wallet" description="Your action credits and transaction history." />
          <CurrencyToggle />
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <MetricCard
          label="Action credits"
          value={formatInr(balance.balance)}
          subtext={overdrawn ? "Overdrawn — add credits to continue" : "Available balance"}
        />
        <MetricCard
          label="Spend (MTD)"
          value={formatInr(balance.monthToDate.spend)}
          subtext={`${balance.monthToDate.successfulEvents.toLocaleString()} events`}
        />
        <MetricCard label="Billing cycle" value={balance.billingCycle} subtext="Current month" />
      </div>

      {overdrawn ? (
        <SketchBox className="flex items-start gap-3 p-4">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-black" strokeWidth={2} />
          <div className="min-w-0">
            <div className={sketchLabel}>Credits overdrawn</div>
            <div className="mt-1 text-[12px] leading-relaxed text-black/60">
              Your balance is negative. Add credits to continue using agents.
            </div>
          </div>
        </SketchBox>
      ) : null}

      <SketchSection title="Transaction history">
        <p className="mb-3 text-[12px] leading-relaxed text-black/60">
          Recent credits and debits to your wallet.
        </p>
        {transactions.length === 0 ? (
          <SketchBox className="p-6 text-center">
            <p className="font-serif text-[11px] uppercase tracking-widest text-black/50">No transactions yet</p>
          </SketchBox>
        ) : (
          <SketchBox className="overflow-hidden">
            <table className="w-full border-collapse text-left text-[13px]">
              <thead className="border-b border-black">
                <tr>
                  <th className={cn(sketchLabel, "px-4 py-3 text-left")}>Type</th>
                  <th className={cn(sketchLabel, "px-4 py-3 text-left")}>Amount</th>
                  <th className={cn(sketchLabel, "px-4 py-3 text-left")}>Date</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx, idx, arr) => (
                  <tr
                    key={tx.id}
                    className={cn(
                      "transition-colors hover:bg-black/5",
                      idx < arr.length - 1 ? "border-b border-black/20" : "",
                    )}
                  >
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "inline-flex border border-black px-2 py-1 font-serif text-[10px] uppercase tracking-widest",
                          tx.type === "manual_credit" ? "bg-[#E2F0CC] text-black" : "bg-black text-white",
                        )}
                      >
                        {tx.type === "manual_credit" ? "Credit" : "Debit"}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-black">{formatInr(tx.amount)}</td>
                    <td className="px-4 py-3 text-black">{new Date(tx.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </SketchBox>
        )}
      </SketchSection>

      <div className="flex items-center gap-2 text-[12px] text-black/50">
        <TrendingDown className="size-3.5" strokeWidth={1.75} aria-hidden />
        Credits are deducted when agents run or actions complete.
      </div>
    </div>
  );
}
