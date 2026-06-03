"use client";

import { Loader2, Sparkles } from "lucide-react";
import {
  type ActivityStep,
  getActiveToolsFromSteps,
  toolCategoryIcon,
} from "@/components/qlix/agents/agentToolActivity";
import { cn } from "@/lib/utils/cn";

export function ActivityTimeline({
  steps,
  className,
}: {
  readonly steps: ActivityStep[];
  readonly className?: string;
}) {
  if (steps.length === 0) return null;
  return (
    <div
      className={cn(
        "rounded-lg border border-[--border-subtle] bg-black/25 px-3 py-2.5",
        className,
      )}
    >
      <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[--text-tertiary]">
        <Sparkles className="size-3 text-[--accent]" aria-hidden />
        Agent activity
      </p>
      <ul className="space-y-2">
        {steps.map((s) => {
          const Icon = s.category ? toolCategoryIcon(s.category) : Sparkles;
          return (
            <li key={s.id} className="flex gap-2 text-[11px] leading-snug">
              <span
                className={cn(
                  "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md ring-1",
                  s.category === "browser" && "bg-sky-500/15 ring-sky-500/30 text-sky-600 dark:text-sky-300",
                  s.category === "brain" && "bg-violet-500/15 ring-violet-500/30 text-violet-600 dark:text-violet-300",
                  s.category === "system" && "bg-amber-500/10 ring-amber-500/25 text-amber-700 dark:text-amber-200",
                  s.category === "agents3" &&
                    "bg-emerald-500/12 ring-emerald-500/30 text-emerald-700 dark:text-emerald-300",
                  (!s.category || s.category === "other") &&
                    "bg-[var(--glass-muted-bg)] ring-[--border-subtle] text-[--text-secondary]",
                )}
                aria-hidden
              >
                <Icon className="size-3" />
              </span>
              <div className="min-w-0 flex-1">
                <span className="font-medium text-[--text-primary]">{s.label}</span>
                {s.detail ? (
                  <span className="mt-0.5 block text-[10px] text-[--text-secondary]">{s.detail}</span>
                ) : null}
                {s.toolId ? (
                  <span className="mt-0.5 block font-mono text-[9px] text-[--text-tertiary]">{s.toolId}</span>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function LiveToolBar({ steps }: { readonly steps: ActivityStep[] }) {
  const active = getActiveToolsFromSteps(steps);
  if (active.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[--accent]/25 bg-[--accent]/8 px-3 py-2">
      <Loader2 className="size-3.5 shrink-0 animate-spin text-[--accent]" aria-hidden />
      <span className="text-[11px] font-medium text-[--text-primary]">Running</span>
      {active.map((t) => {
        const Icon = toolCategoryIcon(t.category);
        return (
          <span
            key={t.toolId}
            className="inline-flex items-center gap-1 rounded-full bg-black/20 px-2 py-0.5 text-[10px] font-medium text-[--text-primary] ring-1 ring-[--border-subtle]"
          >
            <Icon className="size-3 text-[--accent]" aria-hidden />
            <span>{t.group}</span>
            <span className="text-[--text-tertiary]">·</span>
            <span className="text-[--text-secondary]">{t.short}</span>
          </span>
        );
      })}
    </div>
  );
}
