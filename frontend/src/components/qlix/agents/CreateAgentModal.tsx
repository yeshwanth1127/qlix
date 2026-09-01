"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, Cloud, Cpu, Download, Fingerprint, Laptop, Loader2, X } from "lucide-react";
import {
  ALL_PERMISSION_SCOPES,
  CLOUD_MODELS,
  EXORA_MODELS,
  FORCE_JIT_SCOPES,
  LOCAL_MODELS,
  PERMISSION_SCOPE_LABELS,
  buildProxyModelGroups,
  llmProviderFromModelId,
  type AgentRuntime,
  type AgentDTO,
  type CreateAgentResponse,
  type LocalInferenceMode,
  type LlmMode,
  type LlmProvider,
  type ModelCatalogEntry,
  type PermissionScope,
  type ScopeCatalogEntry,
  confirmDownload,
  createAgent,
  fetchInferenceCapabilities,
  fetchModelCatalog,
  fetchScopeCatalog,
  getRuntimeStatus,
  restartCloudRunner,
} from "@/lib/agents-api";
import { downloadBase64File, downloadJsonFile, stashStarterPack } from "@/lib/download";
import { detectHybridClientPlatform } from "@/lib/hybrid-platform";
import {
  CreateAgentStepProgress,
  CreateAgentSubmitProgress,
  type CreateAgentFlowStep,
} from "@/components/qlix/agents/CreateAgentStepProgress";
import { HybridRunnerSetupPopup } from "@/components/qlix/agents/HybridRunnerSetupPopup";
import { ModelHierarchyPicker } from "@/components/qlix/agents/ModelHierarchyPicker";
import { cn } from "@/lib/utils/cn";
import { SketchBox, sketchButton, sketchInput, sketchLabel } from "@/components/qlix/sketch";

type Step = 1 | 2 | 3 | 4 | "result";

interface CreateAgentModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onCreated: (agent: AgentDTO) => void;
  readonly orgId: string | null;
  /** When true, hide SDK-only local runtime (team agents: cloud or hybrid). */
  readonly cloudOnly?: boolean;
}

interface FormState {
  name: string;
  description: string;
  permissionScopes: PermissionScope[];
  userToggledJit: PermissionScope[];
  runtime: AgentRuntime;
  /** When runtime is local; null when cloud. */
  localInferenceMode: LocalInferenceMode | null;
  /** direct = local engine; proxy = Qlix backend. Cloud always forces proxy. */
  llmMode: LlmMode;
  llmProvider: LlmProvider;
  model: string;
}

const INITIAL_FORM: FormState = {
  name: "",
  description: "",
  permissionScopes: ["web.read", "brain.query"],
  userToggledJit: [],
  runtime: "cloud",
  localInferenceMode: null,
  llmMode: "proxy",
  llmProvider: "exora",
  model: EXORA_MODELS[0],
};

// React Bits Stepper slide transition — entering content slides in from the
// opposite side of travel while the outgoing step fades away.
const stepVariants = {
  enter: (dir: number) => ({ x: dir >= 0 ? "-100%" : "100%", opacity: 0 }),
  center: { x: "0%", opacity: 1 },
  exit: (dir: number) => ({ x: dir >= 0 ? "50%" : "-50%", opacity: 0 }),
};

function splitJit(form: FormState): { jitScopes: PermissionScope[]; alwaysScopes: PermissionScope[] } {
  const userToggled = new Set(form.userToggledJit);
  const jitScopes = form.permissionScopes.filter(
    (s) => FORCE_JIT_SCOPES.includes(s) || userToggled.has(s),
  );
  const jitSet = new Set(jitScopes);
  const alwaysScopes = form.permissionScopes.filter((s) => !jitSet.has(s));
  return { jitScopes, alwaysScopes };
}

