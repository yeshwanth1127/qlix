"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Brain,
  Database,
  Loader2,
  Plus,
  RefreshCw,
  ScrollText,
} from "lucide-react";
import { useSession } from "@/components/qlix/session-context";
import { cn } from "@/lib/utils/cn";
import {
  SketchBox,
  SketchPageHeader,
  sketchButton,
  sketchInput,
  sketchLabel,
} from "@/components/qlix/sketch";
import Dock, { type DockItemData } from "./Dock";
import Orb from "./Orb";
import { BrainOrbChat } from "./BrainOrbChat";
import {
  createAiBrainCollection,
  getAiBrainStatus,
  ingestAiBrainDocument,
  ingestAiBrainDocumentFromFile,
  postAiBrainConsoleOpen,
  type AiBrainStatusResponse,
} from "@/lib/ai-brain-api";
import { canManageBrain } from "@/lib/org-permissions";
import { deriveOrgBrainDisplayStatus } from "@/components/qlix/agents/agentStatus";

function formatTraceClock(ms: number): string {
  try {
    return new Date(ms).toISOString().slice(11, 23).replace("T", "");
  } catch {
    return "";
  }
}

type TraceTone = "accent" | "success" | "warning" | "danger" | "muted";

interface TraceEntry {
  readonly id: string;
  readonly at: number;
  readonly tone: TraceTone;
  readonly label: string;
  readonly detail: string;
}

const btnPrimary = sketchButton;
const btnSecondary = sketchButton;
const fieldBase = sketchInput;
const bentoCard = "border border-black bg-white overflow-hidden flex flex-col";

function BentoHeader({
  title,
  icon,
  trailing,
}: {
  title: string;
  icon?: ReactNode;
  trailing?: ReactNode;
  tint?: "violet" | "cyan" | "amber" | "emerald";
}) {
  return (
    <div className="border-b border-black px-4 py-3">
      <div className="flex items-center justify-between">
        <h2 className={sketchLabel}>{title}</h2>
        <div className="flex items-center gap-2 text-black [&_svg]:size-[18px]">
          {trailing}
          {icon}
        </div>
      </div>
    </div>
  );
}

function traceToneClass(tone: TraceTone): string {
  void tone;
  return "text-black/70";
}

type SectionId = "brain" | "knowledge" | "trace";

