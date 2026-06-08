"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Bot, Check, Download, History, Loader2, Sparkles, Users, Wand2, X } from "lucide-react";
import { nlParsePrompt, fetchBuilderHistory, saveBuilderPrompt, type AgentCreationPlan, type NLAgentSpec, type NLWorkerSpec } from "@/lib/nl-builder-api";
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
import { useSession } from "@/components/qlix/session-context";
import { cn } from "@/lib/utils/cn";
import { NLPlanPreview } from "./NLPlanPreview";
import { VerificationPrompt } from "./VerificationPrompt";
import { NLCreationProgress, type CreationStep } from "./NLCreationProgress";
import Particles from "@/components/qlix/Particles";

type FlowState = "idle" | "parsing" | "plan_preview" | "verifying" | "creating" | "done";

interface AgentOutput {
  response: CreateAgentResponse;
  label: string;
}

type DoneResult =
  | { type: "single"; outputs: AgentOutput[] }
  | { type: "team"; teamId: string; outputs: AgentOutput[] };

const EXAMPLE_PROMPTS = [
  "A web researcher that reads pages and sends me daily WhatsApp summaries",
  "Build a team with a supervisor, a web researcher, and a writer that drafts reports",
  "An agent that monitors my inbox and replies to simple questions automatically",
  "A finance tracker that can spend up to $50 and reports transactions",
];

interface NLAgentBuilderPageProps {
  readonly orgId: string | null;
  readonly deviceVerified: boolean;
}

function ResultOutput({ output }: { readonly output: AgentOutput }) {
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
    <div className="rounded-lg border border-[--border-subtle] bg-[--bg-base] p-3 text-[12px]">
      <div className="flex items-center gap-2 font-medium text-[--text-primary]">
        <Bot className="size-3.5 text-[--accent]" aria-hidden />
        {agent.name}
        <span className="ml-auto font-mono text-[10px] text-[--text-tertiary]">{agent.did.slice(0, 24)}…</span>
      </div>
      <div className="mt-1 flex items-center gap-2 text-[11px] text-[--text-tertiary]">
        <span>{agent.runtime}</span>
        <span>·</span>
        <span>{agent.alwaysScopes.length} always-on</span>
        <span>·</span>
        <span>{agent.jitScopes.length} JIT</span>
      </div>
      {(agent.runtime === "hybrid" || agent.runtime === "local") && (
        <button
          type="button"
          onClick={download}
          className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-[--accent] px-2.5 py-1 text-[11px] font-medium text-[--accent-contrast] transition-colors hover:bg-[--accent-hover]"
        >
          <Download className="size-3" aria-hidden />
          {downloaded
            ? "Download again"
            : isHybrid && hybridStarterPack?.filename
              ? hybridStarterPack.filename
              : sdkAgentPaths.suggestedDownloadFilename}
        </button>
      )}
      {agent.runtime === "cloud" && (
        <div className="mt-2 flex items-center gap-1 text-[11px] text-emerald-400">
          <Check className="size-3" aria-hidden />
          Provisioning on Qlix cloud…
        </div>
      )}
    </div>
  );
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

