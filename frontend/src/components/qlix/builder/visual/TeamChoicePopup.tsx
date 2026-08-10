"use client";

import { useState } from "react";
import { Crown, Share2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";

const HAIRLINE = "border-[color:var(--ink-border)]";
const INK_SOFT = "text-[color:var(--ink-soft)]";
const INK_FAINT = "text-[color:var(--ink-faint)]";
const MICRO = "text-[10px] font-medium uppercase tracking-[0.16em]";

export interface TeamChoice {
  kind: "team" | "peers";
  name: string;
}

export interface TeamChoicePopupProps {
  /** How many agents the new connection wired together. */
  readonly memberCount: number;
  readonly defaultName: string;
  readonly onChoose: (choice: TeamChoice) => void;
  /** Cancelling removes the edge, so no unlabelled cluster is left behind. */
  readonly onCancel: () => void;
}

/**
 * Asked once, the moment two or more agents become wired together.
 *
 * The two answers mean genuinely different things, so the canvas asks rather than guessing:
 * a team has a lead that hands out steps and can be run, while peers are independent agents
 * that only pass messages. Copy must not imply peers can run — there is no runtime for
 * agent-to-agent work outside a team yet (`A2ATask` requires a `teamId`).
 */
export function TeamChoicePopup({
  memberCount,
  defaultName,
  onChoose,
  onCancel,
}: TeamChoicePopupProps) {
  const [name, setName] = useState(defaultName);
  const trimmed = name.trim();

  return (
    <div
      role="dialog"
      aria-label="How should these agents work together?"
      className={cn(
        "w-72 rounded-2xl border bg-white/90 p-3 shadow-[0_16px_40px_-18px_rgba(16,14,22,0.55)] backdrop-blur-md",
        HAIRLINE,
      )}
    >
      <p className={cn(MICRO, "text-black")}>{memberCount} agents connected</p>
      <p className={cn("mt-1 text-[12px] leading-relaxed", INK_SOFT)}>
        How should they work together?
      </p>

      <label className="mt-2.5 block">
        <span className={cn(MICRO, INK_FAINT)}>Name</span>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoFocus
          maxLength={120}
          className={cn(
            "mt-1 w-full rounded-xl border bg-white/80 px-2.5 py-1.5 text-[12.5px] text-black outline-none transition-colors focus:border-[color:var(--sketch-purple)]/55",
            HAIRLINE,
          )}
        />
      </label>

      <div className="mt-2.5 flex flex-col gap-1.5">
        <button
          type="button"
          disabled={!trimmed}
          onClick={() => onChoose({ kind: "team", name: trimmed })}
          className={cn(
            "flex items-start gap-2 rounded-xl border px-2.5 py-2 text-left transition-colors hover:border-[color:var(--sketch-purple)]/55 hover:bg-white disabled:pointer-events-none disabled:opacity-40",
            HAIRLINE,
          )}
        >
          <Crown size={12} className="mt-0.5 shrink-0 text-black" aria-hidden />
          <span className="min-w-0">
            <span className="block text-[12px] font-medium text-black">Make them a team</span>
            <span className={cn("block text-[11px] leading-relaxed", INK_SOFT)}>
              One agent leads and hands out the steps.
            </span>
          </span>
        </button>

        <button
          type="button"
          disabled={!trimmed}
          onClick={() => onChoose({ kind: "peers", name: trimmed })}
          className={cn(
            "flex items-start gap-2 rounded-xl border px-2.5 py-2 text-left transition-colors hover:border-[color:var(--sketch-purple)]/55 hover:bg-white disabled:pointer-events-none disabled:opacity-40",
            HAIRLINE,
          )}
        >
          <Share2 size={12} className="mt-0.5 shrink-0 text-black" aria-hidden />
          <span className="min-w-0">
            <span className="block text-[12px] font-medium text-black">Keep them separate</span>
            <span className={cn("block text-[11px] leading-relaxed", INK_SOFT)}>
              Agents that pass messages to each other. Can&apos;t be run yet.
            </span>
          </span>
        </button>
      </div>

      <button
        type="button"
        onClick={onCancel}
        className={cn(
          "mt-2 w-full rounded-xl px-2.5 py-1 text-[11px] transition-colors hover:bg-black/[0.05] hover:text-black",
          INK_SOFT,
        )}
      >
        Cancel — undo this connection
      </button>
    </div>
  );
}
