"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowUp,
  Bot,
  Check,
  ChevronDown,
  Download,
  Lightbulb,
  Loader2,
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
import { downloadBase64File, downloadJsonFile } from "@/lib/download";
import { obtainAgentCreateStepUpToken } from "@/lib/webauthn";
import { detectHybridClientPlatform } from "@/lib/hybrid-platform";
import { postGuestSession, type AuthSuccessResponse } from "@/lib/auth-api";
import { useSession } from "@/components/qlix/session-context";
import { ClaimAccountModal } from "@/components/qlix/ClaimAccountModal";
import { NLPlanPreview } from "@/components/qlix/agents/nl/NLPlanPreview";
import { NLCreationProgress, type CreationStep } from "@/components/qlix/agents/nl/NLCreationProgress";
import BlurText from "@/components/qlix/BlurText";
import Grainient from "@/components/qlix/Grainient";
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
  "Build a team with a researcher and a writer that drafts reports",
  "An agent that monitors my inbox and replies to simple questions",
  "A finance tracker that can spend up to $50 and reports transactions",
];

/** Guests get cloud agents only (instantly usable, nothing to download) and ≤ 3 agents. */
const GUEST_MAX_AGENTS = 3;

function forceCloud<T extends NLAgentSpec | NLWorkerSpec>(spec: T): T {
  const model = CLOUD_MODELS.includes(spec.model as (typeof CLOUD_MODELS)[number])
    ? spec.model
    : CLOUD_MODELS[0];
  return { ...spec, runtime: "cloud", model, llmMode: "proxy", localInferenceMode: null };
}

