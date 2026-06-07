"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Brain,
  Database,
  Loader2,
  Network,
  Plus,
  RefreshCw,
  ScrollText,
  Search,
  Shield,
} from "lucide-react";
import { useSession } from "@/components/qlix/session-context";
import { cn } from "@/lib/utils/cn";
import Dock, { type DockItemData } from "./Dock";
import { NeuralBrainVisualizer } from "./NeuralBrainVisualizer";
import {
  createAiBrainCollection,
  getAiBrainKnowledgeDocuments,
  getAiBrainPolicySignals,
  getAiBrainStatus,
  getOpenRouterModelCatalog,
  ingestAiBrainDocument,
  ingestAiBrainDocumentFromFile,
  postAiBrainConsoleOpen,
  postAiBrainSimulatePolicy,
  queryAiBrain,
  updateAiBrainModel,
  type AiBrainKnowledgeDocumentRow,
  type AiBrainPolicySignalsResponse,
  type AiBrainQueryResponse,
  type AiBrainStatusResponse,
  type OpenRouterCatalogModelOption,
} from "@/lib/ai-brain-api";
import { canManageBrain } from "@/lib/org-permissions";
import { AgentStatusBadge, deriveOrgBrainDisplayStatus } from "@/components/qlix/agents/agentStatus";

function formatTime(ms: number): string {
  try {
    const d = new Date(ms);
    return d.toISOString().replace("T", " ").slice(0, 19) + " UTC";
  } catch {
    return String(ms);
  }
}

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

const btnPrimary =
  "inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-violet-600 via-indigo-600 to-cyan-600 px-3 py-1.5 text-xs font-semibold text-white shadow-md shadow-violet-500/25 transition-[filter,transform,box-shadow] duration-200 hover:brightness-110 hover:shadow-lg hover:shadow-cyan-500/20 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 dark:from-violet-500 dark:via-indigo-500 dark:to-cyan-500";

const btnSecondary =
  "inline-flex items-center justify-center gap-2 rounded-lg border border-violet-400/40 bg-violet-50/80 px-3 py-1.5 text-xs font-medium text-violet-900 transition-[background,border-color] duration-200 hover:border-cyan-400/50 hover:bg-cyan-50/60 dark:border-violet-400/35 dark:bg-[--bg-subtle] dark:text-violet-100/85 dark:hover:bg-indigo-950/40 disabled:pointer-events-none disabled:opacity-40";

const btnDangerOutline =
  "inline-flex items-center justify-center rounded-lg border border-[--danger]/35 bg-transparent px-3 py-1.5 text-xs font-medium text-[--danger] transition-colors duration-200 hover:bg-[--danger-subtle] disabled:pointer-events-none disabled:opacity-40";

const fieldBase =
  "w-full rounded-lg border border-[--border-default] bg-[--bg-base] px-3 py-2 text-[13px] text-[--text-primary] shadow-sm outline-none transition-[border-color,box-shadow] duration-200 placeholder:text-[--text-tertiary] focus:border-[--accent] focus:ring-2 focus:ring-[--accent-subtle]";

const bentoCard =
  "ai-brain-panel group flex flex-col overflow-hidden rounded-xl border border-violet-500/15 bg-[--bg-elevated] shadow-[0_1px_2px_rgba(0,0,0,0.04)] ring-1 ring-inset ring-violet-500/10 motion-safe:transition-[border-color,box-shadow] motion-safe:duration-300 dark:border-violet-400/20 dark:shadow-[0_4px_24px_rgba(99,102,241,0.12),0_1px_3px_rgba(0,0,0,0.35)] dark:ring-violet-400/15 dark:hover:border-cyan-400/25";

