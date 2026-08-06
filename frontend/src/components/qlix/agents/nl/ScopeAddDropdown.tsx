"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Plus, Search, ShieldAlert } from "lucide-react";
import {
  FORCE_JIT_SCOPES,
  PERMISSION_SCOPE_LABELS,
  type PermissionScope,
} from "@/lib/agents-api";
import { sketchInput } from "@/components/qlix/sketch";

interface ScopeAddDropdownProps {
  readonly availableScopes: readonly PermissionScope[];
  /** Scopes already on the agent — used to explain search misses. */
  readonly assignedScopes?: readonly PermissionScope[];
  readonly onSelect: (scope: PermissionScope) => void;
}

interface PanelPosition {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
}

export function ScopeAddDropdown({ availableScopes, assignedScopes = [], onSelect }: ScopeAddDropdownProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [position, setPosition] = useState<PanelPosition | null>(null);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const margin = 12;
    const gap = 6;
    const width = Math.min(340, window.innerWidth - margin * 2);
    let left = rect.left;
    if (left + width > window.innerWidth - margin) {
      left = window.innerWidth - width - margin;
    }
    left = Math.max(margin, left);

    const spaceBelow = window.innerHeight - rect.bottom - margin;
    const spaceAbove = rect.top - margin;
    const openUpward = spaceBelow < 200 && spaceAbove > spaceBelow;
    const maxHeight = Math.min(280, Math.max(120, (openUpward ? spaceAbove : spaceBelow) - gap));

    setPosition({
      top: openUpward ? rect.top - gap - maxHeight : rect.bottom + gap,
      left,
      width,
      maxHeight,
    });
  }, []);

  const openMenu = () => {
    setQuery("");
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    updatePosition();
    const raf = requestAnimationFrame(() => searchRef.current?.focus());
    const onScrollOrResize = () => updatePosition();
    window.addEventListener("resize", onScrollOrResize);
    window.addEventListener("scroll", onScrollOrResize, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onScrollOrResize);
      window.removeEventListener("scroll", onScrollOrResize, true);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const assignedMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return assignedScopes.filter((scope) => {
      const label = (PERMISSION_SCOPE_LABELS[scope] ?? "").toLowerCase();
      return scope.toLowerCase().includes(q) || label.includes(q);
    });
  }, [assignedScopes, query]);

  const filteredScopes = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return availableScopes;
    return availableScopes.filter((scope) => {
      const label = (PERMISSION_SCOPE_LABELS[scope] ?? "").toLowerCase();
      return scope.toLowerCase().includes(q) || label.includes(q);
    });
  }, [availableScopes, query]);

  const handleSelect = (scope: PermissionScope) => {
    onSelect(scope);
    setOpen(false);
    setQuery("");
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => (open ? setOpen(false) : openMenu())}
        className="inline-flex items-center gap-1 border border-dashed border-black/40 bg-white px-2 py-0.5 text-[10.5px] text-black/50 transition-colors hover:border-black hover:text-black"
      >
        <Plus className="size-2.5" aria-hidden />
        Add
      </button>

      {open && position && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={panelRef}
              role="listbox"
              aria-label="Add permission scope"
              className="fixed z-[300] flex flex-col overflow-hidden border border-[color:var(--sketch-card-border,var(--qlix-card-border))] bg-white shadow-[0_16px_40px_-20px_rgba(16,14,22,0.35)]"
              style={{
                top: position.top,
                left: position.left,
                width: position.width,
                maxHeight: position.maxHeight,
              }}
            >
              <div className="shrink-0 border-b border-black/10 p-2">
                <div className="relative">
                  <Search
                    className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-black/40"
                    aria-hidden
                  />
                  <input
                    ref={searchRef}
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search scopes…"
                    className={`${sketchInput} !py-2 !pl-8 !text-[12px]`}
                  />
                </div>
              </div>
              <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1">
                {filteredScopes.length === 0 ? (
                  <li className="px-3 py-4 text-center text-[11px] text-black/50">
                    {assignedMatches.length > 0 ? (
                      <>
                        Already on this agent:{" "}
                        <span className="font-mono text-black/70">{assignedMatches.join(", ")}</span>
                      </>
                    ) : (
                      "No matching scopes"
                    )}
                  </li>
                ) : (
                  filteredScopes.map((scope) => {
                    const isJit = FORCE_JIT_SCOPES.includes(scope as never);
                    return (
                      <li key={scope}>
                        <button
                          type="button"
                          role="option"
                          onClick={() => handleSelect(scope)}
                          className="flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-black/5"
                        >
                          <span className="shrink-0 font-mono text-[10.5px] text-black">{scope}</span>
                          {isJit ? (
                            <ShieldAlert className="mt-0.5 size-2.5 shrink-0 text-black/50" aria-hidden />
                          ) : null}
                          <span className="min-w-0 text-[10px] leading-relaxed text-black/55">
                            {PERMISSION_SCOPE_LABELS[scope]}
                          </span>
                        </button>
                      </li>
                    );
                  })
                )}
              </ul>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
