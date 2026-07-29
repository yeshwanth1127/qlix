"use client";

import { Check, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export interface CreationStep {
  label: string;
  status: "pending" | "active" | "done" | "error";
  errorMessage?: string;
}

interface NLCreationProgressProps {
  readonly steps: CreationStep[];
}

function StepRow({ step }: { readonly step: CreationStep }) {
  return (
    <div className="flex w-[260px] shrink-0 items-start gap-3 rounded-lg border border-black/10 bg-white/60 p-3">
      <div className="mt-0.5 flex size-5 shrink-0 items-center justify-center">
        {step.status === "active" && (
          <Loader2 className="size-4 animate-spin text-[--accent]" aria-hidden />
        )}
        {step.status === "done" && (
          <span className="flex size-5 items-center justify-center rounded-full bg-black/[0.06]">
            <Check className="size-3 text-[#1c1830]" aria-hidden />
          </span>
        )}
        {step.status === "error" && (
          <span className="flex size-5 items-center justify-center rounded-full bg-[--danger]/20">
            <X className="size-3 text-[--danger]" aria-hidden />
          </span>
        )}
        {step.status === "pending" && (
          <span className="size-2 rounded-full bg-[--border-default]" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <span
          className={cn(
            "block whitespace-normal break-normal text-[12px] leading-snug",
            step.status === "active" && "font-medium text-[--text-primary]",
            step.status === "done" && "text-[--text-tertiary] line-through",
            step.status === "pending" && "text-[--text-tertiary]",
            step.status === "error" && "font-medium text-[--danger]",
          )}
        >
          {step.label}
        </span>
        {step.errorMessage && (
          <p className="mt-0.5 text-[11px] text-[--danger]">{step.errorMessage}</p>
        )}
        {step.status === "active" ? (
          <div
            className="mt-2 h-1 w-full max-w-xs overflow-hidden rounded-full bg-amber-200/70"
            role="progressbar"
            aria-label={step.label}
          >
            <div className="create-agent-progress-shimmer h-full w-1/3 rounded-full bg-amber-600" />
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function NLCreationProgress({ steps }: NLCreationProgressProps) {
  const completed = steps.filter((step) => step.status === "done" || step.status === "error").length;
  const progress = steps.length > 0 ? Math.round((completed / steps.length) * 100) : 0;

  return (
    <div className="space-y-2">
      <div className="rounded-xl border border-amber-500/25 bg-amber-50/70 p-3">
        <p className="text-[12px] font-medium text-amber-950">
          Building {steps.length > 1 ? "your agents" : "your agent"}. This might take a few minutes.
        </p>
        {steps.length > 1 ? (
          <div className="mt-2">
            <div className="mb-1 flex items-center justify-between text-[10px] text-amber-900/70">
              <span>Overall progress</span>
              <span>{completed} of {steps.length}</span>
            </div>
            <div
              className="h-1.5 overflow-hidden rounded-full bg-amber-200/80"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={steps.length}
              aria-valuenow={completed}
            >
              <div
                className="h-full rounded-full bg-amber-600 transition-[width] duration-500 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        ) : null}
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {steps.map((step, i) => (
          <StepRow key={i} step={step} />
        ))}
      </div>
    </div>
  );
}
