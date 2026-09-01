"use client";

import { useState } from "react";
import { Check, ChevronLeft, ChevronRight, Loader2, ShieldCheck, X } from "lucide-react";
import { createTeam, type TeamDTO } from "@/lib/teams-api";
import { CLOUD_MODELS } from "@/lib/agents-api";
import { cn } from "@/lib/utils/cn";
import { SketchBox, sketchButton, sketchInput, sketchLabel } from "@/components/qlix/sketch";

type Step = 1 | 2;

interface CreateTeamModalProps {
  readonly open: boolean;
  readonly orgId: string;
  readonly onClose: () => void;
  readonly onCreated: (team: TeamDTO) => void;
}

function StepDot({ n, current }: { n: number; current: Step }) {
  const done = n < current;
  const active = n === current;
  return (
    <div
      className={cn(
        "flex h-6 w-6 items-center justify-center border border-black text-xs font-semibold",
        done ? "bg-black text-white" : active ? "border-2 bg-[#E2F0CC] text-black" : "bg-[#E2F0CC] text-black/40",
      )}
    >
      {done ? <Check size={12} /> : n}
    </div>
  );
}

export function CreateTeamModal({ open, orgId: _orgId, onClose, onCreated }: CreateTeamModalProps) {
  const [step, setStep] = useState<Step>(1);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [pipelineMode, setPipelineMode] = useState(true);
  const [defaultModel, setDefaultModel] = useState<string>("openrouter/qlix/auto");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setStep(1);
    setName("");
    setDescription("");
    setPipelineMode(true);
    setDefaultModel("");
    setError(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      const team = await createTeam({
        name: name.trim(),
        description: description.trim() || undefined,
        config: (defaultModel || !pipelineMode)
          ? { pipelineMode: pipelineMode || undefined, defaultModel: defaultModel || undefined }
          : undefined,
      });
      reset();
      onCreated(team);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create team");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#E2F0CC]/80 p-4">
      <div className="flex w-full max-w-lg flex-col border-2 border-black bg-[#E2F0CC]" style={{ maxHeight: "90vh" }}>
        <div className="flex shrink-0 items-center justify-between border-b border-black px-6 py-4">
          <div>
            <h2 className={sketchLabel}>Create team</h2>
            <div className="mt-2 flex items-center gap-2">
              <StepDot n={1} current={step} />
              <div className="h-px w-6 bg-black/20" />
              <StepDot n={2} current={step} />
            </div>
          </div>
          <button type="button" onClick={handleClose} className="text-black/40 hover:text-black">
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {step === 1 ? (
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-black">Team name</label>
                <input
                  className={sketchInput}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Research squad"
                  autoFocus
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-black">Description</label>
                <textarea
                  className={`${sketchInput} min-h-[80px] resize-none`}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Optional"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-black">Execution mode</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setPipelineMode(true)}
                    className={cn(
                      "border px-3 py-2 text-left text-xs",
                      pipelineMode ? "border-2 border-black bg-[#E2F0CC]" : "border-black/20 text-black/50",
                    )}
                  >
                    <div className="font-medium text-black">Pipeline</div>
                    <div className="mt-0.5 text-black/50">Sequential handoffs</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPipelineMode(false)}
                    className={cn(
                      "border px-3 py-2 text-left text-xs",
                      !pipelineMode ? "border-2 border-black bg-[#E2F0CC]" : "border-black/20 text-black/50",
                    )}
                  >
                    <div className="font-medium text-black">Parallel</div>
                    <div className="mt-0.5 text-black/50">Workers run together</div>
                  </button>
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-black">Default model (optional)</label>
                <select
                  className={sketchInput}
                  value={defaultModel}
                  onChange={(e) => setDefaultModel(e.target.value)}
                >
                  <option value="">Per-agent defaults</option>
                  {CLOUD_MODELS.map((m) => (
                    <option key={m} value={m}>
                      {m === "openrouter/qlix/auto"
                        ? "Auto (Qlix picks ≤ your plan)"
                        : m.replace("openrouter/", "")}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <SketchBox className="space-y-2 px-4 py-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-black/50">Name</span>
                  <span className="font-medium text-black">{name}</span>
                </div>
                {description.trim() ? (
                  <div className="flex items-start justify-between gap-4 text-xs">
                    <span className="shrink-0 text-black/50">Description</span>
                    <span className="text-right text-black/70">{description}</span>
                  </div>
                ) : null}
                <div className="flex items-center justify-between text-xs">
                  <span className="text-black/50">Execution mode</span>
                  <span className="font-medium text-black">
                    {pipelineMode ? "Pipeline (sequential)" : "Parallel"}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-black/50">Team model</span>
                  <span className="font-medium text-black">
                    {defaultModel ? defaultModel.replace("openrouter/", "") : "Per-agent defaults"}
                  </span>
                </div>
              </SketchBox>
            </div>
          )}
        </div>

        {error ? (
          <div className="border-t border-black px-6 py-2 text-xs text-black">{error}</div>
        ) : null}

        <div className="flex shrink-0 items-center justify-between border-t border-black px-6 py-3">
          <button
            type="button"
            onClick={step === 1 ? handleClose : () => setStep(1)}
            className={sketchButton}
          >
            {step === 1 ? "Cancel" : <><ChevronLeft size={13} /> Back</>}
          </button>

          {step === 1 ? (
            <button
              type="button"
              onClick={() => setStep(2)}
              disabled={!name.trim()}
              className={sketchButton}
            >
              Next <ChevronRight size={13} />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={submitting}
              className={sketchButton}
            >
              {submitting ? (
                <><Loader2 size={13} className="animate-spin" /> Creating…</>
              ) : (
                <><ShieldCheck size={13} /> Create Team</>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
