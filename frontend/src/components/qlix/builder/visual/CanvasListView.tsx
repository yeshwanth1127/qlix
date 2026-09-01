"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Trash2, Workflow } from "lucide-react";
import {
  createCanvas,
  deleteCanvas,
  listCanvases,
  updateCanvas,
  type BuilderCanvasSummary,
} from "@/lib/builder-api";
import { SketchBox, SketchPageHeader, sketchButton, sketchLabel } from "@/components/qlix/sketch";
import { cn } from "@/lib/utils/cn";

const HAIRLINE = "border-[color:var(--ink-border)]";
const INK_SOFT = "text-[color:var(--ink-soft)]";
const INK_FAINT = "text-[color:var(--ink-faint)]";

function relativeTime(iso: string): string {
  const deltaMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(deltaMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export interface CanvasListViewProps {
  readonly routePrefix: string;
}

export function CanvasListView({ routePrefix }: CanvasListViewProps) {
  const router = useRouter();
  const [canvases, setCanvases] = useState<BuilderCanvasSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");

  // setState only after an await, so the effect body stays free of synchronous updates.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rows = await listCanvases();
        if (!cancelled) setCanvases(rows);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't load canvases");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    setReloadKey((key) => key + 1);
  }, []);

  const handleCreate = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const canvas = await createCanvas(`Canvas ${canvases.length + 1}`);
      router.push(`${routePrefix}/visual-builder/${canvas.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the canvas");
      setBusy(false);
    }
  }, [canvases.length, routePrefix, router]);

  const commitRename = useCallback(
    async (id: string) => {
      const name = draftName.trim();
      setRenamingId(null);
      if (!name) return;
      try {
        await updateCanvas(id, { name });
        setCanvases((current) =>
          current.map((canvas) => (canvas.id === id ? { ...canvas, name } : canvas)),
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't rename the canvas");
      }
    },
    [draftName],
  );

  const handleDelete = useCallback(async (id: string, name: string) => {
    if (!window.confirm(`Delete "${name}"? This can't be undone.`)) return;
    try {
      await deleteCanvas(id);
      setCanvases((current) => current.filter((canvas) => canvas.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't delete the canvas");
    }
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SketchPageHeader
        title="Visual Builder"
        actions={
          <>
            <button type="button" onClick={refresh} className={sketchButton}>
              Refresh
            </button>
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={busy}
              className={sketchButton}
            >
              {busy ? "Creating…" : "+ New canvas"}
            </button>
          </>
        }
      />

      <SketchBox className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain p-3">
        {error && <p className="text-[12.5px] text-[color:var(--sketch-red)]">{error}</p>}

        {loading ? (
          <p className={sketchLabel}>Loading…</p>
        ) : canvases.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <Workflow size={20} className={INK_FAINT} aria-hidden />
            <p className="text-[13px] font-medium text-black">No canvases yet</p>
            <p className={cn("max-w-sm text-[12px] leading-relaxed", INK_SOFT)}>
              A canvas is a workspace for wiring agents and the tools they can use. Nothing you
              draw changes your agents until you deploy it.
            </p>
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={busy}
              className={cn(sketchButton, "mt-1")}
            >
              {busy ? "Creating…" : "+ New canvas"}
            </button>
          </div>
        ) : (
          canvases.map((canvas) => (
            <div
              key={canvas.id}
              className={cn(
                "flex items-center gap-3 rounded-2xl border bg-[#E2F0CC]/60 px-3.5 py-2.5 transition-colors hover:bg-[#E2F0CC]/85",
                HAIRLINE,
              )}
            >
              <Workflow size={13} className="shrink-0 text-black" aria-hidden />

              {renamingId === canvas.id ? (
                <input
                  value={draftName}
                  onChange={(event) => setDraftName(event.target.value)}
                  onBlur={() => void commitRename(canvas.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void commitRename(canvas.id);
                    if (event.key === "Escape") setRenamingId(null);
                  }}
                  autoFocus
                  maxLength={120}
                  aria-label="Canvas name"
                  className={cn(
                    "min-w-0 flex-1 rounded-lg border bg-[#E2F0CC] px-2 py-1 text-[13px] text-black outline-none",
                    HAIRLINE,
                  )}
                />
              ) : (
                <Link
                  href={`${routePrefix}/visual-builder/${canvas.id}`}
                  className="min-w-0 flex-1 truncate text-[13px] text-black transition-opacity hover:opacity-70"
                >
                  {canvas.name}
                </Link>
              )}

              <span className={cn("shrink-0 text-[11px]", INK_FAINT)}>
                {relativeTime(canvas.updatedAt)}
              </span>

              <button
                type="button"
                onClick={() => {
                  setRenamingId(canvas.id);
                  setDraftName(canvas.name);
                }}
                className={cn("shrink-0 text-[11px] transition-colors hover:text-black", INK_SOFT)}
              >
                Rename
              </button>

              <button
                type="button"
                onClick={() => void handleDelete(canvas.id, canvas.name)}
                aria-label={`Delete ${canvas.name}`}
                className="grid size-6 shrink-0 place-items-center rounded-lg text-black transition-colors hover:bg-black/[0.06]"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))
        )}
      </SketchBox>
    </div>
  );
}