export function CreateAgentModal({
  open,
  onClose,
  onCreated,
  orgId,
  cloudOnly = false,
}: CreateAgentModalProps) {
  const submitLockRef = useRef(false);
  const [step, setStep] = useState<Step>(1);
  const [direction, setDirection] = useState(1);
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<CreateAgentResponse | null>(null);
  const updateForm = useCallback((patch: Partial<FormState>) => {
    setForm((current) => ({ ...current, ...patch }));
  }, []);

  useEffect(() => {
    if (open) {
      setStep(1);
      setDirection(1);
      setForm(cloudOnly ? { ...INITIAL_FORM, runtime: "cloud", llmMode: "proxy", localInferenceMode: null } : INITIAL_FORM);
      setError(null);
      setResult(null);
      setSubmitting(false);
    }
  }, [open, cloudOnly]);

  const { jitScopes, alwaysScopes } = useMemo(() => splitJit(form), [form]);

  if (!open) return null;

  const canStep1 = form.name.trim().length > 0 && form.permissionScopes.length > 0;
  const canStep3 =
    form.model.trim().length > 0 &&
    (form.runtime === "cloud" || form.runtime === "local" || form.runtime === "hybrid");

  const submit = async () => {
    if (submitLockRef.current) return;
    submitLockRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const body = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        permissionScopes: form.permissionScopes,
        jitScopes,
        runtime: form.runtime,
        model: form.model,
        llmMode:
          form.runtime === "cloud" || form.runtime === "hybrid" ? "proxy" : form.llmMode,
        llmProvider: form.llmProvider,
        localInferenceMode:
          form.runtime === "local"
            ? (form.localInferenceMode as LocalInferenceMode)
            : null,
        orgId,
        ...(form.runtime === "hybrid"
          ? { clientPlatform: detectHybridClientPlatform() }
          : {}),
      };

      const res = await createAgent(body);
      if (!res.ok) {
        setError(res.errorMessage);
        setDirection(-1);
        setStep(3);
        return;
      }
      setResult(res.data);
      setDirection(1);
      setStep("result");
      onCreated(res.data.agent);
    } finally {
      submitLockRef.current = false;
      setSubmitting(false);
    }
  };

  const goCreate = () => {
    setDirection(1);
    setStep(4);
    void submit();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#E2F0CC]/80 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-agent-title"
    >
      <div
        className="relative flex w-full max-w-xl flex-col overflow-hidden border-2 border-black bg-[#E2F0CC]"
        style={{ maxHeight: "min(90vh, 700px)" }}
      >
        <header className="flex shrink-0 items-center justify-between border-b border-black px-5 py-3">
          <div>
            <h2 id="create-agent-title" className={sketchLabel}>
              Create agent
            </h2>
            <p className="mt-0.5 text-[11px] text-black/50">
              Register a new autonomous agent with cryptographic identity
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="border border-black p-1 text-black/50 transition-colors hover:bg-black hover:text-white"
            aria-label="Close"
          >
            <X className="size-4" aria-hidden />
          </button>
        </header>

        <div className="shrink-0">
          <CreateAgentStepProgress step={step as CreateAgentFlowStep} creating={step === 4} />
        </div>

        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-5 py-5">
          <AnimatePresence mode="wait" custom={direction} initial={false}>
          <motion.div
            key={String(step)}
            custom={direction}
            variants={stepVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          >
          {step === 1 ? (
            <Step1
              name={form.name}
              description={form.description}
              scopes={form.permissionScopes}
              orgId={orgId}
              onChange={updateForm}
            />
          ) : null}

          {step === 2 ? (
            <Step2
              scopes={form.permissionScopes}
              userToggledJit={form.userToggledJit}
              onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
            />
          ) : null}

          {step === 3 ? (
            <Step3
              runtime={form.runtime}
              llmMode={form.llmMode}
              llmProvider={form.llmProvider}
              localInferenceMode={form.localInferenceMode}
              model={form.model}
              cloudOnly={cloudOnly}
              onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
            />
          ) : null}

          {step === 4 ? <CreateAgentSubmitProgress runtime={form.runtime} /> : null}

          {step === "result" && result ? (
            <ResultPanel
              data={result}
              onClose={onClose}
            />
          ) : null}

          {error ? (
            <SketchBox className="mt-3 px-3 py-2 text-[12px] text-black">{error}</SketchBox>
          ) : null}
          </motion.div>
          </AnimatePresence>
        </div>

        {step !== "result" && step !== 4 ? (
          <footer className="flex shrink-0 items-center justify-between border-t border-black px-5 py-3">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  if (step === 1) onClose();
                  else {
                    setDirection(-1);
                    setStep(((step as number) - 1) as Step);
                  }
                }}
                className={sketchButton}
                disabled={submitting}
              >
                {step === 1 ? "Cancel" : "Back"}
              </button>
              <span className="text-[11px] text-black/50">
                always-on: {alwaysScopes.length} · JIT: {jitScopes.length}
              </span>
            </div>
            <button
              type="button"
              disabled={
                submitting ||
                (step === 1 && !canStep1) ||
                (step === 3 && !canStep3)
              }
              onClick={() => {
                setDirection(1);
                if (step === 1) setStep(2);
                else if (step === 2) setStep(3);
                else if (step === 3) void goCreate();
              }}
              className={`${sketchButton} gap-2 disabled:cursor-not-allowed disabled:opacity-50`}
            >
              {submitting ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
              {step === 3 ? "Create agent" : "Next →"}
            </button>
          </footer>
        ) : null}

        {step === "result" ? (
          <footer className="flex shrink-0 items-center justify-end border-t border-black px-5 py-3">
            <button type="button" onClick={onClose} className={sketchButton}>
              Done
            </button>
          </footer>
        ) : null}
      </div>
    </div>
  );
}

