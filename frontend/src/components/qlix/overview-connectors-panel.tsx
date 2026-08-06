"use client";

import Link from "next/link";
import { Loader2 } from "lucide-react";
import { ConnectorLogo } from "@/components/qlix/connectors/ConnectorLogo";
import {
  SketchBox,
  SketchMetric,
  SketchRow,
  SketchSection,
  sketchButtonPrimary,
  sketchLabel,
} from "@/components/qlix/sketch";
import {
  CONNECTOR_CATALOG_IDS,
  type LiveConnectorItem,
} from "@/lib/connectors-api";
import { getCatalogEntry } from "@/lib/connector-catalog";
import { cn } from "@/lib/utils/cn";

function ConnectedDot() {
  return (
    <span
      className="inline-block size-2 shrink-0 rounded-full bg-emerald-500"
      title="Connected"
      aria-label="Connected"
    />
  );
}

function formatConnectorDetail(item: LiveConnectorItem): string | null {
  if (!item.detail) return null;
  if (item.provider !== "whatsapp_baileys") return item.detail;
  const digits = item.detail.replace(/@.*/, "").split(":")[0]?.replace(/\D/g, "") ?? "";
  if (!digits) return item.detail;
  if (digits.startsWith("91") && digits.length >= 12) {
    return `+91 ${digits.slice(2)}`;
  }
  return `+${digits}`;
}

interface OverviewConnectorsPanelProps {
  readonly connectorsHref: string;
  readonly liveConnectors: LiveConnectorItem[];
  readonly loading?: boolean;
}

export function OverviewConnectorsPanel({
  connectorsHref,
  liveConnectors,
  loading = false,
}: OverviewConnectorsPanelProps) {
  const count = liveConnectors.length;

  return (
    <>
      <SketchMetric value={loading ? "—" : count} label="Live Connectors" tone="green" />
      <SketchSection title="Connected services">
        <SketchBox tone="green" className="flex flex-col gap-2 p-3">
          {loading ? (
            <p className="flex items-center gap-1.5 text-[12px] text-black">
              <Loader2 size={12} className="animate-spin" aria-hidden />
              Loading connectors…
            </p>
          ) : count === 0 ? (
            <div className="flex flex-col items-start gap-3 py-2">
              <p className={cn(sketchLabel, "normal-case tracking-normal text-black")}>
                No connectors linked yet.
              </p>
              <Link href={connectorsHref} className={sketchButtonPrimary}>
                Connect a service →
              </Link>
            </div>
          ) : (
            <>
              {liveConnectors.map((item) => {
                const catalogId = CONNECTOR_CATALOG_IDS[item.provider];
                const entry = getCatalogEntry(catalogId);
                const detail = formatConnectorDetail(item);
                return (
                  <Link key={item.provider} href={connectorsHref}>
                    <SketchRow
                      className={cn(
                        "flex items-center justify-between gap-2 ring-2 ring-emerald-500",
                      )}
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        {entry ? (
                          <ConnectorLogo name={item.name} logo={entry.logo} size="sm" />
                        ) : null}
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-[13px] text-black">{item.name}</span>
                            <ConnectedDot />
                          </div>
                          {detail ? (
                            <p className="truncate text-[11px] text-black/70">{detail}</p>
                          ) : null}
                        </div>
                      </div>
                    </SketchRow>
                  </Link>
                );
              })}
              <Link
                href={connectorsHref}
                className={cn(
                  sketchLabel,
                  "px-1 pt-1 transition-colors hover:text-[color:var(--sketch-purple)]",
                )}
              >
                Manage connectors →
              </Link>
            </>
          )}
        </SketchBox>
      </SketchSection>
    </>
  );
}
