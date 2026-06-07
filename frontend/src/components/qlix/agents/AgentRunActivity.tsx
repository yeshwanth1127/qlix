"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, ChevronDown, Loader2, ShieldCheck, Sparkles } from "lucide-react";
import {
  type ActivityStep,
  type ToolCategory,
  getActiveToolsFromSteps,
  getPendingJitStep,
  toolCategoryIcon,
} from "@/components/qlix/agents/agentToolActivity";
import { cn } from "@/lib/utils/cn";

/** Per-category chip styling for the small step icon. */
function categoryDotClass(category: ToolCategory | undefined): string {
  switch (category) {
    case "browser":
      return "bg-sky-500/15 ring-sky-500/30 text-sky-600 dark:text-sky-300";
    case "brain":
      return "bg-violet-500/15 ring-violet-500/30 text-violet-600 dark:text-violet-300";
    case "system":
      return "bg-amber-500/10 ring-amber-500/25 text-amber-700 dark:text-amber-200";
    case "agents3":
      return "bg-emerald-500/12 ring-emerald-500/30 text-emerald-700 dark:text-emerald-300";
    case "approval":
      return "bg-amber-500/15 ring-amber-500/35 text-amber-800 dark:text-amber-100";
    default:
      return "bg-[var(--glass-muted-bg)] ring-[--border-subtle] text-[--text-secondary]";
  }
}

/**
 * Collapsible, animated agent-activity log. While `running`, it auto-expands and
 * shows the live tools in the header; when the run finishes it collapses to a
 * single summary line that the user can re-open. Pass `defaultOpen` to control the
 * initial state for non-streaming contexts (run history stays expanded).
 */