export function AiBrainConsoleView() {
  const pathname = usePathname();
  const dashBase = pathname.startsWith("/organization") ? "/organization" : "/individual";
  const knowledgeHref = `${dashBase}/knowledge`;

  const { session, loading: sessionLoading } = useSession();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<AiBrainStatusResponse | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [brainChatOpen, setBrainChatOpen] = useState(false);

  const [collectionName, setCollectionName] = useState("");
  const [docTitle, setDocTitle] = useState("");
  const [docBody, setDocBody] = useState("");
  const [selectedCollectionId, setSelectedCollectionId] = useState<string>("");
  const [ingestFiles, setIngestFiles] = useState<File[]>([]);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [ingestProgress, setIngestProgress] = useState<{ done: number; total: number; currentName: string } | null>(null);

  const [trace, setTrace] = useState<readonly TraceEntry[]>([]);

  const [activeSection, setActiveSection] = useState<SectionId>("brain");

  const role = session?.user.role ?? "member";
  const manageBrain = canManageBrain(role);

  const pushTrace = useCallback((tone: TraceTone, label: string, detail: string) => {
    setTrace((prev) => {
      const next: TraceEntry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        at: Date.now(),
        tone,
        label,
        detail,
      };
      return [...prev.slice(-80), next];
    });
  }, []);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    const s = await getAiBrainStatus();
    if (!s.ok) {
      setError(s.message);
      setStatus(null);
    } else {
      setStatus(s.data);
      const cols = s.data.knowledge.collections;
      setSelectedCollectionId((prev) => {
        if (cols.some((c) => c.id === prev)) return prev;
        return cols[0]?.id ?? "";
      });
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (sessionLoading || !session) return;
    void postAiBrainConsoleOpen();
    queueMicrotask(() => {
      void refreshAll();
    });
  }, [session, sessionLoading, refreshAll]);

  const onCreateCollection = async () => {
    if (!collectionName.trim()) return;
    setBusyKey("collection");
    setError(null);
    const res = await createAiBrainCollection({ name: collectionName.trim(), description: "" });
    setBusyKey(null);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    pushTrace("accent", "COLLECTION", `Created "${collectionName.trim()}".`);
    setCollectionName("");
    await refreshAll();
  };

  const onIngest = async () => {
    if (!selectedCollectionId) return;
    if (ingestFiles.length === 0 && !docBody.trim()) {
      setError("Choose at least one file or paste text below.");
      return;
    }
    setBusyKey("ingest");
    setError(null);

    if (ingestFiles.length > 0) {
      let totalChunks = 0;
      const errors: string[] = [];
      for (let i = 0; i < ingestFiles.length; i++) {
        const file = ingestFiles[i]!;
        setIngestProgress({ done: i, total: ingestFiles.length, currentName: file.name });
        const res = await ingestAiBrainDocumentFromFile(selectedCollectionId, file);
        if (res.ok) {
          totalChunks += res.chunkCount;
          pushTrace("success", "INGEST", `${file.name} · ${res.chunkCount} chunk(s)`);
        } else {
          errors.push(`${file.name}: ${res.message}`);
          pushTrace("danger", "INGEST", `Failed: ${file.name} — ${res.message}`);
        }
      }
      setIngestProgress(null);
      setBusyKey(null);
      if (errors.length > 0) setError(errors.join("\n"));
      if (totalChunks > 0) {
        setIngestFiles([]);
        setFileInputKey((k) => k + 1);
        await refreshAll();
      }
    } else {
      const res = await ingestAiBrainDocument(selectedCollectionId, {
        title: docTitle.trim() || "Pasted document",
        bodyText: docBody.trim(),
      });
      setBusyKey(null);
      if (!res.ok) { setError(res.message); return; }
      pushTrace("success", "INGEST", `Indexed document · ${res.chunkCount} chunk(s).`);
      setDocTitle("");
      setDocBody("");
      await refreshAll();
    }
  };

  const onRefresh = async () => {
    pushTrace("muted", "REFRESH", "Reloaded brain status.");
    await refreshAll();
  };

  const brain = status?.brain;
  const totalDocs = status?.knowledge.collections.reduce((n, c) => n + c.documentCount, 0) ?? 0;
  const brainDisplayStatus = brain ? deriveOrgBrainDisplayStatus({ status: brain.status }) : null;

  const dockItems: DockItemData[] = useMemo(
    () => [
      {
        icon: <Brain size={20} strokeWidth={1.5} />,
        label: "Brain",
        active: activeSection === "brain",
        onClick: () => setActiveSection("brain"),
      },
      {
        icon: <Database size={20} strokeWidth={1.5} />,
        label: "Knowledge",
        active: activeSection === "knowledge",
        onClick: () => setActiveSection("knowledge"),
      },
      {
        icon: <ScrollText size={20} strokeWidth={1.5} />,
        label: "Trace",
        active: activeSection === "trace",
        onClick: () => setActiveSection("trace"),
      },
    ],
    [activeSection],
  );

  return (
    <div className="mx-auto max-w-[1024px] px-4 pb-20 pt-6 md:px-6 md:pt-8">
      <SketchPageHeader
        title="exa"
        actions={
          <>
            <button
              type="button"
              disabled={loading || sessionLoading || busyKey !== null}
              onClick={() => void onRefresh()}
              className={sketchButton}
            >
              <RefreshCw className={cn("size-3.5", loading && "animate-spin")} aria-hidden />
              Sync
            </button>
            {manageBrain && brain ? (
              <button
                type="button"
                className={sketchButton}
                onClick={() => {
                  setActiveSection("knowledge");
                  setTimeout(() => document.getElementById("brain-collection-form")?.scrollIntoView({ behavior: "smooth" }), 60);
                }}
              >
                <Plus className="size-3.5" aria-hidden />
                Add collection
              </button>
            ) : null}
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3 text-[13px]">
        {brain ? (
          <>
            <span className="font-mono text-black/50">DID: {brain.didShort}</span>
            {brainDisplayStatus ? (
              <span className="font-serif text-[10px] uppercase tracking-widest text-black/50">{brainDisplayStatus}</span>
            ) : null}
          </>
        ) : (
          <span className="font-serif text-[10px] uppercase tracking-widest text-black/50">Not provisioned</span>
        )}
      </div>
      <p className="mb-8 max-w-xl text-[13px] leading-relaxed text-black/70">
        Centralized org knowledge for RAG. Queries and policy outcomes are attributed in your Exora Layer 5 audit trail.
      </p>

      {error ? (
        <SketchBox className="mb-6 px-4 py-3 text-[13px] text-black">{error}</SketchBox>
      ) : null}

      {/* Sub-navbar dock */}
      <div className="mb-8 flex justify-center pt-4">
        <Dock
          items={dockItems}
          panelHeight={64}
          baseItemSize={44}
          magnification={62}
          distance={150}
          dockHeight={92}
        />
      </div>

      <div className="space-y-6">
        {/* Brain — Orb is the identity / presence */}
        <section
          className={cn(
            "min-h-[min(520px,70dvh)] flex-col items-center justify-center px-4 py-12",
            activeSection === "brain" ? "flex" : "hidden",
          )}
        >
            {!brain ? (
              <p className="text-[13px] text-black/50">Brain agent unavailable.</p>
            ) : (
              <>
                <BrainOrbChat
                  open={brainChatOpen}
                  onOpenChange={setBrainChatOpen}
                  hideLauncher
                  embedded
                />
                {!brainChatOpen ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setBrainChatOpen(true)}
                      aria-label="Chat with exa"
                      aria-expanded={brainChatOpen}
                      className="group relative size-[min(340px,72vw)] overflow-hidden rounded-full border border-black bg-white transition-transform duration-300 hover:scale-[1.02] active:scale-[0.99]"
                    >
                      <Orb
                        hue={0}
                        hoverIntensity={0.45}
                        rotateOnHover
                        forceHoverState={brainChatOpen}
                        backgroundColor="#ffffff"
                      />
                    </button>
                    <p className="mt-8 font-serif text-[12px] uppercase tracking-[0.22em] text-black">
                      {brain.name || "exa"}
                    </p>
                    <p className="mt-2 max-w-sm text-center text-[13px] leading-relaxed text-black/55">
                      {loading || sessionLoading
                        ? "Loading…"
                        : `${totalDocs} document${totalDocs === 1 ? "" : "s"} indexed${
                            brainDisplayStatus ? ` · ${brainDisplayStatus}` : ""
                          }`}
                    </p>
                    <p className="mt-1 text-[11px] text-black/40">Click the orb to ask</p>
                  </>
                ) : null}
              </>
            )}
        </section>

        {/* Retrieval trace */}
        {activeSection === "trace" ? (
        <section className={cn(bentoCard, "max-h-[620px]")} style={{ animationDelay: "60ms" }}>
          <BentoHeader
            title="Retrieval trace"
            tint="amber"
            trailing={
              <button
                type="button"
                className="text-[10px] font-semibold uppercase tracking-wide text-amber-600 transition-colors hover:text-amber-500 dark:text-amber-400 dark:hover:text-amber-300"
                onClick={() => setTrace([])}
              >
                Clear
              </button>
            }
            icon={<ScrollText className="size-[18px]" strokeWidth={1.25} />}
          />
          <div className="thin-scrollbar max-h-[340px] flex-1 space-y-4 overflow-y-auto p-4 font-mono text-[11px] leading-snug">
            {trace.length === 0 ? (
              <p className="text-black/50">
                Run a query, ingest a document, or refresh status—steps will appear here with timestamps.
              </p>
            ) : (
              trace.map((entry) => (
                <div key={entry.id} className="space-y-1">
                  <p className={cn("opacity-90", traceToneClass(entry.tone))}>
                    {formatTraceClock(entry.at)} › {entry.label}
                  </p>
                  <p className="pl-2 text-black/70">{entry.detail}</p>
                </div>
              ))
            )}
          </div>
        </section>
        ) : null}

        {/* Knowledge */}
        {activeSection === "knowledge" ? (
        <section style={{ animationDelay: "80ms" }}>
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <h2 className="text-lg font-medium tracking-tight text-black">Knowledge collections</h2>
            <div className="flex flex-wrap items-center gap-3 text-[13px]">
              <span className="text-black/50">
                Documents indexed: <span className="tabular-nums text-black/70">{totalDocs}</span>
              </span>
              <Link
                href={knowledgeHref}
                className="text-black transition-colors hover:underline hover:underline"
              >
                Open library →
              </Link>
            </div>
          </div>
          {!brain ? (
            <p className="text-[13px] text-black/50">Provision the brain agent to manage collections.</p>
          ) : loading ? (
            <p className="flex items-center gap-2 text-[13px] text-black/50">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Loading…
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {status?.knowledge.collections.map((c) => (
                <SketchBox key={c.id} className="p-4">
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <div className="border border-black p-2">
                      <Database className="size-5 stroke-[1.25] text-black" />
                    </div>
                    <span className="border border-black px-2 py-0.5 font-serif text-[10px] uppercase tracking-widest text-black/50">
                      Collection
                    </span>
                  </div>
                  <h3 className="mb-1 text-sm font-medium text-black">{c.name}</h3>
                  <p className="mb-4 line-clamp-2 text-[13px] text-black/50">
                    {c.description || "Org-scoped knowledge for RAG."}
                  </p>
                  <div className="flex items-center justify-between text-[11px]">
                    <div className="flex items-center gap-1.5 text-black/50">
                      <span className="size-1.5 rounded-full bg-black" />
                      Ready
                    </div>
                    <span className="tabular-nums text-black/70">
                      {c.documentCount} doc{c.documentCount === 1 ? "" : "s"}
                    </span>
                  </div>
                </SketchBox>
              ))}
              {manageBrain ? (
                <button
                  type="button"
                  id="brain-new-collection"
                  onClick={() => document.getElementById("brain-collection-form")?.scrollIntoView({ behavior: "smooth" })}
                  className="flex min-h-[160px] flex-col items-center justify-center gap-2 border border-dashed border-black bg-white text-black transition-colors hover:bg-black/5"
                >
                  <Plus className="size-6" strokeWidth={1.25} />
                  <span className="text-xs font-medium">New collection</span>
                </button>
              ) : null}
            </div>
          )}

          {manageBrain && brain && !loading ? (
            <div id="brain-collection-form" className="mt-8 space-y-8 rounded-xl border border-black bg-white p-5 md:p-6">
              <div>
                <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-black/50">
                  Create collection
                </h3>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <input
                    value={collectionName}
                    onChange={(e) => setCollectionName(e.target.value)}
                    placeholder="Name"
                    className={cn(fieldBase, "sm:flex-1")}
                  />
                  <button
                    type="button"
                    disabled={busyKey !== null || !collectionName.trim()}
                    onClick={() => void onCreateCollection()}
                    className={btnPrimary}
                  >
                    {busyKey === "collection" ? "Creating…" : "Create"}
                  </button>
                </div>
              </div>
              <div>
                <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-black/50">
                  Ingest document
                </h3>
                <div className="space-y-3">
                  <select
                    value={selectedCollectionId}
                    onChange={(e) => setSelectedCollectionId(e.target.value)}
                    className={fieldBase}
                  >
                    {status?.knowledge.collections.length === 0 ? (
                      <option value="">No collections</option>
                    ) : (
                      status?.knowledge.collections.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))
                    )}
                  </select>
                  <label className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-lg border-2 border-dashed border-black px-4 py-3 text-[12px] text-black/50 transition-colors hover:border-black hover:text-black/70",
                  )}>
                    <input
                      key={fileInputKey}
                      type="file"
                      multiple
                      accept=".pdf,.docx,.xls,.xlsx,.ods,.txt,.md,.csv,.tsv,.json,.jsonl,.ndjson,.ipynb,.html,.htm,.xml,.svg,.yaml,.yml,.rtf,.log,.sql,.js,.jsx,.ts,.tsx,.py,.java,.c,.cc,.cpp,.h,.hpp,.go,.rs,.rb,.php,.swift,.kt,.kts,.scala,.lua,.pl,.css,.scss,.less,.sh,.bash,.env,.toml,.ini,.conf,.config,.properties,.rst,.tex,.srt,.vtt,.eml,.ics,text/*,application/json,application/pdf"
                      className="sr-only"
                      onChange={(e) => {
                        const picked = Array.from(e.target.files ?? []);
                        setIngestFiles((prev) => {
                          const existing = new Set(prev.map((f) => f.name));
                          return [...prev, ...picked.filter((f) => !existing.has(f.name))];
                        });
                      }}
                    />
                    <span className="text-black font-medium">Choose files</span>
                    <span>or drag &amp; drop — documents, spreadsheets, JSON, CSV, Markdown, HTML, XML, YAML, code, and text</span>
                    {ingestFiles.length > 0 && (
                      <span className="ml-auto text-black/70 font-medium">{ingestFiles.length} file{ingestFiles.length !== 1 ? "s" : ""} selected</span>
                    )}
                  </label>

                  {ingestFiles.length > 0 && (
                    <ul className="space-y-1">
                      {ingestFiles.map((f, i) => (
                        <li key={`${f.name}-${i}`} className="flex items-center justify-between rounded-md border border-black bg-white px-3 py-1.5 text-[12px]">
                          <span className="truncate text-black/70">{f.name}</span>
                          <button
                            type="button"
                            onClick={() => setIngestFiles((prev) => prev.filter((_, idx) => idx !== i))}
                            className="ml-3 shrink-0 text-black/50 hover:text-black transition-colors"
                          >
                            ✕
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}

                  {ingestFiles.length === 0 && (
                    <>
                      <input
                        value={docTitle}
                        onChange={(e) => setDocTitle(e.target.value)}
                        placeholder='Optional title (defaults to "Pasted document")'
                        className={fieldBase}
                      />
                      <textarea
                        value={docBody}
                        onChange={(e) => setDocBody(e.target.value)}
                        placeholder="Or paste text here instead of uploading files"
                        rows={4}
                        className={cn(fieldBase, "min-h-[100px] resize-y")}
                      />
                    </>
                  )}

                  {ingestProgress && (
                    <div className="rounded-md border border-black bg-white px-3 py-2 text-[12px] text-black/70">
                      <div className="flex items-center justify-between mb-1">
                        <span>Ingesting {ingestProgress.done + 1} of {ingestProgress.total}…</span>
                        <span className="text-black/50">{Math.round((ingestProgress.done / ingestProgress.total) * 100)}%</span>
                      </div>
                      <div className="h-1 w-full rounded-full bg-black/5 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-[--accent] transition-all duration-300"
                          style={{ width: `${(ingestProgress.done / ingestProgress.total) * 100}%` }}
                        />
                      </div>
                      <p className="mt-1 truncate text-[11px] text-black/50">{ingestProgress.currentName}</p>
                    </div>
                  )}

                  <button
                    type="button"
                    disabled={busyKey !== null || !selectedCollectionId}
                    onClick={() => void onIngest()}
                    className={btnSecondary}
                  >
                    {busyKey === "ingest"
                      ? ingestProgress
                        ? `Ingesting ${ingestProgress.done + 1}/${ingestProgress.total}…`
                        : "Ingesting…"
                      : ingestFiles.length > 1
                        ? `Ingest ${ingestFiles.length} files`
                        : "Ingest document"
                    }
                  </button>
                </div>
              </div>
            </div>
          ) : !manageBrain && brain ? (
            <p className="mt-6 text-[13px] text-black/50">Only owners and admins can manage collections and ingest.</p>
          ) : null}
        </section>
        ) : null}

      </div>

    </div>
  );
}
