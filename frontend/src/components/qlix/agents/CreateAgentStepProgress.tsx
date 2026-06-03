"use client";

import { useEffect, useState } from "react";
import { Bot, Check, Cloud, Fingerprint, Loader2, Shield, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export type CreateAgentFlowStep = 1 | 2 | 3 | 4 | 5 | "result";

const FLOW_STEPS = [
  { label: "Identity", hint: "Name & scopes", Icon: Bot },
  { label: "Access", hint: "JIT policy", Icon: Shield },
  { label: "Runtime", hint: "Where it runs", Icon: Cloud },
  { label: "Verify", hint: "Passkey", Icon: Fingerprint },
  { label: "Create", hint: "Issue agent", Icon: Sparkles },
] as const;

function flowIndex(step: CreateAgentFlowStep): number {
  if (step === "result") return FLOW_STEPS.length;
  return step - 1;
}

function progressPercent(step: CreateAgentFlowStep): number {
  if (step === "result") return 100;
  if (step === 5) return 92;
  return ((step - 1) / (FLOW_STEPS.length - 1)) * 100;
}

export function CreateAgentStepProgress({
  step,
  creating,
}: {
  readonly step: CreateAgentFlowStep;
  readonly creating?: boolean;
}) {
  const activeIdx = flowIndex(step);
  const pct = progressPercent(step);
  const complete = step === "result";

  return (
    <div className="border-b border-[--border-subtle] bg-gradient-to-b from-violet-500/[0.06] via-transparent to-cyan-500/[0.04] px-5 py-4 dark:from-violet-500/10 dark:to-cyan-500/5">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-violet-700/90 dark:text-violet-300/90">
          {complete ? "Agent ready" : creating ? "Creating agent…" : "Setup progress"}
        </p>
        <span className="font-mono text-[10px] tabular-nums text-[--text-tertiary]">
          {complete ? "100%" : `${Math.round(pct)}%`}
        </span>
      </div>
      <div className="relative h-1.5 overflow-hidden rounded-full bg-violet-950/10 dark:bg-violet-950/40">
        <div
          className="create-agent-progress-fill absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-violet-600 via-indigo-500 to-cyan-500 shadow-[0_0_12px_rgba(99,102,241,0.45)] motion-safe:transition-[width] motion-safe:duration-500 motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)] dark:from-violet-500 dark:via-indigo-400 dark:to-cyan-400"
          style={{ width: `${pct}%` }}
        />
        {!complete && creating ? (
          <span
            className="create-agent-progress-shimmer pointer-events-none absolute inset-y-0 w-1/3 rounded-full bg-gradient-to-r from-transparent via-white/50 to-transparent dark:via-white/25"
            aria-hidden
          />
        ) : null}
      </div>

      <ol className="mt-4 grid grid-cols-5 gap-1" aria-label="Create agent steps">
        {FLOW_STEPS.map((s, i) => {
          const done = complete || i < activeIdx;
          const current = !complete && i === activeIdx;
          const upcoming = !done && !current;
          const Icon = s.Icon;

          return (
            <li key={s.label} className="flex flex-col items-center text-center">
              <div className="relative flex w-full items-center justify-center">
                {i > 0 ? (
                  <span
                    className={cn(
                      "absolute right-1/2 top-1/2 h-0.5 w-full -translate-y-1/2 motion-safe:transition-colors motion-safe:duration-500",
                      done ? "bg-gradient-to-r from-violet-500/80 to-cyan-500/80" : "bg-[--border-subtle]",
                    )}
                    aria-hidden
                  />
                ) : null}
                <span
                  className={cn(
                    "relative z-[1] flex size-8 items-center justify-center rounded-full border-2 motion-safe:transition-all motion-safe:duration-300",
                    done &&
                      "border-emerald-500/60 bg-emerald-500/15 text-emerald-600 shadow-[0_0_0_3px_rgba(16,185,129,0.12)] dark:text-emerald-400",
                    current &&
                      !creating &&
                      "scale-110 border-violet-500 bg-gradient-to-br from-violet-500 to-indigo-600 text-white shadow-lg shadow-violet-500/35 ring-2 ring-violet-400/30",
                    current &&
                      creating &&
                      "border-cyan-500/70 bg-cyan-500/15 text-cyan-600 dark:text-cyan-300",
                    upcoming && "border-[--border-default] bg-[--bg-base] text-[--text-tertiary]",
                  )}
                >
                  {done ? (
                    <Check className="size-3.5 stroke-[2.5]" aria-hidden />
                  ) : current && creating ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Icon className="size-3.5" aria-hidden />
                  )}
                </span>
              </div>
              <span
                className={cn(
                  "mt-1.5 block w-full truncate text-[10px] font-semibold leading-tight motion-safe:transition-colors motion-safe:duration-300",
                  done && "text-emerald-700 dark:text-emerald-400",
                  current && "text-violet-700 dark:text-violet-300",
                  upcoming && "text-[--text-tertiary]",
                )}
              >
                {s.label}
              </span>
              <span className="mt-0.5 hidden w-full truncate text-[9px] text-[--text-tertiary] sm:block">{s.hint}</span>
            </li>
          );
        })}
      </ol>
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
