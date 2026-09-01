"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { Check, Search, X } from "lucide-react";
import {
  catalogIdsToConnectorsNeeded,
  filterConnectorCatalog,
  getCatalogEntry,
  type ConnectorCatalogEntry,
} from "@/lib/connector-catalog";
import { ConnectorLogo } from "@/components/qlix/connectors/ConnectorLogo";
import { SketchBox, sketchInput } from "@/components/qlix/sketch";
import { cn } from "@/lib/utils/cn";
import type { PlatformSuggestion } from "@/lib/employees-api";

function availabilityBadge(entry: ConnectorCatalogEntry): string {
  if (entry.availability === "live") return "Live";
  if (entry.availability === "orbit") return "Orbit";
  return "Soon";
}

export function EmployeePlatformPicker({
  suggestions,
  selectedIds,
  onChange,
  layout = "default",
}: {
  readonly suggestions: PlatformSuggestion[];
  readonly selectedIds: readonly string[];
  readonly onChange: (ids: string[]) => void;
  readonly layout?: "default" | "wide";
}) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const wide = layout === "wide";

  const searchResults = useMemo(
    () => filterConnectorCatalog({ query: deferredQuery, availability: "All" }),
    [deferredQuery],
  );

  function toggle(id: string) {
    if (selectedSet.has(id)) {
      onChange(selectedIds.filter((x) => x !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  }

  return (
    <div className="space-y-6">
      {suggestions.length > 0 ? (
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-black/70">
            Suggested for this role
          </p>
          <ul
            className={cn(
              "mt-3 gap-3",
              wide ? "grid sm:grid-cols-2 xl:grid-cols-3" : "space-y-2",
            )}
          >
            {suggestions.map((s) => {
              const entry = getCatalogEntry(s.platformId);
              const checked = selectedSet.has(s.platformId);
              return (
                <li key={s.platformId}>
                  <button
                    type="button"
                    onClick={() => toggle(s.platformId)}
                    className={cn(
                      "flex h-full w-full cursor-pointer items-start gap-3 rounded border p-4 text-left transition-colors",
                      checked
                        ? "border-black bg-black/[0.03] ring-1 ring-black/10"
                        : "border-black/15 bg-[#E2F0CC] hover:border-black/30",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border",
                        checked ? "border-black bg-black text-white" : "border-black/30 bg-[#E2F0CC]",
                      )}
                      aria-hidden
                    >
                      {checked ? <Check className="size-2.5" /> : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        {entry ? (
                          <ConnectorLogo name={entry.name} logo={entry.logo} size="sm" className="shrink-0" />
                        ) : null}
                        <span className="text-[13px] font-medium text-black">
                          {entry?.name ?? s.platformId}
                        </span>
                        {entry ? (
                          <span className="rounded border border-black/15 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-black/45">
                            {availabilityBadge(entry)}
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-1 block text-[12px] leading-relaxed text-black/60">
                        {s.reason}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-black/70">
          Search all platforms
        </p>
        <SketchBox className={cn("mt-3 p-4", wide && "p-5")}>
          <label className="relative block">
            <span className="sr-only">Search platforms</span>
            <Search
              size={18}
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-black/50"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search Gmail, WhatsApp, LinkedIn, Slack, Tally, Zoho…"
              className={cn(
                sketchInput,
                "pl-11 pr-11 text-[13px] text-black placeholder:text-black/45",
                wide && "py-2.5",
              )}
              autoComplete="off"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-black/50 hover:text-black"
                aria-label="Clear search"
              >
                <X size={16} />
              </button>
            ) : null}
          </label>

          {deferredQuery.trim() ? (
            <ul
              className={cn(
                "mt-4 gap-1 overflow-y-auto",
                wide ? "grid max-h-64 sm:grid-cols-2" : "max-h-48 space-y-1",
              )}
            >
              {searchResults.length === 0 ? (
                <li className="col-span-full px-1 py-3 text-[12px] text-black/50">
                  No platforms match your search.
                </li>
              ) : (
                searchResults.slice(0, wide ? 24 : 12).map((entry) => {
                  const checked = selectedSet.has(entry.id);
                  return (
                    <li key={entry.id}>
                      <button
                        type="button"
                        onClick={() => toggle(entry.id)}
                        className={cn(
                          "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[12px] transition-colors",
                          checked ? "bg-black/5 ring-1 ring-black/10" : "hover:bg-black/[0.03]",
                        )}
                      >
                        <ConnectorLogo name={entry.name} logo={entry.logo} size="sm" className="shrink-0" />
                        <span className="min-w-0 flex-1 truncate font-medium text-black">{entry.name}</span>
                        <span className="shrink-0 text-[10px] uppercase tracking-wider text-black/40">
                          {availabilityBadge(entry)}
                        </span>
                        {checked ? <Check className="size-3.5 shrink-0 text-green-700" /> : null}
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          ) : (
            <p className="mt-3 text-[12px] text-black/45">
              Type to search the same platform catalog used on Connectors.
            </p>
          )}
        </SketchBox>
      </div>

      {selectedIds.length > 0 ? (
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-black/70">
            Selected ({selectedIds.length})
          </p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {selectedIds.map((id) => {
              const entry = getCatalogEntry(id);
              return (
                <li
                  key={id}
                  className="inline-flex items-center gap-2 rounded-full border border-black/20 bg-[#E2F0CC] px-3 py-1.5 text-[12px] text-black"
                >
                  {entry ? <ConnectorLogo name={entry.name} logo={entry.logo} size="sm" /> : null}
                  {entry?.name ?? id}
                  <button
                    type="button"
                    onClick={() => toggle(id)}
                    className="text-black/45 hover:text-black"
                    aria-label={`Remove ${entry?.name ?? id}`}
                  >
                    <X size={12} />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <p className="text-[13px] leading-relaxed text-black/50">
          No platforms selected — this employee will work from AI Brain and chat only until you add
          connections later.
        </p>
      )}
    </div>
  );
}

export function connectorsNeededHref(
  routePrefix: "/individual" | "/organization",
  platformIds: readonly string[],
): string {
  const needed = catalogIdsToConnectorsNeeded(platformIds);
  if (!needed) return `${routePrefix}/connectors`;
  return `${routePrefix}/connectors?needed=${encodeURIComponent(needed)}`;
}