function BentoHeader({
  title,
  icon,
  trailing,
  tint = "violet",
}: {
  title: string;
  icon?: ReactNode;
  trailing?: ReactNode;
  tint?: "violet" | "cyan" | "amber" | "emerald";
}) {
  const tintBar = {
    violet: "from-violet-500/90 via-indigo-400 to-transparent",
    cyan: "from-cyan-500/90 via-sky-400 to-transparent",
    amber: "from-amber-500/90 via-orange-400 to-transparent",
    emerald: "from-emerald-500/90 via-teal-400 to-transparent",
  } as const;
  return (
    <div className="relative border-b border-violet-500/15 bg-gradient-to-r from-violet-500/[0.07] via-transparent to-cyan-500/[0.06] px-4 py-3 dark:from-violet-500/10 dark:to-cyan-500/10">
      <div
        className={cn("absolute left-0 top-0 h-full w-1 bg-gradient-to-b opacity-95", tintBar[tint])}
        aria-hidden
      />
      <div className="flex items-center justify-between pl-2">
        <h2 className="bg-gradient-to-r from-violet-600 to-cyan-600 bg-clip-text text-sm font-semibold tracking-tight text-transparent dark:from-violet-300 dark:to-cyan-300">
          {title}
        </h2>
        <div className="flex items-center gap-2 text-violet-600/90 dark:text-cyan-200/90 [&_svg]:size-[18px]">
          {trailing}
          {icon}
        </div>
      </div>
    </div>
  );
}

function traceToneClass(tone: TraceTone): string {
  switch (tone) {
    case "success":
      return "text-emerald-500 dark:text-emerald-400";
    case "warning":
      return "text-amber-500 dark:text-amber-400";
    case "danger":
      return "text-rose-500 dark:text-rose-400";
    case "muted":
      return "text-[--text-tertiary]";
    default:
      return "text-cyan-600 dark:text-cyan-400";
  }
}

type SectionId = "brain" | "ask" | "knowledge" | "policy" | "trace";

