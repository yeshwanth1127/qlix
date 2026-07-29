"use client";

import Link from "next/link";
import { useState } from "react";
import { usePassportsOverview } from "@/lib/hooks/use-passports-overview";
import {
  SketchBox,
  SketchPageHeader,
  SketchRow,
  sketchButton,
  sketchLabel,
} from "@/components/qlix/sketch";
import { CopyDidButton } from "./passports/CopyDidButton";
import { AgentPassportModal } from "./passports/AgentPassportModal";
import type { PassportRow } from "@/lib/passports-api";

export function PassportsView({ routePrefix }: { readonly routePrefix: "/individual" | "/organization" }) {
  const { data, error, loading, refresh } = usePassportsOverview();
  const [selected, setSelected] = useState<PassportRow | null>(null);

  if (loading) {
    return (
      <div className="flex h-full flex-col">
        <SketchPageHeader title="Passports" />
        <p className={sketchLabel}>Loading…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-3">
        <SketchPageHeader title="Passports" />
        <p className="text-[13px] text-black">{error ?? "Something went wrong."}</p>
        <button type="button" onClick={() => void refresh()} className={sketchButton}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SketchPageHeader
        title="Passports"
        actions={
          <Link href={`${routePrefix}/agents`} className={sketchButton}>
            Manage Agents
          </Link>
        }
      />

      <p className="mb-4 font-serif text-[11px] uppercase tracking-widest text-black/50">
        Layer 3 cryptographic agent identities for {data.organization.name}
      </p>

      <SketchBox className="flex flex-col gap-2 p-3">
        {data.passports.length === 0 ? (
          <p className="py-8 text-center font-serif text-[11px] uppercase tracking-widest text-black/50">
            No passports yet — register an agent first
          </p>
        ) : (
          data.passports.map((row) => (
            <SketchRow key={row.agentId} className="flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setSelected(row)}
                className="truncate text-left text-[13px] font-medium text-black underline underline-offset-2"
              >
                {row.name}
              </button>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[11px] text-black/60" title={row.did}>
                  {row.didShort}
                </span>
                <CopyDidButton value={row.did} />
                <span className="font-serif text-[10px] uppercase text-black/50">{row.status}</span>
              </div>
            </SketchRow>
          ))
        )}
      </SketchBox>

      {selected ? (
        <AgentPassportModal
          passport={selected}
          routePrefix={routePrefix}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </div>
  );
}
