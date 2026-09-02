"use client";

import { ShieldCheck } from "lucide-react";
import { GtmDiscoveryFoundation } from "@/components/qlix/gtm/GtmDiscoveryFoundation";
import { SketchPageHeader } from "@/components/qlix/sketch";

export function GtmWorkspaceView() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SketchPageHeader
        title="GTM Discovery"
        subtitle="Answer six simple questions to give Qlix a clear starting point. Unknown answers are okay."
        actions={<div className="flex items-center gap-2 border border-black px-3 py-2 font-serif text-[10px] uppercase tracking-widest"><ShieldCheck className="size-3.5" aria-hidden /> Discovery only</div>}
      />
      <div className="py-4 sm:py-8">
        <GtmDiscoveryFoundation />
      </div>
    </div>
  );
}
