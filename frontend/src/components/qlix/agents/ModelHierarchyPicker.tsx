"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Lock, Search, Sparkles } from "lucide-react";
import {
  formatModelOptionLabel,
  llmProviderFromModelId,
  type ModelSelectGroup,
  type ModelSelectOption,
} from "@/lib/agents-api";
import { cn } from "@/lib/utils/cn";

/** `text-black/NN` is force-inked inside the console, so muted copy uses the ink vars. */
const INK_SOFT = "text-[color:var(--ink-soft)]";
const INK_FAINT = "text-[color:var(--ink-faint)]";
const HAIRLINE = "border-[color:var(--ink-border)]";

const EXORA_BLURBS: Record<string, string> = {
  "exora/exora-general": "Best default for chat, research, and everyday work",
  "exora/exora-coder": "Stronger for code, debugging, and technical tasks",
  "exora/qlix/auto": "Qlix picks a model within your plan automatically",
};

function optionBlurb(modelId: string): string | null {
  const lower = modelId.toLowerCase();
  if (EXORA_BLURBS[lower]) return EXORA_BLURBS[lower];
  if (lower.endsWith("/qlix/auto")) return "Qlix picks a model within your plan automatically";
  return null;
}

/** Vendor slug → display name. Anything unlisted is title-cased. */
const VENDOR_LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  "meta-llama": "Meta",
  meta: "Meta",
  mistralai: "Mistral",
  qwen: "Qwen",
  deepseek: "DeepSeek",
  "x-ai": "xAI",
  cohere: "Cohere",
  perplexity: "Perplexity",
  amazon: "Amazon",
  microsoft: "Microsoft",
  nvidia: "NVIDIA",
  ai21: "AI21",
  "01-ai": "01.AI",
  nousresearch: "Nous Research",
  moonshotai: "Moonshot AI",
  "z-ai": "Z.AI",
  liquid: "Liquid",
  inflection: "Inflection",
  databricks: "Databricks",
  openrouter: "OpenRouter",
};

/** Vendors people reach for first; the rest follow alphabetically. */
const VENDOR_ORDER = [
  "anthropic",
  "openai",
  "google",
  "nvidia",
  "deepseek",
  "meta-llama",
  "mistralai",
  "qwen",
  "x-ai",
];

const WORD_CASE: Record<string, string> = {
  gpt: "GPT",
  ai: "AI",
  llm: "LLM",
  vl: "VL",
  moe: "MoE",
  it: "IT",
  hq: "HQ",
};

