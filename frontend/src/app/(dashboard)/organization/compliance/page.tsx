"use client";

import { useState } from "react";
import {
  SketchBox,
  SketchPageHeader,
  SketchSection,
  sketchButtonPrimary,
  sketchInput,
  sketchLabel,
} from "@/components/qlix/sketch";

const defaultBase = "http://localhost:4000";

function apiBase(): string {
  return (process.env.NEXT_PUBLIC_API_BASE_URL ?? defaultBase).replace(/\/$/, "");
}

export default function OrganizationCompliancePage() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<{
    actionLogCount?: number;
    merkleRoot?: string;
    generatedAt?: string;
  } | null>(null);

  async function exportPack(format: "json" | "csv") {
    setBusy(true);
    setError(null);
    try {
      const url = new URL(`${apiBase()}/api/v1/compliance/export`);
      if (from) url.searchParams.set("from", from);
      if (to) url.searchParams.set("to", to);
      url.searchParams.set("format", format);
      const res = await fetch(url.toString(), { credentials: "include" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message ?? "Export failed");
      }
      if (format === "csv") {
        const blob = await res.blob();
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "qlix-compliance.csv";
        a.click();
        URL.revokeObjectURL(a.href);
      } else {
        const body = (await res.json()) as {
          actionLogCount: number;
          merkleRoot: string;
          generatedAt: string;
        };
        setSummary(body);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-6 overflow-auto pb-6">
      <SketchPageHeader title="Compliance" />
      <SketchSection title="Export pack">
        <SketchBox className="flex flex-col gap-3 p-4">
          <p className="text-[12px] text-black/60">
            Download a Merkle-rooted action log export for audits (admin/owner only).
          </p>
          {error ? <p className="text-[13px] text-[color:var(--sketch-red)]">{error}</p> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className={sketchLabel}>From</span>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className={`${sketchInput} mt-1`}
              />
            </label>
            <label className="block">
              <span className={sketchLabel}>To</span>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className={`${sketchInput} mt-1`}
              />
            </label>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              className={sketchButtonPrimary}
              onClick={() => void exportPack("json")}
            >
              {busy ? "Working…" : "Preview JSON"}
            </button>
            <button
              type="button"
              disabled={busy}
              className={sketchButtonPrimary}
              onClick={() => void exportPack("csv")}
            >
              Download CSV
            </button>
          </div>
          {summary ? (
            <dl className="mt-2 grid gap-1 text-[12px] text-black/70">
              <div>
                <dt className="inline font-medium text-black">Generated </dt>
                <dd className="inline">{summary.generatedAt}</dd>
              </div>
              <div>
                <dt className="inline font-medium text-black">Actions </dt>
                <dd className="inline">{summary.actionLogCount}</dd>
              </div>
              <div>
                <dt className="inline font-medium text-black">Merkle root </dt>
                <dd className="inline break-all font-mono">{summary.merkleRoot}</dd>
              </div>
            </dl>
          ) : null}
        </SketchBox>
      </SketchSection>
    </div>
  );
}
