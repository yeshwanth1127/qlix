"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { ExternalLink, Search, X } from "lucide-react";
import {
  CONNECTOR_CATEGORIES,
  CONNECTOR_CATALOG_ENTRIES,
  filterConnectorCatalog,
  type ConnectorAuthFilter,
  type ConnectorAvailability,
  type ConnectorAvailabilityFilter,
  type ConnectorCatalogCategory,
  type ConnectorCatalogEntry,
} from "@/lib/connector-catalog";
import { ConnectorLogo } from "@/components/qlix/connectors/ConnectorLogo";
import { ConnectorFilterChip } from "@/components/qlix/connectors/connector-ui";
import { SketchBox, SketchSection, sketchInput } from "@/components/qlix/sketch";
import { cn } from "@/lib/utils/cn";

function availabilityLabel(a: ConnectorAvailability): string {
  if (a === "live") return "Live";
  if (a === "orbit") return "Via Orbit";
  return "Soon";
}

function availabilityTone(a: ConnectorAvailability): string {
  if (a === "live") return "bg-[color:var(--sketch-green-soft)] text-[color:var(--sketch-green)]";
  if (a === "orbit") return "bg-[color:var(--sketch-purple-soft)] text-[color:var(--sketch-purple)]";
  return "bg-black/[0.04] text-black/45";
}

function scrollToLive(anchor: ConnectorCatalogEntry["liveAnchor"]) {
  if (!anchor) return;
  const el = document.getElementById(`connector-${anchor}`);
  el?.scrollIntoView({ behavior: "smooth", block: "start" });
}

const AVAILABILITY_FILTERS: readonly ConnectorAvailabilityFilter[] = [
  "All",
  "Available",
  "Coming soon",
];

const AUTH_FILTERS: readonly ConnectorAuthFilter[] = ["All", "OAuth2", "APIKey"];

export function ConnectorCatalogSection() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<ConnectorCatalogCategory | "All">("All");
  const [availability, setAvailability] = useState<ConnectorAvailabilityFilter>("All");
  const [auth, setAuth] = useState<ConnectorAuthFilter>("All");
  const deferredQuery = useDeferredValue(query);

  const entries = useMemo(
    () =>
      filterConnectorCatalog({
        query: deferredQuery,
        category,
        availability,
        auth,
      }),
    [deferredQuery, category, availability, auth],
  );

  const categoryCounts = useMemo(() => {
    const base = filterConnectorCatalog({
      query: deferredQuery,
      availability,
      auth,
    });
    const counts = new Map<string, number>();
    counts.set("All", base.length);
    for (const c of CONNECTOR_CATEGORIES) {
      counts.set(
        c,
        base.filter((e) => e.category === c).length,
      );
    }
    return counts;
  }, [deferredQuery, availability, auth]);

  const hasActiveFilters =
    query.trim() !== "" || category !== "All" || availability !== "All" || auth !== "All";

  function clearFilters() {
    setQuery("");
    setCategory("All");
    setAvailability("All");
    setAuth("All");
  }

  return (
    <SketchSection title="Platform catalog" className="mt-6" id="connector-catalog">
      <p className="mb-4 max-w-2xl text-[12px] leading-relaxed text-black/70">
        {CONNECTOR_CATALOG_ENTRIES.length} platforms with documented OAuth or developer APIs.
        Search by name, category, or auth type.
      </p>

      <SketchBox className="mb-4 overflow-hidden p-3 sm:p-4">
        <label className="relative block">
          <span className="sr-only">Search platforms</span>
          <Search
            size={16}
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-black/45 transition-colors duration-200"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search Zoho Mail, Books, Desk, Slack, CRM…"
            className={cn(
              sketchInput,
              "border-black/10 pl-10 pr-10 text-black placeholder:text-black/40 focus:border-[color:var(--sketch-purple)]/45",
            )}
            autoComplete="off"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-black/50 transition-colors hover:bg-black/[0.04] hover:text-black"
              aria-label="Clear search"
            >
              <X size={14} />
            </button>
          ) : null}
        </label>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-black/55">
            Status
          </span>
          {AVAILABILITY_FILTERS.map((f) => (
            <ConnectorFilterChip
              key={f}
              label={f}
              active={availability === f}
              onClick={() => setAvailability(f)}
            />
          ))}
          <span className="ml-2 text-[11px] font-medium uppercase tracking-[0.16em] text-black/55">
            Auth
          </span>
          {AUTH_FILTERS.map((f) => (
            <ConnectorFilterChip
              key={f}
              label={f === "APIKey" ? "API key" : f === "OAuth2" ? "OAuth" : f}
              active={auth === f}
              onClick={() => setAuth(f)}
            />
          ))}
          {hasActiveFilters ? (
            <button
              type="button"
              onClick={clearFilters}
              className="ml-auto text-[11px] uppercase tracking-[0.1em] text-[color:var(--sketch-purple)] underline-offset-2 transition-opacity hover:underline"
            >
              Clear
            </button>
          ) : null}
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          <ConnectorFilterChip
            label="All"
            count={categoryCounts.get("All") ?? 0}
            active={category === "All"}
            onClick={() => setCategory("All")}
          />
          {CONNECTOR_CATEGORIES.map((c) => (
            <ConnectorFilterChip
              key={c}
              label={c}
              count={categoryCounts.get(c) ?? 0}
              active={category === c}
              disabled={(categoryCounts.get(c) ?? 0) === 0}
              onClick={() => setCategory(c)}
            />
          ))}
        </div>
      </SketchBox>

      <div className="mb-2 flex items-baseline justify-between gap-2">
        <p className="text-[12px] text-black/70">
          {entries.length === 0
            ? "No matches"
            : `${entries.length} platform${entries.length === 1 ? "" : "s"}`}
          {deferredQuery.trim() ? (
            <span>
              {" "}
              for &ldquo;{deferredQuery.trim()}&rdquo;
            </span>
          ) : null}
        </p>
      </div>

      {entries.length === 0 ? (
        <SketchBox className="sketch-rise px-4 py-10 text-center">
          <p className="text-[13px] text-black/70">No platforms match those filters.</p>
          <button
            type="button"
            onClick={clearFilters}
            className="mt-3 text-[11px] uppercase tracking-[0.12em] text-[color:var(--sketch-purple)] underline-offset-2 hover:underline"
          >
            Reset filters
          </button>
        </SketchBox>
      ) : (
        <ul className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {entries.map((entry, i) => (
            <li
              key={entry.id}
              className="sketch-rise"
              style={{ animationDelay: `${Math.min(i, 12) * 35}ms` }}
            >
              <CatalogCard entry={entry} />
            </li>
          ))}
        </ul>
      )}
    </SketchSection>
  );
}

