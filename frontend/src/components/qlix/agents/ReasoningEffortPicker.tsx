"use client";

import { cn } from "@/lib/utils/cn";
import {
  REASONING_EFFORT_OPTIONS,
  type ReasoningEffort,
} from "@/lib/agents-api";

const INK_SOFT = "text-[color:var(--ink-soft)]";
const HAIRLINE = "border-[color:var(--ink-border)]";

export function ReasoningEffortPicker({
  value,
  onChange,
  disabled,
  size = "default",
}: {
  readonly value: ReasoningEffort | null;
  readonly onChange: (next: ReasoningEffort | null) => void;
  readonly disabled?: boolean;
  readonly size?: "default" | "compact";
}) {
  const compact = size === "compact";
  return (
    <label className={cn("inline-flex items-center gap-1.5", compact ? "text-[11px]" : "text-[12px]", INK_SOFT)}>
      <span className="shrink-0">Thinking</span>
      <select
        value={value ?? ""}
        disabled={disabled}
        onChange={(event) => {
          const next = event.target.value;
          onChange(next ? (next as ReasoningEffort) : null);
        }}
        className={cn(
          "bg-transparent text-black outline-none disabled:opacity-50",
          compact
            ? "max-w-[9.5rem] truncate text-[11px]"
            : cn("rounded-xl border bg-white/70 px-2.5 py-1.5 text-[12.5px]", HAIRLINE),
        )}
      >
        {REASONING_EFFORT_OPTIONS.map((option) => (
          <option key={option.value || "auto"} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
