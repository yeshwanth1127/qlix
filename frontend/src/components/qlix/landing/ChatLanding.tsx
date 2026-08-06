"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowUp,
  Bot,
  Check,
  ChevronDown,
  Download,
  LayoutDashboard,
  Lightbulb,
  Loader2,
  MessageCircle,
  Sparkles,
  User,
  Users,
} from "lucide-react";
import {
  nlParsePrompt,
  saveBuilderPrompt,
  type AgentCreationPlan,
  type NLAgentSpec,
  type NLWorkerSpec,
} from "@/lib/nl-builder-api";
import {
  createAgent,
  deleteAgent,
  confirmDownload,
  CLOUD_MODELS,
  type CreateAgentResponse,
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
import { postGuestSession, type AuthSuccessResponse } from "@/lib/auth-api";
import { useSession } from "@/components/qlix/session-context";
import { ClaimAccountModal } from "@/components/qlix/ClaimAccountModal";
import { HybridRunnerSetupPopup } from "@/components/qlix/agents/HybridRunnerSetupPopup";
import { NLPlanPreview } from "@/components/qlix/agents/nl/NLPlanPreview";
import { NLCreationProgress, type CreationStep } from "@/components/qlix/agents/nl/NLCreationProgress";
import { RequiredConnectorsPopup } from "@/components/qlix/agents/nl/RequiredConnectorsPopup";
import { QlixWordmark } from "@/components/qlix/landing/QlixWordmark";
import {
  ParticleConstellation,
  type ConstellationShape,
  type ConstellationSide,
} from "@/components/qlix/agents/nl/ParticleConstellation";
import { cn } from "@/lib/utils/cn";

// ── Chat transcript model ───────────────────────────────────────────────────

interface AgentOutput {
  response: CreateAgentResponse;
  label: string;
}

type DoneResult =
  | { type: "single"; outputs: AgentOutput[] }
  | { type: "team"; teamId: string; outputs: AgentOutput[] };

type ChatItem =
  | { id: number; kind: "user"; text: string }
  | { id: number; kind: "thinking"; text: string }
  | { id: number; kind: "info"; text: string }
  | { id: number; kind: "error"; text: string }
  | { id: number; kind: "plan"; plan: AgentCreationPlan; consumed: boolean; guestNote: string | null }
  | { id: number; kind: "progress"; steps: CreationStep[] }
  | { id: number; kind: "done"; result: DoneResult };

/** `Omit` collapses unions to their common keys; this distributes over each member. */
type NewChatItem = ChatItem extends infer T ? (T extends ChatItem ? Omit<T, "id"> : never) : never;

const EXAMPLE_PROMPTS = [
  "A web researcher that reads pages and sends me daily WhatsApp summaries",
  "A competitor research agent that writes a cited SWOT report and sends it as a PDF",
  "Build a team with a researcher and a writer that drafts reports",
  "An agent that monitors my inbox and replies to simple questions",
  "A finance tracker that can spend up to $50 and reports transactions",
];

/** Guests: cloud-only for web agents; hybrid when scopes need local tools (desktop/files). */
const GUEST_MAX_AGENTS = 3;

function adaptSpecForGuest<T extends NLAgentSpec | NLWorkerSpec>(spec: T): T {
  const model = CLOUD_MODELS.includes(spec.model as (typeof CLOUD_MODELS)[number])
    ? spec.model
    : CLOUD_MODELS[0];
  if (scopesRequireHybrid(spec.permissionScopes)) {
    return { ...spec, runtime: "hybrid", model, llmMode: "proxy", localInferenceMode: null };
  }
  return { ...spec, runtime: "cloud", model, llmMode: "proxy", localInferenceMode: null };
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
    localInferenceMode: spec.localInferenceMode,
    orgId,
    clientPlatform: detectHybridClientPlatform(),
  } as const;
}

// ── Result row ──────────────────────────────────────────────────────────────

