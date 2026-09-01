"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, ChevronDown, Globe, Loader2, ShieldCheck, Wrench, Users } from "lucide-react";
import {
  type ActivityStep,
  collapseRetriedActivity,
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

/** Compact run details that stay open while work is active and collapse when done. */
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
  const visibleSteps = collapseRetriedActivity(steps);
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

  if (visibleSteps.length === 0) return null;

  const lastStepIdx = visibleSteps.length - 1;

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        className={cn(
          "mb-2 flex items-center gap-1.5 text-[11px] transition-colors hover:text-black/70",
          jitPending
            ? "font-medium text-black/70 opacity-100"
            : "text-black/40",
          className,
        )}
      >
        {jitPending ? (
          <ShieldCheck className="size-3 shrink-0 text-black/50" aria-hidden />
        ) : (
          <Check className="size-3" aria-hidden />
        )}
        <span>
          {jitPending
            ? "Waiting for your approval"
            : `Run details · ${visibleSteps.length} step${visibleSteps.length === 1 ? "" : "s"}`}
        </span>
        <ChevronDown className="size-3 shrink-0" aria-hidden />
      </button>
    );
  }

  return (
    <div className={cn("mb-3 border-l border-black/10 pl-3", className)}>
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-black/55">
        {keepOpen ? <Loader2 className="size-3 animate-spin" aria-hidden /> : <Check className="size-3" aria-hidden />}
        <span>{keepOpen ? "Working" : "Run details"}</span>
      </div>
      <div>
        {visibleSteps.map((s, i) => {
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
                  : Wrench;

          return (
            <div
              key={s.id}
              className={cn(
                "flex items-baseline gap-1.5 py-0.5 text-[11px]",
                isError
                  ? "text-red-700/75"
                  : isJitPending
                    ? "opacity-100 font-medium text-black/80"
                    : isLiveSubagent || active
                      ? "text-black/75"
                      : "text-black/40",
              )}
            >
              <span className="flex size-3.5 shrink-0 translate-y-px items-center justify-center">
                {(active || isLiveSubagent) && (running || isLiveSubagent) && !isJitPending ? (
                  <Loader2 className="size-3 animate-spin text-black/55" aria-hidden />
                ) : (
                  <Icon className={cn("size-3", isJitPending && "text-black/55")} aria-hidden />
                )}
              </span>
              <span className="flex min-w-0 flex-1 flex-col leading-snug">
                <span>
                  <span>{s.label}</span>
                  {s.detail && s.detail !== s.toolId && !isJitPending ? (
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
            </div>
          );
        })}
      </div>

      {/* Collapse toggle when not running and not waiting on approval */}
      {!keepOpen && (
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          className="mt-1 flex items-center gap-1 text-[10px] text-black/35 transition-colors hover:text-black/60"
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
  const subagents = getActiveSubagentsFromSteps(steps);
  if (active.length === 0 && subagents.length === 0) return null;

  const summary = subagents.length > 0
    ? `${subagents.length} sub-agent${subagents.length === 1 ? "" : "s"} working`
    : active.length === 1
      ? `Running ${active[0]?.short ?? "tool"}`
      : `${active.length} tools running`;

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-1.5 text-[11px] text-black/55"
    >
      <Loader2 className="size-3 animate-spin" aria-hidden />
      <span>{summary}</span>
    </div>
  );
}

export { hasActiveSubagents };
