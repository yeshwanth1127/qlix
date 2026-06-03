"use client";

import type { PermissionScope } from "@/lib/agents-api";
import { ALL_PERMISSION_SCOPES, PERMISSION_SCOPE_LABELS } from "@/lib/agents-api";
import { cn } from "@/lib/utils/cn";

interface DelegatedScopePickerProps {
  readonly availableScopes: PermissionScope[];
  readonly selected: PermissionScope[];
  readonly onChange: (scopes: PermissionScope[]) => void;
  readonly disabled?: boolean;
}

export function DelegatedScopePicker({
  availableScopes,
  selected,
  onChange,
  disabled,
}: DelegatedScopePickerProps) {
  const available = new Set(availableScopes);
  const selectedSet = new Set(selected);

  const toggle = (scope: PermissionScope) => {
    if (!available.has(scope)) return;
    const next = new Set(selectedSet);
    if (next.has(scope)) next.delete(scope);
    else next.add(scope);
    onChange(Array.from(next));
  };

  return (
    <div className="flex flex-wrap gap-2">
      {ALL_PERMISSION_SCOPES.filter((s) => available.has(s)).map((scope) => {
        const on = selectedSet.has(scope);
        return (
          <button
            key={scope}
            type="button"
            disabled={disabled}
            onClick={() => toggle(scope)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-[11px] transition-colors disabled:opacity-40",
              on
                ? "border-indigo-400/50 bg-indigo-500/15 text-indigo-200"
                : "border-white/10 bg-white/5 text-white/45 hover:border-white/20",
            )}
          >
            {PERMISSION_SCOPE_LABELS[scope]}
          </button>
        );
      })}
    </div>
  );
}