function ResultRow({ output, routePrefix }: { readonly output: AgentOutput; readonly routePrefix: string }) {
  const { agent, sdkAgentFile, sdkAgentPaths, hybridStarterPack } = output.response;
  const [downloaded, setDownloaded] = useState(false);
  const isHybrid = agent.runtime === "hybrid";
  const [setupPopupOpen, setSetupPopupOpen] = useState(isHybrid);
  const autoDownloadFiredRef = useRef(false);

  // Stash the just-created starter pack so the agent's own page can offer a
  // re-download without re-issuing (which would rotate the signing key).
  useEffect(() => {
    if (isHybrid) stashStarterPack(agent.id, hybridStarterPack);
  }, [isHybrid, agent.id, hybridStarterPack]);

  const download = () => {
    if (isHybrid && hybridStarterPack?.base64) {
      downloadBase64File(hybridStarterPack.base64, hybridStarterPack.filename, "application/zip");
    } else {
      downloadJsonFile(sdkAgentFile, sdkAgentPaths.suggestedDownloadFilename);
    }
    setDownloaded(true);
    void confirmDownload(agent.id);
  };

  // Auto-download hybrid starter ZIP as soon as this result appears.
  useEffect(() => {
    if (!isHybrid) return;
    if (autoDownloadFiredRef.current) return;
    if (!hybridStarterPack?.base64) return;
    autoDownloadFiredRef.current = true;
    const t = window.setTimeout(() => {
      download();
    }, 50);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHybrid, hybridStarterPack?.base64]);

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
            <Download className="size-3.5 text-[#1c1830]" aria-hidden />
          </div>
          <div>
            <p className="text-[12.5px] font-semibold text-[#1c1830]">{agent.name}</p>
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
              <span className="flex size-4.5 shrink-0 items-center justify-center rounded-full bg-amber-400/15 text-[9.5px] font-semibold text-[#1c1830]">
                {n}
              </span>
              <span className="text-[12px] text-black/65">{text}</span>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={download}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-amber-400/25 bg-amber-400/10 px-4 py-2 text-[12.5px] font-semibold text-[#1c1830] transition-all duration-200 hover:border-amber-400/40 hover:bg-amber-400/20 active:scale-[0.99]"
        >
          {downloaded ? (
            <>
              <Check className="size-3.5 text-[#1c1830]" aria-hidden />
              <span className="text-[#1c1830]">Downloaded — download again</span>
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
            className="text-[11px] font-medium text-black/55 hover:text-[#1c1830]"
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
    <div className="rounded-xl border border-black/10 bg-white/70 p-3 text-[12px] shadow-[0_10px_24px_-18px_rgba(28,24,48,0.3)] backdrop-blur-sm">
      <div className="flex items-center gap-2 font-medium text-[#1c1830]">
        <Bot className="size-3.5 text-[#1c1830]" aria-hidden />
        {agent.name}
        <span className="ml-auto flex items-center gap-1 text-[10px] text-black/45">
          {agent.runtime === "cloud" ? (
            <>
              <Check className="size-3 text-[#1c1830]" aria-hidden />
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
          className="inline-flex items-center gap-1.5 rounded-full bg-[#1c1830] px-2.5 py-1 text-[11px] font-semibold text-white hover:brightness-110"
        >
          Chat with it →
        </Link>
        <Link
          href={`${routePrefix}/agents/${agent.id}`}
          className="text-[11px] text-black/55 hover:text-[#1c1830]"
        >
          Open agent
        </Link>
        {agent.runtime === "local" && (
          <button
            type="button"
            onClick={download}
            className="inline-flex items-center gap-1 text-[11px] text-[#1c1830] hover:text-black/70"
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
  const { session, refresh: refreshSession } = useSession();
  const [introDone, setIntroDone] = useState(isDashboard);
  const [items, setItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [claimOpen, setClaimOpen] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [connectorGate, setConnectorGate] = useState<PendingConnectorGate | null>(null);
  const idRef = useRef(0);
  const busyRef = useRef(false);
  const sessionRef = useRef<AuthSuccessResponse | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  sessionRef.current = session;

  useEffect(() => {
    if (session) sessionRef.current = session;
  }, [session]);

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
  const isOrg = isDashboard ? orgIdProp != null : session?.user.workspaceKind === "organization";
  const routePrefix = isOrg ? "/organization" : "/individual";
  const effectiveOrgId = isDashboard ? orgIdProp : session?.user.workspaceKind === "organization" ? session.user.orgId : null;

  // Particle background: scrambled until the first message, then it re-forms into
  // a new line-art shape each turn, alternating which half of the screen it owns.
  // The agent's reply panel always takes the opposite half.
  const SHAPE_SEQUENCE: ConstellationShape[] = ["brain", "bulb", "rocket", "check"];
  const userTurns = items.reduce((n, it) => n + (it.kind === "user" ? 1 : 0), 0);
  const constShape: ConstellationShape = hasConversation
    ? SHAPE_SEQUENCE[Math.min(Math.max(userTurns, 1), SHAPE_SEQUENCE.length) - 1]
    : "scramble";
  const shapeSide: ConstellationSide = !hasConversation
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
      const thinkingId = push({ kind: "thinking", text: "Designing your agent…" });
      const res = await nlParsePrompt(text, CLOUD_MODELS[0]);
      if (!res.ok) {
        replace(thinkingId, { kind: "error", text: res.errorMessage });
        return;
      }

      let plan = res.plan;
      let guestNote: string | null = null;
      const activeSession = isDashboard ? session : sessionRef.current;
      if (activeSession?.user.isGuest) {
        const adapted = adaptPlanForGuest(plan);
        plan = adapted.plan;
        guestNote = adapted.note;
      }
      replace(thinkingId, { kind: "plan", plan, consumed: false, guestNote });
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

    const outputs: AgentOutput[] = [];
    try {
      if (effectivePlan.type === "single") {
        setStep(0, { status: "active" });
        const res = await createAgent(specToCreateBody(effectivePlan.agent, orgId));
        if (!res.ok) throw new Error(res.errorMessage);
        setStep(0, { status: "done" });
        outputs.push({ response: res.data, label: effectivePlan.agent.name });
        push({ kind: "done", result: { type: "single", outputs } });
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
        push({ kind: "done", result: { type: "team", teamId: team.id, outputs } });
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
      <div className="relative flex items-end gap-2 rounded-[1.4rem] border border-black/10 bg-white/75 px-4 py-3 shadow-[0_1px_1px_rgba(28,24,48,0.04),0_18px_44px_-22px_rgba(28,24,48,0.35),inset_0_1px_0_rgba(255,255,255,0.85)] backdrop-blur-xl transition-[border-color,box-shadow] duration-300 focus-within:border-black/25 focus-within:shadow-[0_1px_1px_rgba(28,24,48,0.05),0_24px_56px_-24px_rgba(28,24,48,0.45),inset_0_1px_0_rgba(255,255,255,0.9)]">
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
          className={cn(
            "max-h-40 w-full resize-none bg-transparent text-[14px] leading-relaxed text-[#26203a] outline-none transition-[min-height] duration-200 placeholder:text-black/35 disabled:opacity-60",
            input ? "min-h-[64px] sm:min-h-[28px]" : "min-h-[28px]",
          )}
        />
        <button
          type="button"
          disabled={!input.trim() || busy}
          onClick={() => void handleSubmit()}
          aria-label="Send"
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-full text-white",
            "bg-[#1c1830]",
            "hover:brightness-110 active:scale-95 motion-safe:transition-[filter,transform]",
            "disabled:cursor-not-allowed disabled:opacity-40",
          )}
        >
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ArrowUp className="size-4" aria-hidden />}
        </button>
      </div>
    </div>
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      className={cn(
        "relative flex flex-col overflow-hidden bg-[#f4f1ea] text-[#26203a]",
        isDashboard ? "size-full" : "h-dvh",
      )}
    >
      <style>{`
        .qlmono { --text-primary:#1c1830; --text-secondary:#3a3550; --text-tertiary:#6b6680; --accent:#1c1830; --danger:#1c1830; --border-subtle:rgba(0,0,0,0.12); --border-default:rgba(0,0,0,0.30); --bg-subtle:rgba(0,0,0,0.04); --bg-elevated:#ffffff; }
        .qlscroll::-webkit-scrollbar{width:7px;height:7px} .qlscroll::-webkit-scrollbar-track{background:transparent} .qlscroll::-webkit-scrollbar-thumb{background:rgba(0,0,0,.20);border-radius:999px} .qlscroll::-webkit-scrollbar-thumb:hover{background:rgba(0,0,0,.4)} .qlscroll{scrollbar-width:thin;scrollbar-color:rgba(0,0,0,.20) transparent}
      `}</style>

      {/* Intro overlay — landing only */}
      {!isDashboard ? (
        <div
          className={cn(
            "fixed inset-0 z-50 flex items-center justify-center bg-[#f4f1ea] transition-opacity duration-700",
            introDone ? "pointer-events-none opacity-0" : "opacity-100",
          )}
        >
          <QlixWordmark
            animate
            onAnimationComplete={() => setIntroDone(true)}
            className="text-[72px] text-[#1c1830] sm:text-[110px] md:text-[150px]"
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

      {/* Header — landing only */}
      {!isDashboard ? (
        <header className="relative z-20 flex h-14 shrink-0 items-center px-4">
          <QlixWordmark className="shrink-0 text-[34px] text-[#1c1830]" />
          <div
            className={cn(
              "flex items-center justify-end gap-3",
              hasConversation ? panelColumnClass : "ml-auto",
            )}
          >
            {session && isGuest && (
              <>
                <span className="hidden items-center gap-1.5 rounded-full border border-black/10 bg-black/[0.04] px-2.5 py-1 text-[11px] text-black/55 sm:flex">
                  <User className="size-3" aria-hidden />
                  Guest workspace
                </span>
                <button
                  type="button"
                  onClick={() => setClaimOpen(true)}
                  className="rounded-full bg-[#1c1830] px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-white hover:brightness-110"
                >
                  Save my account
                </button>
              </>
            )}
            {session && !isGuest && (
              <Link
                href={`${routePrefix}/overview`}
                className="rounded-full bg-black/[0.06] px-3.5 py-1.5 text-[12px] font-semibold text-[#26203a] transition-colors hover:bg-black/10"
              >
                Open dashboard →
              </Link>
            )}
            {!session && (
              <>
                <Link href="/sign-in" className="text-[12px] font-medium text-black/55 transition-colors hover:text-[#1c1830]">
                  Sign in
                </Link>
                <Link
                  href="/sign-in?mode=sign-up"
                  className="rounded-full border border-black/15 bg-black/[0.04] px-3.5 py-1.5 text-[12px] font-semibold text-[#26203a] transition-colors hover:bg-black/[0.08]"
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
            <p className="mb-4 text-center text-[11px] font-semibold uppercase tracking-[0.05em] text-[#1c1830] sm:text-[12px]">
              Describe it. Qlix builds it.
            </p>
            <h1 className="text-center text-[34px] font-extralight leading-[0.95] tracking-[-0.04em] text-[#1c1830] sm:text-[44px] md:text-[64px]">
              What should your
              <br />
              AI agent do for you?
            </h1>
            <p className="mt-5 max-w-md text-center text-[14px] font-light leading-relaxed tracking-[0.025em] text-[#26203a]/70 sm:mt-6 sm:text-[15px]">
              Describe it in plain words. Qlix designs it, wires up its permissions, and brings it to life — right here.
            </p>
            {isDashboard ? (
              <Link
                href={`${routePrefix}/ai-employees`}
                className="mt-4 text-[12px] font-medium text-[#1c1830]/70 underline underline-offset-2 hover:text-[#1c1830]"
              >
                Looking for a ready-made role? Hire an AI Employee →
              </Link>
            ) : null}
          </div>
        ) : (
          <div
            ref={scrollRef}
            className={cn(
              "qlmono qlscroll mt-4 mb-2 flex h-[calc(100%-2.5rem)] max-h-full flex-col gap-3 overflow-y-auto rounded-3xl border border-black/10 bg-white/55 p-3 text-[#1c1830] shadow-[0_1px_1px_rgba(28,24,48,0.04),0_28px_64px_-32px_rgba(28,24,48,0.4),inset_0_1px_0_rgba(255,255,255,0.8)] backdrop-blur-2xl transition-[margin] duration-700 sm:mt-8 sm:gap-4 sm:p-5",
              panelColumnClass,
            )}
          >
            {items.map((item) => {
              if (item.kind === "user") {
                return (
                  <div key={item.id} className="qlix-msg-in flex justify-end">
                    <div className="max-w-[85%] rounded-2xl rounded-br-md border border-black/10 bg-white/80 px-4 py-2.5 text-[13.5px] leading-relaxed text-[#1c1830] shadow-[0_10px_24px_-16px_rgba(28,24,48,0.35)] backdrop-blur-sm">
                      {item.text}
                    </div>
                  </div>
                );
              }
              if (item.kind === "thinking") {
                return (
                  <div key={item.id} className="qlix-msg-in flex items-center gap-3">
                    <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#1c1830]">
                      <Sparkles className="size-3.5 text-white" aria-hidden />
                    </div>
                    <div className="flex items-center gap-2 text-[13px] text-black/60">
                      {item.text}
                      <span className="flex gap-1">
                        <span className="qlix-thinking-dot size-1.5 rounded-full bg-[#1c1830]" />
                        <span className="qlix-thinking-dot size-1.5 rounded-full bg-black/40" />
                        <span className="qlix-thinking-dot size-1.5 rounded-full bg-[#1c1830]" />
                      </span>
                    </div>
                  </div>
                );
              }
              if (item.kind === "info") {
                return (
                  <div key={item.id} className="qlix-msg-in flex gap-3">
                    <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#1c1830]">
                      <Sparkles className="size-3.5 text-white" aria-hidden />
                    </div>
                    <p className="max-w-[85%] text-[13px] leading-relaxed text-black/60">{item.text}</p>
                  </div>
                );
              }
              if (item.kind === "error") {
                return (
                  <div key={item.id} className="qlix-msg-in flex gap-3">
                    <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#1c1830]">
                      <Sparkles className="size-3.5 text-white" aria-hidden />
                    </div>
                    <p className="max-w-[85%] rounded-xl border border-red-500/20 bg-red-500/[0.07] px-3.5 py-2.5 text-[13px] text-[#1c1830]">
                      {item.text}
                    </p>
                  </div>
                );
              }
              if (item.kind === "plan") {
                const plan = item.plan;
                return (
                  <div key={item.id} className="qlix-msg-in flex gap-3">
                    <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#1c1830]">
                      {plan.type === "team" ? (
                        <Users className="size-3.5 text-white" aria-hidden />
                      ) : (
                        <Bot className="size-3.5 text-white" aria-hidden />
                      )}
                    </div>
                    <div className="min-w-0 flex-1 space-y-3">
                      <p className="text-[13px] leading-relaxed text-black/65">
                        {plan.type === "team"
                          ? `Here's a team of ${1 + plan.team.workers.length} agents I'd build for that. Review or tweak anything below, then bring them to life.`
                          : "Here's the agent I'd build for that. Review or tweak anything below, then bring it to life."}
                      </p>
                      {item.guestNote && (
                        <p className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[12px] text-[#1c1830]">
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
                      {!item.consumed && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void requestCreate(item.id, plan)}
                          className={cn(
                            "inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-[12px] font-semibold uppercase tracking-[0.05em] text-white",
                            "bg-[#1c1830]",
                            "hover:brightness-110 active:scale-[0.98] motion-safe:transition-[filter,transform]",
                            "disabled:cursor-not-allowed disabled:opacity-50",
                          )}
                        >
                          <Sparkles className="size-4" aria-hidden />
                          Bring {plan.type === "team" ? "this team" : "it"} to life
                        </button>
                      )}
                    </div>
                  </div>
                );
              }
              if (item.kind === "progress") {
                const allStepsDone = item.steps.every((s) => s.status === "done" || s.status === "error");
                return (
                  <div key={item.id} className="qlix-msg-in flex gap-3">
                    <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#1c1830]">
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
                  result.outputs[0]?.response.agent.name ??
                  (result.type === "team" ? "Your team" : "Your agent");
                return (
                  <div key={item.id} className="qlix-msg-in flex gap-3">
                    <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#1c1830]">
                      <Check className="size-3.5 text-white" aria-hidden />
                    </div>
                    <div className="min-w-0 flex-1 rounded-xl border border-green-600/35 bg-green-50 p-4">
                      <p className="text-[13px] font-medium text-[#1c1830]">
                        {result.type === "team"
                          ? `${primaryName} is live — ${result.outputs.length} agents created`
                          : `${primaryName} is live`}
                      </p>
                      <p className="mt-1 text-[12px] text-black/60">
                        {result.type === "team"
                          ? "Find your team on the Teams page to run and manage it."
                          : "Find it on the Agents page. Use Chat there when you&apos;re ready to talk to it."}
                      </p>
                      <Link
                        href={result.type === "team" ? `${routePrefix}/teams` : `${routePrefix}/agents`}
                        className={cn(
                          "mt-4 inline-flex items-center justify-center rounded-lg border border-green-700/40 bg-white px-4 py-2 text-[12px] font-semibold text-[#1c1830]",
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
                  <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#1c1830]">
                    <Check className="size-3.5 text-white" aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1 space-y-3">
                    <p className="text-[13px] leading-relaxed text-black/65">
                      {result.type === "team" ? "Your team is alive" : "Your agent is alive"} — it&apos;s already
                      running in your workspace.
                    </p>
                    <div className="space-y-2">
                      {result.outputs.map((o, i) => (
                        <ResultRow key={i} output={o} routePrefix={routePrefix} />
                      ))}
                    </div>
                    {result.outputs.some((o) => o.response.agent.jitScopes.length > 0) && result.outputs[0] && (
                      <div className="rounded-xl border border-amber-500/25 bg-amber-50/70 p-3.5 backdrop-blur-sm space-y-2.5">
                        <div>
                          <p className="text-[12.5px] font-semibold text-[#1c1830]">
                            This agent asks before sensitive actions
                          </p>
                          <p className="mt-0.5 text-[11px] text-black/55">
                            How do you want to approve those actions?
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Link
                            href={`${routePrefix}/connectors`}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-400/25 bg-emerald-400/10 px-3 py-1.5 text-[12px] font-semibold text-[#1c1830] transition-colors hover:bg-emerald-400/20"
                          >
                            <MessageCircle className="size-3.5" aria-hidden />
                            Approve via WhatsApp
                          </Link>
                          <Link
                            href={`${routePrefix}/agents/${result.outputs[0].response.agent.id}/chat`}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-black/15 bg-black/[0.04] px-3 py-1.5 text-[12px] font-semibold text-[#1c1830] transition-colors hover:bg-black/[0.08]"
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
                      {result.outputs[0] && (
                        <Link
                          href={`${routePrefix}/agents/${result.outputs[0].response.agent.id}`}
                          className="rounded-lg border border-black/15 bg-black/[0.04] px-3.5 py-1.5 text-[12px] font-semibold text-[#1c1830] transition-colors hover:bg-black/[0.08]"
                        >
                          Open dashboard →
                        </Link>
                      )}
                      {isGuest && (
                        <button
                          type="button"
                          onClick={() => setClaimOpen(true)}
                          className="text-[12px] font-medium text-[#1c1830] hover:text-black/70 hover:underline"
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
                className="inline-flex items-center gap-1.5 rounded-full border border-black/12 bg-black/[0.03] px-3 py-1 text-[11px] text-black/55 transition-colors hover:border-black/40 hover:text-[#1c1830]"
              >
                <Lightbulb className="size-3 text-[#1c1830]" aria-hidden />
                Need ideas?
                <ChevronDown
                  className={cn("size-3 transition-transform", showSuggestions && "rotate-180")}
                  aria-hidden
                />
              </button>
              {showSuggestions && (
                <div className="absolute bottom-full left-0 z-30 mb-2 w-full max-w-md overflow-hidden rounded-2xl border border-black/10 bg-white p-1 shadow-xl shadow-black/10">
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
                      className="block w-full rounded-lg px-3 py-2 text-left text-[12px] text-black/65 transition-colors hover:bg-black/[0.04] hover:text-[#1c1830] disabled:opacity-50"
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