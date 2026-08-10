"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { AlertTriangle, Check, ChevronDown, Globe, Loader2, ShieldCheck, Sparkles, Users } from "lucide-react";
import {
  type ActivityStep,
  getActiveSubagentsFromSteps,
  getActiveToolsFromSteps,
  getPendingJitStep,
  hasActiveSubagents,
  toolCategoryIcon,
} from "@/components/qlix/agents/agentToolActivity";
import { cn } from "@/lib/utils/cn";

function hostnameOf(url: string): string {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h.startsWith("www.") ? h.slice(4) : h;
  } catch {
    return url;
  }
}

/**
 * Chat-native activity stream. Steps appear as a lightly faded "thinking" feed —
 * minimal lines with icon + label, no heavy borders. Collapses to a pill summary
 * once the run finishes; click to expand.
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
  const activeSubagents = getActiveSubagentsFromSteps(steps);
  const activeSubIds = new Set(activeSubagents.map((s) => s.invocationId));
  // Keep the feed open while approval is outstanding or a sub-agent is still working.
  const keepOpen = running || Boolean(jitPending) || activeSubagents.length > 0;

  const [collapsed, setCollapsed] = useState(!keepOpen && !defaultOpen);
  const prevKeepOpen = useRef(keepOpen);
  useEffect(() => {
    if (keepOpen && !prevKeepOpen.current) setCollapsed(false);
    else if (!keepOpen && prevKeepOpen.current) setCollapsed(true);
    prevKeepOpen.current = keepOpen;
  }, [keepOpen]);

  if (steps.length === 0) return null;

  const lastStepIdx = steps.length - 1;

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        className={cn(
          "mb-2 flex items-center gap-1.5 text-[10px] transition-opacity hover:opacity-90",
          jitPending
            ? "rounded-md border border-amber-600/30 bg-amber-500/15 px-2 py-1 font-medium text-amber-950 opacity-100"
            : "text-[--text-tertiary] opacity-50 hover:opacity-80",
          className,
        )}
      >
        {jitPending ? (
          <ShieldCheck className="size-3 shrink-0 text-amber-700" aria-hidden />
        ) : (
          <Check className="size-3" aria-hidden />
        )}
        <span>
          {jitPending
            ? "Waiting for your approval"
            : `${steps.length} step${steps.length === 1 ? "" : "s"}`}
        </span>
        <ChevronDown className="size-3 shrink-0" aria-hidden />
      </button>
    );
  }

  return (
    <div className={cn("relative mb-2 pl-3", className)}>
      {/* Left thinking line — a light travels down it while the agent works */}
      <span
        className={cn(
          "pointer-events-none absolute bottom-0 left-0 top-0 w-px overflow-hidden transition-colors duration-500",
          running || activeSubagents.length > 0 ? "bg-[--accent]/25" : "bg-[--border-subtle]/60",
        )}
        aria-hidden
      >
        {(running || activeSubagents.length > 0) && !reduceMotion ? (
          <span className="qlix-think-line-travel absolute left-0 h-7 w-px" />
        ) : null}
      </span>

      <AnimatePresence initial={false}>
        {steps.map((s, i) => {
          const isLiveSubagent =
            s.kind === "subagent_running" &&
            Boolean(s.subagentInvocationId) &&
            activeSubIds.has(s.subagentInvocationId!);
          const active = (running && i === lastStepIdx) || isLiveSubagent;
          const isError = s.tone === "error";
          const isJitPending = s.kind === "jit_pending" && Boolean(jitPending) && s.id === jitPending?.id;
          const Icon = isError
            ? AlertTriangle
            : isJitPending
              ? ShieldCheck
              : s.kind === "subagent_running" || s.kind === "subagent_done" || s.category === "subagent"
                ? Users
                : s.category
                  ? toolCategoryIcon(s.category)
                  : Sparkles;

          return (
            <motion.div
              key={s.id}
              layout={!reduceMotion}
              initial={reduceMotion ? false : { opacity: 0, y: 3 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? undefined : { opacity: 0 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className={cn(
                "flex items-baseline gap-1.5 py-[3px] text-[11px] transition-opacity duration-300",
                isError
                  ? "opacity-80 text-red-400/90"
                  : isJitPending
                    ? "rounded-md bg-amber-500/15 px-1.5 py-1 -ml-1.5 opacity-100 font-medium text-amber-950"
                    : isLiveSubagent || active
                      ? "opacity-100 text-[--text-primary]"
                      : "opacity-40 text-[--text-secondary]",
              )}
            >
              <span className="flex size-3.5 shrink-0 translate-y-px items-center justify-center">
                {(active || isLiveSubagent) && (running || isLiveSubagent) && !isJitPending && !reduceMotion ? (
                  <span className="relative flex size-2 items-center justify-center" aria-hidden>
                    <span className="qlix-orb-ping absolute inline-flex size-2 rounded-full bg-[--accent]/60" />
                    <span className="qlix-orb-core relative inline-flex size-[7px] rounded-full bg-[--accent]" />
                  </span>
                ) : (
                  <Icon className={cn("size-3", isJitPending && "text-amber-700")} aria-hidden />
                )}
              </span>
              <span className="flex min-w-0 flex-1 flex-col leading-snug">
                <span>
                  <span
                    className={cn(
                      (active || isLiveSubagent) &&
                        (running || isLiveSubagent) &&
                        !isJitPending &&
                        !reduceMotion &&
                        "qlix-text-shimmer",
                    )}
                  >
                    {s.label}
                  </span>
                  {s.detail && s.detail !== s.toolId ? (
                    <span className="opacity-60"> · {s.detail}</span>
                  ) : null}
                </span>
                {s.sources && s.sources.length > 0 ? (
                  <span className="mt-1 flex flex-col gap-0.5">
                    {s.sources.map((src) => (
                      <a
                        key={src.url}
                        href={src.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={src.url}
                        className="inline-flex items-center gap-1 text-[10px] text-[--accent] hover:underline"
                      >
                        <Globe className="size-2.5 shrink-0" aria-hidden />
                        <span className="truncate">{src.title ?? hostnameOf(src.url)}</span>
                      </a>
                    ))}
                  </span>
                ) : null}
              </span>
            </motion.div>
          );
        })}
      </AnimatePresence>

      {/* Collapse toggle when not running and not waiting on approval */}
      {!keepOpen && (
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          className="mt-0.5 flex items-center gap-1 text-[9px] text-[--text-tertiary] opacity-30 transition-opacity hover:opacity-60"
        >
          <ChevronDown className="size-2.5 rotate-180" aria-hidden />
          <span>collapse</span>
        </button>
      )}
    </div>
  );
}

export function LiveToolBar({ steps }: { readonly steps: ActivityStep[] }) {
  const active = getActiveToolsFromSteps(steps);
  const jitPending = getPendingJitStep(steps);
  const subagents = getActiveSubagentsFromSteps(steps);
  if (active.length === 0 && !jitPending && subagents.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {jitPending ? (
        <div
          role="status"
          aria-live="polite"
          className="flex items-start gap-2 rounded-lg border-2 border-amber-600/40 bg-amber-500/15 px-3 py-2.5"
        >
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-amber-700" aria-hidden />
          <div className="min-w-0 text-[11px] leading-snug text-amber-950">
            <span className="font-semibold">{jitPending.label}</span>
            {jitPending.detail ? (
              <span className="mt-0.5 block text-[10px] opacity-90">{jitPending.detail}</span>
            ) : null}
          </div>
        </div>
      ) : null}
      {subagents.length > 0 ? (
        <div
          role="status"
          aria-live="polite"
          className="flex flex-wrap items-center gap-2 rounded-lg border border-[--accent]/30 bg-[--accent]/10 px-3 py-2"
        >
          <Loader2 className="size-3.5 shrink-0 animate-spin text-[--accent]" aria-hidden />
          <Users className="size-3.5 shrink-0 text-[--accent]" aria-hidden />
          <span className="text-[11px] font-medium text-[--text-primary]">
            {subagents.length === 1 ? "Sub-agent running" : `${subagents.length} sub-agents running`}
          </span>
          {subagents.map((s) => (
            <span
              key={s.invocationId}
              className="inline-flex max-w-[14rem] items-center gap-1 truncate rounded-full bg-black/20 px-2 py-0.5 text-[10px] font-medium text-[--text-primary] ring-1 ring-[--border-subtle]"
              title={s.detail}
            >
              <span className="truncate">{s.label}</span>
            </span>
          ))}
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

export { hasActiveSubagents };
