"use client";

import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { FileText, Loader2, Upload, X } from "lucide-react";
import {
  ingestAiBrainDocument,
  ingestAiBrainDocumentFromFile,
} from "@/lib/ai-brain-api";
import type { GtmKnowledgeCollection } from "@/lib/gtm-api";

const FILE_ACCEPT =
  ".pdf,.doc,.docx,.txt,.md,.markdown,.json,.csv,.html,.htm,.xml,.yml,.yaml,.ts,.tsx,.js,.jsx,.py,.go,.rs,.sql";

type IngestMode = "upload" | "paste";

const PURPOSE_HINTS: Record<string, string> = {
  company_positioning: "Pitch decks, website copy, capability statements",
  offers_qualification: "Pricing sheets, offer one-pagers, qualification rules",
  proof_case_studies: "Case studies, testimonials, outcome reports",
  discovery_playbooks: "Discovery questions, objection handling, rubrics",
};

export function GtmKnowledgeIngestPanel({
  collections,
  disabled,
  onIngested,
  onError,
}: {
  readonly collections: readonly GtmKnowledgeCollection[];
  readonly disabled?: boolean;
  readonly onIngested: () => void;
  readonly onError: (message: string) => void;
}) {
  const [mode, setMode] = useState<IngestMode>("upload");
  const [collectionId, setCollectionId] = useState(collections[0]?.collectionId ?? "");
  const [title, setTitle] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [markReviewed, setMarkReviewed] = useState(true);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; name: string } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileInputKey = files.length;

  useEffect(() => {
    if (!collectionId && collections[0]) setCollectionId(collections[0].collectionId);
  }, [collections, collectionId]);

  const selected = collections.find((c) => c.collectionId === collectionId);
  const purposeHint = selected ? PURPOSE_HINTS[selected.purpose] : undefined;

  const resetForm = useCallback(() => {
    setTitle("");
    setBodyText("");
    setFiles([]);
    setProgress(null);
  }, []);

  async function runIngest() {
    if (!collectionId) {
      onError("Initialize GTM collections first.");
      return;
    }
    if (mode === "upload" && files.length === 0) {
      onError("Choose at least one file to upload.");
      return;
    }
    if (mode === "paste" && !bodyText.trim()) {
      onError("Paste some text or switch to Upload.");
      return;
    }
    if (mode === "paste" && !title.trim()) {
      onError("Add a title for pasted text.");
      return;
    }

    setBusy(true);
    onError("");

    if (mode === "upload") {
      for (let i = 0; i < files.length; i++) {
        const file = files[i]!;
        setProgress({ done: i, total: files.length, name: file.name });
        const res = await ingestAiBrainDocumentFromFile(collectionId, file, { markReviewed });
        if (!res.ok) {
          setBusy(false);
          setProgress(null);
          onError(`${file.name}: ${res.message}`);
          return;
        }
      }
    } else {
      const res = await ingestAiBrainDocument(collectionId, {
        title: title.trim(),
        bodyText: bodyText.trim(),
        markReviewed,
      });
      if (!res.ok) {
        setBusy(false);
        onError(res.message);
        return;
      }
    }

    setBusy(false);
    setProgress(null);
    resetForm();
    onIngested();
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragOver(false);
    const dropped = Array.from(event.dataTransfer.files ?? []);
    if (dropped.length) setFiles((prev) => [...prev, ...dropped]);
  }

  if (collections.length === 0) {
    return (
      <p className="text-[12px] leading-relaxed text-black/50">
        Initialize GTM Brain collections above, then add company docs or paste text here.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="mb-1.5 block font-serif text-[10px] uppercase tracking-widest text-black/50">GTM collection</span>
        <select
          value={collectionId}
          disabled={disabled || busy}
          onChange={(event) => setCollectionId(event.target.value)}
          className="w-full border border-black/25 bg-transparent px-3 py-2 text-[13px] text-black outline-none focus:border-black"
        >
          {collections.map((collection) => (
            <option key={collection.collectionId} value={collection.collectionId}>
              {collection.name.replace("GTM · ", "")}
            </option>
          ))}
        </select>
        {purposeHint ? <p className="mt-1 text-[10px] text-black/40">{purposeHint}</p> : null}
      </label>

      <div className="inline-flex border border-black/20 p-0.5" role="tablist" aria-label="Add knowledge method">
        {(
          [
            { id: "upload" as const, label: "Upload files", icon: Upload },
            { id: "paste" as const, label: "Paste text", icon: FileText },
          ] as const
        ).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={mode === id}
            disabled={disabled || busy}
            onClick={() => setMode(id)}
            className={
              mode === id
                ? "flex items-center gap-1.5 bg-black px-3 py-1.5 font-serif text-[9px] uppercase tracking-widest text-white"
                : "flex items-center gap-1.5 px-3 py-1.5 font-serif text-[9px] uppercase tracking-widest text-black/50"
            }
          >
            <Icon className="size-3" aria-hidden />
            {label}
          </button>
        ))}
      </div>

      {mode === "upload" ? (
        <div
          onDragEnter={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={(e) => {
            e.preventDefault();
            if (e.currentTarget.contains(e.relatedTarget as Node)) return;
            setDragOver(false);
          }}
          onDrop={onDrop}
          className={
            dragOver
              ? "border border-dashed border-black bg-black/[0.03] px-4 py-8 text-center"
              : "border border-dashed border-black/25 px-4 py-8 text-center"
          }
        >
          <input
            key={fileInputKey}
            ref={fileInputRef}
            type="file"
            multiple
            accept={FILE_ACCEPT}
            className="sr-only"
            disabled={disabled || busy}
            onChange={(e) => {
              setFiles((prev) => [...prev, ...Array.from(e.target.files ?? [])]);
              e.target.value = "";
            }}
          />
          <Upload className="mx-auto mb-2 size-5 text-black/35" aria-hidden />
          <p className="text-[12px] text-black">
            Drop files or{" "}
            <button
              type="button"
              disabled={disabled || busy}
              onClick={() => fileInputRef.current?.click()}
              className="underline underline-offset-2"
            >
              browse
            </button>
          </p>
          <p className="mt-1 text-[10px] text-black/40">PDF, Word, spreadsheets, Markdown, plain text</p>
        </div>
      ) : (
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1.5 block font-serif text-[10px] uppercase tracking-widest text-black/50">Title</span>
            <input
              value={title}
              disabled={disabled || busy}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Company overview"
              className="w-full border border-black/25 bg-transparent px-3 py-2 text-[13px] outline-none focus:border-black"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block font-serif text-[10px] uppercase tracking-widest text-black/50">Text</span>
            <textarea
              rows={5}
              value={bodyText}
              disabled={disabled || busy}
              onChange={(e) => setBodyText(e.target.value)}
              placeholder="Paste positioning, ICP notes, case study copy…"
              className="w-full border border-black/25 bg-transparent px-3 py-2.5 text-[13px] leading-relaxed outline-none focus:border-black"
            />
          </label>
        </div>
      )}

      {files.length > 0 ? (
        <ul className="space-y-1">
          {files.map((file, index) => (
            <li key={`${file.name}-${index}`} className="flex items-center justify-between gap-2 text-[11px] text-black/70">
              <span className="truncate">{file.name}</span>
              <button
                type="button"
                disabled={busy}
                onClick={() => setFiles((prev) => prev.filter((_, i) => i !== index))}
                className="shrink-0 text-black/40 hover:text-black"
                aria-label={`Remove ${file.name}`}
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <label className="flex items-start gap-2 text-[11px] leading-relaxed text-black/55">
        <input
          type="checkbox"
          checked={markReviewed}
          disabled={disabled || busy}
          onChange={(e) => setMarkReviewed(e.target.checked)}
          className="mt-0.5"
        />
        <span>
          Treat as reviewed — Exa can use this immediately in GTM setup chat. Leave unchecked for raw material you still want to review in Knowledge.
        </span>
      </label>

      {progress ? (
        <p className="text-[11px] text-black/45">
          Adding {progress.done + 1} of {progress.total}: {progress.name}
        </p>
      ) : null}

      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => void runIngest()}
        className="border border-black bg-black px-4 py-2 font-serif text-[10px] uppercase tracking-widest text-white disabled:opacity-50"
      >
        {busy ? (
          <span className="inline-flex items-center gap-2">
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
            Adding…
          </span>
        ) : mode === "upload" && files.length > 1 ? (
          `Add ${files.length} files`
        ) : (
          "Add to GTM knowledge"
        )}
      </button>
    </div>
  );
}
