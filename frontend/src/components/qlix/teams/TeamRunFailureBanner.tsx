"use client";

import { AlertCircle } from "lucide-react";
import type { TeamRunFailure } from "@/lib/team-run-failures";
import { cn } from "@/lib/utils/cn";

export function TeamRunFailureBanner({
  failure,
  className,
}: {
  failure: TeamRunFailure;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "rounded-xl border border-red-500/20 bg-red-50/90 px-4 py-3 text-red-950",
        className,
      )}
    >
      <div className="flex items-start gap-2.5">
        <AlertCircle className="mt-0.5 size-4 shrink-0 text-red-600" aria-hidden />
        <div className="min-w-0 space-y-2">
          <div>
            <p className="text-[13px] font-medium text-red-900">{failure.title}</p>
            <p className="mt-1 text-[13px] leading-relaxed text-red-800/95">{failure.message}</p>
          </div>
          {failure.reason ? (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-red-700/80">
                Why
              </p>
              <p className="mt-0.5 text-[12px] leading-relaxed text-red-800/90">{failure.reason}</p>
            </div>
          ) : null}
          {failure.hint ? (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-red-700/80">
                What to do
              </p>
              <p className="mt-0.5 text-[12px] leading-relaxed text-red-800/90">{failure.hint}</p>
            </div>
          ) : null}
          {failure.agentName ? (
            <p className="text-[11px] text-red-700/75">
              Failed stage: <span className="font-medium">{failure.agentName}</span>
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
