"use client";

import Link from "next/link";
import { Check, Circle } from "lucide-react";
import { GtmCrmChoice } from "@/components/qlix/gtm/GtmCrmChoice";
import { GtmAgentRecommendationCard } from "@/components/qlix/gtm/GtmAgentRecommendationCard";
import type { GtmDiscoveryPlanContent, GtmDiscoveryWorkspace } from "@/lib/gtm-api";

function StatusIcon({ ready }: { readonly ready: boolean }) {
  return ready ? (
    <Check className="size-4 shrink-0 text-black" aria-hidden />
  ) : (
    <Circle className="size-4 shrink-0 text-black/25" aria-hidden />
  );
}

export function GtmSetupStack({
  workspace,
  content,
  routePrefix,
  onUpdated,
}: {
  readonly workspace: GtmDiscoveryWorkspace;
  readonly content: GtmDiscoveryPlanContent;
  readonly routePrefix: string;
  readonly onUpdated: (workspace: GtmDiscoveryWorkspace) => void;
}) {
  const { connectors, setup, agentRecommendations, hiredRoleSlugs } = workspace;
  const researchReady = connectors.researchConnected;
  const crmReady = setup.crmMode === "qlix_twenty"
    || (setup.crmMode === "external" && (setup.crmExternalProvider !== "zoho" || connectors.zohoConnected));
  const primarySlug = content.suggestedAgents.find((a) => a.tier === "primary")?.roleSlug
    ?? content.suggestedAgents[0]?.roleSlug;
  const agentReady = primarySlug ? hiredRoleSlugs.includes(primarySlug) : hiredRoleSlugs.length > 0;

  const researchProvider = connectors.connectedProviders.includes("google")
    ? "google"
    : connectors.connectedProviders.includes("microsoft")
      ? "microsoft"
      : "google";

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <section className="border border-black/25 bg-[#fbfaf6] p-5">
        <div className="flex items-start gap-3">
          <StatusIcon ready={researchReady} />
          <div className="min-w-0 flex-1">
            <h3 className="font-serif text-[10px] uppercase tracking-[0.16em] text-black/45">Research & email</h3>
            <p className="mt-2 text-[13px] text-black/65">
              Agents need this to research accounts and read inbox context.
            </p>
            <p className="mt-1 text-[11px] text-black/40">
              {researchReady ? "Connected" : "Not connected"}
            </p>
            {!researchReady ? (
              <Link
                href={`${routePrefix}/connectors#${researchProvider}`}
                className="mt-3 inline-block bg-black px-3 py-2 font-serif text-[10px] uppercase tracking-widest text-white"
              >
                Connect {researchProvider === "google" ? "Google" : "Microsoft"}
              </Link>
            ) : (
              <Link
                href={`${routePrefix}/connectors#${researchProvider}`}
                className="mt-3 inline-block font-serif text-[10px] uppercase tracking-widest underline underline-offset-4"
              >
                Manage connection
              </Link>
            )}
            <p className="mt-3 border-t border-black/10 pt-3 text-[10px] text-black/40">
              Email send · blocked in discovery-only mode
            </p>
          </div>
        </div>
      </section>

      <section className="border border-black/25 bg-[#fbfaf6] p-5">
        <div className="flex items-start gap-3">
          <StatusIcon ready={crmReady} />
          <div className="min-w-0 flex-1">
            <h3 className="font-serif text-[10px] uppercase tracking-[0.16em] text-black/45">CRM</h3>
            <p className="mt-2 text-[13px] text-black/65">Choose where your pipeline will live.</p>
            <div className="mt-3">
              <GtmCrmChoice workspace={workspace} routePrefix={routePrefix} onUpdated={onUpdated} />
            </div>
          </div>
        </div>
      </section>

      <section className="border border-black/25 bg-[#fbfaf6] p-5">
        <div className="flex items-start gap-3">
          <StatusIcon ready={agentReady} />
          <div className="min-w-0 flex-1">
            <h3 className="font-serif text-[10px] uppercase tracking-[0.16em] text-black/45">Your GTM team</h3>
            <p className="mt-2 text-[13px] text-black/65">Start with the best-fit agent for discovery.</p>
            <div className="mt-3">
              <GtmAgentRecommendationCard
                suggestedAgents={content.suggestedAgents}
                recommendations={agentRecommendations}
                hiredRoleSlugs={hiredRoleSlugs}
                routePrefix={routePrefix}
              />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