function Step1({
  name,
  description,
  scopes,
  orgId,
  onChange,
}: {
  readonly name: string;
  readonly description: string;
  readonly scopes: PermissionScope[];
  readonly orgId: string | null;
  readonly onChange: (patch: Partial<FormState>) => void;
}) {
  const [catalog, setCatalog] = useState<ScopeCatalogEntry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchScopeCatalog(orgId).then((rows) => {
      if (!cancelled) setCatalog(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  const scopeOptions = useMemo(() => {
    const map = new Map<string, { id: string; label: string; forceJit: boolean }>();
    for (const id of ALL_PERMISSION_SCOPES) {
      map.set(id, {
        id,
        label: PERMISSION_SCOPE_LABELS[id],
        forceJit: FORCE_JIT_SCOPES.includes(id),
      });
    }
    for (const row of catalog ?? []) {
      map.set(row.id, {
        id: row.id,
        label: row.label || row.id,
        forceJit: row.forceJit,
      });
    }
    return Array.from(map.values()).sort((a, b) => {
      const aMcp = a.id.startsWith("mcp.") ? 1 : 0;
      const bMcp = b.id.startsWith("mcp.") ? 1 : 0;
      if (aMcp !== bMcp) return aMcp - bMcp;
      return a.id.localeCompare(b.id);
    });
  }, [catalog]);

  const toggle = (scope: string) => {
    const set = new Set(scopes);
    if (set.has(scope as PermissionScope)) set.delete(scope as PermissionScope);
    else set.add(scope as PermissionScope);
    onChange({ permissionScopes: Array.from(set) });
  };

  return (
    <div className="space-y-4">
      <label className="block">
        <span className={`${sketchLabel} normal-case tracking-normal`}>Agent name</span>
        <input
          type="text"
          value={name}
          maxLength={120}
          autoFocus
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="e.g. Job Apply Agent"
          className={`${sketchInput} mt-1.5`}
        />
      </label>

      <label className="block">
        <span className={`${sketchLabel} normal-case tracking-normal`}>
          Role description <span className="font-normal text-black/50">(optional)</span>
        </span>
        <textarea
          value={description}
          rows={5}
          onChange={(e) => onChange({ description: e.target.value })}
          placeholder="e.g. Apply to Greenhouse and Lever roles using my resume."
          className={`${sketchInput} mt-1.5 resize-none`}
        />
      </label>

      <div>
        <p className={sketchLabel}>Permission scopes</p>
        <p className="mt-0.5 text-[11px] text-black/50">
          What this agent is allowed to do — including MCP tools like Qlix Jobs (resume apply) and Qlix Leads.
        </p>
        <ul className="mt-2 max-h-72 space-y-1 overflow-y-auto">
          {scopeOptions.map((opt) => {
            const checked = scopes.includes(opt.id as PermissionScope);
            return (
              <li key={opt.id}>
                <label className="flex cursor-pointer items-start gap-2 border border-black px-2 py-1.5 transition-colors hover:bg-black/5">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(opt.id)}
                    className="mt-0.5 accent-black"
                  />
                  <div>
                    <span className="font-mono text-[12px] text-black">{opt.id}</span>
                    <span className="ml-2 text-[12px] text-black/50">{opt.label}</span>
                    {opt.forceJit ? (
                      <span className="ml-2 text-[10px] uppercase tracking-wide text-black/40">JIT</span>
                    ) : null}
                  </div>
                </label>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function Step2({
  scopes,
  userToggledJit,
  onChange,
}: {
  readonly scopes: PermissionScope[];
  readonly userToggledJit: PermissionScope[];
  readonly onChange: (patch: Partial<FormState>) => void;
}) {
  const toggle = (scope: PermissionScope) => {
    const set = new Set(userToggledJit);
    if (set.has(scope)) set.delete(scope);
    else set.add(scope);
    onChange({ userToggledJit: Array.from(set) });
  };

  return (
    <div className="space-y-3">
      <div>
        <p className="text-[12px] font-medium text-[--text-secondary]">Just-in-time approvals</p>
        <p className="mt-0.5 text-[11px] text-[--text-tertiary]">
          JIT scopes ask for confirmation every time. Sensitive scopes are always JIT and cannot be turned off.
        </p>
      </div>
      {scopes.length === 0 ? (
        <p className="text-[12px] text-[--text-tertiary]">No scopes selected. Go back to step 1.</p>
      ) : (
        <ul className="space-y-1">
          {scopes.map((scope) => {
            const forced = FORCE_JIT_SCOPES.includes(scope);
            const checked = forced || userToggledJit.includes(scope);
            return (
              <li
                key={scope}
                className="flex items-center justify-between rounded-md border border-[--border-subtle] px-3 py-2"
              >
                <div>
                  <div className="font-mono text-[12px] text-[--text-primary]">{scope}</div>
                  <div className="text-[11px] text-[--text-tertiary]">
                    {forced ? "Platform required — always JIT" : "Optional — toggle to require approval"}
                  </div>
                </div>
                <label className="inline-flex items-center gap-2 text-[12px] text-[--text-secondary]">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={forced}
                    onChange={() => toggle(scope)}
                  />
                  JIT
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Step3({
  runtime,
  llmMode,
  llmProvider,
  localInferenceMode,
  model,
  cloudOnly,
  onChange,
}: {
  readonly runtime: AgentRuntime;
  readonly llmMode: LlmMode;
  readonly llmProvider: LlmProvider;
  readonly localInferenceMode: LocalInferenceMode | null;
  readonly model: string;
  readonly cloudOnly?: boolean;
  readonly onChange: (patch: Partial<FormState>) => void;
}) {
  const proxyInference =
    runtime === "cloud" || runtime === "hybrid" || llmMode === "proxy";
  const [capabilities, setCapabilities] = useState<Awaited<
    ReturnType<typeof fetchInferenceCapabilities>
  >>(null);
  const [exoraCatalog, setExoraCatalog] = useState<ModelCatalogEntry[]>([]);
  const [openrouterCatalog, setOpenrouterCatalog] = useState<ModelCatalogEntry[]>([]);

  useEffect(() => {
    if (!proxyInference) return;
    let cancelled = false;
    void fetchInferenceCapabilities().then((result) => {
      if (cancelled || !result) return;
      setCapabilities(result);
      if (!result.providers[llmProvider].enabled) {
        const fallback = result.providers[result.defaultProvider].enabled
          ? result.defaultProvider
          : result.providers.exora.enabled
            ? "exora"
            : "openrouter";
        onChange({
          llmProvider: fallback,
          model: fallback === "exora" ? EXORA_MODELS[0] : CLOUD_MODELS[0],
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [proxyInference, llmProvider, onChange]);

  useEffect(() => {
    if (!proxyInference) {
      setExoraCatalog([]);
      setOpenrouterCatalog([]);
      return;
    }
    let cancelled = false;
    void Promise.all([fetchModelCatalog("exora"), fetchModelCatalog("openrouter")]).then(
      ([exoraResult, openrouterResult]) => {
        if (cancelled) return;
        setExoraCatalog(exoraResult.ok ? exoraResult.models : []);
        setOpenrouterCatalog(openrouterResult.ok ? openrouterResult.models : []);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [proxyInference]);

  const modelGroups = useMemo(() => {
    if (!proxyInference) return [];
    return buildProxyModelGroups({
      exoraCatalog,
      openrouterCatalog,
      includeExora: capabilities?.providers.exora.enabled !== false,
      includeOpenrouter: capabilities?.providers.openrouter.enabled !== false,
      selectedModel: model,
    });
  }, [capabilities, exoraCatalog, openrouterCatalog, model, proxyInference]);

  return (
    <div className="space-y-4">
      <div>
        <p className="text-[12px] font-medium text-[--text-secondary]">Where should this agent run?</p>
        <p className="mt-0.5 text-[11px] text-[--text-tertiary]">
          Choose how the agent thinks and where it executes tasks.
        </p>
        <div
          className={cn(
            "mt-2 grid gap-2",
            cloudOnly ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1 sm:grid-cols-3",
          )}
        >
          <RuntimeCard
            active={runtime === "cloud"}
            icon={<Cloud className="size-4" aria-hidden />}
            title="Cloud"
            description="Brain and tools run on Qlix servers. Browser and email in the cloud."
            onClick={() =>
              onChange({
                runtime: "cloud",
                llmMode: "proxy",
                localInferenceMode: null,
                llmProvider: "exora",
                model: EXORA_MODELS[0],
              })
            }
          />
          <RuntimeCard
            active={runtime === "hybrid"}
            icon={<Laptop className="size-4" aria-hidden />}
            title="Hybrid"
            description="Agent hosted on Qlix. Tasks run on your computer (files, apps, shell)."
            onClick={() =>
              onChange({
                runtime: "hybrid",
                llmMode: "proxy",
                localInferenceMode: null,
                llmProvider: "exora",
                model: EXORA_MODELS[0],
              })
            }
          />
          {!cloudOnly ? (
            <RuntimeCard
              active={runtime === "local"}
              icon={<Cpu className="size-4" aria-hidden />}
              title="Local SDK"
              description="Scripts only — no dashboard chat. You run the SDK yourself."
              onClick={() =>
                onChange({
                  runtime: "local",
                  llmMode: "direct",
                  localInferenceMode: "local_llm",
                  model: LOCAL_MODELS[0],
                })
              }
            />
          ) : null}
        </div>
        {cloudOnly ? (
          <p className="mt-2 text-[11px] text-[--text-tertiary]">
            Team agents use Cloud or Hybrid. Hybrid workers need the Qlix agent app running on someone&apos;s
            computer.
          </p>
        ) : null}
      </div>

      {runtime === "hybrid" ? (
        <div className="rounded-md border border-cyan-500/35 bg-cyan-500/10 px-3 py-2.5 text-[12px] leading-relaxed text-[--text-secondary]">
          <p className="font-medium text-cyan-900 dark:text-cyan-100">Run agent here, execute tasks locally</p>
          <ul className="mt-2 list-inside list-disc space-y-1 text-[11px] text-[--text-tertiary]">
            <li>Chat and reasoning use Qlix (same as cloud agents).</li>
            <li>Files, terminal, and desktop apps run on your PC.</li>
            <li>After creation you get one ZIP — unzip it and double-click Start Qlix Agent.</li>
          </ul>
        </div>
      ) : null}

      {runtime === "local" ? (
        <div className="space-y-2">
          <p className="text-[12px] font-medium text-[--text-secondary]">LLM calls</p>
          <p className="text-[11px] leading-relaxed text-[--text-tertiary]">
            Choose whether LLM requests go straight to your local engine or are routed through Qlix.
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <InferenceModeCard
              active={llmMode === "direct"}
              title="Use your own model"
              description="Calls go directly to Ollama or another local engine."
              onClick={() =>
                onChange({
                  llmMode: "direct",
                  localInferenceMode: "local_llm",
                  model: LOCAL_MODELS.includes(model as (typeof LOCAL_MODELS)[number])
                    ? model
                    : LOCAL_MODELS[0],
                })
              }
            />
            <InferenceModeCard
              active={llmMode === "proxy"}
              title="Use Qlix AI"
              description="Calls are routed through the Qlix backend (same models as cloud)."
              onClick={() =>
                onChange({
                  llmMode: "proxy",
                  localInferenceMode: "cloud_api",
                  llmProvider: "exora",
                  model: EXORA_MODELS[0],
                })
              }
            />
          </div>
        </div>
      ) : null}

      <div className="block">
        <span className="text-[12px] font-medium text-[--text-secondary]">AI Model</span>
        {proxyInference ? (
          <div className="mt-1.5">
            <ModelHierarchyPicker
              value={model}
              groups={modelGroups}
              onChange={(next) =>
                onChange({
                  model: next,
                  llmProvider: llmProviderFromModelId(next),
                })
              }
            />
          </div>
        ) : (
          <select
            value={model}
            onChange={(e) => onChange({ model: e.target.value })}
            className="mt-1.5 w-full rounded-md border border-[--border-subtle] bg-[--bg-base] px-3 py-1.5 text-[13px] text-[--text-primary] outline-none focus:border-[--accent]"
          >
            {LOCAL_MODELS.map((m) => (
              <option key={m} value={m} className="bg-[#E2F0CC] text-black">
                {m}
              </option>
            ))}
          </select>
        )}
        <p className="mt-1 text-[11px] text-[--text-tertiary]">
          {runtime === "cloud" || runtime === "hybrid"
            ? model.endsWith("/qlix/auto")
              ? "Auto routes to the cheapest capable model within your billable tier. Price stays fixed."
              : llmProvider === "exora"
                ? "Exora model — routed through llm.exora.solutions."
                : "OpenRouter model — routed through Qlix."
            : "Override with your local model if needed."}
        </p>
      </div>
    </div>
  );
}

const runtimeCardSelected = "border-2 border-black bg-[#E2F0CC]";
const runtimeCardIdle = "border border-black bg-[#E2F0CC] hover:bg-black/5";

function InferenceModeCard({
  active,
  title,
  description,
  onClick,
}: {
  readonly active: boolean;
  readonly title: string;
  readonly description: string;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn("relative p-3 text-left transition-all duration-200 border", active ? runtimeCardSelected : runtimeCardIdle)}
    >
      {active ? (
        <span className="absolute right-2 top-2 flex size-5 items-center justify-center border border-black bg-black text-white" aria-hidden>
          <Check className="size-3" />
        </span>
      ) : null}
      <div className={cn("text-[12px] font-medium", active ? "text-black" : "text-black/70")}>
        {title}
      </div>
      <p className="mt-1 text-[11px] text-black/50">{description}</p>
    </button>
  );
}

function RuntimeCard({
  active,
  icon,
  title,
  description,
  onClick,
}: {
  readonly active: boolean;
  readonly icon: React.ReactNode;
  readonly title: string;
  readonly description: string;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn("relative p-3 text-left transition-all duration-200 border", active ? runtimeCardSelected : runtimeCardIdle)}
    >
      {active ? (
        <span className="absolute right-2 top-2 flex size-5 items-center justify-center border border-black bg-black text-white" aria-hidden>
          <Check className="size-3" />
        </span>
      ) : null}
      <div className={cn("flex items-center gap-2 text-[12px] font-medium", active ? "text-black" : "text-black/70")}>
        {icon}
        {title}
      </div>
      <p className="mt-1 text-[11px] text-black/50">{description}</p>
    </button>
  );
}

function ResultPanel({
  data,
  onClose: _onClose,
}: {
  readonly data: CreateAgentResponse;
  readonly onClose: () => void;
}) {
  const { agent, credentials, sdkAgentFile, sdkAgentPaths, hybridStarterPack } = data;
  const isCloud = agent.runtime === "cloud";
  const isHybrid = agent.runtime === "hybrid";
  const needsCredentialFile = isHybrid || agent.runtime === "local";
  const [downloaded, setDownloaded] = useState(false);
  const [setupPopupOpen, setSetupPopupOpen] = useState(isHybrid);
  const autoDownloadFiredRef = useRef(false);
  const starterPackMissing = isHybrid && !hybridStarterPack?.base64;
  // Stash the just-created starter pack so the agent's own page can re-offer the
  // download without re-issuing (which rotates the signing key).
  useEffect(() => {
    if (isHybrid) stashStarterPack(agent.id, hybridStarterPack);
  }, [isHybrid, agent.id, hybridStarterPack]);
  const [runnerStatus, setRunnerStatus] = useState<
    | { state: "idle" }
    | { state: "loading" }
    | { state: "running"; lastHeartbeatAt: string | null }
    | { state: "provisioning"; provisioningStatus: string | null }
    | { state: "offline"; message: string }
    | { state: "failed"; message: string }
  >({ state: "idle" });
  const [inferenceError, setInferenceError] = useState<string | null>(null);

  useEffect(() => {
    if (!isCloud && !isHybrid) return;
    let alive = true;
    setRunnerStatus({ state: "loading" });
    const tick = async () => {
      const status = await getRuntimeStatus(agent.id);
      if (!alive) return;
      if (!status) {
        if (isCloud) {
          setRunnerStatus({
            state: "provisioning",
            provisioningStatus: agent.cloudProvisioningStatus ?? "provisioning",
          });
        } else {
          setRunnerStatus({
            state: "offline",
            message: "Your local agent isn't connected yet. Download its credentials, then run: qlix start",
          });
        }
        return;
      }
      setInferenceError(status.inferenceError ?? null);
      if (status.heartbeatFresh || (isCloud && status.provisioningStatus === "running")) {
        setRunnerStatus({ state: "running", lastHeartbeatAt: status.lastHeartbeatAt });
      } else if (isCloud && status.provisioningStatus === "failed") {
        setRunnerStatus({ state: "failed", message: "Runner failed to start. Try restart." });
      } else if (isCloud) {
        setRunnerStatus({ state: "provisioning", provisioningStatus: status.provisioningStatus });
      } else {
        setRunnerStatus({
          state: "offline",
          message: "Not connected. Unzip the starter pack and double-click Start Qlix Agent on your computer.",
        });
      }
    };
    void tick();
    const t = window.setInterval(() => void tick(), 2500);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [agent.cloudProvisioningStatus, agent.id, isCloud, isHybrid]);

  const triggerDownload = () => {
    if (isHybrid && hybridStarterPack?.base64) {
      downloadBase64File(
        hybridStarterPack.base64,
        hybridStarterPack.filename,
        "application/zip",
      );
    } else if (isHybrid) {
      // Starter zip missing — fall back to credentials so the user is not left empty-handed.
      downloadJsonFile(sdkAgentFile, sdkAgentPaths.suggestedDownloadFilename);
    } else {
      downloadJsonFile(sdkAgentFile, sdkAgentPaths.suggestedDownloadFilename);
    }
    setDownloaded(true);
    void confirmDownload(agent.id);
  };

  // Auto-download the hybrid starter ZIP as soon as the result panel renders.
  // The backend ships the ZIP inline once; if the user dismisses the modal they cannot redownload.
  useEffect(() => {
    if (!isHybrid) return;
    if (autoDownloadFiredRef.current) return;
    if (!hybridStarterPack?.base64) return;
    autoDownloadFiredRef.current = true;
    // Defer one tick so the browser sees a freshly mounted document — improves popup-blocker handling.
    const t = window.setTimeout(() => {
      triggerDownload();
    }, 50);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHybrid, hybridStarterPack?.base64]);

  return (
    <div className="space-y-3">
      {isHybrid ? (
        <HybridRunnerSetupPopup
          open={setupPopupOpen}
          onClose={() => setSetupPopupOpen(false)}
          zipFilename={hybridStarterPack?.filename}
        />
      ) : null}

      <div className="flex items-center gap-2 text-[--text-primary]">
        <Fingerprint className="size-4" aria-hidden />
        <span className="text-[13px] font-medium">Agent created</span>
      </div>

      <dl className="space-y-1.5 text-[12px]">
        <Row label="DID" value={agent.did} mono />
        <Row label="Status" value={agent.status} />
        <Row label="Runtime" value={agent.runtime} />
        <Row
          label="LLM calls"
          value={agent.llmMode === "direct" ? "Direct (local engine)" : "Proxy (Qlix backend)"}
        />
        <Row label="Model" value={agent.model} />
        <Row label="Always-on" value={agent.alwaysScopes.join(", ") || "—"} mono />
        <Row label="JIT" value={agent.jitScopes.join(", ") || "—"} mono />
        <Row
          label="VCs"
          value={credentials.map((c) => c.type).join(", ") || "—"}
        />
      </dl>

      {isCloud ? (
        <div className="rounded-md border border-[--accent]/40 bg-[--accent]/10 px-3 py-2 text-[12px] text-[--text-primary]">
          <span className="inline-flex items-center gap-1.5">
            <Check className="size-3.5" aria-hidden /> Live on Qlix infrastructure. Nothing to install for cloud
            runtime.
          </span>
          <div className="mt-2 text-[11px] text-[--text-secondary]">
            {runnerStatus.state === "loading" ? "Setting up your agent…" : null}
            {runnerStatus.state === "provisioning" ? "Setting up your agent…" : null}
            {runnerStatus.state === "running"
              ? `Online and ready${runnerStatus.lastHeartbeatAt ? ` (last seen ${runnerStatus.lastHeartbeatAt})` : ""}`
              : null}
            {runnerStatus.state === "failed" ? runnerStatus.message : null}
            {inferenceError ? ` ${inferenceError}` : null}
          </div>
          {runnerStatus.state === "failed" ? (
            <button
              type="button"
              onClick={async () => {
                setRunnerStatus({ state: "provisioning", provisioningStatus: "provisioning" });
                const result = await restartCloudRunner(agent.id);
                if (!result.ok) {
                  setRunnerStatus({
                    state: "failed",
                    message: result.message,
                  });
                }
              }}
              className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-[--accent] px-2.5 py-1 text-[12px] font-medium text-[--accent-contrast] transition-colors hover:bg-[--accent-hover]"
            >
              Restart agent
            </button>
          ) : null}
        </div>
      ) : isHybrid ? (
        <div className="rounded-md border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-[12px] text-[--text-primary]">
          <span className="font-medium">Next: connect this agent on your computer</span>
          <div className="mt-2 text-[11px] text-[--text-secondary]">
            {runnerStatus.state === "loading" ? "Checking your computer…" : null}
            {runnerStatus.state === "running"
              ? `Online on your computer${runnerStatus.lastHeartbeatAt ? ` (last seen ${runnerStatus.lastHeartbeatAt})` : ""}. You can chat with this agent in the dashboard.`
              : null}
            {runnerStatus.state === "offline" ? runnerStatus.message : null}
            {inferenceError ? ` ${inferenceError}` : null}
          </div>
          <ol className="mt-2 list-inside list-decimal space-y-1 text-[11px] text-[--text-tertiary]">
            <li>
              {starterPackMissing
                ? "Starter ZIP could not be built (see server logs) — use the credentials file below instead."
                : downloaded
                  ? "Starter ZIP downloaded — check your browser Downloads folder."
                  : "The starter ZIP will download automatically. If your browser blocked it, click the button below."}
            </li>
            <li>Unzip the folder anywhere on your PC.</li>
            <li>
              Double-click <span className="font-medium">Start Qlix Agent</span> in the ZIP (matched to your
              computer) and leave that window open.
            </li>
          </ol>
          {!setupPopupOpen ? (
            <button
              type="button"
              onClick={() => setSetupPopupOpen(true)}
              className="mt-2 text-[11px] font-medium text-cyan-700 underline-offset-2 hover:underline"
            >
              Show setup steps again
            </button>
          ) : null}
        </div>
      ) : (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-200/90">
          The signing key in your credential file is shown only once here — if lost, rotate keys from the agent
          detail page.
        </div>
      )}

      {needsCredentialFile ? (
        <div className="space-y-2 rounded-md border border-[--border-subtle] bg-[var(--glass-row-hover)]/30 px-3 py-2 text-[12px] text-[--text-secondary]">
          <p className="font-medium text-[--text-primary]">
            {isHybrid ? "Starter pack (ZIP)" : "Qlix SDK credential file"}
          </p>
          <p className="text-[11px] leading-relaxed">
            {isHybrid
              ? "Everything needed to run this agent on your computer. Save this download — the link is only offered once."
              : sdkAgentPaths.instructions}
          </p>
          <button
            type="button"
            onClick={triggerDownload}
            className="inline-flex items-center gap-1.5 rounded-md bg-[--accent] px-2.5 py-1 text-[12px] font-medium text-[--accent-contrast] transition-colors hover:bg-[--accent-hover]"
          >
            <Download className="size-3.5" aria-hidden />
            {downloaded
              ? "Downloaded — download again"
              : isHybrid && hybridStarterPack?.filename
                ? `Download ${hybridStarterPack.filename}`
                : `Download ${sdkAgentPaths.suggestedDownloadFilename}`}
          </button>
          {!isHybrid ? (
            <>
              <p className="text-[11px] text-[--text-tertiary]">
                Then set <span className="font-mono text-[--text-secondary]">{sdkAgentPaths.envVarName}</span> to the
                absolute path of that file.
              </p>
              <div className="space-y-1.5">
                <p className="text-[10px] font-medium uppercase tracking-wide text-[--text-tertiary]">macOS / Linux</p>
                <pre className="overflow-x-auto rounded-md bg-black/30 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-[--text-secondary]">
                  {sdkAgentPaths.posixExample}
                </pre>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Row({ label, value, mono }: { readonly label: string; readonly value: string; readonly mono?: boolean }) {
  return (
    <div className="flex gap-3">
      <dt className="w-24 shrink-0 text-[--text-tertiary]">{label}</dt>
      <dd className={cn("min-w-0 flex-1 break-all text-[--text-primary]", mono ? "font-mono" : "")}>
        {value}
      </dd>
    </div>
  );
}
