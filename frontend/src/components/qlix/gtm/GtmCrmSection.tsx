"use client";

import { GtmCrmChoice } from "@/components/qlix/gtm/GtmCrmChoice";
import type { GtmDiscoveryWorkspace } from "@/lib/gtm-api";

export function GtmCrmSection({
  workspace,
  routePrefix,
  onUpdated,
}: {
  readonly workspace: GtmDiscoveryWorkspace;
  readonly routePrefix: string;
  readonly onUpdated: (workspace: GtmDiscoveryWorkspace) => void;
}) {
  return (
    <section className="border border-black/25 bg-[#fbfaf6] p-5">
      <h2 className="font-serif text-[10px] uppercase tracking-[0.16em] text-black/45">Pipeline & CRM</h2>
      <p className="mt-2 text-[13px] text-black/65">Choose where researched accounts and deals will live.</p>
      <div className="mt-3">
        <GtmCrmChoice workspace={workspace} routePrefix={routePrefix} onUpdated={onUpdated} />
      </div>
    </section>
  );
}
