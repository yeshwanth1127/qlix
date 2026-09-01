"use client";

import { useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import {
  CONNECTOR_CATALOG_ENTRIES,
  filterConnectorCatalog,
  type ConnectorCatalogEntry,
} from "@/lib/connector-catalog";
import { ConnectorLogo } from "@/components/qlix/connectors/ConnectorLogo";
import { SectionHeading } from "@/components/qlix/connectors/connector-ui";

/** How many tiles show before the user asks for the rest. */
const PREVIEW_COUNT = 6;

export function ConnectorCatalogSection({
  query = "",
  forceExpanded = false,
}: {
  readonly query?: string;
  readonly forceExpanded?: boolean;
}) {
  const [showAll, setShowAll] = useState(false);

  const entries = useMemo(
    () => filterConnectorCatalog({ query, availability: "Coming soon" }),
    [query],
  );

  const expanded = forceExpanded || showAll;
  const visible = expanded ? entries : entries.slice(0, PREVIEW_COUNT);
  const hidden = entries.length - visible.length;
  const soonTotal = CONNECTOR_CATALOG_ENTRIES.filter((e) => e.availability === "soon").length;

  if (entries.length === 0) return null;

  return (
    <section className="mt-10" id="connector-catalog">
      <SectionHeading title="Coming soon" hint={`${soonTotal} apps`} />

      <ul className="connector-upcoming">
        {visible.map((entry) => (
          <li key={entry.id}>
            <UpcomingTile entry={entry} />
          </li>
        ))}
      </ul>

      {hidden > 0 ? (
        <div className="mt-3 flex justify-center">
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="connector-action connector-action--quiet"
          >
            Show {hidden} more
          </button>
        </div>
      ) : null}
    </section>
  );
}

function UpcomingTile({ entry }: { readonly entry: ConnectorCatalogEntry }) {
  return (
    <a
      href={entry.docsUrl}
      target="_blank"
      rel="noopener noreferrer"
      title={`${entry.name} — coming soon`}
      className="connector-upcoming-tile group"
    >
      <ConnectorLogo name={entry.name} logo={entry.logo} size="sm" />
      <span className="min-w-0 flex-1 truncate text-[12.5px] text-black">{entry.name}</span>
      <ExternalLink
        size={11}
        className="shrink-0 text-[color:var(--ink-faint)] opacity-0 transition-opacity group-hover:opacity-70"
      />
    </a>
  );
}