function adaptPlanForGuest(plan: AgentCreationPlan): { plan: AgentCreationPlan; note: string | null } {
  if (plan.type === "single") {
    return { plan: { ...plan, agent: forceCloud(plan.agent) }, note: null };
  }
  const maxWorkers = GUEST_MAX_AGENTS - 1;
  const trimmed = plan.team.workers.length > maxWorkers;
  return {
    plan: {
      ...plan,
      team: {
        ...plan.team,
        supervisor: forceCloud(plan.team.supervisor),
        workers: plan.team.workers.slice(0, maxWorkers).map(forceCloud),
      },
    },
    note: trimmed
      ? `Guest workspaces are limited to ${GUEST_MAX_AGENTS} agents — the team was trimmed. Create a free account for bigger teams.`
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

  const download = () => {
    if (isHybrid && hybridStarterPack?.base64) {
      downloadBase64File(hybridStarterPack.base64, hybridStarterPack.filename, "application/zip");
    } else {
      downloadJsonFile(sdkAgentFile, sdkAgentPaths.suggestedDownloadFilename);
    }
    setDownloaded(true);
    void confirmDownload(agent.id);
  };

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3 text-[12px]">
      <div className="flex items-center gap-2 font-medium text-white">
        <Bot className="size-3.5 text-cyan-400" aria-hidden />
        {agent.name}
        <span className="ml-auto flex items-center gap-1 text-[10px] text-white/40">
          {agent.runtime === "cloud" ? (
            <>
              <Check className="size-3 text-emerald-400" aria-hidden />
              live on Qlix cloud
            </>
          ) : (
            agent.runtime
          )}
        </span>
      </div>
      <div className="mt-1 flex items-center gap-2 text-[11px] text-white/40">
        <span>{agent.alwaysScopes.length} always-on scopes</span>
        <span>·</span>
        <span>{agent.jitScopes.length} JIT</span>
      </div>
      <div className="mt-2 flex items-center gap-3">
        <Link
          href={`${routePrefix}/agents/${agent.id}/chat`}
          className="inline-flex items-center gap-1.5 rounded-md bg-gradient-to-r from-violet-600 to-cyan-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:brightness-110"
        >
          Chat with it →
        </Link>
        <Link
          href={`${routePrefix}/agents/${agent.id}`}
          className="text-[11px] text-white/50 hover:text-white"
        >
          Open agent
        </Link>
        {(agent.runtime === "hybrid" || agent.runtime === "local") && (
          <button
            type="button"
            onClick={download}
            className="inline-flex items-center gap-1 text-[11px] text-cyan-300 hover:text-cyan-200"
          >
            <Download className="size-3" aria-hidden />
            {downloaded ? "Download again" : "Download runner"}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main landing ────────────────────────────────────────────────────────────

export function ChatLanding() {
  const { session, refresh: refreshSession } = useSession();
  const [introDone, setIntroDone] = useState(false);
  const [items, setItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [claimOpen, setClaimOpen] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const idRef = useRef(0);
  const busyRef = useRef(false);
  const sessionRef = useRef<AuthSuccessResponse | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  sessionRef.current = session;

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
  const isOrg = session?.user.workspaceKind === "organization";
  const routePrefix = isOrg ? "/organization" : "/individual";

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
      const sess = await ensureSession();
      if (!sess) return;

      void saveBuilderPrompt(text);
      const thinkingId = push({ kind: "thinking", text: "Designing your agent…" });
      const res = await nlParsePrompt(text, CLOUD_MODELS[0]);
      if (!res.ok) {
        replace(thinkingId, { kind: "error", text: res.errorMessage });
        return;
      }

      let plan = res.plan;
      let guestNote: string | null = null;
      if (sess.user.isGuest) {
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

  const handleCreate = async (planItemId: number, plan: AgentCreationPlan) => {
    if (busyRef.current) return;
    const sess = sessionRef.current;
    if (!sess) return;
    busyRef.current = true;
    setBusy(true);
    patch(planItemId, { consumed: true });

    // Guests have no passkey — the backend waives step-up for them.
    let token = "";
    if (!sess.user.isGuest) {
      const stepUp = await obtainAgentCreateStepUpToken(sess.user.deviceVerified);
      if (!stepUp.ok) {
        push({ kind: "error", text: stepUp.errorMessage });
        patch(planItemId, { consumed: false });
        busyRef.current = false;
        setBusy(false);
        return;
      }
      token = stepUp.stepUpToken;
      if (!sess.user.deviceVerified) await refreshSession();
    }

    const orgId = sess.user.workspaceKind === "organization" ? sess.user.orgId : null;
    const initialSteps: CreationStep[] =
      plan.type === "single"
        ? [{ label: `Creating ${plan.agent.name}`, status: "pending" }]
        : [
            { label: `Creating supervisor — ${plan.team.supervisor.name}`, status: "pending" },
            ...plan.team.workers.map((w) => ({ label: `Creating ${w.name}`, status: "pending" as const })),
            { label: `Assembling team — ${plan.team.name}`, status: "pending" as const },
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
      if (plan.type === "single") {
        setStep(0, { status: "active" });
        const res = await createAgent(specToCreateBody(plan.agent, orgId), token);
        if (!res.ok) throw new Error(res.errorMessage);
        setStep(0, { status: "done" });
        outputs.push({ response: res.data, label: plan.agent.name });
        push({ kind: "done", result: { type: "single", outputs } });
      } else {
        // Teams are workspace-scoped: the team is created under the user's own
        // workspace org, so its member agents must carry that same org or the
        // backend rejects them (assertAgentInOrg). For an individual/guest this
        // org is simply their private workspace.
        const teamOrgId = sess.user.orgId;
        setStep(0, { status: "active" });
        const supRes = await createAgent(specToCreateBody(plan.team.supervisor, teamOrgId), token);
        if (!supRes.ok) {
          setStep(0, { status: "error", errorMessage: supRes.errorMessage });
          throw new Error(supRes.errorMessage);
        }
        setStep(0, { status: "done" });
        outputs.push({ response: supRes.data, label: plan.team.supervisor.name });

        const workerIds: string[] = [];
        for (let i = 0; i < plan.team.workers.length; i++) {
          const worker = plan.team.workers[i];
          setStep(i + 1, { status: "active" });
          const wRes = await createAgent(specToCreateBody(worker, teamOrgId), token);
          if (!wRes.ok) {
            setStep(i + 1, { status: "error", errorMessage: wRes.errorMessage });
            throw new Error(wRes.errorMessage);
          }
          setStep(i + 1, { status: "done" });
          outputs.push({ response: wRes.data, label: worker.name });
          workerIds.push(wRes.data.agent.id);
        }

        const assembleIdx = plan.team.workers.length + 1;
        setStep(assembleIdx, { status: "active" });
        const team = await createTeam(
          {
            name: plan.team.name,
            description: plan.team.description,
            config: {
              maxParallelWorkers: plan.team.config.maxParallelWorkers,
              subtaskTimeoutMs: plan.team.config.subtaskTimeoutMs,
              retryPolicy: plan.team.config.retryPolicy,
              humanInLoopTriggers: ["web.transaction", "finance.spend_50", "finance.spend_100"],
              pipelineMode: true,
              autoSequence: false,
            },
          },
          token,
        );
        await setSupervisorAgent(team.id, supRes.data.agent.id);
        for (let i = 0; i < plan.team.workers.length; i++) {
          const worker = plan.team.workers[i];
          await addTeamMember(team.id, {
            agentId: workerIds[i],
            role: worker.role,
            delegatedScopes: worker.permissionScopes,
          });
        }
        setStep(assembleIdx, { status: "done", label: `Team assembled — ${plan.team.name}` });
        push({ kind: "done", result: { type: "team", teamId: team.id, outputs } });
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
    <div className="relative w-full rounded-2xl">
      <div className="relative flex items-end gap-2 rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 shadow-2xl shadow-black/40 backdrop-blur-2xl">
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
          className="max-h-40 min-h-[28px] w-full resize-none bg-transparent text-[14px] leading-relaxed text-white outline-none placeholder:text-white/30 disabled:opacity-60"
        />
        <button
          type="button"
          disabled={!input.trim() || busy}
          onClick={() => void handleSubmit()}
          aria-label="Send"
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-xl text-white",
            "bg-gradient-to-br from-violet-600 to-cyan-600 shadow-lg shadow-violet-500/30",
            "hover:brightness-110 active:scale-95 motion-safe:transition-[filter,transform]",
            "disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none",
          )}
        >
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ArrowUp className="size-4" aria-hidden />}
        </button>
      </div>
    </div>
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="dark relative flex h-dvh flex-col overflow-hidden bg-[#03010A] text-white">
      <style>{`
        @keyframes qlanding-msg-in {
          from { opacity: 0; transform: translateY(14px) scale(0.985); filter: blur(4px); }
          to { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }
        }
        .qlanding-msg { animation: qlanding-msg-in 0.45s cubic-bezier(0.22, 1, 0.36, 1) both; }
        .qlanding-dot { animation: qlanding-pulse 1.2s ease-in-out infinite; }
        .qlanding-dot:nth-child(2) { animation-delay: 0.15s; }
        .qlanding-dot:nth-child(3) { animation-delay: 0.3s; }
        @keyframes qlanding-pulse {
          0%, 100% { opacity: 0.25; transform: scale(0.85); }
          50% { opacity: 1; transform: scale(1.1); }
        }
      `}</style>

      {/* Intro overlay */}
      <div
        className={cn(
          "fixed inset-0 z-50 flex items-center justify-center bg-[#03010A] transition-opacity duration-700",
          introDone ? "pointer-events-none opacity-0" : "opacity-100",
        )}
      >
        <BlurText
          text="Qlix"
          delay={200}
          animateBy="words"
          direction="top"
          onAnimationComplete={() => setIntroDone(true)}
          className="justify-center text-[96px] font-medium tracking-tighter text-white [font-family:var(--font-landing-logo)]"
        />
      </div>

      {/* Animated background */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <Grainient
          color1="#8b5cf6"
          color2="#03010A"
          color3="#22d3ee"
          timeSpeed={0.18}
          warpStrength={1.2}
          grainAmount={0.08}
          saturation={1.1}
          contrast={1.4}
        />
        <div className="absolute inset-0 bg-[#03010A]/40" />
      </div>

      {/* Header */}
      <header className="relative z-20 flex h-14 shrink-0 items-center justify-between px-5 sm:px-8">
        <span className="text-[20px] font-medium tracking-tighter text-white [font-family:var(--font-landing-logo)]">
          Qlix
        </span>
        <div className="flex items-center gap-3">
          {session && isGuest && (
            <>
              <span className="hidden items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-white/60 sm:flex">
                <User className="size-3" aria-hidden />
                Guest workspace
              </span>
              <button
                type="button"
                onClick={() => setClaimOpen(true)}
                className="rounded-lg bg-gradient-to-r from-violet-600 to-cyan-600 px-3.5 py-1.5 text-[12px] font-semibold text-white hover:brightness-110"
              >
                Save my account
              </button>
            </>
          )}
          {session && !isGuest && (
            <Link
              href={`${routePrefix}/overview`}
              className="rounded-lg bg-white/10 px-3.5 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-white/20"
            >
              Open dashboard →
            </Link>
          )}
          {!session && (
            <>
              <Link href="/sign-in" className="text-[12px] font-medium text-white/60 transition-colors hover:text-white">
                Sign in
              </Link>
              <Link
                href="/sign-in?mode=sign-up"
                className="rounded-lg border border-white/15 bg-white/5 px-3.5 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-white/10"
              >
                Sign up
              </Link>
            </>
          )}
        </div>
      </header>

      {/* Conversation / hero */}
      <div ref={scrollRef} className="relative z-10 flex-1 overflow-y-auto">
        {!hasConversation ? (
          <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center px-5 pb-24">
            <h1 className="bg-gradient-to-br from-white via-white to-white/40 bg-clip-text text-center text-[34px] font-semibold leading-[1.15] tracking-[-0.03em] text-transparent sm:text-[44px]">
              What should your
              <br />
              AI agent do for you?
            </h1>
            <p className="mt-3 max-w-md text-center text-[14px] leading-relaxed text-white/50">
              Describe it in plain words. Qlix designs it, wires up its permissions, and brings it to life — right here.
            </p>
          </div>
        ) : (
          <div className="mx-auto max-w-2xl space-y-4 px-5 pb-40 pt-6">
            {items.map((item) => {
              if (item.kind === "user") {
                return (
                  <div key={item.id} className="qlanding-msg flex justify-end">
                    <div className="max-w-[85%] rounded-2xl rounded-br-md bg-gradient-to-br from-violet-600/30 to-indigo-600/20 px-4 py-2.5 text-[13.5px] leading-relaxed text-white ring-1 ring-violet-500/25">
                      {item.text}
                    </div>
                  </div>
                );
              }
              if (item.kind === "thinking") {
                return (
                  <div key={item.id} className="qlanding-msg flex items-center gap-3">
                    <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-cyan-600">
                      <Sparkles className="size-3.5 text-white" aria-hidden />
                    </div>
                    <div className="flex items-center gap-2 text-[13px] text-white/60">
                      {item.text}
                      <span className="flex gap-1">
                        <span className="qlanding-dot size-1.5 rounded-full bg-cyan-400" />
                        <span className="qlanding-dot size-1.5 rounded-full bg-violet-400" />
                        <span className="qlanding-dot size-1.5 rounded-full bg-cyan-400" />
                      </span>
                    </div>
                  </div>
                );
              }
              if (item.kind === "info") {
                return (
                  <div key={item.id} className="qlanding-msg flex gap-3">
                    <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-cyan-600">
                      <Sparkles className="size-3.5 text-white" aria-hidden />
                    </div>
                    <p className="max-w-[85%] text-[13px] leading-relaxed text-white/60">{item.text}</p>
                  </div>
                );
              }
              if (item.kind === "error") {
                return (
                  <div key={item.id} className="qlanding-msg flex gap-3">
                    <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-red-500/20">
                      <Sparkles className="size-3.5 text-red-400" aria-hidden />
                    </div>
                    <p className="max-w-[85%] rounded-xl border border-red-500/25 bg-red-500/10 px-3.5 py-2.5 text-[13px] text-red-300">
                      {item.text}
                    </p>
                  </div>
                );
              }
              if (item.kind === "plan") {
                const plan = item.plan;
                return (
                  <div key={item.id} className="qlanding-msg flex gap-3">
                    <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-cyan-600">
                      {plan.type === "team" ? (
                        <Users className="size-3.5 text-white" aria-hidden />
                      ) : (
                        <Bot className="size-3.5 text-white" aria-hidden />
                      )}
                    </div>
                    <div className="min-w-0 flex-1 space-y-3">
                      <p className="text-[13px] leading-relaxed text-white/70">
                        {plan.type === "team"
                          ? `Here's a team of ${1 + plan.team.workers.length} agents I'd build for that. Review or tweak anything below, then bring them to life.`
                          : "Here's the agent I'd build for that. Review or tweak anything below, then bring it to life."}
                      </p>
                      {item.guestNote && (
                        <p className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-300">
                          {item.guestNote}
                        </p>
                      )}
                      <div className="rounded-xl border border-white/10 bg-[#0b0918]/80 p-3 backdrop-blur-md">
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
                          onClick={() => void handleCreate(item.id, plan)}
                          className={cn(
                            "inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold text-white shadow-lg",
                            "bg-gradient-to-r from-violet-600 via-indigo-600 to-cyan-600 shadow-violet-500/30",
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
                return (
                  <div key={item.id} className="qlanding-msg flex gap-3">
                    <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-cyan-600">
                      <Loader2 className="size-3.5 animate-spin text-white" aria-hidden />
                    </div>
                    <div className="min-w-0 flex-1 rounded-xl border border-white/10 bg-[#0b0918]/80 p-3 backdrop-blur-md">
                      <NLCreationProgress steps={item.steps} />
                    </div>
                  </div>
                );
              }
              // done
              const result = item.result;
              return (
                <div key={item.id} className="qlanding-msg flex gap-3">
                  <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-emerald-500/20">
                    <Check className="size-3.5 text-emerald-400" aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1 space-y-3">
                    <p className="text-[13px] leading-relaxed text-white/70">
                      {result.type === "team" ? "Your team is alive" : "Your agent is alive"} — it&apos;s already
                      running in your workspace.
                    </p>
                    <div className="space-y-2">
                      {result.outputs.map((o, i) => (
                        <ResultRow key={i} output={o} routePrefix={routePrefix} />
                      ))}
                    </div>
                    <div className="flex flex-wrap items-center gap-3 pt-1">
                      <Link
                        href={`${routePrefix}/overview`}
                        className="rounded-lg border border-white/15 bg-white/5 px-3.5 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-white/10"
                      >
                        Explore your dashboard →
                      </Link>
                      {isGuest && (
                        <button
                          type="button"
                          onClick={() => setClaimOpen(true)}
                          className="text-[12px] font-medium text-cyan-300 hover:text-cyan-200 hover:underline"
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
      <div className="relative z-20 shrink-0 px-5 pb-25">
        <div className="mx-auto max-w-5xl">
          {!hasConversation && (
            <div className="relative mb-2">
              <button
                type="button"
                onClick={() => setShowSuggestions((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] text-white/55 transition-colors hover:border-violet-500/40 hover:text-white"
              >
                <Lightbulb className="size-3 text-violet-400" aria-hidden />
                Need ideas?
                <ChevronDown
                  className={cn("size-3 transition-transform", showSuggestions && "rotate-180")}
                  aria-hidden
                />
              </button>
              {showSuggestions && (
                <div className="absolute bottom-full left-0 z-30 mb-2 w-full max-w-md overflow-hidden rounded-xl border border-white/10 bg-[#0b0918]/95 p-1 shadow-2xl shadow-black/50 backdrop-blur-xl">
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
                      className="block w-full rounded-lg px-3 py-2 text-left text-[12px] text-white/60 transition-colors hover:bg-white/[0.06] hover:text-white disabled:opacity-50"
                    >
                      {ex}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {composer}
          <p className="mt-2 text-center text-[10.5px] text-white/30">
            Agents act under scoped permissions — sensitive actions always ask you first.
          </p>
        </div>
      </div>

      <ClaimAccountModal open={claimOpen} onClose={() => setClaimOpen(false)} />
    </div>
  );
}