export function ActivityTimeline({
  steps,
  running = false,
  defaultOpen = true,
  className,
}: {
  readonly steps: ActivityStep[];
  readonly running?: boolean;
  readonly defaultOpen?: boolean;
  readonly className?: string;
}) {
  const reduceMotion = useReducedMotion() ?? false;
  const jitPending = getPendingJitStep(steps);
  const activeTools = running ? getActiveToolsFromSteps(steps) : [];

  const [open, setOpen] = useState(running || defaultOpen);
  const prevRunning = useRef(running);
  useEffect(() => {
    // Auto-open when a run starts, auto-collapse to the summary when it ends.
    if (running && !prevRunning.current) setOpen(true);
    else if (!running && prevRunning.current) setOpen(false);
    prevRunning.current = running;
  }, [running]);

  if (steps.length === 0) return null;

  const lastStepIdx = steps.length - 1;

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-[--border-subtle] bg-black/20",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-white/[0.03]"
      >
        <span
          className={cn(
            "flex size-5 shrink-0 items-center justify-center rounded-md ring-1",
            running
              ? "bg-[--accent]/12 text-[--accent] ring-[--accent]/30"
              : jitPending
                ? "bg-amber-500/15 text-amber-700 ring-amber-500/35 dark:text-amber-200"
                : "bg-emerald-500/12 text-emerald-600 ring-emerald-500/30 dark:text-emerald-300",
          )}
          aria-hidden
        >
          {running ? (
            <Loader2 className="size-3 animate-spin" />
          ) : jitPending ? (
            <ShieldCheck className="size-3" />
          ) : (
            <Check className="size-3" />
          )}
        </span>

        <span className="text-[10px] font-semibold uppercase tracking-wider text-[--text-secondary]">
          {running ? "Working" : "Agent activity"}
        </span>

        <span className="min-w-0 flex-1 truncate">
          {running && activeTools.length > 0 ? (
            <span className="inline-flex flex-wrap items-center gap-1 align-middle">
              {activeTools.slice(0, 3).map((t) => {
                const Icon = toolCategoryIcon(t.category);
                return (
                  <span
                    key={t.toolId}
                    className="inline-flex items-center gap-1 rounded-full bg-black/25 px-1.5 py-0.5 text-[9px] font-medium text-[--text-primary] ring-1 ring-[--border-subtle]"
                  >
                    <Icon className="size-2.5 text-[--accent]" aria-hidden />
                    {t.short}
                  </span>
                );
              })}
              {activeTools.length > 3 ? (
                <span className="text-[9px] text-[--text-tertiary]">+{activeTools.length - 3}</span>
              ) : null}
            </span>
          ) : null}
        </span>

        <span className="shrink-0 font-mono text-[9px] tabular-nums text-[--text-tertiary]">
          {steps.length} step{steps.length === 1 ? "" : "s"}
        </span>
        <ChevronDown
          className={cn(
            "size-3.5 shrink-0 text-[--text-tertiary] transition-transform duration-200",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="body"
            initial={reduceMotion ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={reduceMotion ? undefined : { height: 0, opacity: 0 }}
            transition={{ duration: 0.24, ease: "easeInOut" }}
            className="overflow-hidden border-t border-[--border-subtle]"
          >
            <ol className="relative px-3 pb-2.5 pt-1.5">
              <span
                className="pointer-events-none absolute bottom-4 left-[1.375rem] top-4 w-px bg-[--border-subtle]"
                aria-hidden
              />
              <AnimatePresence initial={false}>
                {steps.map((s, i) => {
                  const active = running && i === lastStepIdx;
                  const Icon = s.category ? toolCategoryIcon(s.category) : Sparkles;
                  return (
                    <motion.li
                      key={s.id}
                      layout={!reduceMotion}
                      initial={reduceMotion ? false : { opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={reduceMotion ? undefined : { opacity: 0, x: 6 }}
                      transition={{ duration: 0.22, ease: "easeOut" }}
                      className="relative flex gap-2.5 py-1.5"
                    >
                      <span
                        className={cn(
                          "relative z-10 mt-px flex size-5 shrink-0 items-center justify-center rounded-md ring-1",
                          categoryDotClass(s.category),
                        )}
                        aria-hidden
                      >
                        <Icon className="size-3" />
                        {active && !reduceMotion ? (
                          <motion.span
                            className="absolute inset-0 rounded-md ring-1 ring-[--accent]/60"
                            initial={{ opacity: 0.7, scale: 1 }}
                            animate={{ opacity: 0, scale: 1.6 }}
                            transition={{ duration: 1.2, repeat: Infinity, ease: "easeOut" }}
                          />
                        ) : null}
                      </span>
                      <div className="min-w-0 flex-1">
                        <span
                          className={cn(
                            "text-[11px] font-medium leading-snug",
                            active ? "text-[--text-primary]" : "text-[--text-primary]/90",
                          )}
                        >
                          {s.label}
                        </span>
                        {s.detail ? (
                          <span className="mt-0.5 block text-[10px] leading-snug text-[--text-secondary]">
                            {s.detail}
                          </span>
                        ) : null}
                        {s.toolId ? (
                          <span className="mt-0.5 block font-mono text-[9px] text-[--text-tertiary]">
                            {s.toolId}
                          </span>
                        ) : null}
                      </div>
                    </motion.li>
                  );
                })}
              </AnimatePresence>
            </ol>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export function LiveToolBar({ steps }: { readonly steps: ActivityStep[] }) {
  const active = getActiveToolsFromSteps(steps);
  const jitPending = getPendingJitStep(steps);
  if (active.length === 0 && !jitPending) return null;
  return (
    <div className="flex flex-col gap-2">
      {jitPending ? (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-200" aria-hidden />
          <div className="min-w-0 text-[11px] leading-snug text-amber-950 dark:text-amber-50">
            <span className="font-semibold">{jitPending.label}</span>
            {jitPending.detail ? (
              <span className="mt-0.5 block text-[10px] opacity-90">{jitPending.detail}</span>
            ) : null}
          </div>
        </div>
      ) : null}
      {active.length > 0 ? (
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
      ) : null}
    </div>
  );
}
