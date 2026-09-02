"use client";

import { Check, Circle, Loader2, Pencil } from "lucide-react";
import { useState } from "react";
import {
  patchGtmDiscoveryWorkspace,
  type GtmChecklistStatus,
  type GtmDiscoveryWorkspace,
  type GtmRoadmapStep,
} from "@/lib/gtm-api";

function stepKey(step: GtmRoadmapStep, index: number): string {
  return step.id || `step-${index}-${step.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60)}`;
}

export function GtmEditableRoadmap({
  workspace,
  onUpdated,
}: {
  readonly workspace: GtmDiscoveryWorkspace;
  readonly onUpdated: (workspace: GtmDiscoveryWorkspace) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<GtmRoadmapStep[]>(() => [...workspace.roadmap]);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const entries = (editing ? draft : workspace.roadmap).map((step, index) => ({
    key: stepKey(step, index),
    step,
    status: workspace.setup.discoveryChecklist[stepKey(step, index)] ?? "pending",
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

  async function saveRoadmap() {
    setSaving(true);
    setError(null);
    const normalized = draft.map((step, index) => ({
      ...step,
      id: stepKey(step, index),
    }));
    const result = await patchGtmDiscoveryWorkspace({ discoveryRoadmap: normalized });
    setSaving(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setEditing(false);
    onUpdated(result.workspace);
    setDraft([...result.workspace.roadmap]);
  }

  function updateStep(index: number, field: "title" | "why", value: string) {
    setDraft((current) => current.map((step, i) => (i === index ? { ...step, [field]: value } : step)));
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-serif text-[10px] uppercase tracking-widest text-black/45">
          {doneCount} of {entries.length} complete
        </p>
        {!editing ? (
          <button
            type="button"
            onClick={() => {
              setDraft([...workspace.roadmap]);
              setEditing(true);
            }}
            className="inline-flex items-center gap-1.5 font-serif text-[10px] uppercase tracking-widest text-black/55 underline underline-offset-4"
          >
            <Pencil className="size-3" aria-hidden /> Edit roadmap
          </button>
        ) : (
          <div className="flex gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => void saveRoadmap()}
              className="bg-black px-3 py-1.5 font-serif text-[10px] uppercase tracking-widest text-white disabled:opacity-40"
            >
              {saving ? "Saving…" : "Save roadmap"}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setDraft([...workspace.roadmap]);
                setEditing(false);
              }}
              className="font-serif text-[10px] uppercase tracking-widest text-black/45"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      <ol className="mt-4 space-y-4">
        {entries.map(({ key, step, status }, index) => {
          const done = status === "done";
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
                {editing ? (
                  <>
                    <input
                      value={step.title}
                      onChange={(e) => updateStep(index, "title", e.target.value)}
                      className="w-full border border-black/20 bg-[#fbfaf6] px-2 py-1.5 text-[13px] font-medium"
                    />
                    <textarea
                      value={step.why}
                      onChange={(e) => updateStep(index, "why", e.target.value)}
                      rows={2}
                      className="mt-2 w-full border border-black/20 bg-[#fbfaf6] px-2 py-1.5 text-[12px] text-black/70"
                    />
                  </>
                ) : (
                  <>
                    <p className="font-medium text-black">{step.title}</p>
                    <p className="mt-1 text-black/60">{step.why}</p>
                  </>
                )}
                <p className="mt-1 font-serif text-[10px] uppercase tracking-widest text-black/40">
                  Effort: {step.effort}
                </p>
                {!editing ? (
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
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
      {error ? <p className="mt-3 text-[12px] text-[#8b1e12]" role="alert">{error}</p> : null}
    </div>
  );
}