export function AiBrainConsoleView() {
  const pathname = usePathname();
  const dashBase = pathname.startsWith("/organization") ? "/organization" : "/individual";
  const knowledgeHref = `${dashBase}/knowledge`;

  const { session, loading: sessionLoading } = useSession();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<AiBrainStatusResponse | null>(null);
  const [policy, setPolicy] = useState<AiBrainPolicySignalsResponse | null>(null);
  const [brainDocuments, setBrainDocuments] = useState<readonly AiBrainKnowledgeDocumentRow[]>([]);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const [collectionName, setCollectionName] = useState("");
  const [docTitle, setDocTitle] = useState("");
  const [docBody, setDocBody] = useState("");
  const [selectedCollectionId, setSelectedCollectionId] = useState<string>("");
  const [ingestFiles, setIngestFiles] = useState<File[]>([]);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [ingestProgress, setIngestProgress] = useState<{ done: number; total: number; currentName: string } | null>(null);

  const [queryInput, setQueryInput] = useState("");
  const [queryResult, setQueryResult] = useState<AiBrainQueryResponse | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);

  const [modelInput, setModelInput] = useState("");
  const [modelSaveError, setModelSaveError] = useState<string | null>(null);
  const [openRouterModels, setOpenRouterModels] = useState<readonly OpenRouterCatalogModelOption[]>([]);
  const [openRouterModelsLoading, setOpenRouterModelsLoading] = useState(false);
  const [openRouterModelsError, setOpenRouterModelsError] = useState<string | null>(null);

  const [trace, setTrace] = useState<readonly TraceEntry[]>([]);

  const [activeSection, setActiveSection] = useState<SectionId>("brain");

  const role = session?.user.role ?? "member";
  const manageBrain = canManageBrain(role);

  const loadOpenRouterModels = useCallback(async () => {
    setOpenRouterModelsLoading(true);
    setOpenRouterModelsError(null);
    const res = await getOpenRouterModelCatalog();
    setOpenRouterModelsLoading(false);
    if (!res.ok) {
      setOpenRouterModelsError(res.message);
      setOpenRouterModels([]);
      return;
    }
    setOpenRouterModels(res.models);
  }, []);

  const selectedOpenRouterCatalogId = useMemo(() => {
    const t = modelInput.trim();
    if (!t) return "";
    const byQlix = openRouterModels.find((m) => m.qlixModelId === t);
    if (byQlix) return byQlix.id;
    const stripped = t.replace(/^openrouter\//i, "");
    return openRouterModels.some((m) => m.id === stripped) ? stripped : "";
  }, [modelInput, openRouterModels]);

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
    const [s, p, d] = await Promise.all([getAiBrainStatus(), getAiBrainPolicySignals(), getAiBrainKnowledgeDocuments()]);
    if (d.ok) {
      setBrainDocuments(d.documents);
    } else {
      setBrainDocuments([]);
    }
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
    if (!p.ok) {
      setPolicy(null);
      if (s.ok) {
        setError(p.message);
      } else {
        setError(`${s.message} ${p.message}`.trim());
      }
    } else {
      setPolicy(p.data);
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

  useEffect(() => {
    const nextModel = status?.brain?.queryModel;
    if (!nextModel) return;
    queueMicrotask(() => {
      setModelInput(nextModel);
    });
  }, [status?.brain?.queryModel]);

  useEffect(() => {
    if (sessionLoading || !manageBrain || !status?.brain) return;
    queueMicrotask(() => {
      void loadOpenRouterModels();
    });
  }, [sessionLoading, manageBrain, status?.brain?.id, loadOpenRouterModels]);

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
          pushTrace("error" as any, "INGEST", `Failed: ${file.name} — ${res.message}`);
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

  const onQuery = async () => {
    if (!queryInput.trim()) return;
    setBusyKey("query");
    setQueryError(null);
    setQueryResult(null);
    pushTrace("accent", "SEARCH", `Retrieving for: "${queryInput.trim().slice(0, 64)}${queryInput.trim().length > 64 ? "…" : ""}"`);
    const res = await queryAiBrain(queryInput.trim());
    setBusyKey(null);
    if (!res.ok) {
      setQueryError(res.message);
      pushTrace("danger", "FAILED", res.message);
      return;
    }
    setQueryResult(res.data);
    pushTrace(
      "success",
      "RETRIEVED",
      res.data.citations.length === 0 ? "No citations returned" : `${res.data.citations.length} source excerpt(s) attached`,
    );
    pushTrace("accent", "SYNTHESIS", "Answer generated from knowledge + model");
  };

  const onSaveModel = async () => {
    if (!modelInput.trim()) return;
    setBusyKey("model");
    setModelSaveError(null);
    const res = await updateAiBrainModel(modelInput.trim());
    setBusyKey(null);
    if (!res.ok) {
      setModelSaveError(res.message);
      return;
    }
    pushTrace("success", "MODEL", "Query model updated.");
    await refreshAll();
  };

  const onSimulate = async (violation: boolean) => {
    setBusyKey(violation ? "sim-block" : "sim-ok");
    setError(null);
    const res = await postAiBrainSimulatePolicy(violation);
    setBusyKey(null);
    if (!res.ok && res.message) setError(res.message);
    pushTrace(violation ? "warning" : "muted", "POLICY_SIM", violation ? "Simulated blocked event" : "Simulated allowed event");
    await refreshAll();
  };

  const onRefresh = async () => {
    pushTrace("muted", "REFRESH", "Reloaded brain status and policy signals.");
    await refreshAll();
  };

  const brain = status?.brain;
  const totalDocs = status?.knowledge.collections.reduce((n, c) => n + c.documentCount, 0) ?? 0;
  const brainDisplayStatus = brain ? deriveOrgBrainDisplayStatus({ status: brain.status }) : null;

  const dockItems: DockItemData[] = useMemo(
    () => [
      {
        icon: <Network size={20} strokeWidth={1.5} />,
        label: "Brain map",
        active: activeSection === "brain",
        onClick: () => setActiveSection("brain"),
      },
      {
        icon: <Search size={20} strokeWidth={1.5} />,
        label: "Ask",
        active: activeSection === "ask",
        onClick: () => setActiveSection("ask"),
      },
      {
        icon: <Database size={20} strokeWidth={1.5} />,
        label: "Knowledge",
        active: activeSection === "knowledge",
        onClick: () => setActiveSection("knowledge"),
      },
      {
        icon: <Shield size={20} strokeWidth={1.5} />,
        label: "Policy & model",
        active: activeSection === "policy",
        onClick: () => setActiveSection("policy"),
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
    <div className="animate-qlix-fade-in mx-auto max-w-[1024px] px-4 pb-20 pt-6 md:px-6 md:pt-8">
      {/* Page header */}
      <div className="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div className="space-y-1">
          <h1 className="bg-gradient-to-r from-violet-600 via-fuchsia-500 to-cyan-500 bg-clip-text text-2xl font-semibold tracking-tight text-transparent md:text-[1.65rem] md:leading-snug dark:from-violet-300 dark:via-fuchsia-300 dark:to-cyan-300">
            AI Brain
          </h1>
          <div className="flex flex-wrap items-center gap-3 text-[13px]">
            {brain ? (
              <>
                <span className="font-mono text-[--text-tertiary]">
                  DID: {brain.didShort}
                </span>
                {brainDisplayStatus ? <AgentStatusBadge status={brainDisplayStatus} /> : null}
              </>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[--border-default] bg-[--bg-subtle] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[--text-tertiary]">
                Not provisioned
              </span>
            )}
          </div>
          <p className="max-w-xl pt-1 text-[13px] leading-relaxed text-[--text-secondary]">
            Centralized org knowledge for RAG. Queries and policy outcomes are attributed in your Exora Layer 5 audit trail.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={loading || sessionLoading || busyKey !== null}
            onClick={() => void onRefresh()}
            className={btnSecondary}
          >
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} aria-hidden />
            Sync
          </button>
          {manageBrain && brain ? (
            <button
              type="button"
              className={btnPrimary}
              onClick={() => {
                setActiveSection("knowledge");
                setTimeout(() => document.getElementById("brain-collection-form")?.scrollIntoView({ behavior: "smooth" }), 60);
              }}
            >
              <Plus className="size-3.5" aria-hidden />
              Add collection
            </button>
          ) : null}
        </div>
      </div>

      {error ? (
        <div
          className="ai-brain-panel mb-6 rounded-xl border border-[--warning]/30 bg-[--warning-subtle] px-4 py-3 text-[13px] text-[--text-primary]"
          style={{ animationDelay: "0ms" }}
          role="alert"
        >
          {error}
        </div>
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
        {/* Brain map — neural network visualizer */}
        {activeSection === "brain" ? (
          <section
            className="overflow-hidden rounded-xl border border-violet-500/20 shadow-[0_4px_24px_rgba(99,102,241,0.12)]"
            style={{ animationDelay: "20ms" }}
          >
            {!brain ? (
              <div className="flex h-[560px] items-center justify-center bg-[#00000f] text-[13px] text-[--text-tertiary]">
                Brain agent unavailable.
              </div>
            ) : (
              <NeuralBrainVisualizer
                documents={brainDocuments}
                loading={loading || sessionLoading}
                heightClass="h-[560px]"
              />
            )}
          </section>
        ) : null}

        {/* Ask your knowledge */}
        {activeSection === "ask" ? (
        <section className={cn(bentoCard)} style={{ animationDelay: "40ms" }}>
          <BentoHeader title="Ask your knowledge" tint="cyan" icon={<Brain className="size-[18px]" strokeWidth={1.25} />} />
        <div className="p-4">
          {!brain ? (
            <p className="text-[13px] text-[--text-tertiary]">Brain agent unavailable.</p>
          ) : (
            <>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  value={queryInput}
                  onChange={(e) => setQueryInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void onQuery();
                    }
                  }}
                  placeholder="Ask a question against ingested documents…"
                  className={cn(fieldBase, "sm:flex-1")}
                />
                <button
                  type="button"
                  disabled={busyKey !== null || !queryInput.trim()}
                  onClick={() => void onQuery()}
                  className={cn(btnPrimary, "sm:shrink-0")}
                >
                  {busyKey === "query" ? (
                    <>
                      <Loader2 className="size-3.5 animate-spin" aria-hidden />
                      Working…
                    </>
                  ) : (
                    "Ask"
                  )}
                </button>
              </div>
              {queryError ? <p className="mt-3 text-[13px] text-[--danger]">{queryError}</p> : null}
              {queryResult ? (
                <div className="mt-5 space-y-4 border-t border-[--border-subtle] pt-5">
                  <div className="rounded-lg border border-[--border-subtle] bg-[--bg-base] px-4 py-3 text-[13px] leading-relaxed text-[--text-primary]">
                    <p className="whitespace-pre-wrap">{queryResult.answer}</p>
                  </div>
                  {queryResult.citations.length > 0 ? (
                    <div>
                      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[--text-tertiary]">
                        Sources
                      </p>
                      <ul className="space-y-2">
                        {queryResult.citations.map((c, i) => (
                          <li
                            key={`${c.documentId}-${c.chunkOrdinal}`}
                            className="rounded-lg border border-[--border-subtle] bg-[--bg-base] px-3 py-2 transition-colors hover:border-[--border-default]"
                          >
                            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11px]">
                              <span className="font-mono text-[--text-tertiary]">[{i + 1}]</span>
                              <span className="font-medium text-[--text-secondary]">{c.documentTitle}</span>
                              <span className="text-[--text-tertiary]">· {c.collectionName}</span>
                            </div>
                            <p className="mt-1 line-clamp-2 font-mono text-[11px] leading-snug text-[--text-tertiary]">
                              {c.excerpt}
                            </p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </div>
        </section>
        ) : null}

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
              <p className="text-[--text-tertiary]">
                Run a query, ingest a document, or refresh status—steps will appear here with timestamps.
              </p>
            ) : (
              trace.map((entry) => (
                <div key={entry.id} className="space-y-1">
                  <p className={cn("opacity-90", traceToneClass(entry.tone))}>
                    {formatTraceClock(entry.at)} › {entry.label}
                  </p>
                  <p className="pl-2 text-[--text-secondary]">{entry.detail}</p>
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
            <h2 className="text-lg font-medium tracking-tight text-[--text-primary]">Knowledge collections</h2>
            <div className="flex flex-wrap items-center gap-3 text-[13px]">
              <span className="text-[--text-tertiary]">
                Documents indexed: <span className="tabular-nums text-[--text-secondary]">{totalDocs}</span>
              </span>
              <Link
                href={knowledgeHref}
                className="text-[--accent] transition-colors hover:text-[--accent-hover] hover:underline"
              >
                Open library →
              </Link>
            </div>
          </div>
          {!brain ? (
            <p className="text-[13px] text-[--text-tertiary]">Provision the brain agent to manage collections.</p>
          ) : loading ? (
            <p className="flex items-center gap-2 text-[13px] text-[--text-tertiary]">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Loading…
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {status?.knowledge.collections.map((c) => (
                <div
                  key={c.id}
                  className={cn(
                    "rounded-xl border border-cyan-500/25 bg-gradient-to-br from-violet-500/[0.06] via-[--bg-elevated] to-cyan-500/[0.05] p-4",
                    "ring-1 ring-inset ring-violet-400/10 motion-safe:transition-all motion-safe:duration-200 hover:border-fuchsia-400/35 hover:shadow-md hover:shadow-violet-500/10 dark:from-violet-500/15 dark:to-cyan-500/10",
                  )}
                >
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <div className="rounded-lg bg-gradient-to-br from-violet-500/25 to-cyan-500/20 p-2 text-violet-700 dark:text-violet-200">
                      <Database className="size-5" strokeWidth={1.25} />
                    </div>
                    <span className="rounded bg-[--bg-subtle] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[--text-tertiary]">
                      Collection
                    </span>
                  </div>
                  <h3 className="mb-1 text-sm font-medium text-[--text-primary]">{c.name}</h3>
                  <p className="mb-4 line-clamp-2 text-[13px] text-[--text-tertiary]">
                    {c.description || "Org-scoped knowledge for RAG."}
                  </p>
                  <div className="flex items-center justify-between text-[11px]">
                    <div className="flex items-center gap-1.5 text-[--text-tertiary]">
                      <span className="size-1.5 rounded-full bg-[--success]" />
                      Ready
                    </div>
                    <span className="tabular-nums text-[--text-secondary]">
                      {c.documentCount} doc{c.documentCount === 1 ? "" : "s"}
                    </span>
                  </div>
                </div>
              ))}
              {manageBrain ? (
                <button
                  type="button"
                  id="brain-new-collection"
                  onClick={() => document.getElementById("brain-collection-form")?.scrollIntoView({ behavior: "smooth" })}
                  className={cn(
                    "flex min-h-[160px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-fuchsia-400/40",
                    "bg-gradient-to-br from-violet-500/10 via-transparent to-cyan-500/10 text-violet-700 transition-all hover:border-cyan-400/55 hover:from-violet-500/20 hover:shadow-lg hover:shadow-violet-500/15 dark:text-fuchsia-200/80",
                  )}
                >
                  <Plus className="size-6" strokeWidth={1.25} />
                  <span className="text-xs font-medium">New collection</span>
                </button>
              ) : null}
            </div>
          )}

          {manageBrain && brain && !loading ? (
            <div id="brain-collection-form" className="mt-8 space-y-8 rounded-xl border border-[--border-subtle] bg-[--bg-elevated] p-5 md:p-6">
              <div>
                <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-[--text-tertiary]">
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
                <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-[--text-tertiary]">
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
                    "flex cursor-pointer items-center gap-2 rounded-lg border-2 border-dashed border-[--border-subtle] px-4 py-3 text-[12px] text-[--text-tertiary] transition-colors hover:border-[--accent]/50 hover:text-[--text-secondary]",
                  )}>
                    <input
                      key={fileInputKey}
                      type="file"
                      multiple
                      className="sr-only"
                      onChange={(e) => {
                        const picked = Array.from(e.target.files ?? []);
                        setIngestFiles((prev) => {
                          const existing = new Set(prev.map((f) => f.name));
                          return [...prev, ...picked.filter((f) => !existing.has(f.name))];
                        });
                      }}
                    />
                    <span className="text-[--accent] font-medium">Choose files</span>
                    <span>or drag &amp; drop — PDF, Word, Excel, TXT</span>
                    {ingestFiles.length > 0 && (
                      <span className="ml-auto text-[--text-secondary] font-medium">{ingestFiles.length} file{ingestFiles.length !== 1 ? "s" : ""} selected</span>
                    )}
                  </label>

                  {ingestFiles.length > 0 && (
                    <ul className="space-y-1">
                      {ingestFiles.map((f, i) => (
                        <li key={`${f.name}-${i}`} className="flex items-center justify-between rounded-md border border-[--border-subtle] bg-[--bg-base] px-3 py-1.5 text-[12px]">
                          <span className="truncate text-[--text-secondary]">{f.name}</span>
                          <button
                            type="button"
                            onClick={() => setIngestFiles((prev) => prev.filter((_, idx) => idx !== i))}
                            className="ml-3 shrink-0 text-[--text-tertiary] hover:text-[--danger] transition-colors"
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
                    <div className="rounded-md border border-[--border-subtle] bg-[--bg-base] px-3 py-2 text-[12px] text-[--text-secondary]">
                      <div className="flex items-center justify-between mb-1">
                        <span>Ingesting {ingestProgress.done + 1} of {ingestProgress.total}…</span>
                        <span className="text-[--text-tertiary]">{Math.round((ingestProgress.done / ingestProgress.total) * 100)}%</span>
                      </div>
                      <div className="h-1 w-full rounded-full bg-[--bg-hover] overflow-hidden">
                        <div
                          className="h-full rounded-full bg-[--accent] transition-all duration-300"
                          style={{ width: `${(ingestProgress.done / ingestProgress.total) * 100}%` }}
                        />
                      </div>
                      <p className="mt-1 truncate text-[11px] text-[--text-tertiary]">{ingestProgress.currentName}</p>
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
            <p className="mt-6 text-[13px] text-[--text-tertiary]">Only owners and admins can manage collections and ingest.</p>
          ) : null}
        </section>
        ) : null}

        {/* Policy & model */}
        {activeSection === "policy" ? (
        <section className={cn(bentoCard)} style={{ animationDelay: "100ms" }}>
          <BentoHeader
            title="Policy signals & query model"
            tint="emerald"
            icon={<Shield className="size-[18px]" strokeWidth={1.25} />}
          />
          <div className="space-y-6 p-4 md:p-5">
            <div className="space-y-2">
              <p className="text-xs font-medium text-[--text-primary]">Workspace scope</p>
              <p className="text-[13px] text-[--text-secondary]">
                Default posture: <span className="font-medium text-[--text-primary]">Exora Layer 3 + 5</span>
                {status?.scope.connectorsDeferred ? (
                  <span className="text-[--text-tertiary]"> · External connectors stay off until Layer 4 is in scope.</span>
                ) : null}
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex items-start justify-between gap-3 rounded-lg border border-[--border-subtle] bg-[--bg-subtle] px-3 py-3">
                <div>
                  <div className="text-xs font-medium text-[--text-primary]">Audit attribution</div>
                  <div className="mt-0.5 text-[10px] text-[--text-tertiary]">
                    brain.query and ingest events write to your org audit ledger.
                  </div>
                </div>
                <span className="shrink-0 rounded-full bg-[--success-subtle] px-2 py-0.5 text-[10px] font-medium text-[--success]">
                  On
                </span>
              </div>
              <div className="flex items-start justify-between gap-3 rounded-lg border border-[--border-subtle] bg-[--bg-subtle] px-3 py-3">
                <div>
                  <div className="text-xs font-medium text-[--text-primary]">Citation excerpts</div>
                  <div className="mt-0.5 text-[10px] text-[--text-tertiary]">
                    Answers include source snippets when retrieval matches chunks.
                  </div>
                </div>
                <span className="shrink-0 rounded-full bg-[--accent-subtle] px-2 py-0.5 text-[10px] font-medium text-[--accent]">
                  RAG
                </span>
              </div>
            </div>

            {!policy ? (
              <p className="text-[13px] text-[--text-tertiary]">Could not load policy signals.</p>
            ) : (
              <div className="space-y-3">
                <p className="text-[13px] text-[--text-secondary]">{policy.auditNote}</p>
                {policy.violations.length === 0 ? (
                  <p className="text-[13px] text-[--text-tertiary]">No blocked or flagged events in this window.</p>
                ) : (
                  <ul className="space-y-2">
                    {policy.violations.map((v) => (
                      <li
                        key={v.id}
                        className="flex gap-3 rounded-lg border border-[--border-subtle] bg-[--bg-base] px-3 py-2.5 text-[13px] text-[--text-secondary]"
                      >
                        <span className="text-[--accent]">●</span>
                        <span>
                          <span
                            className={cn(
                              "mr-2 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase",
                              v.status === "blocked" && "bg-[--warning-subtle] text-[--warning]",
                              v.status === "flagged" && "bg-[--danger-subtle] text-[--danger]",
                              v.status !== "blocked" && v.status !== "flagged" && "bg-[--neutral-subtle] text-[--text-secondary]",
                            )}
                          >
                            {v.status}
                          </span>
                          {v.preview}
                          <span className="mt-1 block font-mono text-[10px] text-[--text-tertiary]">
                            {formatTime(v.timestampMs)} · {v.actionType}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {manageBrain && brain ? (
              <div className="space-y-2 border-t border-[--border-subtle] pt-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="text-xs font-medium text-[--text-secondary]">Query model (OpenRouter)</label>
                  <button
                    type="button"
                    onClick={() => void loadOpenRouterModels()}
                    disabled={openRouterModelsLoading}
                    className={cn(btnSecondary, "py-1.5 text-[10px]")}
                  >
                    <RefreshCw className={cn("size-3.5", openRouterModelsLoading && "animate-spin")} aria-hidden />
                    Refresh catalog
                  </button>
                </div>
                <p className="text-[10px] leading-relaxed text-[--text-tertiary]">
                  Dropdown is loaded live from OpenRouter&apos;s <span className="font-mono">GET /models</span> (
                  <span className="font-mono">id</span> = exact string their API accepts). Qlix stores the canonical{" "}
                  <span className="font-mono">openrouter/…</span> form when you save.
                </p>
                {openRouterModelsError ? (
                  <p className="text-[12px] text-amber-600 dark:text-amber-400">{openRouterModelsError}</p>
                ) : null}
                <select
                  className={cn(
                    fieldBase,
                    "!text-black bg-white [color-scheme:light] dark:!text-black dark:bg-white",
                  )}
                  disabled={openRouterModelsLoading || openRouterModels.length === 0}
                  value={selectedOpenRouterCatalogId}
                  onChange={(e) => {
                    const id = e.target.value;
                    if (!id) return;
                    const row = openRouterModels.find((m) => m.id === id);
                    if (row) setModelInput(row.qlixModelId);
                  }}
                >
                  <option className="bg-white text-black" value="">
                    {openRouterModelsLoading
                      ? "Loading models from OpenRouter…"
                      : openRouterModels.length === 0
                        ? "No models — configure OPENROUTER_API_KEY on the server"
                        : "Choose model from catalog…"}
                  </option>
                  {openRouterModels.map((m) => (
                    <option key={m.id} className="bg-white text-black" value={m.id} title={m.id}>
                      {m.name} — {m.id}
                    </option>
                  ))}
                </select>
                <label className="text-[10px] font-medium uppercase tracking-wide text-[--text-tertiary]">
                  Canonical id (editable / custom)
                </label>
                <div className="rounded-lg border border-[--border-subtle] bg-[--bg-base] p-3 font-mono text-[12px] text-[--text-secondary]">
                  <textarea
                    value={modelInput}
                    onChange={(e) => setModelInput(e.target.value)}
                    rows={2}
                    placeholder="openrouter/provider/model"
                    className="min-h-[56px] w-full resize-y border-0 bg-transparent outline-none placeholder:text-[--text-tertiary]"
                  />
                </div>
                {modelInput.trim() && !selectedOpenRouterCatalogId ? (
                  <p className="text-[10px] text-[--text-tertiary]">
                    Value is not in the catalog — it will still save if allowed by model policy.
                  </p>
                ) : null}
                {modelSaveError ? <p className="text-[12px] text-[--danger]">{modelSaveError}</p> : null}
              </div>
            ) : null}
          </div>
          {manageBrain && brain ? (
            <div className="flex flex-wrap justify-end gap-2 border-t border-[--border-subtle] bg-[--bg-subtle] px-3 py-3 md:px-4">
              <button
                type="button"
                className="px-3 py-1.5 text-[11px] text-[--text-tertiary] transition-colors hover:text-[--text-primary]"
                onClick={() => {
                  setModelInput(status?.brain?.queryModel ?? "");
                  setModelSaveError(null);
                }}
              >
                Discard model edits
              </button>
              <button
                type="button"
                disabled={busyKey !== null || !modelInput.trim() || modelInput.trim() === status?.brain?.queryModel}
                onClick={() => void onSaveModel()}
                className={btnPrimary}
              >
                {busyKey === "model" ? "Saving…" : "Save query model"}
              </button>
              <button type="button" disabled={busyKey !== null} onClick={() => void onSimulate(false)} className={btnSecondary}>
                Simulate allow
              </button>
              <button type="button" disabled={busyKey !== null} onClick={() => void onSimulate(true)} className={btnDangerOutline}>
                Simulate block
              </button>
            </div>
          ) : null}
        </section>
        ) : null}
      </div>
    </div>
  );
}
