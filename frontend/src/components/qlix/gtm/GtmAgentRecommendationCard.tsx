"use client";

import Link from "next/link";
import { Check } from "lucide-react";
import type { GtmAgentRecommendation, GtmSuggestedAgent } from "@/lib/gtm-api";

function buildHireHref(
  routePrefix: string,
  agent: GtmSuggestedAgent | GtmAgentRecommendation,
  platforms?: readonly string[],
): string {
  const params = new URLSearchParams({ from: "gtm" });
  const platformList = platforms ?? ("suggestedPlatforms" in agent ? agent.suggestedPlatforms : []);
  if (platformList.length > 0) params.set("platforms", platformList.join(","));
  const suggestedName = agent.tier === "primary" ? "Discovery Lead" : agent.label;
  params.set("name", suggestedName);
  return `${routePrefix}/ai-employees/${agent.roleSlug}/hire?${params.toString()}`;
}

function AgentCard({
  agent,
  recommendation,
  routePrefix,
  hired,
  primary,
}: {
  readonly agent: GtmSuggestedAgent;
  readonly recommendation?: GtmAgentRecommendation;
  readonly routePrefix: string;
  readonly hired: boolean;
  readonly primary: boolean;
}) {
  const matchReasons = agent.matchReasons ?? recommendation?.matchReasons ?? [];
  const mission = recommendation?.mission;
  const platforms = recommendation?.suggestedPlatforms ?? ["google"];

  return (
    <div className={`border p-4 ${primary ? "border-black bg-white" : "border-black/15 bg-white/80"}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[14px] font-medium">{agent.label}</p>
          {mission ? <p className="mt-1 text-[12px] text-black/55">{mission}</p> : null}
        </div>
        {hired ? (
          <span className="inline-flex items-center gap-1 font-serif text-[10px] uppercase tracking-widest text-black/55">
            <Check className="size-3" aria-hidden /> Hired
          </span>
        ) : primary ? (
          <span className="shrink-0 border border-black/20 px-2 py-0.5 font-serif text-[9px] uppercase tracking-widest text-black/55">
            Best fit
          </span>
        ) : null}
      </div>

      {matchReasons.length > 0 ? (
        <ul className="mt-3 list-disc space-y-1 pl-4 text-[12px] text-black/65">
          {matchReasons.slice(0, 2).map((reason) => (
            <li key={reason.code}>{reason.label}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-[12px] text-black/60">{agent.reason}</p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {!hired ? (
          <Link
            href={buildHireHref(routePrefix, agent, platforms)}
            className="bg-black px-3 py-2 font-serif text-[10px] uppercase tracking-widest text-white"
          >
            Hire {agent.label}
          </Link>
        ) : null}
        <Link
          href={`${routePrefix}/ai-employees/${agent.roleSlug}`}
          className="border border-black/25 px-3 py-2 font-serif text-[10px] uppercase tracking-widest"
        >
          View role details
        </Link>
      </div>
    </div>
  );
}

export function GtmAgentRecommendationCard({
  suggestedAgents,
  recommendations,
  hiredRoleSlugs,
  routePrefix,
}: {
  readonly suggestedAgents: readonly GtmSuggestedAgent[];
  readonly recommendations: readonly GtmAgentRecommendation[];
  readonly hiredRoleSlugs: readonly string[];
  readonly routePrefix: string;
}) {
  const recBySlug = new Map(recommendations.map((r) => [r.roleSlug, r]));
  const primary = suggestedAgents.find((a) => a.tier === "primary") ?? suggestedAgents[0];
  const secondary = suggestedAgents.filter((a) => a.roleSlug !== primary?.roleSlug).slice(0, 2);

  if (!primary) {
    return <p className="text-[12px] text-black/45">No agent recommendations yet.</p>;
  }

  return (
    <div className="space-y-3">
      <AgentCard
        agent={primary}
        recommendation={recBySlug.get(primary.roleSlug)}
        routePrefix={routePrefix}
        hired={hiredRoleSlugs.includes(primary.roleSlug)}
        primary
      />
      {secondary.map((agent) => (
        <AgentCard
          key={agent.roleSlug}
          agent={agent}
          recommendation={recBySlug.get(agent.roleSlug)}
          routePrefix={routePrefix}
          hired={hiredRoleSlugs.includes(agent.roleSlug)}
          primary={false}
        />
      ))}
    </div>
  );
}
