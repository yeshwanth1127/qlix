"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Eye, Loader2, Pencil, RefreshCw, Save, ShieldCheck, Trash2, X } from "lucide-react";
import { useSession } from "@/components/qlix/session-context";
import { consoleRoutePrefix } from "@/lib/workspace";
import {
  deleteAiBrainDocument,
  getAiBrainKnowledgeDocument,
  getAiBrainKnowledgeDocuments,
  reviewAiBrainDocument,
  updateAiBrainKnowledgeDocument,
  type AiBrainKnowledgeDocumentDetail,
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
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AiBrainKnowledgeDocumentDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  function reviewLabel(status: string): string {
    if (status === "reviewed") return "Reviewed";
    if (status === "rejected") return "Rejected";
    return "Pending review";
  }

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
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
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

  const closeDocument = () => {
    setOpenId(null);
    setDetail(null);
    setEditing(false);
  };

  const onOpen = async (d: AiBrainKnowledgeDocumentRow, startEditing = false) => {
    if (openId === d.id && detail) {
      if (startEditing && manageKnowledge) setEditing(true);
      else if (!startEditing) closeDocument();
      return;
    }
    setOpenId(d.id);
    setDetail(null);
    setEditing(false);
    setDetailLoading(true);
    setError(null);
    const res = await getAiBrainKnowledgeDocument(d.id);
    setDetailLoading(false);
    if (!res.ok) {
      setError(res.message);
      setOpenId(null);
      return;
    }
    setDetail(res.document);
    setDraftTitle(res.document.title);
    setDraftBody(res.document.bodyText);
    setEditing(startEditing && manageKnowledge);
  };

  const onSave = async () => {
    if (!detail || !draftTitle.trim() || !draftBody.trim()) return;
    setSaving(true);
    setError(null);
    const res = await updateAiBrainKnowledgeDocument(detail.id, {
      title: draftTitle.trim(),
      bodyText: draftBody,
    });
    setSaving(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setDetail({ ...detail, title: draftTitle.trim(), bodyText: draftBody, updatedAt: res.updatedAt });
    setDocuments((prev) =>
      prev.map((document) =>
        document.id === detail.id
          ? { ...document, title: draftTitle.trim(), chunkCount: res.chunkCount }
          : document,
      ),
    );
    setEditing(false);
  };

  const onReview = async (d: AiBrainKnowledgeDocumentRow, reviewStatus: "reviewed" | "pending" | "rejected") => {
    if (!manageKnowledge) return;
    setReviewingId(d.id);
    setError(null);
    const res = await reviewAiBrainDocument(d.id, { reviewStatus });
    setReviewingId(null);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setDocuments((prev) =>
      prev.map((document) =>
        document.id === d.id
          ? {
              ...document,
              reviewStatus: res.reviewStatus,
              reviewedAt: res.reviewedAt,
            }
          : document,
      ),
    );
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
            <div key={d.id}>
              <SketchRow className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-[13px] text-black">{d.title}</div>
                  <div className="font-serif text-[10px] uppercase text-black/50">
                    {d.collectionName} · {d.ingestStatus} · {reviewLabel(d.reviewStatus)} · {d.chunkCount} chunks
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <span className="font-mono text-[10px] text-black/40">{formatShortDate(d.createdAt)}</span>
                  {manageKnowledge && d.reviewStatus !== "reviewed" ? (
                    <button
                      type="button"
                      disabled={reviewingId !== null}
                      onClick={() => void onReview(d, "reviewed")}
                      className={sketchButton}
                    >
                      {reviewingId === d.id ? (
                        <Loader2 className="size-3.5 animate-spin" aria-hidden />
                      ) : (
                        <ShieldCheck className="size-3.5" aria-hidden />
                      )}
                      Mark reviewed
                    </button>
                  ) : null}
                  {manageKnowledge && d.reviewStatus === "reviewed" ? (
                    <button
                      type="button"
                      disabled={reviewingId !== null}
                      onClick={() => void onReview(d, "pending")}
                      className={sketchButton}
                    >
                      {reviewingId === d.id ? (
                        <Loader2 className="size-3.5 animate-spin" aria-hidden />
                      ) : null}
                      Unreview
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void onOpen(d)}
                    className={sketchButton}
                  >
                    <Eye className="size-3.5" aria-hidden />
                    {openId === d.id ? "Close" : "View"}
                  </button>
                  {manageKnowledge ? (
                    <>
                      <button type="button" onClick={() => void onOpen(d, true)} className={sketchButton}>
                        <Pencil className="size-3.5" aria-hidden />
                        Edit
                      </button>
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
                    </>
                  ) : null}
                </div>
              </SketchRow>

              {openId === d.id ? (
                <div className="border-x border-b border-black bg-[#E2F0CC] p-4 md:p-5">
                  {detailLoading ? (
                    <div className="flex items-center justify-center gap-2 py-10">
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                      <span className={sketchLabel}>Loading document…</span>
                    </div>
                  ) : detail ? (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between gap-3">
                        <span className={sketchLabel}>{editing ? "Edit document" : "Document contents"}</span>
                        <button type="button" onClick={closeDocument} className={sketchButton} aria-label="Close document">
                          <X className="size-3.5" aria-hidden />
                          Close
                        </button>
                      </div>
                      {editing ? (
                        <>
                          <input
                            value={draftTitle}
                            onChange={(event) => setDraftTitle(event.target.value)}
                            className="w-full border border-black bg-[#E2F0CC] px-3 py-2 text-[13px] text-black outline-none focus:shadow-[0_0_0_3px_var(--sketch-purple-soft)]"
                            aria-label="Document title"
                          />
                          <textarea
                            value={draftBody}
                            onChange={(event) => setDraftBody(event.target.value)}
                            className="min-h-[320px] w-full resize-y border border-black bg-[#E2F0CC] px-3 py-3 font-mono text-[12px] leading-relaxed text-black outline-none focus:shadow-[0_0_0_3px_var(--sketch-purple-soft)]"
                            aria-label="Document contents"
                          />
                          <div className="flex flex-wrap justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setDraftTitle(detail.title);
                                setDraftBody(detail.bodyText);
                                setEditing(false);
                              }}
                              className={sketchButton}
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              disabled={saving || !draftTitle.trim() || !draftBody.trim()}
                              onClick={() => void onSave()}
                              className={sketchButton}
                            >
                              {saving ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Save className="size-3.5" aria-hidden />}
                              {saving ? "Saving…" : "Save changes"}
                            </button>
                          </div>
                        </>
                      ) : (
                        <div className="max-h-[480px] overflow-y-auto border border-black bg-[#E2F0CC] px-3 py-3 font-mono text-[12px] leading-relaxed text-black">
                          <p className="whitespace-pre-wrap">{detail.bodyText}</p>
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))
        )}
      </SketchBox>
    </div>
  );
}
