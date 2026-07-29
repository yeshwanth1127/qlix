"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, Trash2 } from "lucide-react";
import { useSession } from "@/components/qlix/session-context";
import { consoleRoutePrefix } from "@/lib/workspace";
import {
  deleteAiBrainDocument,
  getAiBrainKnowledgeDocuments,
  type AiBrainKnowledgeDocumentRow,
} from "@/lib/ai-brain-api";
import { canManageBrain } from "@/lib/org-permissions";
import {
  SketchBox,
  SketchPageHeader,
  SketchRow,
  sketchButton,
  sketchLabel,
} from "@/components/qlix/sketch";

function formatShortDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

export function KnowledgeLibraryView() {
  const { session, loading: sessionLoading } = useSession();
  const prefix = session
    ? consoleRoutePrefix(session.user.workspaceKind ?? session.organization.workspaceKind)
    : "/individual";
  const brainHref = `${prefix}/ai-brain`;
  const manageKnowledge = session ? canManageBrain(session.user.role ?? "member") : false;

  const [documents, setDocuments] = useState<AiBrainKnowledgeDocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await getAiBrainKnowledgeDocuments();
    setLoading(false);
    if (!res.ok) {
      setError(res.message);
      setDocuments([]);
      return;
    }
    setDocuments([...res.documents]);
  }, []);

  useEffect(() => {
    if (sessionLoading || !session) return;
    void load();
  }, [session, sessionLoading, load]);

  const onDelete = async (d: AiBrainKnowledgeDocumentRow) => {
    if (!manageKnowledge) return;
    const ok = window.confirm(
      `Remove "${d.title}" from this collection?\n\nChunks and embeddings for this document will be deleted. This cannot be undone.`,
    );
    if (!ok) return;
    setDeletingId(d.id);
    setError(null);
    const res = await deleteAiBrainDocument(d.id);
    setDeletingId(null);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    await load();
  };

  if (sessionLoading || !session) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center font-serif text-[11px] uppercase tracking-widest text-black/50">
        Loading…
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SketchPageHeader
        title="Knowledge"
        actions={
          <button type="button" onClick={() => void load()} disabled={loading} className={sketchButton}>
            <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} aria-hidden />
            Refresh
          </button>
        }
      />

      <p className="mb-4 max-w-xl font-serif text-[11px] uppercase tracking-widest text-black/50">
        Documents ingested into your AI Brain. Upload more from{" "}
        <Link href={brainHref} className="text-black underline underline-offset-2">
          AI Brain
        </Link>
        .
      </p>

      {error ? (
        <p className="mb-4 border border-black px-3 py-2 text-[13px] text-black">{error}</p>
      ) : null}

      <SketchBox className="flex min-h-0 flex-1 flex-col gap-2 p-3">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16">
            <Loader2 className="size-5 animate-spin text-black" aria-hidden />
            <span className={sketchLabel}>Loading documents…</span>
          </div>
        ) : documents.length === 0 ? (
          <p className="py-12 text-center font-serif text-[11px] uppercase tracking-widest text-black/50">
            No documents yet — open AI Brain to ingest
          </p>
        ) : (
          documents.map((d) => (
            <SketchRow key={d.id} className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-[13px] text-black">{d.title}</div>
                <div className="font-serif text-[10px] uppercase text-black/50">
                  {d.collectionName} · {d.ingestStatus} · {d.chunkCount} chunks
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="font-mono text-[10px] text-black/40">{formatShortDate(d.createdAt)}</span>
                {manageKnowledge ? (
                  <button
                    type="button"
                    disabled={deletingId !== null}
                    onClick={() => void onDelete(d)}
                    className={sketchButton}
                  >
                    {deletingId === d.id ? (
                      <Loader2 className="size-3.5 animate-spin" aria-hidden />
                    ) : (
                      <Trash2 className="size-3.5" aria-hidden />
                    )}
                    Remove
                  </button>
                ) : null}
              </div>
            </SketchRow>
          ))
        )}
      </SketchBox>
    </div>
  );
}
