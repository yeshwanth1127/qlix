"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { ExternalLink, Search, X } from "lucide-react";
import {
  CONNECTOR_CATEGORIES,
  CONNECTOR_CATALOG_ENTRIES,
  filterConnectorCatalog,
  type ConnectorAvailability,
  type ConnectorAvailabilityFilter,
  type ConnectorCatalogCategory,
  type ConnectorCatalogEntry,
} from "@/lib/connector-catalog";
import { ConnectorLogo } from "@/components/qlix/connectors/ConnectorLogo";
import { ConnectorFilterChip, SectionHeading } from "@/components/qlix/connectors/connector-ui";
import { cn } from "@/lib/utils/cn";

/** How many tiles show before the user asks for the rest. */
const PREVIEW_COUNT = 12;

const STATUS_FILTERS: ReadonlyArray<{ label: string; value: ConnectorAvailabilityFilter }> = [
  { label: "All", value: "All" },
  { label: "Ready", value: "Available" },
  { label: "Soon", value: "Coming soon" },
];

function isReady(a: ConnectorAvailability): boolean {
  return a === "live" || a === "orbit";
}

/** Jump to the connector's row and flash it so the eye lands in the right place. */
function scrollToLive(anchor: ConnectorCatalogEntry["liveAnchor"]) {
  if (!anchor) return;
  const el = document.getElementById(`connector-${anchor}`);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.remove("connector-row--flash");
  // Force a reflow so the animation restarts on repeat clicks.
  void el.offsetWidth;
  el.classList.add("connector-row--flash");
  window.setTimeout(() => el.classList.remove("connector-row--flash"), 1700);
}

export function ConnectorCatalogSection() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<ConnectorCatalogCategory | "All">("All");
  const [availability, setAvailability] = useState<ConnectorAvailabilityFilter>("All");
  const [showAll, setShowAll] = useState(false);
  const deferredQuery = useDeferredValue(query);

  const entries = useMemo(
    () => filterConnectorCatalog({ query: deferredQuery, category, availability }),
    [deferredQuery, category, availability],
  );

  const categoryCounts = useMemo(() => {
    const base = filterConnectorCatalog({ query: deferredQuery, availability });
    const counts = new Map<string, number>();
    counts.set("All", base.length);
    for (const c of CONNECTOR_CATEGORIES) {
      counts.set(c, base.filter((e) => e.category === c).length);
    }
    return counts;
  }, [deferredQuery, availability]);

  const filtered = query.trim() !== "" || category !== "All" || availability !== "All";
  const visible = showAll || filtered ? entries : entries.slice(0, PREVIEW_COUNT);
  const hidden = entries.length - visible.length;

  function clearFilters() {
    setQuery("");
    setCategory("All");
    setAvailability("All");
  }

  return (
    <section className="mt-10" id="connector-catalog">
      <SectionHeading
        title="Library"
        hint={`${CONNECTOR_CATALOG_ENTRIES.length} apps`}
        right={
          <label className="relative w-full sm:w-64">
            <span className="sr-only">Search apps</span>
            <Search
              size={14}
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[color:var(--ink-faint)]"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
              className="connector-search"
              autoComplete="off"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[color:var(--ink-faint)] transition-colors hover:text-black"
              >
                <X size={13} />
              </button>
            ) : null}
          </label>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-1">
        {STATUS_FILTERS.map((f) => (
          <ConnectorFilterChip
            key={f.value}
            label={f.label}
            active={availability === f.value}
            onClick={() => setAvailability(f.value)}
          />
        ))}
        <span className="mx-1.5 h-4 w-px bg-[color:var(--ink-border)]" aria-hidden />
        {CONNECTOR_CATEGORIES.map((c) => (
          <ConnectorFilterChip
            key={c}
            label={c}
            active={category === c}
            disabled={(categoryCounts.get(c) ?? 0) === 0}
            onClick={() => setCategory(category === c ? "All" : c)}
          />
        ))}
      </div>

      {entries.length === 0 ? (
        <div className="flex justify-center rounded-2xl border border-[color:var(--ink-border)] bg-white/40 py-9">
          <button
            type="button"
            onClick={clearFilters}
            className="connector-meta transition-colors hover:text-black"
          >
            Nothing matches — clear filters
          </button>
        </div>
      ) : (
        <>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {visible.map((entry, i) => (
              <li
                key={entry.id}
                className="sketch-rise"
                style={{ animationDelay: `${Math.min(i, 10) * 25}ms` }}
              >
                <CatalogTile entry={entry} />
              </li>
            ))}
          </ul>

          {hidden > 0 ? (
            <div className="mt-4 flex justify-center">
              <button
                type="button"
                onClick={() => setShowAll(true)}
                className="connector-action connector-action--quiet"
              >
                Show {hidden} more
              </button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

function CatalogTile({ entry }: { readonly entry: ConnectorCatalogEntry }) {
  const ready = isReady(entry.availability);
  const canJump = ready && Boolean(entry.liveAnchor);

  return (
    <div
      className={cn(
        "connector-tile group",
        ready ? "connector-tile--ready" : "connector-tile--soon",
        canJump && "cursor-pointer",
      )}
      onClick={canJump ? () => scrollToLive(entry.liveAnchor) : undefined}
      onKeyDown={
        canJump
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                scrollToLive(entry.liveAnchor);
              }
            }
          : undefined
      }
      role={canJump ? "button" : undefined}
      tabIndex={canJump ? 0 : undefined}
      title={ready ? undefined : "Coming soon"}
    >
      <ConnectorLogo name={entry.name} logo={entry.logo} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-black">{entry.name}</p>
        <p className="connector-meta truncate">{entry.category}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {ready ? (
          <span className="connector-dot connector-dot--connected" title="Ready to connect" />
        ) : (
          <span className="text-[9px] font-medium uppercase tracking-[0.14em] text-[color:var(--ink-faint)]">
            Soon
          </span>
        )}
        <a
          href={entry.docsUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          aria-label={`${entry.name} documentation`}
          className="connector-tile-docs"
        >
          <ExternalLink size={12} />
        </a>
      </div>
    </div>
  );
}
