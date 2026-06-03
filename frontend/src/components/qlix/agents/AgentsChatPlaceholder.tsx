"use client";

import { Bot, ChevronRight, MessageSquare } from "lucide-react";
import type { AgentDTO } from "@/lib/agents-api";
import { AgentStatusBadge, deriveAgentDisplayStatus, formatDidCompact } from "./agentStatus";
import { cn } from "@/lib/utils/cn";

export function AgentsChatPlaceholder({
  agents,
  onSelect,
}: {
  readonly agents: readonly AgentDTO[];
  readonly onSelect: (id: string) => void;
}) {
  return (
    <div className="agents-chat-placeholder relative flex h-[calc(100vh-10rem)] min-h-[520px] flex-col overflow-hidden rounded-xl border border-violet-500/15 bg-gradient-to-b from-violet-950/20 via-[--bg-elevated] to-cyan-950/15 shadow-[0_8px_40px_rgba(99,102,241,0.08)] ring-1 ring-inset ring-violet-400/10 dark:from-violet-950/35 dark:to-cyan-950/25">
      <div className="pointer-events-none absolute -left-24 top-0 size-64 rounded-full bg-violet-500/20 blur-3xl agents-empty-orb" aria-hidden />
      <div
        className="pointer-events-none absolute -right-16 bottom-12 size-56 rounded-full bg-cyan-500/15 blur-3xl agents-empty-orb"
        style={{ animationDelay: "1.2s" }}
        aria-hidden
      />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-violet-400/40 to-transparent" />

      <div className="relative flex flex-1 flex-col items-center justify-center px-6 pt-10 text-center">
        <div className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500/25 to-cyan-500/20 ring-1 ring-violet-400/30 shadow-lg shadow-violet-500/15">
          <MessageSquare className="size-8 text-violet-400 dark:text-cyan-300" aria-hidden />
        </div>
        <h2 className="mt-6 text-[15px] font-semibold tracking-tight text-[--text-primary]">Select an agent to chat</h2>
        <p className="mt-2 max-w-sm text-[13px] leading-relaxed text-[--text-secondary]">
          Streaming replies, tool activity, and optional org brain context — pick an agent below or from the registry.
        </p>
      </div>

      {agents.length > 0 ? (
        <div className="relative mt-8 w-full max-w-md px-6 pb-8">
          <p className="mb-3 text-center text-[10px] font-semibold uppercase tracking-wider text-[--text-tertiary]">
            Quick open
          </p>
          <ul className="space-y-2">
            {agents.slice(0, 6).map((a, i) => (
              <li key={a.id} className="agents-list-row" style={{ animationDelay: `${i * 50}ms` }}>
                <button
                  type="button"
                  onClick={() => onSelect(a.id)}
                  className={cn(
                    "group flex w-full items-center gap-3 rounded-xl border border-[--border-subtle] bg-[--bg-base]/80 px-3 py-2.5 text-left",
                    "motion-safe:transition-all motion-safe:duration-200 hover:border-violet-400/40 hover:bg-violet-500/10 hover:shadow-md hover:shadow-violet-500/10",
                  )}
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500/20 to-cyan-500/15 ring-1 ring-violet-400/20">
                    <Bot className="size-4 text-violet-600 dark:text-violet-300" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-[--text-primary] group-hover:text-violet-700 dark:group-hover:text-violet-200">
                      {a.name}
                    </span>
                    <span className="mt-0.5 block font-mono text-[10px] text-[--text-tertiary]">
                      {formatDidCompact(a.did)}
                    </span>
                  </span>
                  <AgentStatusBadge status={deriveAgentDisplayStatus(a)} />
                  <ChevronRight
                    className="size-4 shrink-0 text-[--text-tertiary] motion-safe:transition-transform group-hover:translate-x-0.5 group-hover:text-violet-500"
                    aria-hidden
                  />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
