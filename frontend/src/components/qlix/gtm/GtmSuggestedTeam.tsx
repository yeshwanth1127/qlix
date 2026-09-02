"use client";

import Link from "next/link";
import { Check, Circle } from "lucide-react";
import type { GtmDiscoveryWorkspace } from "@/lib/gtm-api";

export function GtmSuggestedTeam({
  workspace,
  routePrefix,
}: {
  readonly workspace: GtmDiscoveryWorkspace;
  readonly routePrefix: string;
}) {
  const { suggestedTeam, hiredRoleSlugs, teamProgress } = workspace;
  const buildTeamHref = `${routePrefix}/gtm/build-team`;
  const teamReady = teamProgress.allHired;

  if (suggestedTeam.length === 0) {
    return <p className="text-[12px] text-black/45">No team recommendation yet.</p>;
  }

  return (
    <section className="border border-black/25 bg-[#fbfaf6] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-serif text-[10px] uppercase tracking-[0.16em] text-black/45">Suggested GTM team</h2>
          <p className="mt-2 max-w-2xl text-[13px] text-black/65">
            A parallel discovery team — research, email, and support agents configured to run together.
          </p>
        </div>
        <p className="font-serif text-[10px] uppercase tracking-widest text-black/45">
          {teamProgress.hiredCount} of {teamProgress.totalCount} built
        </p>
      </div>

      <ul className="mt-4 space-y-2">
        {suggestedTeam.map((slot) => {
          const built = hiredRoleSlugs.includes(slot.roleSlug);
          return (
            <li
              key={`${slot.slotId}-${slot.roleSlug}`}
              className="flex items-start gap-3 border border-black/10 bg-white px-4 py-3 text-[13px]"
            >
              {built ? (
                <Check className="mt-0.5 size-4 shrink-0 text-black" aria-hidden />
              ) : (
                <Circle className="mt-0.5 size-4 shrink-0 text-black/25" aria-hidden />
              )}
              <div className="min-w-0 flex-1">
                <p className="font-medium text-black">{slot.slotLabel}</p>
                <p className="text-[12px] text-black/55">{slot.roleLabel} · {slot.mission}</p>
              </div>
              <span className="shrink-0 font-serif text-[9px] uppercase tracking-widest text-black/40">Parallel</span>
            </li>
          );
        })}
      </ul>

      <div className="mt-4 border-t border-black/10 pt-4">
        <Link
          href={buildTeamHref}
          className="inline-block bg-black px-4 py-2.5 font-serif text-[10px] uppercase tracking-widest text-white"
        >
          {teamReady ? "View team build" : "Build team"}
        </Link>
      </div>
    </section>
  );
}
