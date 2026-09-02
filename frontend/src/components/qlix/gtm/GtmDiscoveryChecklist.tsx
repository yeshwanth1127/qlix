"use client";

import { Check, Circle, Loader2 } from "lucide-react";
import { useState } from "react";
import {
  patchGtmDiscoveryWorkspace,
  type GtmChecklistStatus,
  type GtmDiscoveryPlanContent,
  type GtmDiscoveryWorkspace,
  type GtmWorkspaceSetup,
} from "@/lib/gtm-api";

function planStepKey(index: number, title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  return `step-${index}-${slug || "item"}`;
}

export function GtmDiscoveryChecklist({
  content,
  setup,
  stackMinimumMet,
  onUpdated,
}: {
  readonly content: GtmDiscoveryPlanContent;
  readonly setup: GtmWorkspaceSetup;
  readonly stackMinimumMet: boolean;
  readonly onUpdated: (workspace: GtmDiscoveryWorkspace) => void;
}) {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const entries = content.planSteps.map((step, index) => ({
    key: planStepKey(index, step.title),
    step,
    status: setup.discoveryChecklist[planStepKey(index, step.title)] ?? "pending",
  }));

  const doneCount = entries.filter((e) => e.status === "done").length;

  async function toggleStep(key: string, next: GtmChecklistStatus) {
    setBusyKey(key);
    setError(null);
    const result = await patchGtmDiscoveryWorkspace({ checklistStepKey: key, checklistStatus: next });
    setBusyKey(null);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onUpdated(result.workspace);
  }

  return (
    <div>
      <p className="font-serif text-[10px] uppercase tracking-widest text-black/45">
        {doneCount} of {entries.length} complete
      </p>
      <ol className="mt-4 space-y-4">
        {entries.map(({ key, step, status }, index) => {
          const done = status === "done";
          const isFirstPending = !done && entries.slice(0, index).every((e) => e.status === "done");
          return (
            <li key={key} className="flex gap-3 border border-black/10 bg-white p-4 text-[13px]">
              <span className="mt-0.5 shrink-0">
                {done ? (
                  <Check className="size-4 text-black" aria-hidden />
                ) : (
                  <Circle className="size-4 text-black/25" aria-hidden />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-black">{step.title}</p>
                <p className="mt-1 text-black/60">{step.why}</p>
                <p className="mt-1 font-serif text-[10px] uppercase tracking-widest text-black/40">
                  Effort: {step.effort}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {!done ? (
                    <button
                      type="button"
                      disabled={busyKey === key}
                      onClick={() => void toggleStep(key, "done")}
                      className="inline-flex items-center gap-2 border border-black px-3 py-1.5 font-serif text-[10px] uppercase tracking-widest disabled:opacity-40"
                    >
                      {busyKey === key ? <Loader2 className="size-3 animate-spin" aria-hidden /> : null}
                      Mark done
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busyKey === key}
                      onClick={() => void toggleStep(key, "pending")}
                      className="font-serif text-[10px] uppercase tracking-widest text-black/45 underline underline-offset-4 disabled:opacity-40"
                    >
                      Undo
                    </button>
                  )}
                  {!done && isFirstPending ? (
                    <span
                      title={stackMinimumMet ? undefined : "Connect research, choose CRM, and hire your primary agent first"}
                      className="inline-flex"
                    >
                      <button
                        type="button"
                        disabled={!stackMinimumMet}
                        className="bg-black px-3 py-1.5 font-serif text-[10px] uppercase tracking-widest text-white disabled:opacity-30"
                      >
                        Start
                      </button>
                    </span>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      {error ? <p className="mt-3 text-[12px] text-[#8b1e12]" role="alert">{error}</p> : null}
    </div>
  );
}
