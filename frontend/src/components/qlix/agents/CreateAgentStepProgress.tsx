"use client";

import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils/cn";

export type CreateAgentFlowStep = 1 | 2 | 3 | 4 | 5 | "result";

const FLOW_STEPS = [
  { label: "Identity", hint: "Name & scopes" },
  { label: "Access", hint: "JIT policy" },
  { label: "Runtime", hint: "Where it runs" },
  { label: "Verify", hint: "Passkey" },
  { label: "Create", hint: "Issue agent" },
] as const;

function flowIndex(step: CreateAgentFlowStep): number {
  if (step === "result") return FLOW_STEPS.length;
  return step - 1;
}

/**
 * React Bits "Stepper" indicator row — animated circle indicators joined by
 * connectors that fill in as the user advances. Display-only (the flow gates
 * navigation through validation in the modal, so indicators are not clickable).
 */
export function CreateAgentStepProgress({
  step,
  creating,
}: {
  readonly step: CreateAgentFlowStep;
  readonly creating?: boolean;
}) {
  // 1-based "current step" matching the React Bits Stepper contract. The terminal
  // "result" state sits one past the last step so every indicator reads complete.
  const currentStep = flowIndex(step) + 1;
  const complete = step === "result";

  return (
    <div className="border-b border-[--border-subtle] bg-gradient-to-b from-violet-500/[0.06] via-transparent to-cyan-500/[0.04] px-5 py-4 dark:from-violet-500/10 dark:to-cyan-500/5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-violet-700/90 dark:text-violet-300/90">
          {complete ? "Agent ready" : creating ? "Creating agent…" : "Setup progress"}
        </p>
        <span className="font-mono text-[10px] tabular-nums text-[--text-tertiary]">
          {complete ? "5 / 5" : `${currentStep} / ${FLOW_STEPS.length}`}
        </span>
      </div>

      <div className="flex w-full items-start" aria-label="Create agent steps">
        {FLOW_STEPS.map((s, index) => {
          const stepNumber = index + 1;
          const isNotLastStep = index < FLOW_STEPS.length - 1;
          const loading = Boolean(creating) && currentStep === stepNumber;
          return (
            <div key={s.label} className="flex flex-1 items-start last:flex-none">
              <StepIndicator
                step={stepNumber}
                currentStep={currentStep}
                label={s.label}
                hint={s.hint}
                loading={loading}
              />
              {isNotLastStep ? <StepConnector isComplete={currentStep > stepNumber} /> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StepIndicator({
  step,
  currentStep,
  label,
  hint,
  loading,
}: {
  readonly step: number;
  readonly currentStep: number;
  readonly label: string;
  readonly hint: string;
  readonly loading: boolean;
}) {
  const status = currentStep === step ? "active" : currentStep < step ? "inactive" : "complete";

  return (
    <div className="relative flex flex-col items-center text-center">
      <motion.div
        className="relative flex size-8 items-center justify-center rounded-full"
        animate={status}
        initial={false}
        variants={{
          inactive: {
            scale: 1,
            backgroundColor: "color-mix(in srgb, var(--bg-base) 100%, transparent)",
            boxShadow: "inset 0 0 0 2px var(--border-default)",
          },
          active: {
            scale: 1.1,
            backgroundColor: "#6d28d9",
            boxShadow: "0 8px 18px -6px rgba(109,40,217,0.6), inset 0 0 0 2px #8b5cf6",
          },
          complete: {
            scale: 1,
            backgroundColor: "#6d28d9",
            boxShadow: "inset 0 0 0 2px #6d28d9",
          },
        }}
        transition={{ duration: 0.3 }}
      >
        {status === "complete" ? (
          <Check className="size-4 stroke-[2.5] text-white" aria-hidden />
        ) : status === "active" && loading ? (
          <Loader2 className="size-4 animate-spin text-white" aria-hidden />
        ) : status === "active" ? (
          <motion.div
            className="size-2.5 rounded-full bg-white"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ duration: 0.3 }}
          />
        ) : (
          <span className="text-[12px] font-semibold text-[--text-tertiary]">{step}</span>
        )}
      </motion.div>
      <span
        className={cn(
          "mt-1.5 block w-full truncate text-[10px] font-semibold leading-tight motion-safe:transition-colors motion-safe:duration-300",
          status === "complete" && "text-violet-700 dark:text-violet-300",
          status === "active" && "text-violet-700 dark:text-violet-200",
          status === "inactive" && "text-[--text-tertiary]",
        )}
      >
        {label}
      </span>
      <span className="mt-0.5 hidden w-full truncate text-[9px] text-[--text-tertiary] sm:block">{hint}</span>
    </div>
  );
}

function StepConnector({ isComplete }: { readonly isComplete: boolean }) {
  return (
    <div className="relative mx-1.5 mt-[15px] h-0.5 flex-1 overflow-hidden rounded-full bg-[--border-subtle]">
      <motion.div
        className="absolute left-0 top-0 h-full rounded-full bg-gradient-to-r from-violet-600 to-indigo-500"
        initial={false}
        variants={{
          incomplete: { width: 0 },
          complete: { width: "100%" },
        }}
        animate={isComplete ? "complete" : "incomplete"}
        transition={{ duration: 0.4 }}
      />
    </div>
  );
}

const SUBMIT_PHASES = [
  "Confirming passkey with your device",
  "Generating DID and keypair",
  "Issuing verifiable credentials",
  "Provisioning cloud runner",
] as const;

const HYBRID_SUBMIT_PHASES = [
  "Confirming passkey with your device",
  "Generating DID and keypair",
  "Issuing verifiable credentials",
  "Preparing hybrid daemon credentials",
] as const;

export function CreateAgentSubmitProgress({
  runtime,
}: {
  readonly runtime: "cloud" | "local" | "hybrid";
}) {
  const phases =
    runtime === "cloud"
      ? SUBMIT_PHASES
      : runtime === "hybrid"
        ? HYBRID_SUBMIT_PHASES
        : SUBMIT_PHASES.slice(0, 3);
  const [activePhase, setActivePhase] = useState(0);

  useEffect(() => {
    setActivePhase(0);
    const id = window.setInterval(() => {
      setActivePhase((p) => (p < phases.length - 1 ? p + 1 : p));
    }, 2200);
    return () => window.clearInterval(id);
  }, [phases.length]);

  return (
    <div className="create-agent-submit-panel space-y-6 py-6">
      <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500/20 via-indigo-500/15 to-cyan-500/20 ring-1 ring-violet-400/25">
        <Loader2 className="size-7 animate-spin text-violet-600 dark:text-violet-300" aria-hidden />
      </div>
      <div className="text-center">
        <p className="text-[14px] font-medium text-[--text-primary]">Creating your agent</p>
        <p className="mt-1 text-[12px] text-[--text-tertiary]">This usually takes a few seconds.</p>
      </div>
      <ul className="space-y-2.5" aria-live="polite">
        {phases.map((label, i) => {
          const active = i === activePhase;
          const done = i < activePhase;
          return (
            <li
              key={label}
              className={cn(
                "create-agent-submit-phase flex items-center gap-3 rounded-lg border px-3 py-2.5 motion-safe:transition-all motion-safe:duration-300",
                active && "border-violet-400/40 bg-violet-500/10 shadow-sm shadow-violet-500/10",
                done && "border-emerald-400/30 bg-emerald-500/5 opacity-90",
                !active && !done && "border-[--border-subtle] bg-[--bg-subtle]/60 opacity-50",
              )}
            >
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold motion-safe:transition-colors",
                  done && "bg-emerald-500/20 text-emerald-700 dark:text-emerald-400",
                  active && "bg-gradient-to-br from-violet-600 to-cyan-600 text-white",
                  !active && !done && "bg-[--bg-base] text-[--text-tertiary]",
                )}
              >
                {done ? <Check className="size-3" aria-hidden /> : i + 1}
              </span>
              <span
                className={cn(
                  "text-[12px]",
                  active && "font-medium text-[--text-primary]",
                  done && "text-[--text-secondary]",
                  !active && !done && "text-[--text-tertiary]",
                )}
              >
                {label}
              </span>
              {active ? <Loader2 className="ml-auto size-3.5 shrink-0 animate-spin text-violet-500" aria-hidden /> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
