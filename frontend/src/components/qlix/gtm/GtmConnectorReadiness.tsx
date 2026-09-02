"use client";

import Link from "next/link";
import { Check, Circle, Loader2 } from "lucide-react";
import { useConnectorsOverview } from "@/lib/hooks/use-connectors-overview";

const GTM_CAPABILITIES = [
  {
    id: "research",
    label: "Research & web",
    hint: "Google or Microsoft for email/calendar context",
    providers: ["google", "microsoft"],
  },
  {
    id: "crm",
    label: "CRM",
    hint: "Zoho or future Twenty connector",
    providers: ["zoho"],
  },
  {
    id: "email",
    label: "Email send",
    hint: "Disabled in discovery-only mode",
    providers: ["google", "microsoft"],
    disabledInDiscovery: true,
  },
] as const;

export function GtmConnectorReadiness({ connectorsHref }: { readonly connectorsHref: string }) {
  const { liveConnectors, loading, error } = useConnectorsOverview();
  const connectedProviders = new Set(liveConnectors.map((c) => c.provider));

  return (
    <div>
      {loading ? (
        <p className="flex items-center gap-2 text-[12px] text-black/45">
          <Loader2 className="size-3.5 animate-spin" aria-hidden /> Checking connectors…
        </p>
      ) : error ? (
        <p className="text-[12px] text-[#8b1e12]">{error}</p>
      ) : (
        <ul className="space-y-2">
          {GTM_CAPABILITIES.map((cap) => {
            const ready = cap.providers.some((p) => connectedProviders.has(p));
            const muted = "disabledInDiscovery" in cap && cap.disabledInDiscovery === true;
            return (
              <li
                key={cap.id}
                className="flex items-start gap-3 border-b border-black/10 pb-2 text-[12px] last:border-0 last:pb-0"
              >
                {muted ? (
                  <Circle className="mt-0.5 size-3 shrink-0 text-black/25" aria-hidden />
                ) : ready ? (
                  <Check className="mt-0.5 size-3 shrink-0 text-black" aria-hidden />
                ) : (
                  <Circle className="mt-0.5 size-3 shrink-0 text-black/25" aria-hidden />
                )}
                <div>
                  <p className={muted ? "text-black/40" : ready ? "text-black" : "text-black/55"}>
                    {cap.label}
                    {muted ? " · blocked" : ready ? " · connected" : " · not connected"}
                  </p>
                  <p className="text-[10px] text-black/40">{cap.hint}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <Link
        href={connectorsHref}
        className="mt-4 inline-block font-serif text-[10px] uppercase tracking-widest underline underline-offset-4"
      >
        Manage connectors
      </Link>
    </div>
  );
}
