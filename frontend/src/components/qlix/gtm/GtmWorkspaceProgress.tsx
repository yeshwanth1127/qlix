"use client";

import { Check } from "lucide-react";
import type { GtmWorkspaceReadiness } from "@/lib/gtm-api";

const MILESTONES = [
  { key: "answersSaved" as const, label: "Answers saved" },
  { key: "planReady" as const, label: "Plan ready" },
  { key: "teamBuilt" as const, label: "Team built" },
  { key: "discoveryStarted" as const, label: "Discovery started" },
];

export function GtmWorkspaceProgress({ readiness }: { readonly readiness: GtmWorkspaceReadiness }) {
  const completedCount = MILESTONES.filter((m) => readiness.milestones[m.key]).length;
  const progressPct = Math.round((completedCount / MILESTONES.length) * 100);

  return (
    <div className="border border-black/25 bg-[#fbfaf6] p-5">
      <div className="flex items-center justify-between gap-4">
        <p className="font-serif text-[10px] uppercase tracking-[0.16em] text-black/45">Progress</p>
        <p className="font-serif text-[10px] uppercase tracking-widest text-black/55">{progressPct}%</p>
      </div>
      <div className="mt-3 h-1.5 w-full bg-black/10">
        <div className="h-full bg-black transition-all" style={{ width: `${progressPct}%` }} />
      </div>
      <ol className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {MILESTONES.map((milestone) => {
          const done = readiness.milestones[milestone.key];
          return (
            <li key={milestone.key} className="flex items-center gap-2 text-[12px]">
              {done ? (
                <Check className="size-3.5 shrink-0 text-black" aria-hidden />
              ) : (
                <span className="size-3.5 shrink-0 rounded-full border border-black/25" aria-hidden />
              )}
              <span className={done ? "text-black" : "text-black/45"}>{milestone.label}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
