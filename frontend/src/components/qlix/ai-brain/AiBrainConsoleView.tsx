"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Brain,
  Database,
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
  sketchLabel,
} from "@/components/qlix/sketch";
import Dock, { type DockItemData } from "./Dock";
import Orb from "./Orb";
import { BrainOrbChat } from "./BrainOrbChat";
import { BrainKnowledgePanel } from "./BrainKnowledgePanel";
import {
  getAiBrainStatus,
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

const bentoCard = "border border-black bg-[#E2F0CC] overflow-hidden flex flex-col";

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
  const [brainChatOpen, setBrainChatOpen] = useState(false);
  const [selectedCollectionId, setSelectedCollectionId] = useState<string>("");
  const [trace, setTrace] = useState<readonly TraceEntry[]>([]);
  const [activeSection, setActiveSection] = useState<SectionId>("brain");
  const [openCreateSignal, setOpenCreateSignal] = useState(0);

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
              disabled={loading || sessionLoading}
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
                  setOpenCreateSignal((n) => n + 1);
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
              <span className="font-serif text-[10px] uppercase tracking-widest text-black/50">
                {brainDisplayStatus}
              </span>
            ) : null}
          </>
        ) : (
          <span className="font-serif text-[10px] uppercase tracking-widest text-black/50">
            Not provisioned
          </span>
        )}
      </div>
      <p className="mb-8 max-w-xl text-[13px] leading-relaxed text-black/70">
        Centralized org knowledge for RAG. Queries and policy outcomes are attributed in your Exora
        Layer 5 audit trail.
      </p>

      {error ? (
        <SketchBox className="mb-6 px-4 py-3 text-[13px] text-black whitespace-pre-wrap">
          {error}
        </SketchBox>
      ) : null}

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
                    className="group relative size-[min(340px,72vw)] overflow-hidden rounded-full border border-black bg-[#E2F0CC] transition-transform duration-300 hover:scale-[1.02] active:scale-[0.99]"
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
                  Run a query, ingest a document, or refresh status—steps will appear here with
                  timestamps.
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

        <div className={cn(activeSection === "knowledge" ? "block" : "hidden")}>
          <BrainKnowledgePanel
            brainReady={Boolean(brain)}
            loading={loading || sessionLoading}
            manageBrain={manageBrain}
            collections={status?.knowledge.collections ?? []}
            totalDocs={totalDocs}
            knowledgeHref={knowledgeHref}
            selectedCollectionId={selectedCollectionId}
            onSelectCollection={setSelectedCollectionId}
            onRefresh={refreshAll}
            onError={setError}
            onTrace={(tone, label, detail) => pushTrace(tone, label, detail)}
            openCreateSignal={openCreateSignal}
          />
        </div>
      </div>
    </div>
  );
}
