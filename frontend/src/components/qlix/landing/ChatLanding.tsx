"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowUp,
  Bot,
  Check,
  ChevronDown,
  Download,
  History,
  LayoutDashboard,
  Lightbulb,
  Loader2,
  MessageCircle,
  MessageSquarePlus,
  Plus,
  Sparkles,
  Trash2,
  User,
  Users,
  Wand2,
} from "lucide-react";
import {
  saveBuilderPrompt,
  listBuilderSessions,
  createBuilderSession,
  sendBuilderTurn,
  getBuilderSession,
  updateBuilderSession,
  deleteBuilderSession,
  type AgentCreationPlan,
  type NLAgentSpec,
  type NLWorkerSpec,
  type NlBuilderSessionSummary,
} from "@/lib/nl-builder-api";
import {
  createAgent,
  deleteAgent,
  confirmDownload,
  buildTeamRunModelGroups,
  CLOUD_MODELS,
  EXORA_MODELS,
  fetchModelCatalog,
  formatModelOptionLabel,
  type CreateAgentResponse,
  type AgentRuntime,
  type ModelCatalogEntry,
} from "@/lib/agents-api";
import { createTeam, setSupervisorAgent, addTeamMember } from "@/lib/teams-api";
import {
  listConnectors,
  type ConnectorProvider,
} from "@/lib/connectors-api";
import {
  missingRequiredConnectors,
  requiredConnectorInfos,
  type RequiredConnectorInfo,
} from "@/lib/required-connectors";
import { downloadBase64File, downloadJsonFile, stashStarterPack } from "@/lib/download";
import { detectHybridClientPlatform } from "@/lib/hybrid-platform";
import { scopesRequireHybrid } from "@/lib/agent-runtime";
import { getSession, postGuestSession, type AuthSuccessResponse } from "@/lib/auth-api";
import { useSession } from "@/components/qlix/session-context";
import { LogoutButton } from "@/components/qlix/user-account-menu";
import { ClaimAccountModal } from "@/components/qlix/ClaimAccountModal";
import { HybridRunnerSetupPopup } from "@/components/qlix/agents/HybridRunnerSetupPopup";
import { NLPlanPreview } from "@/components/qlix/agents/nl/NLPlanPreview";
import { AddCapabilitiesPanel } from "@/components/qlix/agents/nl/AddCapabilitiesPanel";
import { NLCreationProgress, type CreationStep } from "@/components/qlix/agents/nl/NLCreationProgress";
import { RequiredConnectorsPopup } from "@/components/qlix/agents/nl/RequiredConnectorsPopup";
import { QlixWordmark } from "@/components/qlix/landing/QlixWordmark";
import { ParticleText } from "@/components/qlix/landing/ParticleText";
import {
  ParticleConstellation,
  type ConstellationShape,
  type ConstellationSide,
} from "@/components/qlix/agents/nl/ParticleConstellation";
import { cn } from "@/lib/utils/cn";

// ── Chat transcript model ───────────────────────────────────────────────────

interface DoneAgentRef {
  id: string;
  name: string;
  runtime: AgentRuntime;
  label?: string;
  /** Present only right after create (starter pack / credentials). Not persisted. */
  response?: CreateAgentResponse;
}

type DoneResult =
  | { type: "single"; agents: DoneAgentRef[] }
  | { type: "team"; teamId: string; agents: DoneAgentRef[] };

type ChatItem =
  | { id: number; kind: "user"; text: string }
  | { id: number; kind: "thinking"; text: string }
  | { id: number; kind: "info"; text: string }
  | { id: number; kind: "error"; text: string }
  | {
      id: number;
      kind: "plan";
      plan: AgentCreationPlan;
      consumed: boolean;
      guestNote: string | null;
      /** The prompt this design came from — replayed when the user redesigns. */
      sourceText: string;
      /** Change requests stacked on top of `sourceText`, oldest first. */
      revisions: string[];
      /** True once a redesign has produced a newer plan further down the thread. */
      superseded: boolean;
    }
  | { id: number; kind: "progress"; steps: CreationStep[] }
  | { id: number; kind: "done"; result: DoneResult };

/** `Omit` collapses unions to their common keys; this distributes over each member. */
type NewChatItem = ChatItem extends infer T ? (T extends ChatItem ? Omit<T, "id"> : never) : never;

function outputsToDoneAgents(outputs: { response: CreateAgentResponse; label: string }[]): DoneAgentRef[] {
  return outputs.map((o) => ({
    id: o.response.agent.id,
    name: o.response.agent.name,
    runtime: o.response.agent.runtime,
    label: o.label,
    response: o.response,
  }));
}

/** Strip ephemeral fields before writing session history. */
function serializeTranscript(items: readonly ChatItem[]): unknown[] {
  return items
    .filter((it) => it.kind !== "thinking" && it.kind !== "progress")
    .map((it) => {
      if (it.kind === "done") {
        return {
          id: it.id,
          kind: "done" as const,
          result:
            it.result.type === "team"
              ? {
                  type: "team" as const,
                  teamId: it.result.teamId,
                  agents: it.result.agents.map(({ id, name, runtime, label }) => ({
                    id,
                    name,
                    runtime,
                    label,
                  })),
                }
              : {
                  type: "single" as const,
                  agents: it.result.agents.map(({ id, name, runtime, label }) => ({
                    id,
                    name,
                    runtime,
                    label,
                  })),
                },
        };
      }
      return it;
    });
}

function hydrateTranscript(raw: unknown[]): ChatItem[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const it = entry as Record<string, unknown>;
    const id = typeof it.id === "number" ? it.id : out.length + 1;
    const kind = it.kind;
    if (kind === "user" && typeof it.text === "string") {
      out.push({ id, kind: "user", text: it.text });
    } else if (kind === "info" && typeof it.text === "string") {
      out.push({ id, kind: "info", text: it.text });
    } else if (kind === "error" && typeof it.text === "string") {
      out.push({ id, kind: "error", text: it.text });
    } else if (kind === "plan" && it.plan && typeof it.plan === "object") {
      out.push({
        id,
        kind: "plan",
        plan: it.plan as AgentCreationPlan,
        consumed: Boolean(it.consumed),
        guestNote: typeof it.guestNote === "string" ? it.guestNote : null,
        sourceText: typeof it.sourceText === "string" ? it.sourceText : "",
        revisions: Array.isArray(it.revisions)
          ? it.revisions.filter((r): r is string => typeof r === "string")
          : [],
        superseded: Boolean(it.superseded),
      });
    } else if (kind === "done" && it.result && typeof it.result === "object") {
      const result = it.result as Record<string, unknown>;
      const agentsRaw = Array.isArray(result.agents) ? result.agents : [];
      const agents: DoneAgentRef[] = agentsRaw
        .filter((a): a is Record<string, unknown> => !!a && typeof a === "object")
        .map((a) => ({
          id: String(a.id ?? ""),
          name: String(a.name ?? "Agent"),
          runtime: (a.runtime === "hybrid" || a.runtime === "local" ? a.runtime : "cloud") as AgentRuntime,
          label: typeof a.label === "string" ? a.label : undefined,
        }))
        .filter((a) => a.id);
      if (result.type === "team" && typeof result.teamId === "string") {
        out.push({ id, kind: "done", result: { type: "team", teamId: result.teamId, agents } });
      } else {
        out.push({ id, kind: "done", result: { type: "single", agents } });
      }
    }
  }
  return out;
}

function titleFromItems(items: readonly ChatItem[]): string {
  const firstUser = items.find((it) => it.kind === "user");
  if (firstUser && firstUser.kind === "user") {
    return firstUser.text.replace(/\s+/g, " ").trim().slice(0, 72) || "New chat";
  }
  return "New chat";
}

function collectCreatedMeta(items: readonly ChatItem[]): {
  createdAgentIds: string[];
  teamId: string | null;
} {
  const ids: string[] = [];
  let teamId: string | null = null;
  for (const it of items) {
    if (it.kind !== "done") continue;
    for (const a of it.result.agents) ids.push(a.id);
    if (it.result.type === "team") teamId = it.result.teamId;
  }
  return { createdAgentIds: [...new Set(ids)], teamId };
}

const EXAMPLE_PROMPTS = [
  "A web researcher that reads pages and sends me daily WhatsApp summaries",
  "A competitor research agent that writes a cited SWOT report and sends it as a PDF",
  "Build a team with a researcher and a writer that drafts reports",
  "An agent that monitors my inbox and replies to simple questions",
  "A finance tracker that can spend up to $50 and reports transactions",
];

