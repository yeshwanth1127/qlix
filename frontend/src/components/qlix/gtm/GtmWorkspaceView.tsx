"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { GtmDiscoveryFoundation } from "@/components/qlix/gtm/GtmDiscoveryFoundation";
import { GtmPersonalizedDashboard } from "@/components/qlix/gtm/GtmPersonalizedDashboard";
import { SketchPageHeader } from "@/components/qlix/sketch";
import { getGtmDiscoveryEntry } from "@/lib/gtm-api";

export function GtmWorkspaceView({ routePrefix = "/organization" }: { readonly routePrefix?: string }) {
  const searchParams = useSearchParams();
  const forceQuestions = searchParams.get("edit") === "answers";
  const [view, setView] = useState<"questions" | "workspace" | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (forceQuestions) {
      setView("questions");
      setLoading(false);
      return;
    }
    let cancelled = false;
    void getGtmDiscoveryEntry().then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setView(result.entry.view);
    });
    return () => {
      cancelled = true;
    };
  }, [refreshKey, forceQuestions]);

  if (loading) {
    return <p className="py-10 text-center text-[13px] text-black/45">Loading GTM…</p>;
  }

  if (error) {
    return <p className="py-10 text-center text-[13px] text-[#8b1e12]" role="alert">{error}</p>;
  }

  if (view === "workspace" && !forceQuestions) {
    return <GtmPersonalizedDashboard routePrefix={routePrefix} />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SketchPageHeader
        title="GTM Discovery"
        subtitle="Answer six simple questions to give Qlix a clear starting point. Unknown answers are okay."
        actions={(
          <div className="flex items-center gap-2 border border-black px-3 py-2 font-serif text-[10px] uppercase tracking-widest">
            <ShieldCheck className="size-3.5" aria-hidden /> Discovery only
          </div>
        )}
      />
      <div className="py-4 sm:py-8">
        <GtmDiscoveryFoundation
          refreshKey={refreshKey}
          onConfirmed={() => {
            setRefreshKey((value) => value + 1);
            setView("workspace");
          }}
        />
      </div>
    </div>
  );
}
