"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { TriangleAlert, TrendingDown } from "lucide-react";
import { useSession } from "@/components/qlix/session-context";
import { SectionHeading } from "@/components/qlix/section-heading";
import { MetricCard } from "@/components/qlix/metric-card";
import { getWalletBalance, getWalletTransactions, type WalletBalanceResponse, type WalletTransaction } from "@/lib/wallet-api";
import {
  formatBillingMoney,
  getBillingUsdInrDisplayRate,
  persistBillingDisplayCurrency,
  readStoredBillingDisplayCurrency,
  type BillingDisplayCurrency,
} from "@/lib/billing-display-money";
import { cn } from "@/lib/utils/cn";

export default function IndividualWalletPage() {
  const { session, loading: sessionLoading } = useSession();
  const [balance, setBalance] = useState<WalletBalanceResponse | null>(null);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [displayCurrency, setDisplayCurrency] = useState<BillingDisplayCurrency>("usd");

  useEffect(() => {
    const stored = readStoredBillingDisplayCurrency();
    if (stored) setDisplayCurrency(stored);
  }, []);

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
    return <p className="text-[13px] text-neutral-500">Loading wallet…</p>;
  }

  if (!session) {
    return <p className="text-[13px] text-neutral-500">Please sign in again.</p>;
  }

  if (session.user.billingExempt) {
    return (
      <div className="space-y-3">
        <SectionHeading title="Wallet" description="Your action credits and transaction history." />
        <div className="rounded-xl border border-[--border-subtle] bg-[--bg-elevated] p-5">
          <p className="text-[13px] text-[--text-secondary]">This account is not billed, so it has no wallet.</p>
          <p className="mt-1 text-[12px] text-[--text-tertiary]">
            You can still review token consumption and inference cost on the Usage page.
          </p>
          <Link
            href="/individual/usage"
            className="mt-3 inline-block text-[13px] font-medium text-blue-400 hover:underline"
          >
            Go to Usage
          </Link>
        </div>
      </div>
    );
  }

  if (error || !balance) {
    return (
      <div className="space-y-2">
        <p className="text-[13px] text-red-500">{error ?? "Could not load wallet."}</p>
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

  const balanceNum = Number(balance.balance);
  const overdrawn = Number.isFinite(balanceNum) && balanceNum < 0;
  const inrRate = getBillingUsdInrDisplayRate();

  return (
    <div className="w-full space-y-8">
      <header className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <SectionHeading title="Wallet" description="Your action credits and transaction history." />
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
                Rupees are approximate ({inrRate} INR per USD). Balances are stored in USD.
              </p>
            ) : null}
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <MetricCard
          label="Action credits"
          value={formatBillingMoney(balance.balance, displayCurrency)}
          subtext={overdrawn ? "Overdrawn — add credits to continue" : "Available balance"}
        />
        <MetricCard
          label="Spend (MTD)"
          value={formatBillingMoney(balance.monthToDate.spend, displayCurrency)}
          subtext={`${balance.monthToDate.successfulEvents.toLocaleString()} events`}
        />
        <MetricCard
          label="Billing cycle"
          value={balance.billingCycle}
          subtext="Current month"
        />
      </div>

      {overdrawn ? (
        <div className="flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
          <TriangleAlert className="mt-0.5 size-4 text-amber-400" strokeWidth={2} />
          <div className="min-w-0">
            <div className="text-[13px] font-medium text-amber-200">Credits overdrawn</div>
            <div className="mt-0.5 text-[12px] leading-relaxed text-amber-200/70">
              Your balance is negative. Add credits to continue using agents.
            </div>
          </div>
        </div>
      ) : null}

      <section className="space-y-3">
        <div className="flex flex-col gap-1">
          <h3 className="text-[14px] font-medium text-[--text-primary]">Transaction history</h3>
          <p className="text-[12px] leading-relaxed text-[--text-tertiary]">
            Recent credits and debits to your wallet.
          </p>
        </div>
        {transactions.length === 0 ? (
          <div className="qlix-glass-box rounded-xl p-6 text-center">
            <p className="text-[13px] text-[--text-tertiary]">No transactions yet.</p>
          </div>
        ) : (
          <div className="qlix-glass-box overflow-hidden rounded-xl">
            <table className="w-full border-collapse text-left text-[13px]">
              <thead className="border-b border-[--border-subtle]">
                <tr className="qlix-glass-inset text-[11px] font-medium uppercase tracking-widest text-[--text-tertiary]">
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3">Date</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx, idx, arr) => (
                  <tr
                    key={tx.id}
                    className={cn(
                      "transition-colors hover:bg-[var(--glass-row-hover)]",
                      idx < arr.length - 1 ? "border-b border-[--border-subtle]" : "",
                    )}
                  >
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "inline-flex px-2 py-1 rounded text-[11px] font-medium",
                          tx.type === "manual_credit"
                            ? "bg-green-500/20 text-green-200"
                            : "bg-red-500/20 text-red-200",
                        )}
                      >
                        {tx.type === "manual_credit" ? "Credit" : "Debit"}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-[--text-secondary]">
                      {formatBillingMoney(tx.amount, displayCurrency)}
                    </td>
                    <td className="px-4 py-3 text-[--text-secondary]">
                      {new Date(tx.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="flex items-center gap-2 text-[12px] text-[--text-tertiary]">
        <TrendingDown className="size-3.5" strokeWidth={1.75} aria-hidden />
        Credits are deducted when agents run or actions complete.
      </div>
    </div>
  );
}