/** One-tap starting points for a redesign; the user can edit before rebuilding. */
const REDESIGN_HINTS = [
  "Take a different approach",
  "Split it into a team",
  "Use fewer permissions",
  "Keep everything on my computer",
] as const;

/** Nudge used when the user asks for a redesign without saying what to change. */
const OPEN_REDESIGN_NOTE =
  "Take a different approach — rethink the permissions, the runtime, and whether a team fits better.";

/** Guests: cloud-only for web agents; hybrid when scopes need local tools (desktop/files). */
const GUEST_MAX_AGENTS = 3;
/** Model used to design/plan agents in the AI Builder (OpenRouter). */
const DEFAULT_BUILDER_PARSE_MODEL = "openrouter/openai/gpt-4o-mini";
/** Default model stamped onto created agents (Exora). */
const DEFAULT_AGENT_MODEL = "exora/exora-general";
function adaptSpecForGuest<T extends NLAgentSpec | NLWorkerSpec>(spec: T): T {
  const proxyModels = [...CLOUD_MODELS, ...EXORA_MODELS] as readonly string[];
  const model = proxyModels.includes(spec.model)
    ? spec.model
    : DEFAULT_AGENT_MODEL;
  if (scopesRequireHybrid(spec.permissionScopes)) {
    return { ...spec, runtime: "hybrid", model, llmMode: "proxy", localInferenceMode: null };
  }
  return { ...spec, runtime: "cloud", model, llmMode: "proxy", localInferenceMode: null };
}

function applyDefaultAgentModel(plan: AgentCreationPlan): AgentCreationPlan {
  if (plan.type === "single") {
    return { ...plan, agent: { ...plan.agent, model: DEFAULT_AGENT_MODEL } };
  }
  return {
    ...plan,
    team: {
      ...plan.team,
      supervisor: { ...plan.team.supervisor, model: DEFAULT_AGENT_MODEL },
      workers: plan.team.workers.map((worker) => ({ ...worker, model: DEFAULT_AGENT_MODEL })),
    },
  };
}

function adaptPlanForGuest(plan: AgentCreationPlan): { plan: AgentCreationPlan; note: string | null } {
  if (plan.type === "single") {
    const agent = adaptSpecForGuest(plan.agent);
    const needsHybrid = agent.runtime === "hybrid";
    return {
      plan: { ...plan, agent },
      note: needsHybrid
        ? "This agent needs your computer for desktop or file access — you'll get a starter pack to download and run locally."
        : null,
    };
  }
  const maxWorkers = GUEST_MAX_AGENTS - 1;
  const trimmed = plan.team.workers.length > maxWorkers;
  const supervisor = adaptSpecForGuest(plan.team.supervisor);
  const workers = plan.team.workers.slice(0, maxWorkers).map(adaptSpecForGuest);
  const needsHybrid =
    supervisor.runtime === "hybrid" || workers.some((w) => w.runtime === "hybrid");
  return {
    plan: {
      ...plan,
      team: { ...plan.team, supervisor, workers },
    },
    note: trimmed
      ? `Guest workspaces are limited to ${GUEST_MAX_AGENTS} agents — the team was trimmed. Create a free account for bigger teams.`
      : needsHybrid
        ? "Some agents need your computer for desktop or file access — you'll get starter packs to download."
        : null,
  };
}

function specToCreateBody(spec: NLAgentSpec | NLWorkerSpec, orgId: string | null) {
  return {
    name: spec.name,
    description: spec.description || null,
    permissionScopes: spec.permissionScopes,
    jitScopes: spec.jitScopes,
    runtime: spec.runtime,
    model: spec.model,
    llmMode: spec.llmMode,
    llmProvider: spec.model.toLowerCase().startsWith("exora/")
      ? "exora"
      : "openrouter",
    localInferenceMode: spec.localInferenceMode,
    orgId,
    clientPlatform: detectHybridClientPlatform(),
  } as const;
}

// ── Result row ──────────────────────────────────────────────────────────────

