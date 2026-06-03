"use client";

import { useState } from "react";
import { Check, ChevronLeft, ChevronRight, Fingerprint, Loader2, ShieldCheck, X } from "lucide-react";
import { createTeam, type TeamDTO } from "@/lib/teams-api";
import { CLOUD_MODELS } from "@/lib/agents-api";
import { obtainAgentCreateStepUpToken, type RegisterDeviceResult } from "@/lib/webauthn";
import { cn } from "@/lib/utils/cn";

type Step = 1 | 2;

interface CreateTeamModalProps {
  readonly open: boolean;
  readonly orgId: string;
  readonly deviceVerified: boolean;
  readonly onClose: () => void;
  readonly onCreated: (team: TeamDTO) => void;
}

function StepDot({ n, current }: { n: number; current: Step }) {
  const done = n < current;
  const active = n === current;
  return (
    <div
      className={cn(
        "flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold transition-colors",
        done
          ? "bg-indigo-600 text-white"
          : active
            ? "border-2 border-indigo-500 text-indigo-400"
            : "border border-white/20 text-white/30",
      )}
    >
      {done ? <Check size={12} /> : n}
    </div>
  );
}

export function CreateTeamModal({ open, orgId: _orgId, deviceVerified, onClose, onCreated }: CreateTeamModalProps) {
  const [step, setStep] = useState<Step>(1);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [pipelineMode, setPipelineMode] = useState(true);
  const [defaultModel, setDefaultModel] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [stepUpBusy, setStepUpBusy] = useState(false);
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
    setStepUpBusy(true);
    let stepUpToken = "";
    try {
      const result: RegisterDeviceResult = await obtainAgentCreateStepUpToken(deviceVerified);
      if (!result.ok) {
        setError(result.errorMessage ?? "Device verification failed");
        setStepUpBusy(false);
        return;
      }
      stepUpToken = result.stepUpToken ?? "";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Device verification failed");
      setStepUpBusy(false);
      return;
    }
    setStepUpBusy(false);

    setSubmitting(true);
    try {
      const team = await createTeam({
        name: name.trim(),
        description: description.trim() || undefined,
        config: (defaultModel || !pipelineMode)
          ? { pipelineMode: pipelineMode || undefined, defaultModel: defaultModel || undefined }
          : undefined,
      }, stepUpToken);
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="relative flex w-full max-w-md flex-col rounded-xl border border-white/10 bg-[#0e0e14] shadow-2xl" style={{ maxHeight: "min(90vh, 680px)" }}>
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-6 py-4">
          <h2 className="text-sm font-semibold text-white/90">Create Team</h2>
          <button onClick={handleClose} className="text-white/40 hover:text-white/80 transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Step progress */}
        <div className="flex shrink-0 items-center gap-2 px-6 py-3 border-b border-white/10">
          {([1, 2] as Step[]).map((n, i) => (
            <div key={n} className="flex items-center gap-2">
              <StepDot n={n} current={step} />
              {i < 1 && <div className={cn("h-px w-8 transition-colors", step > n ? "bg-indigo-600" : "bg-white/10")} />}
            </div>
          ))}
          <span className="ml-2 text-xs text-white/30">
            {step === 1 ? "Name & Description" : "Confirm"}
          </span>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {error && (
            <div className="mb-4 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
              {error}
            </div>
          )}

          {/* Step 1: Name + Description */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-white/60 mb-1">Team name *</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && name.trim() && setStep(2)}
                  placeholder="Research & Analysis Team"
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80 placeholder-white/20 focus:outline-none focus:border-indigo-500/60"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-white/60 mb-1">Description (optional)</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="A team that researches and summarizes information…"
                  rows={3}
                  className="w-full resize-none rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80 placeholder-white/20 focus:outline-none focus:border-indigo-500/60"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-white/60 mb-1">
                  Team AI model <span className="text-white/30 font-normal">(optional — overrides each agent&apos;s own model)</span>
                </label>
                <select
                  value={defaultModel}
                  onChange={(e) => setDefaultModel(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80 focus:outline-none focus:border-indigo-500/60"
                >
                  <option value="" className="bg-white text-black">Use each agent&apos;s own model</option>
                  {CLOUD_MODELS.map((m) => (
                    <option key={m} value={m} className="bg-white text-black">{m.replace("openrouter/", "")}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="flex items-start gap-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={pipelineMode}
                    onChange={(e) => setPipelineMode(e.target.checked)}
                    className="mt-0.5"
                  />
                  <div>
                    <p className="text-xs font-medium text-white/70">Pipeline mode <span className="text-indigo-400/70">(recommended)</span></p>
                    <p className="text-xs text-white/35 mt-0.5">
                      Workers run sequentially — each agent receives output from the previous stage. Disable only if tasks are fully independent and order doesn&apos;t matter.
                    </p>
                  </div>
                </label>
              </div>

              <p className="text-xs text-white/30">
                After creating the team, you&apos;ll set up a supervisor agent and add worker agents directly inside the team.
              </p>
            </div>
          )}

          {/* Step 2: Confirm */}
          {step === 2 && (
            <div className="space-y-3">
              <div className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-white/40">Name</span>
                  <span className="text-white/80 font-medium">{name}</span>
                </div>
                {description && (
                  <div className="flex items-start justify-between text-xs gap-4">
                    <span className="text-white/40 shrink-0">Description</span>
                    <span className="text-white/60 text-right">{description}</span>
                  </div>
                )}
                <div className="flex items-center justify-between text-xs">
                  <span className="text-white/40">Execution mode</span>
                  <span className={cn("font-medium", pipelineMode ? "text-indigo-400" : "text-white/50")}>
                    {pipelineMode ? "Pipeline (sequential)" : "Parallel"}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-white/40">Team model</span>
                  <span className="text-white/60 font-medium">
                    {defaultModel ? defaultModel.replace("openrouter/", "") : "Per-agent defaults"}
                  </span>
                </div>
              </div>

              <div className="rounded-lg border border-indigo-500/20 bg-indigo-500/5 px-4 py-3 flex items-start gap-2">
                <Fingerprint size={14} className="text-indigo-400 mt-0.5 shrink-0" />
                <p className="text-xs text-indigo-300/80">
                  Creating a team requires device verification (WebAuthn). Your browser will prompt you to authenticate.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-between border-t border-white/10 px-6 py-3">
          <button
            onClick={step === 1 ? handleClose : () => setStep(1)}
            className="flex items-center gap-1 text-xs text-white/40 hover:text-white/70 transition-colors"
          >
            {step === 1 ? "Cancel" : <><ChevronLeft size={13} /> Back</>}
          </button>

          {step === 1 ? (
            <button
              onClick={() => setStep(2)}
              disabled={!name.trim()}
              className="flex items-center gap-1 rounded-lg px-4 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Next <ChevronRight size={13} />
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={submitting || stepUpBusy}
              className="flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40 transition-colors"
            >
              {stepUpBusy ? (
                <><Fingerprint size={13} className="animate-pulse" /> Verifying…</>
              ) : submitting ? (
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