function titleCase(slug: string): string {
  return slug
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => WORD_CASE[word.toLowerCase()] ?? word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function isAutoModel(modelId: string): boolean {
  return modelId.toLowerCase().endsWith("/qlix/auto");
}

/** `openrouter/anthropic/claude-sonnet-4.6` → `anthropic`. */
function vendorOf(modelId: string): string {
  const parts = modelId.toLowerCase().replace(/^(openrouter|exora)\//, "").split("/");
  return parts.length > 1 ? parts[0]! : "other";
}

function vendorLabel(key: string): string {
  return VENDOR_LABELS[key] ?? titleCase(key);
}

/** Model name without the vendor prefix the catalog repeats ("Anthropic: Claude…"). */
function modelDisplayName(option: ModelSelectOption, vendorKey: string): string {
  const raw = option.name?.trim();
  if (raw) {
    const colon = raw.indexOf(":");
    if (colon > 0) {
      const head = raw.slice(0, colon).trim().toLowerCase();
      if (head === vendorLabel(vendorKey).toLowerCase() || head === vendorKey) {
        return raw.slice(colon + 1).trim();
      }
    }
    return raw;
  }
  const slug = option.id
    .toLowerCase()
    .replace(/^(openrouter|exora)\//, "")
    .split("/")
    .slice(1)
    .join(" ");
  return slug ? titleCase(slug) : option.label;
}

function formatContext(tokens: number | null | undefined): string | null {
  if (!tokens || tokens <= 0) return null;
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 === 0 ? 0 : 1)}M context`;
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}K context`;
  return `${tokens} context`;
}

interface Row {
  readonly id: string;
  readonly title: string;
  readonly meta: string | null;
  readonly locked: boolean;
}

interface VendorBucket {
  readonly key: string;
  readonly label: string;
  readonly rows: Row[];
  readonly expanded: boolean;
}

interface Section {
  readonly key: string;
  readonly label: string;
  readonly subtitle: string;
  readonly locked: boolean;
  /** Rows shown before any vendor grouping — presets and auto-routing. */
  readonly pinned: Row[];
  readonly vendors: VendorBucket[];
}

export function ModelHierarchyPicker({
  value,
  groups,
  onChange,
  disabled,
  size = "default",
  placement = "below",
  enabledProviders,
  agentDefaultId,
}: {
  readonly value: string;
  readonly groups: ModelSelectGroup[];
  readonly onChange: (modelId: string) => void;
  readonly disabled?: boolean;
  readonly size?: "default" | "compact";
  readonly placement?: "below" | "above";
  /** When set, options outside these providers are shown as locked. */
  readonly enabledProviders?: ReadonlySet<"exora" | "openrouter">;
  readonly agentDefaultId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const compact = size === "compact";
  const flat = useMemo(() => groups.flatMap((g) => g.options), [groups]);

  const selected = useMemo(
    () =>
      flat.find((o) => o.id === value) ??
      (value ? { id: value, label: formatModelOptionLabel(value) } : null),
    [flat, value],
  );
  const selectedProvider = value ? llmProviderFromModelId(value) : null;
  const selectedTitle = selected
    ? isAutoModel(selected.id)
      ? "Auto"
      : modelDisplayName(selected, vendorOf(selected.id))
    : "Select a model";

  /** Vendors open by default: the selected model's, the agent default's, and the first one. */
  const defaultOpenVendors = useMemo(() => {
    const keys = new Set<string>();
    if (value) keys.add(vendorOf(value));
    if (agentDefaultId) keys.add(vendorOf(agentDefaultId));
    return keys;
  }, [value, agentDefaultId]);

  const { sections, navigable } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const result: Section[] = [];
    const order: string[] = [];

    for (const group of groups) {
      const locked = enabledProviders != null && !enabledProviders.has(group.provider);
      const matches = group.options.filter(
        (option) =>
          !q ||
          option.label.toLowerCase().includes(q) ||
          option.id.toLowerCase().includes(q) ||
          (option.name?.toLowerCase().includes(q) ?? false),
      );
      if (matches.length === 0) continue;

      const toRow = (option: ModelSelectOption): Row => ({
        id: option.id,
        title: isAutoModel(option.id) ? "Auto" : modelDisplayName(option, vendorOf(option.id)),
        meta: optionBlurb(option.id) ?? formatContext(option.contextLength) ?? option.label,
        locked,
      });

      const pinned: Row[] = [];
      const buckets = new Map<string, Row[]>();

      for (const option of matches) {
        // Exora ships capability presets, not vendor models — keep them flat.
        if (group.provider === "exora" || isAutoModel(option.id)) {
          pinned.push(toRow(option));
          continue;
        }
        const key = vendorOf(option.id);
        const bucket = buckets.get(key);
        if (bucket) bucket.push(toRow(option));
        else buckets.set(key, [toRow(option)]);
      }

      const hasPreferredVendor = [...buckets.keys()].some((key) => defaultOpenVendors.has(key));

      const vendors: VendorBucket[] = [...buckets.entries()]
        .sort((a, b) => {
          const ia = VENDOR_ORDER.indexOf(a[0]);
          const ib = VENDOR_ORDER.indexOf(b[0]);
          if (ia !== ib) return (ia < 0 ? VENDOR_ORDER.length : ia) - (ib < 0 ? VENDOR_ORDER.length : ib);
          return vendorLabel(a[0]).localeCompare(vendorLabel(b[0]));
        })
        .map(([key, rows], index) => {
          const overrideKey = `${group.label}:${key}`;
          const expanded =
            q.length > 0
              ? true
              : (overrides[overrideKey] ??
                (defaultOpenVendors.has(key) || (!hasPreferredVendor && index === 0)));
          return { key, label: vendorLabel(key), rows, expanded };
        });

      if (!locked) {
        for (const row of pinned) order.push(row.id);
        for (const vendor of vendors) {
          if (vendor.expanded) for (const row of vendor.rows) order.push(row.id);
        }
      }

      result.push({
        key: group.label,
        label: group.label,
        subtitle:
          group.provider === "exora"
            ? "Included in your plan"
            : `${group.options.length} models from every major lab`,
        locked,
        pinned,
        vendors,
      });
    }

    return { sections: result, navigable: order };
  }, [groups, query, enabledProviders, overrides, defaultOpenVendors]);

  const activeId = navigable[Math.min(activeIndex, navigable.length - 1)] ?? null;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => searchRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [open]);

  // Keep the highlighted row in view without scrolling the page.
  useEffect(() => {
    if (!open || !activeId) return;
    listRef.current
      ?.querySelector(`[data-model-id="${CSS.escape(activeId)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [open, activeId]);

  function openMenu(next: boolean) {
    setOpen(next);
    setQuery("");
    if (next) {
      // `navigable` is unfiltered while closed, so this lands on the current model.
      const index = navigable.indexOf(value);
      setActiveIndex(index >= 0 ? index : 0);
    }
  }

  function commit(modelId: string, locked: boolean) {
    if (locked) return;
    onChange(modelId);
    setOpen(false);
    setQuery("");
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setOpen(false);
      setQuery("");
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (navigable.length === 0) return;
      const delta = e.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((i) => (i + delta + navigable.length) % navigable.length);
      return;
    }
    if (e.key === "Enter" && activeId) {
      e.preventDefault();
      commit(activeId, false);
    }
  }

  function toggleVendor(sectionKey: string, vendorKey: string, expanded: boolean) {
    setOverrides((prev) => ({ ...prev, [`${sectionKey}:${vendorKey}`]: !expanded }));
  }

  return (
    <div ref={rootRef} className={cn("relative", compact ? "" : "w-full")}>
      <button
        type="button"
        disabled={disabled || flat.length === 0}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={`Model: ${selectedTitle}`}
        onClick={() => openMenu(!open)}
        title={selected?.id}
        className={cn(
          "sketch-press flex items-center gap-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50",
          HAIRLINE,
          compact
            ? "max-w-full rounded-full border bg-[#E2F0CC]/60 px-2.5 py-1 hover:bg-[#E2F0CC]"
            : "w-full rounded-2xl border bg-[#E2F0CC]/70 px-3.5 py-2.5 hover:bg-[#E2F0CC]",
        )}
      >
        {selectedProvider === "exora" ? (
          <Sparkles className={cn("size-3 shrink-0", INK_SOFT)} aria-hidden />
        ) : (
          <span
            className={cn("size-1.5 shrink-0 rounded-full bg-[color:var(--ink-faint)]")}
            aria-hidden
          />
        )}
        <span
          className={cn(
            "min-w-0 flex-1 truncate font-medium text-black",
            compact ? "text-[11px]" : "text-[13px]",
          )}
        >
          {selectedTitle}
        </span>
        <ChevronDown
          className={cn(
            "shrink-0 transition-transform",
            INK_FAINT,
            compact ? "size-3" : "size-4",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>

      {open ? (
        <div
          role="listbox"
          aria-activedescendant={activeId ? `model-opt-${activeId}` : undefined}
          onKeyDown={onKeyDown}
          className={cn(
            "absolute z-50 overflow-hidden rounded-2xl border bg-[#E2F0CC]/90 shadow-[var(--sketch-shadow-hover)] backdrop-blur-xl",
            HAIRLINE,
            compact ? "left-0 w-[min(23rem,calc(100vw-3rem))]" : "left-0 right-0 w-full",
            placement === "above" ? "bottom-full mb-2" : "top-full mt-2",
          )}
        >
          <div className="p-2.5 pb-1.5">
            <label
              className={cn(
                "flex items-center gap-2 rounded-full border bg-[#E2F0CC]/70 px-3 py-1.5",
                HAIRLINE,
              )}
            >
              <Search className={cn("size-3.5 shrink-0", INK_FAINT)} aria-hidden />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActiveIndex(0);
                }}
                placeholder="Search models"
                className="w-full bg-transparent text-[12.5px] text-black outline-none"
              />
            </label>
          </div>

          <div
            ref={listRef}
            className={cn("overflow-y-auto overscroll-contain px-1.5 pb-2", compact ? "max-h-72" : "max-h-96")}
          >
            {sections.length === 0 ? (
              <p className={cn("px-3 py-6 text-center text-[12.5px]", INK_SOFT)}>
                No models match “{query}”.
              </p>
            ) : (
              sections.map((section) => (
                <section key={section.key} className="pt-1.5">
                  <div className="sticky top-0 z-10 mb-1 flex items-baseline justify-between gap-2 rounded-xl bg-[color:var(--sketch-purple)] px-2.5 py-1.5">
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-white">
                      {section.label}
                    </p>
                    {section.locked ? (
                      <span className="inline-flex items-center gap-1 text-[10px] text-white/80">
                        <Lock size={9} />
                        Not enabled
                      </span>
                    ) : (
                      <span className="text-[10px] text-white/80">{section.subtitle}</span>
                    )}
                  </div>

                  {section.locked && (
                    <p className={cn("px-2.5 pb-2 text-[11px] leading-relaxed", INK_SOFT)}>
                      Switch this agent to {section.label} in its settings to pick from these{" "}
                      {section.pinned.length +
                        section.vendors.reduce((n, v) => n + v.rows.length, 0)}{" "}
                      models.
                    </p>
                  )}

                  {!section.locked &&
                    section.pinned.map((row) => (
                      <OptionRow
                        key={row.id}
                        row={row}
                        accent={isAutoModel(row.id)}
                        selected={row.id === value}
                        active={row.id === activeId}
                        isDefault={
                          !!agentDefaultId && row.id.toLowerCase() === agentDefaultId.toLowerCase()
                        }
                        onSelect={() => commit(row.id, row.locked)}
                      />
                    ))}

                  {!section.locked &&
                    section.vendors.map((vendor) => (
                    <div key={vendor.key}>
                      <button
                        type="button"
                        onClick={() => toggleVendor(section.key, vendor.key, vendor.expanded)}
                        aria-expanded={vendor.expanded}
                        className="flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-left transition-colors hover:bg-black/[0.04]"
                      >
                        <ChevronDown
                          size={12}
                          className={cn(
                            "shrink-0 transition-transform",
                            INK_FAINT,
                            !vendor.expanded && "-rotate-90",
                          )}
                          aria-hidden
                        />
                        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-black">
                          {vendor.label}
                        </span>
                        <span className={cn("shrink-0 text-[10.5px] tabular-nums", INK_FAINT)}>
                          {vendor.rows.length}
                        </span>
                      </button>

                      {vendor.expanded &&
                        vendor.rows.map((row) => (
                          <OptionRow
                            key={row.id}
                            row={row}
                            indented
                            selected={row.id === value}
                            active={row.id === activeId}
                            isDefault={
                              !!agentDefaultId &&
                              row.id.toLowerCase() === agentDefaultId.toLowerCase()
                            }
                            onSelect={() => commit(row.id, row.locked)}
                          />
                        ))}
                      </div>
                    ))}
                </section>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function OptionRow({
  row,
  selected,
  active,
  isDefault,
  indented = false,
  accent = false,
  onSelect,
}: {
  readonly row: Row;
  readonly selected: boolean;
  readonly active: boolean;
  readonly isDefault: boolean;
  readonly indented?: boolean;
  /** Auto-routing rows carry the brand accent — they're the recommended pick. */
  readonly accent?: boolean;
  readonly onSelect: () => void;
}) {
  // One background wins per row: selection, then keyboard focus, then the accent tint.
  const background = row.locked
    ? ""
    : selected
      ? "bg-black/[0.06]"
      : active
        ? "bg-black/[0.05]"
        : accent
          ? "bg-[color:var(--sketch-purple-soft)]"
          : "";

  return (
    <button
      type="button"
      role="option"
      id={`model-opt-${row.id}`}
      data-model-id={row.id}
      aria-selected={selected}
      disabled={row.locked}
      title={row.locked ? "Enable this provider for the agent to use these models" : row.id}
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-xl py-1.5 pr-2.5 text-left transition-colors",
        indented ? "pl-7" : "pl-2.5",
        row.locked ? "cursor-not-allowed opacity-40" : "hover:bg-black/[0.04]",
        background,
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span
            className={cn(
              "truncate text-[12.5px]",
              accent
                ? "font-bold text-[color:var(--sketch-purple)]"
                : "font-medium text-black",
            )}
          >
            {row.title}
          </span>
          {isDefault ? (
            <span className={cn("shrink-0 text-[9.5px] uppercase tracking-[0.12em]", INK_FAINT)}>
              Default
            </span>
          ) : null}
        </span>
        {row.meta ? (
          <span className={cn("mt-0.5 block truncate text-[10.5px] leading-snug", INK_FAINT)}>
            {row.meta}
          </span>
        ) : null}
      </span>
      {selected ? <Check size={13} className="shrink-0 text-black" /> : null}
    </button>
  );
}
