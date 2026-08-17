"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type ReactNode,
} from "react";
import {
  Check,
  ChevronDown,
  FileText,
  FolderPlus,
  Loader2,
  Plus,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import {
  SketchBox,
  SketchListSkeleton,
  sketchButtonGhost,
  sketchButtonPrimary,
  sketchInput,
  sketchLabel,
} from "@/components/qlix/sketch";
import {
  createAiBrainCollection,
  ingestAiBrainDocument,
  ingestAiBrainDocumentFromFile,
  type AiBrainStatusResponse,
} from "@/lib/ai-brain-api";

type Collection = AiBrainStatusResponse["knowledge"]["collections"][number];
type IngestMode = "upload" | "paste";

const INK_SOFT = "text-[color:var(--ink-soft)]";
const INK_FAINT = "text-[color:var(--ink-faint)]";
const HAIRLINE = "border-[color:var(--ink-border)]";

const FILE_ACCEPT =
  ".pdf,.doc,.docx,.docm,.ppt,.pptx,.pptm,.pps,.ppsx,.xls,.xlsx,.xlsm,.xlsb,.odt,.ods,.odp,.epub,.txt,.md,.csv,.tsv,.json,.jsonl,.ndjson,.ipynb,.html,.htm,.xml,.svg,.yaml,.yml,.rtf,.log,.sql,.js,.jsx,.ts,.tsx,.py,.java,.c,.cc,.cpp,.h,.hpp,.go,.rs,.rb,.php,.swift,.kt,.kts,.scala,.lua,.pl,.css,.scss,.less,.sh,.bash,.env,.toml,.ini,.conf,.config,.properties,.rst,.tex,.srt,.vtt,.eml,.ics,text/*,application/json,application/pdf";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function mergeFiles(prev: File[], next: File[]): File[] {
  const existing = new Set(prev.map((f) => `${f.name}:${f.size}:${f.lastModified}`));
  return [...prev, ...next.filter((f) => !existing.has(`${f.name}:${f.size}:${f.lastModified}`))];
}

export interface BrainKnowledgePanelProps {
  readonly brainReady: boolean;
  readonly loading: boolean;
  readonly manageBrain: boolean;
  readonly collections: readonly Collection[];
  readonly totalDocs: number;
  readonly knowledgeHref: string;
  readonly selectedCollectionId: string;
  readonly onSelectCollection: (id: string) => void;
  readonly onRefresh: () => Promise<void>;
  readonly onError: (message: string | null) => void;
  readonly onTrace: (tone: "accent" | "success" | "danger", label: string, detail: string) => void;
  /** Increment to open the create-collection dialog from a parent action. */
  readonly openCreateSignal?: number;
}

export function BrainKnowledgePanel({
  brainReady,
  loading,
  manageBrain,
  collections,
  totalDocs,
  knowledgeHref,
  selectedCollectionId,
  onSelectCollection,
  onRefresh,
  onError,
  onTrace,
  openCreateSignal = 0,
}: BrainKnowledgePanelProps) {
  const [collectionName, setCollectionName] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [ingestMode, setIngestMode] = useState<IngestMode>("upload");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [ingestFiles, setIngestFiles] = useState<File[]>([]);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [docTitle, setDocTitle] = useState("");
  const [docBody, setDocBody] = useState("");
  const [ingestProgress, setIngestProgress] = useState<{
    done: number;
    total: number;
    currentName: string;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const createInputRef = useRef<HTMLInputElement>(null);

  const selected = collections.find((c) => c.id === selectedCollectionId) ?? null;

  const openCreate = useCallback(() => {
    setCreateOpen(true);
    setCollectionName("");
    setTimeout(() => createInputRef.current?.focus(), 50);
  }, []);

  const lastCreateSignal = useRef(0);
  useEffect(() => {
    if (openCreateSignal > lastCreateSignal.current) {
      lastCreateSignal.current = openCreateSignal;
      openCreate();
    }
  }, [openCreateSignal, openCreate]);

  const onCreateCollection = async () => {
    if (!collectionName.trim()) return;
    setBusyKey("collection");
    onError(null);
    const res = await createAiBrainCollection({ name: collectionName.trim(), description: "" });
    setBusyKey(null);
    if (!res.ok) {
      onError(res.message);
      return;
    }
    onTrace("accent", "COLLECTION", `Created "${collectionName.trim()}".`);
    setCollectionName("");
    setCreateOpen(false);
    onSelectCollection(res.id);
    await onRefresh();
  };

  const addFiles = (files: File[]) => {
    if (files.length === 0) return;
    setIngestFiles((prev) => mergeFiles(prev, files));
    setIngestMode("upload");
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    addFiles(Array.from(e.dataTransfer.files ?? []));
  };

  const onIngest = async () => {
    if (!selectedCollectionId) return;
    if (ingestMode === "upload" && ingestFiles.length === 0) {
      onError("Choose at least one file to ingest.");
      return;
    }
    if (ingestMode === "paste" && !docBody.trim()) {
      onError("Paste some text to ingest, or switch to Upload.");
      return;
    }

    setBusyKey("ingest");
    onError(null);

    if (ingestMode === "upload") {
      let totalChunks = 0;
      const errors: string[] = [];
      for (let i = 0; i < ingestFiles.length; i++) {
        const file = ingestFiles[i]!;
        setIngestProgress({ done: i, total: ingestFiles.length, currentName: file.name });
        const res = await ingestAiBrainDocumentFromFile(selectedCollectionId, file);
        if (res.ok) {
          totalChunks += res.chunkCount;
          onTrace("success", "INGEST", `${file.name} · ${res.chunkCount} chunk(s)`);
        } else {
          errors.push(`${file.name}: ${res.message}`);
          onTrace("danger", "INGEST", `Failed: ${file.name} — ${res.message}`);
        }
      }
      setIngestProgress(null);
      setBusyKey(null);
      if (errors.length > 0) onError(errors.join("\n"));
      if (totalChunks > 0) {
        setIngestFiles([]);
        setFileInputKey((k) => k + 1);
        await onRefresh();
      }
      return;
    }

    const res = await ingestAiBrainDocument(selectedCollectionId, {
      title: docTitle.trim() || "Pasted document",
      bodyText: docBody.trim(),
    });
    setBusyKey(null);
    if (!res.ok) {
      onError(res.message);
      return;
    }
    onTrace("success", "INGEST", `Indexed document · ${res.chunkCount} chunk(s).`);
    setDocTitle("");
    setDocBody("");
    await onRefresh();
  };

  if (!brainReady) {
    return (
      <section>
        <KnowledgeHeader totalDocs={0} knowledgeHref={knowledgeHref} />
        <p className={cn("mt-6 text-[13px]", INK_SOFT)}>
          Provision the brain agent to manage collections.
        </p>
      </section>
    );
  }

  if (loading && collections.length === 0) {
    return (
      <section>
        <KnowledgeHeader totalDocs={totalDocs} knowledgeHref={knowledgeHref} />
        <SketchBox className="mt-5 p-3">
          <SketchListSkeleton rows={4} />
        </SketchBox>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <KnowledgeHeader
        totalDocs={totalDocs}
        knowledgeHref={knowledgeHref}
        actions={
          manageBrain ? (
            <button type="button" onClick={openCreate} className={sketchButtonPrimary}>
              <FolderPlus className="size-3.5" aria-hidden />
              New collection
            </button>
          ) : null
        }
      />

      {/* Collections */}
      <SketchBox className="overflow-hidden">
        {collections.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-16 text-center">
            <div className="qlix-empty-glow mb-6 size-11 rounded-2xl border border-black/12 bg-[var(--sketch-tint-purple)]" />
            <p className="text-[15px] font-medium text-black">No collections yet</p>
            <p className={cn("mt-1.5 max-w-sm text-[12.5px] leading-relaxed", INK_SOFT)}>
              Collections group related documents for RAG — create one, then ingest files or paste
              text.
            </p>
            {manageBrain ? (
              <button
                type="button"
                onClick={openCreate}
                className={cn(sketchButtonPrimary, "mt-6")}
              >
                Create your first collection
              </button>
            ) : null}
          </div>
        ) : (
          <div className="divide-y divide-black/10">
            {collections.map((c, index) => {
              const selectedRow = c.id === selectedCollectionId;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onSelectCollection(c.id)}
                  className={cn(
                    "agents-list-row group flex w-full items-center gap-4 px-5 py-4 text-left transition-colors",
                    selectedRow ? "bg-white/70" : "hover:bg-white/55",
                  )}
                  style={{ animationDelay: `${index * 40}ms` } as CSSProperties}
                  aria-pressed={selectedRow}
                >
                  <span
                    className={cn(
                      "relative grid size-9 shrink-0 place-items-center rounded-xl border bg-white/70",
                      HAIRLINE,
                      selectedRow && "border-black/25 bg-black text-white",
                    )}
                    aria-hidden
                  >
                    <FileText className="size-4" strokeWidth={1.5} />
                    {selectedRow ? (
                      <span className="absolute -bottom-0.5 -right-0.5 grid size-4 place-items-center rounded-full bg-[color:var(--sketch-green)] text-white ring-2 ring-white">
                        <Check className="size-2.5" strokeWidth={3} />
                      </span>
                    ) : null}
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-medium text-black">{c.name}</p>
                    <p className={cn("mt-0.5 truncate text-[11.5px]", INK_SOFT)}>
                      {c.description?.trim() || "Org-scoped knowledge for RAG"}
                      <span className={INK_FAINT}> · </span>
                      <span className="tabular-nums">
                        {c.documentCount} doc{c.documentCount === 1 ? "" : "s"}
                      </span>
                    </p>
                  </div>

                  <span
                    className={cn(
                      "shrink-0 rounded-full border px-2.5 py-1 text-[10.5px] font-medium uppercase tracking-[0.12em]",
                      HAIRLINE,
                      selectedRow ? "bg-black text-white" : INK_SOFT,
                    )}
                  >
                    {selectedRow ? "Selected" : "Select"}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </SketchBox>

      {/* Ingest */}
      {manageBrain ? (
        <SketchBox className="overflow-hidden">
          <div className="border-b border-[color:var(--ink-border)] px-5 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className={sketchLabel}>Ingest</p>
                <p className={cn("mt-1.5 text-[12.5px] leading-relaxed", INK_SOFT)}>
                  Add documents into the selected collection for retrieval.
                </p>
              </div>

              {/* Custom collection picker — replaces native select */}
              <div className="relative">
                <button
                  type="button"
                  disabled={collections.length === 0}
                  onClick={() => setPickerOpen((o) => !o)}
                  className={cn(
                    "inline-flex min-w-[11rem] items-center justify-between gap-2 rounded-full border bg-white/70 px-3.5 py-2 text-[12px] transition-colors",
                    HAIRLINE,
                    collections.length === 0 && "opacity-40",
                  )}
                  aria-haspopup="listbox"
                  aria-expanded={pickerOpen}
                >
                  <span className="truncate font-medium text-black">
                    {selected?.name ?? "No collection"}
                  </span>
                  <ChevronDown
                    className={cn("size-3.5 shrink-0 transition-transform", INK_FAINT, pickerOpen && "rotate-180")}
                    aria-hidden
                  />
                </button>
                {pickerOpen ? (
                  <>
                    <button
                      type="button"
                      className="fixed inset-0 z-10 cursor-default"
                      aria-label="Close collection menu"
                      onClick={() => setPickerOpen(false)}
                    />
                    <ul
                      role="listbox"
                      className="absolute right-0 z-20 mt-1.5 max-h-56 min-w-[14rem] overflow-y-auto rounded-2xl border border-black/12 bg-white/95 py-1.5 shadow-[var(--sketch-shadow-hover)] backdrop-blur-xl"
                    >
                      {collections.map((c) => {
                        const active = c.id === selectedCollectionId;
                        return (
                          <li key={c.id} role="option" aria-selected={active}>
                            <button
                              type="button"
                              onClick={() => {
                                onSelectCollection(c.id);
                                setPickerOpen(false);
                              }}
                              className={cn(
                                "flex w-full items-center justify-between gap-3 px-3.5 py-2 text-left text-[12.5px] transition-colors",
                                active ? "bg-black/[0.04] font-medium text-black" : cn(INK_SOFT, "hover:bg-black/[0.03] hover:text-black"),
                              )}
                            >
                              <span className="truncate">{c.name}</span>
                              <span className={cn("tabular-nums text-[11px]", INK_FAINT)}>
                                {c.documentCount}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </>
                ) : null}
              </div>
            </div>

            {/* Mode tabs */}
            <div
              className={cn("mt-4 inline-flex rounded-full border bg-white/50 p-1", HAIRLINE)}
              role="tablist"
              aria-label="Ingest method"
            >
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
                  aria-selected={ingestMode === id}
                  onClick={() => setIngestMode(id)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[11px] font-medium uppercase tracking-[0.12em] transition-colors",
                    ingestMode === id
                      ? "bg-black text-white"
                      : cn(INK_SOFT, "hover:text-black"),
                  )}
                >
                  <Icon className="size-3" aria-hidden />
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-4 px-5 py-5">
            {collections.length === 0 ? (
              <p className={cn("text-[13px]", INK_SOFT)}>
                Create a collection first, then come back to ingest.
              </p>
            ) : ingestMode === "upload" ? (
              <>
                <div
                  onDragEnter={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault();
                    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                    setDragOver(false);
                  }}
                  onDrop={onDrop}
                  className={cn(
                    "relative flex flex-col items-center justify-center rounded-2xl border border-dashed px-6 py-10 text-center transition-colors",
                    dragOver
                      ? "border-black bg-black/[0.03]"
                      : "border-black/20 bg-white/40 hover:border-black/35 hover:bg-white/55",
                  )}
                >
                  <input
                    key={fileInputKey}
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept={FILE_ACCEPT}
                    className="sr-only"
                    onChange={(e) => {
                      addFiles(Array.from(e.target.files ?? []));
                      e.target.value = "";
                    }}
                  />
                  <span
                    className={cn(
                      "mb-3 grid size-10 place-items-center rounded-2xl border bg-white/80",
                      HAIRLINE,
                    )}
                    aria-hidden
                  >
                    <Upload className="size-4 text-black" strokeWidth={1.5} />
                  </span>
                  <p className="text-[13.5px] font-medium text-black">
                    Drop files here, or{" "}
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="underline underline-offset-2 hover:opacity-70"
                    >
                      browse
                    </button>
                  </p>
                  <p className={cn("mt-1.5 max-w-md text-[11.5px] leading-relaxed", INK_FAINT)}>
                    PDF, Word, spreadsheets, Markdown, JSON, HTML, code, and plain text
                  </p>
                </div>

                {ingestFiles.length > 0 ? (
                  <ul className="space-y-1.5">
                    {ingestFiles.map((f, i) => (
                      <li
                        key={`${f.name}-${f.size}-${f.lastModified}-${i}`}
                        className={cn(
                          "flex items-center gap-3 rounded-xl border bg-white/60 px-3.5 py-2.5",
                          HAIRLINE,
                        )}
                      >
                        <FileText className={cn("size-3.5 shrink-0", INK_FAINT)} aria-hidden />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[12.5px] font-medium text-black">{f.name}</p>
                          <p className={cn("text-[11px]", INK_FAINT)}>{formatFileSize(f.size)}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setIngestFiles((prev) => prev.filter((_, idx) => idx !== i))}
                          aria-label={`Remove ${f.name}`}
                          className={cn(
                            "grid size-7 shrink-0 place-items-center rounded-full transition-colors hover:bg-[color:var(--sketch-red-soft)] hover:text-[color:var(--sketch-red)]",
                            INK_FAINT,
                          )}
                        >
                          <Trash2 className="size-3.5" aria-hidden />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            ) : (
              <div className="space-y-3">
                <input
                  value={docTitle}
                  onChange={(e) => setDocTitle(e.target.value)}
                  placeholder="Title (optional)"
                  className={sketchInput}
                  aria-label="Document title"
                />
                <textarea
                  value={docBody}
                  onChange={(e) => setDocBody(e.target.value)}
                  placeholder="Paste document text…"
                  rows={7}
                  className={cn(sketchInput, "min-h-[160px] resize-y leading-relaxed")}
                  aria-label="Document body"
                />
              </div>
            )}

            {ingestProgress ? (
              <div className={cn("rounded-xl border bg-white/60 px-4 py-3", HAIRLINE)}>
                <div className="mb-2 flex items-center justify-between text-[12px]">
                  <span className={INK_SOFT}>
                    Ingesting {ingestProgress.done + 1} of {ingestProgress.total}…
                  </span>
                  <span className={cn("tabular-nums", INK_FAINT)}>
                    {Math.round((ingestProgress.done / Math.max(ingestProgress.total, 1)) * 100)}%
                  </span>
                </div>
                <div className="h-1 overflow-hidden rounded-full bg-black/8">
                  <div
                    className="h-full rounded-full bg-[color:var(--sketch-purple)] transition-all duration-300"
                    style={{
                      width: `${(ingestProgress.done / Math.max(ingestProgress.total, 1)) * 100}%`,
                    }}
                  />
                </div>
                <p className={cn("mt-2 truncate text-[11px]", INK_FAINT)}>
                  {ingestProgress.currentName}
                </p>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <p className={cn("text-[11.5px]", INK_FAINT)}>
                {selected
                  ? `Destination · ${selected.name}`
                  : "Select a collection above to continue"}
              </p>
              <button
                type="button"
                disabled={
                  busyKey !== null ||
                  !selectedCollectionId ||
                  (ingestMode === "upload" ? ingestFiles.length === 0 : !docBody.trim())
                }
                onClick={() => void onIngest()}
                className={sketchButtonPrimary}
              >
                {busyKey === "ingest" ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                    {ingestProgress
                      ? `${ingestProgress.done + 1}/${ingestProgress.total}`
                      : "Ingesting…"}
                  </>
                ) : ingestMode === "upload" && ingestFiles.length > 1 ? (
                  `Ingest ${ingestFiles.length} files`
                ) : (
                  "Ingest"
                )}
              </button>
            </div>
          </div>
        </SketchBox>
      ) : (
        <p className={cn("text-[13px]", INK_SOFT)}>
          Only owners and admins can manage collections and ingest.
        </p>
      )}

      {/* Create collection modal */}
      {createOpen ? (
        <div className="qlix-backdrop-in fixed inset-0 z-50 flex items-center justify-center bg-white/70 p-4 backdrop-blur-sm">
          <div className="qlix-scale-in w-full max-w-sm rounded-2xl border border-black/12 bg-white/95 p-6 shadow-[var(--sketch-shadow-hover)] backdrop-blur-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className={sketchLabel}>New collection</h2>
                <p className={cn("mt-2 text-[12.5px] leading-relaxed", INK_SOFT)}>
                  A named folder for related documents your agents can retrieve.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                aria-label="Close"
                className={cn(
                  "grid size-7 shrink-0 place-items-center rounded-full transition-colors hover:bg-black/[0.05]",
                  INK_FAINT,
                )}
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </div>
            <input
              ref={createInputRef}
              type="text"
              value={collectionName}
              onChange={(e) => setCollectionName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void onCreateCollection();
                if (e.key === "Escape") setCreateOpen(false);
              }}
              placeholder="e.g. Product handbook"
              autoComplete="off"
              className={cn(sketchInput, "mt-4")}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setCreateOpen(false)} className={sketchButtonGhost}>
                Cancel
              </button>
              <button
                type="button"
                disabled={busyKey !== null || !collectionName.trim()}
                onClick={() => void onCreateCollection()}
                className={sketchButtonPrimary}
              >
                {busyKey === "collection" ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                    Creating…
                  </>
                ) : (
                  <>
                    <Plus className="size-3.5" aria-hidden />
                    Create
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function KnowledgeHeader({
  totalDocs,
  knowledgeHref,
  actions,
}: {
  readonly totalDocs: number;
  readonly knowledgeHref: string;
  readonly actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="h-5 w-[3px] rounded-full bg-[color:var(--sketch-purple)]"
          />
          <h2 className={cn(sketchLabel, "text-[13px] font-bold tracking-[0.18em] text-black")}>
            Knowledge
          </h2>
        </div>
        <p className={cn("mt-2 max-w-lg pl-[15px] text-[13px] leading-relaxed", INK_SOFT)}>
          {totalDocs > 0 ? (
            <>
              <span className="tabular-nums text-black">{totalDocs}</span> document
              {totalDocs === 1 ? "" : "s"} indexed
              <span className={INK_FAINT}> · </span>
            </>
          ) : null}
          <Link
            href={knowledgeHref}
            className="text-black underline-offset-2 transition-opacity hover:underline hover:opacity-70"
          >
            Open library
          </Link>
        </p>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
