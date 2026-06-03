"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { BookOpen, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { ReflectiveCard } from "@/components/qlix/ReflectiveCard";
import { useSession } from "@/components/qlix/session-context";
import { consoleRoutePrefix } from "@/lib/workspace";
import {
  deleteAiBrainDocument,
  getAiBrainKnowledgeDocuments,
  type AiBrainKnowledgeDocumentRow,
} from "@/lib/ai-brain-api";
import { canManageBrain } from "@/lib/org-permissions";
import { cn } from "@/lib/utils/cn";

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
      `Remove “${d.title}” from this collection?\n\nChunks and embeddings for this document will be deleted. This cannot be undone.`,
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
      <div className="flex min-h-[40vh] items-center justify-center text-[13px] text-[--text-tertiary]">Loading…</div>
    );
  }

  return (
    <div className="animate-qlix-fade-in mx-auto max-w-5xl space-y-5 px-4 pb-16 pt-4 md:px-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="qlix-glass-muted flex size-9 shrink-0 items-center justify-center rounded-lg text-[--accent]">
            <BookOpen className="size-[18px]" strokeWidth={1.75} aria-hidden />
          </div>
          <div>
            <h1 className="text-base font-medium tracking-[-0.01em] text-[--text-primary]">Knowledge</h1>
            <p className="mt-1 max-w-xl text-[13px] leading-relaxed text-[--text-tertiary]">
              Documents ingested into your org AI Brain, grouped by collection. Upload more from{" "}
              <Link href={brainHref} className="font-medium text-[--accent] hover:underline">
                AI Brain
              </Link>
              .
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-2 self-start rounded-lg border border-[--border-subtle] px-3 py-2 text-[12px] font-medium text-[--text-secondary] hover:bg-[--bg-hover] disabled:opacity-50"
        >
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} aria-hidden />
          Refresh
        </button>
      </header>

      {error ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[13px] text-amber-200">{error}</div>
      ) : null}

      <ReflectiveCard className="rounded-xl" contentClassName="p-0 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-[13px] text-[--text-tertiary]">
            <Loader2 className="size-5 animate-spin text-[--accent]" aria-hidden />
            Loading documents…
          </div>
        ) : documents.length === 0 ? (
          <div className="px-4 py-12 text-center text-[13px] text-[--text-tertiary]">
            <p>No uploaded documents yet.</p>
            <p className="mt-2">
              <Link href={brainHref} className="font-medium text-[--accent] hover:underline">
                Open AI Brain
              </Link>{" "}
              to create a collection and ingest files or text.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-left text-[13px]">
              <thead>
                <tr className="border-b border-[--border-subtle] bg-[var(--glass-inset-bg)]/50 text-[11px] font-medium uppercase tracking-wider text-[--text-tertiary]">
                  <th className="px-4 py-3 font-medium">Title</th>
                  <th className="px-4 py-3 font-medium">Collection</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium text-right">Chunks</th>
                  <th className="px-4 py-3 font-medium">Added</th>
                  {manageKnowledge ? (
                    <th className="px-4 py-3 font-medium text-right">Actions</th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {documents.map((d) => (
                  <tr key={d.id} className="border-b border-[--border-subtle]/80 hover:bg-[--bg-hover]/40">
                    <td className="max-w-[240px] px-4 py-3">
                      <span className="font-medium text-[--text-primary]" title={d.title}>
                        {d.title}
                      </span>
                      {d.sourceUri ? (
                        <p className="mt-0.5 truncate font-mono text-[10px] text-[--text-tertiary]" title={d.sourceUri}>
                          {d.sourceUri}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-[--text-secondary]">{d.collectionName}</td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "inline-block rounded-full px-2 py-0.5 text-[11px] font-medium capitalize",
                          d.ingestStatus === "ready"
                            ? "bg-emerald-500/15 text-emerald-200"
                            : d.ingestStatus === "failed"
                              ? "bg-red-500/15 text-red-200"
                              : "bg-amber-500/15 text-amber-100",
                        )}
                      >
                        {d.ingestStatus}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-[--text-secondary]">{d.chunkCount}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-[12px] text-[--text-tertiary]">
                      {formatShortDate(d.createdAt)}
                    </td>
                    {manageKnowledge ? (
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          disabled={deletingId !== null}
                          onClick={() => void onDelete(d)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/35 bg-red-500/10 px-2.5 py-1.5 text-[11px] font-medium text-red-200 transition-colors hover:bg-red-500/20 disabled:opacity-40"
                          title="Remove document from knowledge"
                        >
                          {deletingId === d.id ? (
                            <Loader2 className="size-3.5 animate-spin" aria-hidden />
                          ) : (
                            <Trash2 className="size-3.5" aria-hidden />
                          )}
                          Remove
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ReflectiveCard>
    </div>
  );
}