export function NLAgentBuilderPage({ orgId, deviceVerified }: NLAgentBuilderPageProps) {
  const { refresh: refreshSession } = useSession();
  const submitLockRef = useRef(false);

  const [state, setState] = useState<FlowState>("idle");
  const [prompt, setPrompt] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [buildHistory, setBuildHistory] = useState<string[]>([]);
  const [parseModel, setParseModel] = useState<string>(CLOUD_MODELS[0]);
  const [agentModel, setAgentModel] = useState<string>(CLOUD_MODELS[0]);
  const [plan, setPlan] = useState<AgentCreationPlan | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [steps, setSteps] = useState<CreationStep[]>([]);
  const [doneResult, setDoneResult] = useState<DoneResult | null>(null);

  useEffect(() => {
    void fetchBuilderHistory().then((entries) => setBuildHistory(entries.map((e) => e.prompt)));
  }, []);

  const saveToHistory = (text: string) => {
    // Optimistic update: move to top locally, then persist in background
    setBuildHistory((prev) => [text, ...prev.filter((p) => p !== text)].slice(0, 20));
    void saveBuilderPrompt(text);
  };

  const reset = () => {
    setState("idle");
    setPlan(null);
    setParseError(null);
    setVerifyError(null);
    setSteps([]);
    setDoneResult(null);
    setPrompt("");
    setHistoryOpen(false);
  };

  const setStep = (index: number, patch: Partial<CreationStep>) =>
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));

  const handleParse = async () => {
    if (!prompt.trim()) return;
    setState("parsing");
    setParseError(null);
    setHistoryOpen(false);
    saveToHistory(prompt.trim());
    const res = await nlParsePrompt(prompt.trim(), parseModel);
    if (!res.ok) {
      setParseError(res.errorMessage);
      setState("idle");
      return;
    }
    const p = res.plan;
    const withModel =
      p.type === "single"
        ? { ...p, agent: { ...p.agent, model: agentModel } }
        : {
            ...p,
            team: {
              ...p.team,
              supervisor: { ...p.team.supervisor, model: agentModel },
              workers: p.team.workers.map((w) => ({ ...w, model: agentModel })),
            },
          };
    setPlan(withModel);
    setState("plan_preview");
  };

  const handleVerifyAndCreate = async () => {
    if (!plan || submitLockRef.current) return;
    submitLockRef.current = true;
    setState("verifying");
    setVerifyError(null);

    const stepUp = await obtainAgentCreateStepUpToken(deviceVerified);
    if (!stepUp.ok) {
      setVerifyError(stepUp.errorMessage);
      setState("plan_preview");
      submitLockRef.current = false;
      return;
    }
    if (!deviceVerified) await refreshSession();

    // Build initial step list — all pending
    const initialSteps: CreationStep[] =
      plan.type === "single"
        ? [{ label: `Creating ${plan.agent.name}`, status: "pending" }]
        : [
            { label: `Creating supervisor — ${plan.team.supervisor.name}`, status: "pending" },
            ...plan.team.workers.map((w) => ({
              label: `Creating ${w.name}`,
              status: "pending" as const,
            })),
            { label: `Assembling team — ${plan.team.name}`, status: "pending" },
          ];

    setSteps(initialSteps);
    setState("creating");

    const token = stepUp.stepUpToken;
    const outputs: AgentOutput[] = [];

    try {
      if (plan.type === "single") {
        setStep(0, { status: "active" });
        const res = await createAgent(specToCreateBody(plan.agent, orgId), token);
        if (!res.ok) throw new Error(res.errorMessage);
        setStep(0, { status: "done" });
        outputs.push({ response: res.data, label: plan.agent.name });
        setDoneResult({ type: "single", outputs });

      } else {
        // Supervisor
        setStep(0, { status: "active" });
        const supRes = await createAgent(specToCreateBody(plan.team.supervisor, orgId), token);
        if (!supRes.ok) { setStep(0, { status: "error", errorMessage: supRes.errorMessage }); throw new Error(supRes.errorMessage); }
        setStep(0, { status: "done" });
        outputs.push({ response: supRes.data, label: plan.team.supervisor.name });

        // Workers
        const workerIds: string[] = [];
        for (let i = 0; i < plan.team.workers.length; i++) {
          const worker = plan.team.workers[i];
          setStep(i + 1, { status: "active" });
          const wRes = await createAgent(specToCreateBody(worker, orgId), token);
          if (!wRes.ok) { setStep(i + 1, { status: "error", errorMessage: wRes.errorMessage }); throw new Error(wRes.errorMessage); }
          setStep(i + 1, { status: "done" });
          outputs.push({ response: wRes.data, label: worker.name });
          workerIds.push(wRes.data.agent.id);
        }

        // Assemble team
        const assembleIdx = plan.team.workers.length + 1;
        setStep(assembleIdx, { status: "active", label: `Assembling team — ${plan.team.name}` });

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
          setStep(assembleIdx, { label: `Adding ${worker.name} to team…` });
          await addTeamMember(team.id, {
            agentId: workerIds[i],
            role: worker.role,
            delegatedScopes: worker.permissionScopes,
          });
        }

        setStep(assembleIdx, { status: "done", label: `Team assembled — ${plan.team.name}` });
        setDoneResult({ type: "team", teamId: team.id, outputs });
      }

      setState("done");
    } catch (err) {
      // Clean up any agents created before the failure so nothing is orphaned
      if (outputs.length > 0) {
        await Promise.allSettled(
          outputs.map((o) => deleteAgent(o.response.agent.id, o.response.agent.name)),
        );
      }
      const base = err instanceof Error ? err.message : "Creation failed";
      setVerifyError(outputs.length > 0 ? `${base} — partially created agents have been removed` : base);
      setState("plan_preview");
    } finally {
      submitLockRef.current = false;
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  // Animated particle field behind the builder, scoped to this page.
  const background = (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <Particles
        particleColors={["#8b5cf6", "#22d3ee", "#ffffff"]}
        particleCount={220}
        particleSpread={12}
        speed={0.08}
        particleBaseSize={90}
        moveParticlesOnHover
        particleHoverFactor={0.6}
        alphaParticles
        disableRotation={false}
      />
    </div>
  );

  const shell = (content: React.ReactNode) => (
    <div className="relative min-h-[calc(100dvh-6rem)]">
      {background}
      <div className="relative z-10">{content}</div>
    </div>
  );

  if (state === "done" && doneResult) {
    const routePrefix = orgId ? `/organization` : `/individual`;
    return shell(
      <div className="mx-auto max-w-2xl space-y-5 px-4 py-8">
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-full bg-emerald-500/15">
            <Check className="size-4 text-emerald-400" aria-hidden />
          </div>
          <div>
            <h2 className="text-[15px] font-semibold text-[--text-primary]">
              {doneResult.type === "team" ? "Team created" : "Agent created"}
            </h2>
            {doneResult.type === "team" && (
              <p className="text-[11px] text-[--text-tertiary]">Team ID: {doneResult.teamId}</p>
            )}
          </div>
        </div>
        <div className="space-y-2">
          {doneResult.outputs.map((o, i) => (
            <div key={i} className="space-y-1">
              <ResultOutput output={o} />
              <Link
                href={`${routePrefix}/agents/${o.response.agent.id}`}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-[--accent] hover:underline"
              >
                Open agent
                <ArrowRight className="size-3" aria-hidden />
              </Link>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-4 pt-1">
          <button type="button" onClick={reset} className="text-[12px] font-medium text-[--accent] hover:underline">
            Build another →
          </button>
          <Link
            href={`${routePrefix}/agents`}
            className="text-[12px] text-[--text-tertiary] hover:text-[--text-primary]"
          >
            View all agents
          </Link>
        </div>
      </div>
    );
  }

  return shell(
    <div className="mx-auto max-w-2xl px-4 py-8">
      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <div className="flex size-9 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-cyan-600">
          <Wand2 className="size-4 text-white" aria-hidden />
        </div>
        <div>
          <h1 className="bg-gradient-to-r from-violet-400 to-cyan-400 bg-clip-text text-[16px] font-bold text-transparent">
            AI Agent Builder
          </h1>
          <p className="text-[11px] text-[--text-tertiary]">
            Describe what you want — we&apos;ll create the agents for you
          </p>
        </div>
        <div className="relative ml-auto">
          <button
            type="button"
            onClick={() => setHistoryOpen((o) => !o)}
            title="View build history"
            className="flex items-center gap-1.5 rounded-md border border-[--border-subtle] bg-[--bg-subtle] px-2.5 py-1.5 text-[11px] text-[--text-secondary] transition-colors hover:border-[--accent]/40 hover:text-[--text-primary]"
          >
            <History className="size-3.5" aria-hidden />
            History
            {buildHistory.length > 0 && (
              <span className="rounded-full bg-[--accent]/20 px-1.5 py-0.5 text-[9px] font-semibold text-[--accent]">
                {buildHistory.length}
              </span>
            )}
          </button>
          {historyOpen && (
            <div className="absolute right-0 top-full z-20 mt-1.5 w-80 rounded-lg border border-[--border-subtle] bg-[--bg-base]/95 shadow-xl backdrop-blur-sm">
              <div className="flex items-center justify-between border-b border-[--border-subtle] px-3 py-2">
                <span className="text-[11px] font-medium text-[--text-primary]">Previous build requests</span>
                <button
                  type="button"
                  onClick={() => setHistoryOpen(false)}
                  className="text-[--text-tertiary] transition-colors hover:text-[--text-primary]"
                  aria-label="Close history"
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </div>
              <div className="max-h-72 space-y-0.5 overflow-y-auto p-1.5">
                {buildHistory.length === 0 ? (
                  <p className="px-2.5 py-4 text-center text-[11px] text-[--text-tertiary]">
                    No history yet — your build requests will appear here.
                  </p>
                ) : (
                  buildHistory.map((entry, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => { setPrompt(entry); setHistoryOpen(false); }}
                      className="w-full rounded-md px-2.5 py-2 text-left text-[11px] text-[--text-secondary] transition-colors hover:bg-[--bg-subtle] hover:text-[--text-primary]"
                    >
                      <span className="line-clamp-2 leading-relaxed">{entry}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Idle / Input */}
      {(state === "idle" || state === "parsing") && (
        <div className="space-y-4">
          <div>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={5}
              maxLength={5000}
              disabled={state === "parsing"}
              placeholder="e.g. Build me a research agent that reads websites and sends me WhatsApp summaries each morning…"
              className="w-full resize-none rounded-lg border border-[--border-subtle] bg-[--bg-base] px-4 py-3 text-[13px] text-[--text-primary] outline-none transition-colors focus:border-[--accent] disabled:opacity-60"
            />
            <div className="mt-1 flex items-center justify-between text-[10px] text-[--text-tertiary]">
              <span>Describe a single agent or a whole team with multiple workers</span>
              <span>{prompt.length}/5000</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-medium text-[--text-tertiary]">Builder model</label>
              <select
                value={parseModel}
                onChange={(e) => setParseModel(e.target.value)}
                disabled={state === "parsing"}
                className="rounded-md border border-[--border-subtle] bg-[--bg-base] px-2.5 py-1 text-[12px] text-[--text-primary] outline-none focus:border-[--accent] disabled:opacity-60"
              >
                {CLOUD_MODELS.map((m) => (
                  <option key={m} value={m} className="bg-white text-black">
                    {m.replace("openrouter/", "")}
                  </option>
                ))}
              </select>
              <span className="text-[10px] text-[--text-tertiary]">Interprets your prompt</span>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-medium text-[--text-tertiary]">Agent model</label>
              <select
                value={agentModel}
                onChange={(e) => setAgentModel(e.target.value)}
                disabled={state === "parsing"}
                className="rounded-md border border-[--border-subtle] bg-[--bg-base] px-2.5 py-1 text-[12px] text-[--text-primary] outline-none focus:border-[--accent] disabled:opacity-60"
              >
                {CLOUD_MODELS.map((m) => (
                  <option key={m} value={m} className="bg-white text-black">
                    {m.replace("openrouter/", "")}
                  </option>
                ))}
              </select>
              <span className="text-[10px] text-[--text-tertiary]">What the agents will use</span>
            </div>
          </div>

          {parseError && (
            <p className="rounded-md border border-[--danger]/40 bg-[--danger]/10 px-3 py-2 text-[12px] text-[--danger]">
              {parseError}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            {EXAMPLE_PROMPTS.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => setPrompt(ex)}
                disabled={state === "parsing"}
                className="rounded-full border border-[--border-subtle] bg-[--bg-subtle] px-3 py-1 text-[11px] text-[--text-secondary] transition-colors hover:border-[--accent]/40 hover:text-[--text-primary] disabled:opacity-50"
              >
                {ex.length > 50 ? ex.slice(0, 48) + "…" : ex}
              </button>
            ))}
          </div>

          <button
            type="button"
            disabled={!prompt.trim() || state === "parsing"}
            onClick={() => void handleParse()}
            className={cn(
              "inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-[13px] font-semibold text-white shadow-md",
              "bg-gradient-to-r from-violet-600 via-indigo-600 to-cyan-600 shadow-violet-500/25",
              "hover:brightness-110 active:scale-[0.98] motion-safe:transition-[filter,transform] motion-safe:duration-200",
              "disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none",
            )}
          >
            {state === "parsing"
              ? <Loader2 className="size-4 animate-spin" aria-hidden />
              : <Sparkles className="size-4" aria-hidden />}
            {state === "parsing" ? "Reading your request…" : "Build"}
          </button>
        </div>
      )}

      {/* Plan preview */}
      {state === "plan_preview" && plan && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {plan.type === "team"
                ? <Users className="size-4 text-[--accent]" aria-hidden />
                : <Bot className="size-4 text-[--accent]" aria-hidden />}
              <span className="text-[13px] font-medium text-[--text-primary]">
                {plan.type === "team"
                  ? `Team plan — ${1 + plan.team.workers.length} agents`
                  : "Agent plan"}
              </span>
            </div>
            <button
              type="button"
              onClick={reset}
              className="flex items-center gap-1 text-[11px] text-[--text-tertiary] hover:text-[--text-primary]"
            >
              <ArrowLeft className="size-3" aria-hidden />
              Refine prompt
            </button>
          </div>

          <NLPlanPreview plan={plan} onPlanChange={setPlan} />

          {verifyError && (
            <p className="rounded-md border border-[--danger]/40 bg-[--danger]/10 px-3 py-2 text-[12px] text-[--danger]">
              {verifyError}
            </p>
          )}

          <div className="flex items-center gap-3">
            <button type="button" onClick={reset} className="text-[12px] text-[--text-tertiary] hover:text-[--text-primary]">
              ← Back
            </button>
            <button
              type="button"
              onClick={() => setState("verifying")}
              className={cn(
                "inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-[13px] font-semibold text-white shadow-md",
                "bg-gradient-to-r from-violet-600 via-indigo-600 to-cyan-600 shadow-violet-500/25",
                "hover:brightness-110 active:scale-[0.98] motion-safe:transition-[filter,transform] motion-safe:duration-200",
              )}
            >
              Create {plan.type === "team" ? "team" : "agent"} →
            </button>
          </div>
        </div>
      )}

      {/* Verification popup */}
      {state === "verifying" && plan && (
        <VerificationPrompt
          plan={plan}
          verifying={false}
          error={verifyError}
          onVerify={() => void handleVerifyAndCreate()}
          onCancel={() => setState("plan_preview")}
        />
      )}

      {/* Live creation progress */}
      {state === "creating" && <NLCreationProgress steps={steps} />}
    </div>
  );
}
