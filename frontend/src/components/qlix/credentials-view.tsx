"use client";

import { useEffect, useState } from "react";
import { getCredentials, type CredentialsResponse } from "@/lib/credentials-api";
import { SketchBox, SketchPageHeader, SketchRow, sketchButton, sketchLabel } from "@/components/qlix/sketch";
import { CopyDidButton } from "./passports/CopyDidButton";

const TYPE_LABEL: Record<string, string> = {
  identity: "Identity",
  scope: "Scope grant",
  jit: "Approval",
};

function statusFor(row: CredentialsResponse["credentials"][number]): string {
  if (row.revokedAt) return "Revoked";
  if (row.expiresAt && new Date(row.expiresAt) < new Date()) return "Expired";
  return "Active";
}

export function CredentialsView() {
  const [data, setData] = useState<CredentialsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    const res = await getCredentials();
    if (!res) {
      setError("Could not load credentials.");
    } else {
      setData(res);
    }
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  if (loading) {
    return (
      <div className="flex h-full flex-col">
        <SketchPageHeader title="Credentials" />
        <p className={sketchLabel}>Loading…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-3">
        <SketchPageHeader title="Credentials" />
        <p className="text-[13px] text-black">{error ?? "Something went wrong."}</p>
        <button type="button" onClick={() => void load()} className={sketchButton}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-auto pb-6">
      <SketchPageHeader title="Credentials" />
      <p className="-mt-2 font-serif text-[11px] uppercase tracking-widest text-black/50">
        Issued VCs, DID document, and key management
      </p>

      <SketchBox className="flex flex-wrap items-center justify-between gap-2 p-3">
        <div>
          <span className={sketchLabel}>Platform signing DID</span>
          <p className="mt-0.5 font-mono text-[12px] text-black">{data.platform.did}</p>
        </div>
        <CopyDidButton value={data.platform.did} />
      </SketchBox>

      <SketchBox className="flex flex-col gap-2 p-3">
        {data.credentials.length === 0 ? (
          <p className="py-8 text-center font-serif text-[11px] uppercase tracking-widest text-black/50">
            No credentials issued yet — create an agent first
          </p>
        ) : (
          data.credentials.map((row) => (
            <SketchRow key={row.id} className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-[13px] font-medium text-black">{row.agentName}</p>
                <p className="truncate font-mono text-[11px] text-black/50" title={row.agentDid}>
                  {row.agentDid}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className={sketchLabel}>{TYPE_LABEL[row.type] ?? row.type}</span>
                <span className="text-[11px] text-black/50">
                  {new Date(row.issuedAt).toLocaleDateString()}
                </span>
                <span className="font-serif text-[10px] uppercase text-black/50">{statusFor(row)}</span>
              </div>
            </SketchRow>
          ))
        )}
      </SketchBox>
    </div>
  );
}