function CatalogCard({ entry }: { entry: ConnectorCatalogEntry }) {
  const brandGlow = `#${entry.logo.color}14`;

  return (
    <div style={{ "--connector-brand-glow": brandGlow } as React.CSSProperties}>
      <SketchBox className="connector-catalog-card group relative flex h-full flex-col overflow-hidden p-4">
      <div className="flex items-start gap-3">
        <ConnectorLogo
          name={entry.name}
          logo={entry.logo}
          size="md"
          className="transition-transform duration-300 group-hover:scale-110"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="truncate text-[14px] font-medium text-black transition-colors group-hover:text-[color:var(--sketch-purple)]">
              {entry.name}
            </h3>
            <span
              className={cn(
                "shrink-0 rounded-full px-2 py-0.5 text-[9px] font-medium uppercase tracking-wide",
                availabilityTone(entry.availability),
              )}
            >
              {availabilityLabel(entry.availability)}
            </span>
          </div>
          <p className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-black/45">
            {entry.category}
          </p>
        </div>
      </div>

      <p className="mt-2.5 line-clamp-2 flex-1 text-[12px] leading-relaxed text-black/75">
        {entry.description}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {entry.authTypes.map((a) => (
          <span
            key={a}
            className="rounded-full border border-black/12 bg-white/60 px-2 py-0.5 text-[9px] font-medium uppercase tracking-wide text-black/55"
          >
            {a === "APIKey" ? "API key" : "OAuth 2"}
          </span>
        ))}
        <a
          href={entry.docsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto inline-flex items-center gap-1 text-[11px] text-black/55 transition-colors hover:text-[color:var(--sketch-purple)]"
        >
          Docs
          <ExternalLink size={11} />
        </a>
      </div>

      {entry.liveAnchor ? (
        <button
          type="button"
          onClick={() => scrollToLive(entry.liveAnchor)}
          className="mt-3 self-start text-[11px] font-medium uppercase tracking-[0.12em] text-[color:var(--sketch-purple)] underline-offset-2 transition-opacity hover:underline"
        >
          {entry.availability === "orbit" ? "Open social →" : "Connect →"}
        </button>
      ) : (
        <p className="mt-3 text-[10px] uppercase tracking-wide text-black/40">
          Connect flow coming soon
        </p>
      )}
      </SketchBox>
    </div>
  );
}
