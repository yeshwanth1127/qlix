"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/components/qlix/session-context";
import { CurrencyToggle, useDisplayCurrency } from "@/components/qlix/currency-context";
import { SketchBox, SketchPageHeader, SketchSection } from "@/components/qlix/sketch";
import type { OrgSubscriptionInfo } from "@/lib/auth-api";
import { getBillingPlans, type BillingPlanRow } from "@/lib/billing-api";

function daysLeft(trialEndsAt: string | null): number | null {
  if (!trialEndsAt) return null;
  const ms = new Date(trialEndsAt).getTime() - Date.now();
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

function statusCopy(sub: OrgSubscriptionInfo | undefined): { title: string; body: string } {
  if (!sub) {
    return {
      title: "Subscription",
      body: "Choose a plan for your workspace. Auto routing is included on every orbit.",
    };
  }
  if (sub.status === "trialing" && sub.access === "allowed") {
    const days = daysLeft(sub.trialEndsAt);
    return {
      title: "Ignition trial active",
      body:
        days === null
          ? "You are on an Ignition trial."
          : days === 1
            ? "1 day left in your Ignition trial."
            : `${days} days left in your Ignition trial.`,
    };
  }
  if (sub.access === "required") {
    return {
      title: "Trial ended — choose a plan",
      body: "Your Ignition trial has ended. Select Nova, Quasar, or Helix to continue.",
    };
  }
  return {
    title: "Your subscription",
    body: `Current plan: ${sub.planName} (${sub.status}).`,
  };
}

export function SubscriptionsView() {
  const { session, loading } = useSession();
  const { currency, formatInr } = useDisplayCurrency();
  const sub = session?.organization.subscription;
  const copy = statusCopy(sub);
  const [plans, setPlans] = useState<BillingPlanRow[]>([]);
  const [plansError, setPlansError] = useState<string | null>(null);
  const [plansLoading, setPlansLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setPlansLoading(true);
    setPlansError(null);
    void getBillingPlans()
      .then((body) => {
        if (cancelled) return;
        if (!body?.plans?.length) {
          setPlans([]);
          setPlansError("Could not load plans");
          return;
        }
        setPlans(body.plans);
        setPlansError(null);
      })
      .catch(() => {
        if (!cancelled) {
          setPlans([]);
          setPlansError("Could not load plans");
        }
      })
      .finally(() => {
        if (!cancelled) setPlansLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading || !session) {
    return (
      <div className="pt-12 text-center text-[13px] text-[--text-tertiary]">Loading…</div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SketchPageHeader title="Subscriptions" />
        <CurrencyToggle />
      </div>
      <SketchSection title={copy.title}>
        <p className="max-w-2xl text-[12px] text-black/55">{copy.body}</p>
        {sub?.trialEndsAt ? (
          <p className="mt-1 text-[11px] text-black/50">
            Trial ends {new Date(sub.trialEndsAt).toLocaleString()}
          </p>
        ) : null}
      </SketchSection>

      <SketchSection title="Orbits">
        {plansLoading ? (
          <p className="text-[12px] text-black/50">Loading plans…</p>
        ) : plansError ? (
          <p className="text-[12px] text-red-700">{plansError}</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-3">
            {plans.map((plan) => (
              <SketchBox key={plan.id} className="flex flex-col gap-3 p-4">
                <div>
                  <h2 className="font-serif text-xl text-black">{plan.displayName}</h2>
                  <p className="mt-1 text-[11px] text-black/55">{plan.blurb}</p>
                </div>
                <div className="border border-dashed border-black/20 px-3 py-6 text-center">
                  <p className="font-serif text-2xl text-black">
                    {currency === "USD"
                      ? `$${Number(plan.monthlyPriceUsd).toFixed(2)}`
                      : formatInr(plan.monthlyPriceInr)}
                  </p>
                  <p className="mt-1 text-[10px] uppercase tracking-wide text-black/40">/ month</p>
                </div>
                <ul className="min-h-[4.5rem] list-inside list-disc text-[11px] text-black/55">
                  <li>Up to {plan.maxAgents} agents</li>
                  <li>
                    Auto + pinned models
                    {plan.allowedModelTiers?.length
                      ? ` (${plan.allowedModelTiers.join(", ")})`
                      : ""}
                  </li>
                  <li>{formatInr(plan.freeMonthlyCreditInr)} free credit / month</li>
                  {plan.whatsappMsgLimit > 0 ? (
                    <li>{plan.whatsappMsgLimit.toLocaleString()} WhatsApp msgs / cycle</li>
                  ) : null}
                </ul>
                <button
                  type="button"
                  disabled
                  className="mt-auto border border-black/20 px-3 py-2 text-[11px] font-semibold text-black/40"
                  title="Checkout coming soon"
                >
                  Select {plan.displayName}
                </button>
              </SketchBox>
            ))}
          </div>
        )}
      </SketchSection>
    </div>
  );
}