function ResultRow({
  agent: doneAgent,
  routePrefix,
}: {
  readonly agent: DoneAgentRef;
  readonly routePrefix: string;
}) {
  const response = doneAgent.response;
  const agent = response?.agent;
  const sdkAgentFile = response?.sdkAgentFile;
  const sdkAgentPaths = response?.sdkAgentPaths;
  const hybridStarterPack = response?.hybridStarterPack;
  const [downloaded, setDownloaded] = useState(false);
  const isHybrid = doneAgent.runtime === "hybrid";
  const [setupPopupOpen, setSetupPopupOpen] = useState(Boolean(response && isHybrid));
  const autoDownloadFiredRef = useRef(false);

  // Stash the just-created starter pack so the agent's own page can offer a
  // re-download without re-issuing (which would rotate the signing key).
  useEffect(() => {
    if (response && isHybrid) stashStarterPack(doneAgent.id, hybridStarterPack);
  }, [isHybrid, doneAgent.id, hybridStarterPack, response]);

  const download = () => {
    if (!response || !agent) return;
    if (isHybrid && hybridStarterPack?.base64) {
      downloadBase64File(hybridStarterPack.base64, hybridStarterPack.filename, "application/zip");
    } else if (sdkAgentFile && sdkAgentPaths) {
      downloadJsonFile(sdkAgentFile, sdkAgentPaths.suggestedDownloadFilename);
    }
    setDownloaded(true);
    void confirmDownload(doneAgent.id);
  };

  // Auto-download hybrid starter ZIP as soon as this result appears.
  useEffect(() => {
    if (!response || !isHybrid) return;
    if (autoDownloadFiredRef.current) return;
    if (!hybridStarterPack?.base64) return;
    autoDownloadFiredRef.current = true;
    const t = window.setTimeout(() => {
      download();
    }, 50);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHybrid, hybridStarterPack?.base64, response]);

  // History restore — no starter pack / credentials, just a link back to the agent.
  if (!response || !agent) {
    return (
      <div className="rounded-xl border border-black/10 bg-[#E2F0CC]/70 p-3 text-[12px] shadow-[0_10px_24px_-18px_rgba(28,24,48,0.3)] backdrop-blur-sm">
        <div className="flex items-center gap-2 font-medium text-[#012F13]">
          <Bot className="size-3.5 text-[#012F13]" aria-hidden />
          {doneAgent.label ?? doneAgent.name}
          <span className="ml-auto text-[10px] text-black/45">
            {doneAgent.runtime === "cloud" ? "Cloud" : doneAgent.runtime === "hybrid" ? "Hybrid" : "Local"}
          </span>
        </div>
        <div className="mt-2 flex items-center gap-3">
          <Link
            href={`${routePrefix}/agents/${doneAgent.id}/chat`}
            className="inline-flex items-center gap-1.5 rounded-full bg-[#012F13] px-2.5 py-1 text-[11px] font-semibold text-white hover:brightness-110"
          >
            Chat with it →
          </Link>
          <Link
            href={`${routePrefix}/agents/${doneAgent.id}`}
            className="text-[11px] text-black/55 hover:text-[#012F13]"
          >
            Open agent
          </Link>
        </div>
      </div>
    );
  }

  if (isHybrid) {
    return (
      <div className="rounded-xl border border-amber-500/25 bg-amber-50/70 p-4 shadow-[0_10px_24px_-18px_rgba(28,24,48,0.3)] backdrop-blur-sm space-y-3.5">
        <HybridRunnerSetupPopup
          open={setupPopupOpen}
          onClose={() => setSetupPopupOpen(false)}
          zipFilename={hybridStarterPack?.filename}
        />
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-amber-400/10">
            <Download className="size-3.5 text-[#012F13]" aria-hidden />
          </div>
          <div>
            <p className="text-[12.5px] font-semibold text-[#012F13]">{agent.name}</p>
            <p className="text-[10.5px] text-black/55">{hybridStarterPack?.filename ?? "starter-pack.zip"}</p>
          </div>
        </div>

        <div className="space-y-2">
          {(
            [
              { n: "1", text: "ZIP downloads automatically (check Downloads)" },
              { n: "2", text: "Unzip the file" },
              { n: "3", text: "Double-click Start Qlix Agent" },
            ] as const
          ).map(({ n, text }) => (
            <div key={n} className="flex items-center gap-2.5">
              <span className="flex size-4.5 shrink-0 items-center justify-center rounded-full bg-amber-400/15 text-[9.5px] font-semibold text-[#012F13]">
                {n}
              </span>
              <span className="text-[12px] text-black/65">{text}</span>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={download}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-amber-400/25 bg-amber-400/10 px-4 py-2 text-[12.5px] font-semibold text-[#012F13] transition-all duration-200 hover:border-amber-400/40 hover:bg-amber-400/20 active:scale-[0.99]"
        >
          {downloaded ? (
            <>
              <Check className="size-3.5 text-[#012F13]" aria-hidden />
              <span className="text-[#012F13]">Downloaded — download again</span>
            </>
          ) : (
            <>
              <Download className="size-3.5" aria-hidden />
              {hybridStarterPack?.filename ?? "starter-pack.zip"}
            </>
          )}
        </button>

        {downloaded && (
          <div className="flex items-start gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.05] px-3 py-2 text-[11px] text-black/60">
            <Check className="mt-px size-3 shrink-0" aria-hidden />
            Unzip the file, then double-click it to connect this agent to Qlix.
          </div>
        )}

        <div className="flex items-center gap-3 pt-0.5">
          <Link
            href={`${routePrefix}/agents/${agent.id}/chat`}
            className="text-[11px] font-medium text-black/55 hover:text-[#012F13]"
          >
            Chat with it →
          </Link>
          <Link
            href={`${routePrefix}/agents/${agent.id}`}
            className="text-[11px] text-black/40 hover:text-black/60"
          >
            Open agent
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-black/10 bg-[#E2F0CC]/70 p-3 text-[12px] shadow-[0_10px_24px_-18px_rgba(28,24,48,0.3)] backdrop-blur-sm">
      <div className="flex items-center gap-2 font-medium text-[#012F13]">
        <Bot className="size-3.5 text-[#012F13]" aria-hidden />
        {agent.name}
        <span className="ml-auto flex items-center gap-1 text-[10px] text-black/45">
          {agent.runtime === "cloud" ? (
            <>
              <Check className="size-3 text-[#012F13]" aria-hidden />
              live on Qlix cloud
            </>
          ) : (
            agent.runtime
          )}
        </span>
      </div>
      <div className="mt-1 flex items-center gap-2 text-[11px] text-black/45">
        <span>{agent.alwaysScopes.length} always-on scopes</span>
        <span>·</span>
        <span>{agent.jitScopes.length} JIT</span>
      </div>
      <div className="mt-2 flex items-center gap-3">
        <Link
          href={`${routePrefix}/agents/${agent.id}/chat`}
          className="inline-flex items-center gap-1.5 rounded-full bg-[#012F13] px-2.5 py-1 text-[11px] font-semibold text-white hover:brightness-110"
        >
          Chat with it →
        </Link>
        <Link
          href={`${routePrefix}/agents/${agent.id}`}
          className="text-[11px] text-black/55 hover:text-[#012F13]"
        >
          Open agent
        </Link>
        {agent.runtime === "local" && (
          <button
            type="button"
            onClick={download}
            className="inline-flex items-center gap-1 text-[11px] text-[#012F13] hover:text-black/70"
          >
            <Download className="size-3" aria-hidden />
            {downloaded ? "Download again" : "Download agent"}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main landing ────────────────────────────────────────────────────────────

export interface ChatLandingProps {
  /** `public` = `/` landing; `dashboard` = authenticated AI Builder in console chrome. */
  readonly variant?: "public" | "dashboard";
  readonly orgId?: string | null;
}

interface PendingConnectorGate {
  planItemId: number;
  plan: AgentCreationPlan;
  connectors: RequiredConnectorInfo[];
}

export function ChatLanding({
  variant = "public",
  orgId: orgIdProp = null,
}: ChatLandingProps = {}) {
  const isDashboard = variant === "dashboard";
  const router = useRouter();
  const { session, loading: sessionLoading, refresh: refreshSession } = useSession();
  const [introDone, setIntroDone] = useState(isDashboard);
  const [items, setItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState("");
  const [builderModel, setBuilderModel] = useState<string>(DEFAULT_BUILDER_PARSE_MODEL);
  const [openrouterCatalog, setOpenrouterCatalog] = useState<ModelCatalogEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [claimOpen, setClaimOpen] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [connectorGate, setConnectorGate] = useState<PendingConnectorGate | null>(null);
  /** Plan item whose redesign composer is open, plus the change request being typed. */
  const [redesignFor, setRedesignFor] = useState<number | null>(null);
  const [redesignNote, setRedesignNote] = useState("");
  const [capabilitiesFor, setCapabilitiesFor] = useState<number | null>(null);
  const [builderSessionId, setBuilderSessionId] = useState<string | null>(null);
  const [historySessions, setHistorySessions] = useState<NlBuilderSessionSummary[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const idRef = useRef(0);
  const busyRef = useRef(false);
  const sessionRef = useRef<AuthSuccessResponse | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const historyMenuRef = useRef<HTMLDivElement | null>(null);
  const builderSessionIdRef = useRef<string | null>(null);
  const skipPersistRef = useRef(false);

  sessionRef.current = session;
  builderSessionIdRef.current = builderSessionId;

  useEffect(() => {
    if (session) sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    let cancelled = false;
    void fetchModelCatalog("openrouter").then((result) => {
      if (!cancelled && result.ok) setOpenrouterCatalog(result.models);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const builderModelGroups = useMemo(
    () => buildTeamRunModelGroups(openrouterCatalog),
    [openrouterCatalog],
  );
  const builderModelIds = useMemo(
    () => new Set(builderModelGroups.flatMap((group) => group.options.map((option) => option.id))),
    [builderModelGroups],
  );

  const nextId = () => ++idRef.current;
  const push = (item: NewChatItem) => {
    const id = nextId();
    setItems((prev) => [...prev, { ...item, id } as ChatItem]);
    return id;
  };
  const replace = (id: number, item: NewChatItem) =>
    setItems((prev) => prev.map((it) => (it.id === id ? ({ ...item, id } as ChatItem) : it)));
  const patch = (id: number, patchFields: Partial<ChatItem>) =>
    setItems((prev) => prev.map((it) => (it.id === id ? ({ ...it, ...patchFields } as ChatItem) : it)));

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [items]);

  const hasConversation = items.length > 0;
  const isGuest = session?.user.isGuest === true;
  const canPersistHistory = Boolean(session && !session.user.isGuest);
  const isOrg = isDashboard ? orgIdProp != null : session?.user.workspaceKind === "organization";
  const routePrefix = isOrg ? "/organization" : "/individual";
  const effectiveOrgId = isDashboard ? orgIdProp : session?.user.workspaceKind === "organization" ? session.user.orgId : null;

  const refreshHistoryList = async () => {
    if (!canPersistHistory) {
      setHistorySessions([]);
      return;
    }
    setHistoryLoading(true);
    try {
      setHistorySessions(await listBuilderSessions());
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    if (!canPersistHistory) {
      setHistorySessions([]);
      return;
    }
    void refreshHistoryList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canPersistHistory, session?.user.id]);

  useEffect(() => {
    if (!historyOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!historyMenuRef.current?.contains(event.target as Node)) {
        setHistoryOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [historyOpen]);

  /** Persist durable transcript for signed-in (non-guest) users. */
  useEffect(() => {
    if (!canPersistHistory || skipPersistRef.current) return;
    if (items.length === 0) return;
    const durable = serializeTranscript(items);
    if (durable.length === 0) return;

    const timer = window.setTimeout(() => {
      void (async () => {
        let sessionId = builderSessionIdRef.current;
        if (!sessionId) {
          const created = await createBuilderSession(titleFromItems(items));
          if (!created) return;
          sessionId = created.id;
          builderSessionIdRef.current = sessionId;
          setBuilderSessionId(sessionId);
        }
        const meta = collectCreatedMeta(items);
        const updated = await updateBuilderSession(sessionId, {
          title: titleFromItems(items),
          transcript: durable,
          createdAgentIds: meta.createdAgentIds,
          teamId: meta.teamId,
        });
        if (updated) {
          setHistorySessions((prev) => {
            const rest = prev.filter((s) => s.id !== updated.id);
            return [
              {
                id: updated.id,
                title: updated.title,
                createdAt: updated.createdAt,
                updatedAt: updated.updatedAt,
                createdAgentIds: updated.createdAgentIds,
                teamId: updated.teamId,
              },
              ...rest,
            ];
          });
        }
      })();
    }, 450);
    return () => window.clearTimeout(timer);
  }, [items, canPersistHistory]);

  const startNewChat = () => {
    skipPersistRef.current = true;
    setItems([]);
    setBuilderSessionId(null);
    builderSessionIdRef.current = null;
    idRef.current = 0;
    setInput("");
    setRedesignFor(null);
    setRedesignNote("");
    setCapabilitiesFor(null);
    setConnectorGate(null);
    setHistoryOpen(false);
    window.setTimeout(() => {
      skipPersistRef.current = false;
    }, 0);
  };

  const openHistorySession = async (sessionId: string) => {
    if (busyRef.current) return;
    setHistoryLoading(true);
    try {
      const detail = await getBuilderSession(sessionId);
      if (!detail) return;
      skipPersistRef.current = true;
      const hydrated = hydrateTranscript(detail.transcript);
      const maxId = hydrated.reduce((m, it) => Math.max(m, it.id), 0);
      idRef.current = maxId;
      setItems(hydrated);
      setBuilderSessionId(detail.id);
      builderSessionIdRef.current = detail.id;
      setHistoryOpen(false);
      setRedesignFor(null);
      setCapabilitiesFor(null);
      setConnectorGate(null);
      window.setTimeout(() => {
        skipPersistRef.current = false;
      }, 0);
    } finally {
      setHistoryLoading(false);
    }
  };

  const removeHistorySession = async (sessionId: string) => {
    const ok = await deleteBuilderSession(sessionId);
    if (!ok) return;
    setHistorySessions((prev) => prev.filter((s) => s.id !== sessionId));
    if (builderSessionIdRef.current === sessionId) startNewChat();
  };

  // Particle background: scrambled until the first message, then it re-forms into
  // a new line-art shape each turn, alternating which half of the screen it owns.
  // The agent's reply panel always takes the opposite half.
  const SHAPE_SEQUENCE: ConstellationShape[] = ["brain", "bulb", "rocket", "check"];
  const userTurns = items.reduce((n, it) => n + (it.kind === "user" ? 1 : 0), 0);
  const constShape: ConstellationShape = hasConversation
    ? SHAPE_SEQUENCE[Math.min(Math.max(userTurns, 1), SHAPE_SEQUENCE.length) - 1]
    : "scramble";
  // While work is in progress, keep the animation centered inside this
  // component's measured viewport (the space remaining after app chrome).
  // Once the response is ready it may move aside again to frame the result.
  const shapeSide: ConstellationSide = busy || !hasConversation
    ? "center"
    : userTurns % 2 === 1
      ? "left"
      : "right";
  const panelSide: "left" | "right" = shapeSide === "left" ? "right" : "left";
  const panelColumnClass = cn(
    "w-full max-w-[820px]",
    "md:w-[min(68%,820px)]",
    panelSide === "right" ? "md:ml-auto md:mr-[5%]" : "md:ml-[5%] md:mr-auto",
  );

  /** Ensures an authenticated session exists, creating a guest workspace if needed. */
  const ensureSession = async (): Promise<AuthSuccessResponse | null> => {
    if (sessionRef.current) return sessionRef.current;
    if (sessionLoading) {
      await refreshSession();
      if (sessionRef.current) return sessionRef.current;
    }
    const existing = await getSession();
    if (existing) {
      sessionRef.current = existing;
      return existing;
    }
    const infoId = push({ kind: "thinking", text: "Spinning up your private workspace…" });
    const res = await postGuestSession();
    if (!res.ok || !res.data) {
      replace(infoId, { kind: "error", text: res.errorMessage ?? "Could not start a session" });
      return null;
    }
    await refreshSession();
    sessionRef.current = res.data;
    replace(infoId, {
      kind: "info",
      text: "Created a private guest workspace for you — no sign-up needed. Everything you build here can be saved to a real account later.",
    });
    return res.data;
  };

  const handleSubmit = async () => {
    const text = input.trim();
    if (!text || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setInput("");
    push({ kind: "user", text });

    try {
      if (!isDashboard) {
        const sess = await ensureSession();
        if (!sess) return;
      } else if (!session) {
        push({ kind: "error", text: "Sign in to build agents" });
        return;
      }

      void saveBuilderPrompt(text);
      const thinkingId = push({ kind: "thinking", text: "Understanding what you need…" });
      const result = await sendBuilderTurn({
        sessionId: builderSessionIdRef.current,
        content: text,
        model: builderModel,
        title: text.replace(/\s+/g, " ").slice(0, 72),
      });
      if (!result.ok) {
        replace(thinkingId, { kind: "error", text: result.errorMessage });
        return;
      }
      builderSessionIdRef.current = result.sessionId;
      setBuilderSessionId(result.sessionId);

      replace(thinkingId, { kind: "info", text: result.data.message.content });
      if (result.data.plan) {
        let plan = applyDefaultAgentModel(result.data.plan);
        let guestNote: string | null = null;
        const activeSession = isDashboard ? session : sessionRef.current;
        if (activeSession?.user.isGuest) {
          const adapted = adaptPlanForGuest(plan);
          plan = adapted.plan;
          guestNote = adapted.note;
        }
        push({
          kind: "plan",
          plan,
          consumed: false,
          guestNote,
          sourceText: result.data.planningBrief ?? text,
          revisions: [],
          superseded: false,
        });
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  /** Sends the redesign request through discovery so facts and plans stay versioned. */
  const requestRedesign = async (
    planItemId: number,
    base: string,
    revisions: string[],
    note: string,
  ) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setRedesignFor(null);
    setRedesignNote("");
    try {
      const trimmed = note.trim() || OPEN_REDESIGN_NOTE;
      const nextRevisions = [...revisions, trimmed];
      push({ kind: "user", text: trimmed });
      patch(planItemId, { superseded: true });

      const thinkingId = push({ kind: "thinking", text: "Redesigning your agent…" });
      const redesignPrompt = [
        "Please redesign the agent or team with this change and produce an updated plan:",
        trimmed,
      ].join("\n");
      const result = await sendBuilderTurn({
        sessionId: builderSessionIdRef.current,
        content: redesignPrompt.slice(0, 5000),
        model: builderModel,
        intent: "redesign",
        title: base.replace(/\s+/g, " ").slice(0, 72),
      });
      if (!result.ok) {
        replace(thinkingId, { kind: "error", text: result.errorMessage });
        return;
      }
      builderSessionIdRef.current = result.sessionId;
      setBuilderSessionId(result.sessionId);

      replace(thinkingId, { kind: "info", text: result.data.message.content });
      if (result.data.plan) {
        let plan = applyDefaultAgentModel(result.data.plan);
        let guestNote: string | null = null;
        const activeSession = isDashboard ? session : sessionRef.current;
        if (activeSession?.user.isGuest) {
          const adapted = adaptPlanForGuest(plan);
          plan = adapted.plan;
          guestNote = adapted.note;
        }
        push({
          kind: "plan",
          plan,
          consumed: false,
          guestNote,
          sourceText: result.data.planningBrief ?? base,
          revisions: nextRevisions,
          superseded: false,
        });
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const loadConnectedProviders = async (): Promise<Set<ConnectorProvider>> => {
    try {
      const res = await listConnectors();
      return new Set(
        res.connectors.filter((c) => c.status === "connected").map((c) => c.provider),
      );
    } catch {
      return new Set();
    }
  };

  /** Gate create on missing connectors, then create (and optionally open Connectors). */
  const requestCreate = async (planItemId: number, plan: AgentCreationPlan) => {
    if (busyRef.current || connectorGate) return;
    const sess = sessionRef.current ?? session;
    if (!sess) return;

    const effectivePlan = sess.user.isGuest ? adaptPlanForGuest(plan).plan : plan;

    busyRef.current = true;
    setBusy(true);
    let missing: ConnectorProvider[] = [];
    try {
      const connected = await loadConnectedProviders();
      missing = missingRequiredConnectors(effectivePlan, connected);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }

    if (missing.length > 0) {
      setConnectorGate({
        planItemId,
        plan: effectivePlan,
        connectors: requiredConnectorInfos(missing),
      });
      return;
    }

    await handleCreate(planItemId, effectivePlan, { redirectToConnectors: false });
  };

  const proceedAfterConnectorGate = async (redirectToConnectors: boolean) => {
    if (!connectorGate) return;
    const { planItemId, plan, connectors } = connectorGate;
    setConnectorGate(null);
    await handleCreate(planItemId, plan, {
      redirectToConnectors,
      neededProviders: connectors.map((c) => c.provider),
    });
  };

  const handleCreate = async (
    planItemId: number,
    plan: AgentCreationPlan,
    options: {
      redirectToConnectors: boolean;
      neededProviders?: ConnectorProvider[];
    } = { redirectToConnectors: false },
  ) => {
    if (busyRef.current) return;
    const sess = sessionRef.current ?? session;
    if (!sess) return;
    busyRef.current = true;
    setBusy(true);
    patch(planItemId, { consumed: true });

    const effectivePlan = sess.user.isGuest ? adaptPlanForGuest(plan).plan : plan;

    const orgId = isDashboard
      ? effectiveOrgId ?? sess.user.orgId
      : sess.user.workspaceKind === "organization"
        ? sess.user.orgId
        : null;
    const initialSteps: CreationStep[] =
      effectivePlan.type === "single"
        ? [{ label: `Creating ${effectivePlan.agent.name}`, status: "pending" }]
        : [
            { label: `Creating supervisor — ${effectivePlan.team.supervisor.name}`, status: "pending" },
            ...effectivePlan.team.workers.map((w) => ({ label: `Creating ${w.name}`, status: "pending" as const })),
            { label: `Assembling team — ${effectivePlan.team.name}`, status: "pending" as const },
          ];
    const progressId = push({ kind: "progress", steps: initialSteps });
    const setStep = (index: number, p: Partial<CreationStep>) =>
      setItems((prev) =>
        prev.map((it) =>
          it.id === progressId && it.kind === "progress"
            ? { ...it, steps: it.steps.map((s, i) => (i === index ? { ...s, ...p } : s)) }
            : it,
        ),
      );

    const outputs: { response: CreateAgentResponse; label: string }[] = [];
    try {
      if (effectivePlan.type === "single") {
        setStep(0, { status: "active" });
        const res = await createAgent(specToCreateBody(effectivePlan.agent, orgId));
        if (!res.ok) throw new Error(res.errorMessage);
        setStep(0, { status: "done" });
        outputs.push({ response: res.data, label: effectivePlan.agent.name });
        push({ kind: "done", result: { type: "single", agents: outputsToDoneAgents(outputs) } });
      } else {
        // Teams are workspace-scoped: the team is created under the user's own
        // workspace org, so its member agents must carry that same org or the
        // backend rejects them (assertAgentInOrg). For an individual/guest this
        // org is simply their private workspace.
        const teamOrgId = orgId ?? sess.user.orgId;
        setStep(0, { status: "active" });
        const supRes = await createAgent(specToCreateBody(effectivePlan.team.supervisor, teamOrgId));
        if (!supRes.ok) {
          setStep(0, { status: "error", errorMessage: supRes.errorMessage });
          throw new Error(supRes.errorMessage);
        }
        setStep(0, { status: "done" });
        outputs.push({ response: supRes.data, label: effectivePlan.team.supervisor.name });

        const workerIds: string[] = [];
        for (let i = 0; i < effectivePlan.team.workers.length; i++) {
          const worker = effectivePlan.team.workers[i];
          setStep(i + 1, { status: "active" });
          const wRes = await createAgent(specToCreateBody(worker, teamOrgId));
          if (!wRes.ok) {
            setStep(i + 1, { status: "error", errorMessage: wRes.errorMessage });
            throw new Error(wRes.errorMessage);
          }
          setStep(i + 1, { status: "done" });
          outputs.push({ response: wRes.data, label: worker.name });
          workerIds.push(wRes.data.agent.id);
        }

        const assembleIdx = effectivePlan.team.workers.length + 1;
        setStep(assembleIdx, { status: "active" });
        const team = await createTeam({
          name: effectivePlan.team.name,
          description: effectivePlan.team.description,
          config: {
            maxParallelWorkers: effectivePlan.team.config.maxParallelWorkers,
            subtaskTimeoutMs: effectivePlan.team.config.subtaskTimeoutMs,
            retryPolicy: effectivePlan.team.config.retryPolicy,
            humanInLoopTriggers: ["web.transaction", "finance.spend_50", "finance.spend_100"],
            pipelineMode: true,
            autoSequence: false,
          },
        });
        await setSupervisorAgent(team.id, supRes.data.agent.id);
        for (let i = 0; i < effectivePlan.team.workers.length; i++) {
          const worker = effectivePlan.team.workers[i];
          await addTeamMember(team.id, {
            agentId: workerIds[i],
            role: worker.role,
            delegatedScopes: worker.permissionScopes,
          });
        }
        setStep(assembleIdx, { status: "done", label: `Team assembled — ${effectivePlan.team.name}` });
        push({
          kind: "done",
          result: { type: "team", teamId: team.id, agents: outputsToDoneAgents(outputs) },
        });
      }

      if (options.redirectToConnectors && options.neededProviders && options.neededProviders.length > 0) {
        const qs = new URLSearchParams({ needed: options.neededProviders.join(",") });
        router.push(`${routePrefix}/connectors?${qs.toString()}`);
      }
    } catch (err) {
      if (outputs.length > 0) {
        await Promise.allSettled(
          outputs.map((o) => deleteAgent(o.response.agent.id, o.response.agent.name)),
        );
      }
      const base = err instanceof Error ? err.message : "Creation failed";
      push({
        kind: "error",
        text: outputs.length > 0 ? `${base} — partially created agents have been removed` : base,
      });
      patch(planItemId, { consumed: false });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  // ── Composer ──────────────────────────────────────────────────────────────

  const composer = (
    <div className="relative w-full rounded-[1.4rem]">
      <div className="chat-composer relative flex items-end gap-2 rounded-[1.4rem] bg-[#E2F0CC]/75 px-4 py-3 backdrop-blur-xl">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            const el = textareaRef.current;
            if (el) {
              el.style.height = "auto";
              el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleSubmit();
            }
          }}
          rows={1}
          maxLength={5000}
          disabled={busy}
          placeholder="Describe the AI agent you want — it'll be alive in under a minute…"
          data-chat-input
          className={cn(
            "max-h-40 w-full resize-none bg-transparent text-[14px] leading-relaxed text-[#011207] outline-none transition-[min-height] duration-200 placeholder:text-black/35 disabled:opacity-60",
            input ? "min-h-[64px] sm:min-h-[28px]" : "min-h-[28px]",
          )}
        />
        <label className="shrink-0">
          <span className="sr-only">AI builder model</span>
          <select
            value={builderModel}
            disabled={busy}
            onChange={(event) => setBuilderModel(event.target.value)}
            className="max-w-36 rounded-full border border-black/15 bg-[#E2F0CC]/80 px-2.5 py-1.5 text-[10px] font-medium text-[#011207] outline-none hover:border-black/30 focus:border-black/40 disabled:opacity-50"
            title="Model used to design and create agents"
          >
            {!builderModelIds.has(builderModel) ? (
              <option value={builderModel}>{formatModelOptionLabel(builderModel)}</option>
            ) : null}
            {builderModelGroups.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.options.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={!input.trim() || busy}
          onClick={() => void handleSubmit()}
          aria-label="Send"
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-full text-white",
            "bg-[#012F13]",
            "hover:brightness-110 active:scale-95 motion-safe:transition-[filter,transform]",
            "disabled:cursor-not-allowed disabled:opacity-40",
          )}
        >
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ArrowUp className="size-4" aria-hidden />}
        </button>
      </div>
    </div>
  );

  const historyControls = canPersistHistory ? (
    <div ref={historyMenuRef} className="relative flex items-center gap-1.5">
      <button
        type="button"
        onClick={startNewChat}
        disabled={busy || (!hasConversation && !builderSessionId)}
        className="inline-flex items-center gap-1.5 rounded-full border border-black/15 bg-[#E2F0CC]/70 px-2.5 py-1.5 text-[11px] font-semibold text-[#012F13] transition-colors hover:bg-black/[0.06] disabled:cursor-not-allowed disabled:opacity-40"
        title="Start a new chat"
      >
        <MessageSquarePlus className="size-3.5" aria-hidden />
        <span className="hidden sm:inline">New chat</span>
      </button>
      <button
        type="button"
        onClick={() => {
          setHistoryOpen((open) => !open);
          if (!historyOpen) void refreshHistoryList();
        }}
        className="inline-flex items-center gap-1.5 rounded-full border border-black/15 bg-[#E2F0CC]/70 px-2.5 py-1.5 text-[11px] font-semibold text-[#012F13] transition-colors hover:bg-black/[0.06]"
        aria-expanded={historyOpen}
        aria-haspopup="menu"
        title="Chat history"
      >
        <History className="size-3.5" aria-hidden />
        <span className="hidden sm:inline">History</span>
        <ChevronDown className={cn("size-3 transition-transform", historyOpen && "rotate-180")} aria-hidden />
      </button>
      {historyOpen ? (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+0.4rem)] z-50 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-black/15 bg-[#E2F0CC] shadow-[0_18px_40px_-24px_rgba(28,24,48,0.55)]"
        >
          <div className="flex items-center justify-between border-b border-black/10 px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-black/55">Recent chats</p>
            <button
              type="button"
              onClick={startNewChat}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-[#012F13] hover:underline"
            >
              <MessageSquarePlus className="size-3" aria-hidden />
              New
            </button>
          </div>
          <div className="max-h-72 overflow-y-auto p-1.5">
            {historyLoading && historySessions.length === 0 ? (
              <div className="flex items-center gap-2 px-2 py-3 text-[11px] text-black/45">
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                Loading history…
              </div>
            ) : historySessions.length === 0 ? (
              <p className="px-2 py-3 text-[11px] text-black/45">No previous chats yet. Build an agent to start a thread.</p>
            ) : (
              historySessions.map((row) => (
                <div
                  key={row.id}
                  className={cn(
                    "group flex items-start gap-1 rounded-lg px-1.5 py-1",
                    row.id === builderSessionId ? "bg-black/[0.05]" : "hover:bg-black/[0.03]",
                  )}
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => void openHistorySession(row.id)}
                    className="min-w-0 flex-1 rounded-md px-1.5 py-1.5 text-left"
                  >
                    <p className="truncate text-[12px] font-medium text-[#012F13]">{row.title}</p>
                    <p className="mt-0.5 text-[10px] text-black/40">
                      {row.createdAgentIds.length > 0
                        ? `${row.createdAgentIds.length} agent${row.createdAgentIds.length === 1 ? "" : "s"} created`
                        : "Design in progress"}
                      {" · "}
                      {new Date(row.updatedAt).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </p>
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${row.title}`}
                    onClick={() => void removeHistorySession(row.id)}
                    className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-md text-black/35 opacity-0 transition-opacity hover:bg-black/[0.06] hover:text-black group-hover:opacity-100 focus:opacity-100"
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  ) : null;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      data-swiss-layout={isDashboard ? "dashboard" : undefined}
      className={cn(
        "relative flex flex-col overflow-hidden bg-[#E2F0CC] text-[#011207]",
        isDashboard ? "size-full" : "h-dvh",
      )}
    >
      <style>{`
        .qlmono { --text-primary:#012F13; --text-secondary:#3a3550; --text-tertiary:#6b6680; --accent:#012F13; --danger:#012F13; --border-subtle:rgba(0,0,0,0.12); --border-default:rgba(0,0,0,0.30); --bg-subtle:rgba(0,0,0,0.04); --bg-elevated:#ffffff; }
        .qlscroll::-webkit-scrollbar{width:7px;height:7px} .qlscroll::-webkit-scrollbar-track{background:transparent} .qlscroll::-webkit-scrollbar-thumb{background:rgba(0,0,0,.20);border-radius:999px} .qlscroll::-webkit-scrollbar-thumb:hover{background:rgba(0,0,0,.4)} .qlscroll{scrollbar-width:thin;scrollbar-color:rgba(0,0,0,.20) transparent}
      `}</style>

      {/* Intro overlay — landing only */}
      {!isDashboard ? (
        <div
          className={cn(
            "fixed inset-0 z-50 flex items-center justify-center bg-[#E2F0CC] transition-opacity duration-700",
            introDone ? "pointer-events-none opacity-0" : "opacity-100",
          )}
        >
          <QlixWordmark
            animate
            onAnimationComplete={() => setIntroDone(true)}
            className="text-[72px] text-[#012F13] sm:text-[110px] md:text-[150px]"
          />
        </div>
      ) : null}

      <RequiredConnectorsPopup
        open={connectorGate != null}
        connectors={connectorGate?.connectors ?? []}
        busy={busy}
        onConnectNow={() => void proceedAfterConnectorGate(true)}
        onConnectLater={() => void proceedAfterConnectorGate(false)}
        onDismiss={() => setConnectorGate(null)}
      />

      {/* Animated particle constellation — scrambles, then re-forms per turn */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <ParticleConstellation shape={constShape} side={shapeSide} className="absolute inset-0" />
      </div>

      {/* History / new chat — dashboard chrome */}
      {isDashboard && canPersistHistory ? (
        <div className="relative z-20 flex h-11 shrink-0 items-center justify-end px-3 sm:px-4">
          {historyControls}
        </div>
      ) : null}

      {/* Header — landing only */}
      {!isDashboard ? (
        <header className="relative z-20 flex h-14 shrink-0 items-center px-4">
          <QlixWordmark className="shrink-0 text-[34px] text-[#012F13]" />
          <div
            className={cn(
              "flex items-center justify-end gap-3",
              hasConversation ? panelColumnClass : "ml-auto",
            )}
          >
            {historyControls}
            <Link href="/how-to-use" className="text-[12px] font-medium text-black/55 transition-colors hover:text-[#012F13]">
              How to use
            </Link>
            <Link href="/docs" className="text-[12px] font-medium text-black/55 transition-colors hover:text-[#012F13]">
              Docs
            </Link>
            {session && isGuest && (
              <>
                <span className="hidden items-center gap-1.5 rounded-full border border-black/10 bg-black/[0.04] px-2.5 py-1 text-[11px] text-black/55 sm:flex">
                  <User className="size-3" aria-hidden />
                  Guest workspace
                </span>
                <button
                  type="button"
                  onClick={() => setClaimOpen(true)}
                  className="rounded-full bg-[#012F13] px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-white hover:brightness-110"
                >
                  Save my account
                </button>
              </>
            )}
            {session && !isGuest && (
              <>
                <Link
                  href={`${routePrefix}/overview`}
                  className="rounded-full bg-black/[0.06] px-3.5 py-1.5 text-[12px] font-semibold text-[#011207] transition-colors hover:bg-black/10"
                >
                  Open dashboard →
                </Link>
                <LogoutButton />
              </>
            )}
            {!session && (
              <>
                <Link href="/sign-in" className="text-[12px] font-medium text-black/55 transition-colors hover:text-[#012F13]">
                  Sign in
                </Link>
                <Link
                  href="/sign-in?mode=sign-up"
                  className="rounded-full border border-black/15 bg-black/[0.04] px-3.5 py-1.5 text-[12px] font-semibold text-[#011207] transition-colors hover:bg-black/[0.08]"
                >
                  Sign up
                </Link>
              </>
            )}
          </div>
        </header>
      ) : null}

      {/* Conversation / hero */}
      <div className="relative z-10 flex flex-1 overflow-hidden px-2 sm:px-4">
        {!hasConversation ? (
          <div className="mx-auto flex h-full w-full max-w-2xl flex-col items-center justify-center px-2 pb-24 sm:px-5">
            <p className="mb-4 text-center text-[11px] font-semibold uppercase tracking-[0.05em] text-[#012F13] sm:text-[12px]">
              Describe it. Qlix builds it.
            </p>
            <h1 className="mx-auto w-full" aria-label="What should your AI agent do for you?">
              <span className="sr-only">What should your AI agent do for you?</span>
              <span className="block h-12 sm:h-14 md:h-16">
                <ParticleText text="What should your AI agent" fontSize="clamp(1.75rem, 5vw, 3rem)" />
              </span>
              <span className="-mt-2 block h-12 sm:h-14 md:h-16">
                <ParticleText text="do for you?" fontSize="clamp(1.75rem, 5vw, 3rem)" />
              </span>
            </h1>
            <p className="mt-5 max-w-md text-center text-[14px] font-light leading-relaxed tracking-[0.025em] text-[#011207]/70 sm:mt-6 sm:text-[15px]">
              Describe it in plain words. Qlix designs it, wires up its permissions, and brings it to life — right here.
            </p>
            {isDashboard ? (
              <Link
                href={`${routePrefix}/ai-employees`}
                className="mt-4 text-[12px] font-medium text-[#012F13]/70 underline underline-offset-2 hover:text-[#012F13]"
              >
                Looking for a ready-made role? Hire an AI Employee →
              </Link>
            ) : null}
          </div>
        ) : (
          <div
            ref={scrollRef}
            className={cn(
              "qlmono qlscroll mt-4 mb-2 flex h-[calc(100%-2.5rem)] max-h-full flex-col gap-3 overflow-y-auto rounded-3xl border border-black/10 bg-[#E2F0CC]/55 p-3 text-[#012F13] shadow-[0_1px_1px_rgba(28,24,48,0.04),0_28px_64px_-32px_rgba(28,24,48,0.4),inset_0_1px_0_rgba(255,255,255,0.8)] backdrop-blur-2xl transition-[margin] duration-700 sm:mt-8 sm:gap-4 sm:p-5",
              panelColumnClass,
            )}
          >
            {items.map((item) => {
              if (item.kind === "user") {
                return (
                  <div key={item.id} className="qlix-msg-in flex justify-end">
                    <div className="max-w-[85%] rounded-2xl rounded-br-md border border-black/10 bg-[#E2F0CC]/80 px-4 py-2.5 text-[13.5px] leading-relaxed text-[#012F13] shadow-[0_10px_24px_-16px_rgba(28,24,48,0.35)] backdrop-blur-sm">
                      {item.text}
                    </div>
                  </div>
                );
              }
              if (item.kind === "thinking") {
                return (
                  <div key={item.id} className="qlix-msg-in flex items-center gap-3">
                    <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#012F13]">
                      <Sparkles className="size-3.5 text-white" aria-hidden />
                    </div>
                    <div className="flex items-center gap-2 text-[13px] text-black/60">
                      {item.text}
                      <span className="flex gap-1">
                        <span className="qlix-thinking-dot size-1.5 rounded-full bg-[#012F13]" />
                        <span className="qlix-thinking-dot size-1.5 rounded-full bg-black/40" />
                        <span className="qlix-thinking-dot size-1.5 rounded-full bg-[#012F13]" />
                      </span>
                    </div>
                  </div>
                );
              }
              if (item.kind === "info") {
                return (
                  <div key={item.id} className="qlix-msg-in flex gap-3">
                    <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#012F13]">
                      <Sparkles className="size-3.5 text-white" aria-hidden />
                    </div>
                    <p className="max-w-[85%] text-[13px] leading-relaxed text-black/60">{item.text}</p>
                  </div>
                );
              }
              if (item.kind === "error") {
                return (
                  <div key={item.id} className="qlix-msg-in flex gap-3">
                    <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#012F13]">
                      <Sparkles className="size-3.5 text-white" aria-hidden />
                    </div>
                    <p className="max-w-[85%] rounded-xl border border-red-500/20 bg-red-500/[0.07] px-3.5 py-2.5 text-[13px] text-[#012F13]">
                      {item.text}
                    </p>
                  </div>
                );
              }
              if (item.kind === "plan") {
                const plan = item.plan;
                return (
                  <div key={item.id} className="qlix-msg-in flex gap-3">
                    <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#012F13]">
                      {plan.type === "team" ? (
                        <Users className="size-3.5 text-white" aria-hidden />
                      ) : (
                        <Bot className="size-3.5 text-white" aria-hidden />
                      )}
                    </div>
                    <div
                      className={cn(
                        "min-w-0 flex-1 space-y-3",
                        item.superseded && "opacity-50 motion-safe:transition-opacity",
                      )}
                    >
                      <p className="text-[13px] leading-relaxed text-black/65">
                        {plan.type === "team"
                          ? `Here's a team of ${1 + plan.team.workers.length} agents I'd build for that. Review or tweak anything below, then bring them to life.`
                          : "Here's the agent I'd build for that. Review or tweak anything below, then bring it to life."}
                      </p>
                      {item.guestNote && (
                        <p className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[12px] text-[#012F13]">
                          {item.guestNote}
                        </p>
                      )}
                      <div className="">
                        <NLPlanPreview
                          plan={plan}
                          onPlanChange={(p) =>
                            setItems((prev) =>
                              prev.map((it) => (it.id === item.id && it.kind === "plan" ? { ...it, plan: p } : it)),
                            )
                          }
                        />
                      </div>
                      {item.superseded ? (
                        <p className="text-[11px] uppercase tracking-[0.14em] text-black/40">
                          Replaced by the design below
                        </p>
                      ) : (
                        !item.consumed && (
                          <div className="space-y-2.5">
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void requestCreate(item.id, plan)}
                                className={cn(
                                  "inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-[12px] font-semibold uppercase tracking-[0.05em] text-white",
                                  "bg-[#012F13]",
                                  "hover:brightness-110 active:scale-[0.98] motion-safe:transition-[filter,transform]",
                                  "disabled:cursor-not-allowed disabled:opacity-50",
                                )}
                              >
                                <Sparkles className="size-4" aria-hidden />
                                Bring {plan.type === "team" ? "this team" : "it"} to life
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                aria-expanded={capabilitiesFor === item.id}
                                onClick={() => {
                                  setRedesignFor(null);
                                  setCapabilitiesFor((cur) => (cur === item.id ? null : item.id));
                                }}
                                className={cn(
                                  "inline-flex items-center gap-2 rounded-full border px-4 py-2.5 text-[12px] font-semibold uppercase tracking-[0.05em] text-[#012F13]",
                                  "bg-[#E2F0CC]/70 backdrop-blur-sm motion-safe:transition-[border-color,background-color,transform] active:scale-[0.98]",
                                  capabilitiesFor === item.id
                                    ? "border-[#012F13]/45 bg-[#E2F0CC]"
                                    : "border-black/15 hover:border-[#012F13]/40 hover:bg-[#E2F0CC]",
                                  "disabled:cursor-not-allowed disabled:opacity-50",
                                )}
                              >
                                <Plus className="size-4" aria-hidden />
                                Add capabilities
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                aria-expanded={redesignFor === item.id}
                                onClick={() => {
                                  setCapabilitiesFor(null);
                                  setRedesignNote("");
                                  setRedesignFor((cur) => (cur === item.id ? null : item.id));
                                }}
                                className={cn(
                                  "inline-flex items-center gap-2 rounded-full border px-4 py-2.5 text-[12px] font-semibold uppercase tracking-[0.05em] text-[#012F13]",
                                  "bg-[#E2F0CC]/70 backdrop-blur-sm motion-safe:transition-[border-color,background-color,transform] active:scale-[0.98]",
                                  redesignFor === item.id
                                    ? "border-[#012F13]/45 bg-[#E2F0CC]"
                                    : "border-black/15 hover:border-[#012F13]/40 hover:bg-[#E2F0CC]",
                                  "disabled:cursor-not-allowed disabled:opacity-50",
                                )}
                              >
                                <Wand2 className="size-4" aria-hidden />
                                Redesign
                              </button>
                            </div>

                            {capabilitiesFor === item.id && (
                              <AddCapabilitiesPanel
                                plan={plan}
                                orgId={effectiveOrgId}
                                onPlanChange={(p) =>
                                  setItems((prev) =>
                                    prev.map((it) =>
                                      it.id === item.id && it.kind === "plan" ? { ...it, plan: p } : it,
                                    ),
                                  )
                                }
                              />
                            )}

                            {redesignFor === item.id && (
                              <div className="qlix-msg-in rounded-2xl border border-black/12 bg-[#E2F0CC]/75 p-3 backdrop-blur-xl">
                                <textarea
                                  autoFocus
                                  value={redesignNote}
                                  rows={2}
                                  maxLength={600}
                                  disabled={busy}
                                  onChange={(e) => setRedesignNote(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" && !e.shiftKey) {
                                      e.preventDefault();
                                      void requestRedesign(
                                        item.id,
                                        item.sourceText,
                                        item.revisions,
                                        redesignNote,
                                      );
                                    }
                                    if (e.key === "Escape") setRedesignFor(null);
                                  }}
                                  placeholder="What should change? Leave blank for a fresh take."
                                  className="w-full resize-none bg-transparent text-[13px] leading-relaxed text-[#011207] outline-none placeholder:text-black/35 disabled:opacity-60"
                                />
                                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                  {REDESIGN_HINTS.map((hint) => (
                                    <button
                                      key={hint}
                                      type="button"
                                      disabled={busy}
                                      onClick={() => setRedesignNote(hint)}
                                      className="rounded-full border border-black/12 bg-[#E2F0CC]/70 px-2.5 py-1 text-[11px] text-black/60 motion-safe:transition-colors hover:border-black/30 hover:text-[#012F13] disabled:opacity-50"
                                    >
                                      {hint}
                                    </button>
                                  ))}
                                  <div className="ml-auto flex items-center gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => setRedesignFor(null)}
                                      className="rounded-full px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.05em] text-black/45 hover:text-[#012F13]"
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      type="button"
                                      disabled={busy}
                                      onClick={() =>
                                        void requestRedesign(
                                          item.id,
                                          item.sourceText,
                                          item.revisions,
                                          redesignNote,
                                        )
                                      }
                                      className={cn(
                                        "inline-flex items-center gap-1.5 rounded-full bg-[#012F13] px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-white",
                                        "hover:brightness-110 active:scale-[0.98] motion-safe:transition-[filter,transform]",
                                        "disabled:cursor-not-allowed disabled:opacity-50",
                                      )}
                                    >
                                      {busy ? (
                                        <Loader2 className="size-3.5 animate-spin" aria-hidden />
                                      ) : (
                                        <Wand2 className="size-3.5" aria-hidden />
                                      )}
                                      Rebuild
                                    </button>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        )
                      )}
                    </div>
                  </div>
                );
              }
              if (item.kind === "progress") {
                const allStepsDone = item.steps.every((s) => s.status === "done" || s.status === "error");
                return (
                  <div key={item.id} className="qlix-msg-in flex gap-3">
                    <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#012F13]">
                      {allStepsDone ? (
                        <Check className="size-3.5 text-white" aria-hidden />
                      ) : (
                        <Loader2 className="size-3.5 animate-spin text-white" aria-hidden />
                      )}
                    </div>
                    <div className="min-w-0 flex-1 ">
                      <NLCreationProgress steps={item.steps} />
                    </div>
                  </div>
                );
              }
              // done
              const result = item.result;
              if (isDashboard) {
                const primaryName =
                  result.agents[0]?.name ??
                  (result.type === "team" ? "Your team" : "Your agent");
                return (
                  <div key={item.id} className="qlix-msg-in flex gap-3">
                    <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#012F13]">
                      <Check className="size-3.5 text-white" aria-hidden />
                    </div>
                    <div className="min-w-0 flex-1 rounded-xl border border-green-600/35 bg-green-50 p-4">
                      <p className="text-[13px] font-medium text-[#012F13]">
                        {result.type === "team"
                          ? `${primaryName} is live — ${result.agents.length} agents created`
                          : `${primaryName} is live`}
                      </p>
                      <p className="mt-1 text-[12px] text-black/60">
                        {result.type === "team"
                          ? "Find your team on the Teams page to run and manage it."
                          : "Find it on the Agents page. Use Chat there when you're ready to talk to it."}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {result.agents.slice(0, 4).map((a) => (
                          <Link
                            key={a.id}
                            href={`${routePrefix}/agents/${a.id}`}
                            className="rounded-full border border-green-700/30 bg-[#E2F0CC] px-2.5 py-1 text-[11px] font-medium text-[#012F13] hover:bg-green-50/80"
                          >
                            {a.name}
                          </Link>
                        ))}
                      </div>
                      <Link
                        href={result.type === "team" ? `${routePrefix}/teams` : `${routePrefix}/agents`}
                        className={cn(
                          "mt-4 inline-flex items-center justify-center rounded-lg border border-green-700/40 bg-[#E2F0CC] px-4 py-2 text-[12px] font-semibold text-[#012F13]",
                          "transition-colors hover:bg-green-50/80",
                        )}
                      >
                        {result.type === "team" ? "Go to teams" : "Go to agents"}
                      </Link>
                    </div>
                  </div>
                );
              }
              return (
                <div key={item.id} className="qlix-msg-in flex gap-3">
                  <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#012F13]">
                    <Check className="size-3.5 text-white" aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1 space-y-3">
                    <p className="text-[13px] leading-relaxed text-black/65">
                      {result.type === "team" ? "Your team is alive" : "Your agent is alive"} — it&apos;s already
                      running in your workspace.
                    </p>
                    <div className="space-y-2">
                      {result.agents.map((a) => (
                        <ResultRow key={a.id} agent={a} routePrefix={routePrefix} />
                      ))}
                    </div>
                    {result.agents.some((a) => (a.response?.agent.jitScopes.length ?? 0) > 0) && result.agents[0] && (
                      <div className="rounded-xl border border-amber-500/25 bg-amber-50/70 p-3.5 backdrop-blur-sm space-y-2.5">
                        <div>
                          <p className="text-[12.5px] font-semibold text-[#012F13]">
                            This agent asks before sensitive actions
                          </p>
                          <p className="mt-0.5 text-[11px] text-black/55">
                            How do you want to approve those actions?
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Link
                            href={`${routePrefix}/connectors`}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-400/25 bg-emerald-400/10 px-3 py-1.5 text-[12px] font-semibold text-[#012F13] transition-colors hover:bg-emerald-400/20"
                          >
                            <MessageCircle className="size-3.5" aria-hidden />
                            Approve via WhatsApp
                          </Link>
                          <Link
                            href={`${routePrefix}/agents/${result.agents[0].id}/chat`}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-black/15 bg-black/[0.04] px-3 py-1.5 text-[12px] font-semibold text-[#012F13] transition-colors hover:bg-black/[0.08]"
                          >
                            <LayoutDashboard className="size-3.5" aria-hidden />
                            Approve in dashboard
                          </Link>
                        </div>
                        <p className="text-[10.5px] text-black/40">
                          WhatsApp sends approval prompts to your phone — connect it on the next screen. Dashboard shows an
                          Approve / Deny prompt right inside the chat.
                        </p>
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-3 pt-1">
                      {result.agents[0] && (
                        <Link
                          href={`${routePrefix}/agents/${result.agents[0].id}`}
                          className="rounded-lg border border-black/15 bg-black/[0.04] px-3.5 py-1.5 text-[12px] font-semibold text-[#012F13] transition-colors hover:bg-black/[0.08]"
                        >
                          Open dashboard →
                        </Link>
                      )}
                      {isGuest && (
                        <button
                          type="button"
                          onClick={() => setClaimOpen(true)}
                          className="text-[12px] font-medium text-[#012F13] hover:text-black/70 hover:underline"
                        >
                          Like it? Save your workspace with a free account
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Bottom composer */}
      <div className="relative z-20 shrink-0 px-2 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-4 sm:pb-8">
        <div
          className={cn(
            "transition-[margin,max-width] duration-700",
            hasConversation ? panelColumnClass : "mx-auto max-w-2xl",
          )}
        >
          {!hasConversation && (
            <div className="relative mb-2">
              <button
                type="button"
                onClick={() => setShowSuggestions((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-full border border-black/12 bg-black/[0.03] px-3 py-1 text-[11px] text-black/55 transition-colors hover:border-black/40 hover:text-[#012F13]"
              >
                <Lightbulb className="size-3 text-[#012F13]" aria-hidden />
                Need ideas?
                <ChevronDown
                  className={cn("size-3 transition-transform", showSuggestions && "rotate-180")}
                  aria-hidden
                />
              </button>
              {showSuggestions && (
                <div className="absolute bottom-full left-0 z-30 mb-2 w-full max-w-md overflow-hidden rounded-2xl border border-black/10 bg-[#E2F0CC] p-1 shadow-xl shadow-black/10">
                  {EXAMPLE_PROMPTS.map((ex) => (
                    <button
                      key={ex}
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setInput(ex);
                        setShowSuggestions(false);
                        textareaRef.current?.focus();
                      }}
                      className="block w-full rounded-lg px-3 py-2 text-left text-[12px] text-black/65 transition-colors hover:bg-black/[0.04] hover:text-[#012F13] disabled:opacity-50"
                    >
                      {ex}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {composer}
          <p className="mt-2 text-center text-[10.5px] text-black/35">
            Agents act under scoped permissions — sensitive actions always ask you first.
          </p>
        </div>
      </div>

      <ClaimAccountModal open={claimOpen} onClose={() => setClaimOpen(false)} />
    </div>
  );
}
