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
    <div className="flex items-start gap-3 py-2.5">
      <div className="mt-0.5 flex size-5 shrink-0 items-center justify-center">
        {step.status === "active" && (
          <Loader2 className="size-4 animate-spin text-[--accent]" aria-hidden />
        )}
        {step.status === "done" && (
          <span className="flex size-5 items-center justify-center rounded-full bg-emerald-500/20">
            <Check className="size-3 text-emerald-400" aria-hidden />
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
      <div className="min-w-0">
        <span
          className={cn(
            "text-[12px]",
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
      </div>
    </div>
  );
}

export function NLCreationProgress({ steps }: NLCreationProgressProps) {
  return (
    <div className="space-y-2">
      <p className="text-[12px] text-[--text-secondary]">Building your agents…</p>
      <div className="divide-y divide-[--border-subtle] rounded-lg border border-[--border-subtle] bg-[--bg-subtle]/40 px-4">
        {steps.map((step, i) => (
          <StepRow key={i} step={step} />
        ))}
      </div>
    </div>
  );
}
