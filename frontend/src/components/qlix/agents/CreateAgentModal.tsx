"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Cloud, Cpu, Download, Fingerprint, Laptop, Loader2, ShieldCheck, X } from "lucide-react";
import {
  ALL_PERMISSION_SCOPES,
  CLOUD_MODELS,
  FORCE_JIT_SCOPES,
  LOCAL_MODELS,
  PERMISSION_SCOPE_LABELS,
  type AgentRuntime,
  type AgentDTO,
  type CreateAgentResponse,
  type LocalInferenceMode,
  type LlmMode,
  type PermissionScope,
  confirmDownload,
  createAgent,
  getRuntimeStatus,
  restartCloudRunner,
} from "@/lib/agents-api";
import { downloadBase64File, downloadJsonFile } from "@/lib/download";
import { detectHybridClientPlatform } from "@/lib/hybrid-platform";
import { obtainAgentCreateStepUpToken } from "@/lib/webauthn";
import { useSession } from "@/components/qlix/session-context";
import {
  CreateAgentStepProgress,
  CreateAgentSubmitProgress,
  type CreateAgentFlowStep,
} from "@/components/qlix/agents/CreateAgentStepProgress";
import { cn } from "@/lib/utils/cn";

type Step = 1 | 2 | 3 | 4 | 5 | "result";

interface CreateAgentModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onCreated: (agent: AgentDTO) => void;
  readonly orgId: string | null;
  readonly deviceVerified: boolean;
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
  model: CLOUD_MODELS[0],
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
  deviceVerified,
  cloudOnly = false,
}: CreateAgentModalProps) {
  const { refresh: refreshSession } = useSession();
  /** Prevents overlapping WebAuthn ceremonies (e.g. double-click) — second call often rejects while the first still saves a passkey. */
  const submitLockRef = useRef(false);
  const [step, setStep] = useState<Step>(1);
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<CreateAgentResponse | null>(null);

  useEffect(() => {
    if (open) {
      setStep(1);
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
        localInferenceMode:
          form.runtime === "local"
            ? (form.localInferenceMode as LocalInferenceMode)
            : null,
        orgId,
        ...(form.runtime === "hybrid"
          ? { clientPlatform: detectHybridClientPlatform() }
          : {}),
      };

      const stepUp = await obtainAgentCreateStepUpToken(deviceVerified);
      if (!stepUp.ok) {
        setError(stepUp.errorMessage);
        setStep(4);
        return;
      }
      if (!deviceVerified) {
        await refreshSession();
      }
      const stepUpToken = stepUp.stepUpToken;

      const res = await createAgent(body, stepUpToken);
      if (!res.ok) {
        setError(res.errorMessage);
        setStep(4);
        return;
      }
      setResult(res.data);
      setStep("result");
      onCreated(res.data.agent);
    } finally {
      submitLockRef.current = false;
      setSubmitting(false);
    }
  };

  const goNextFromStep4 = () => {
    setStep(5);
    void submit();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-agent-title"
    >
      <div className="qlix-glass-muted relative flex w-full max-w-xl flex-col overflow-hidden rounded-xl border border-violet-500/20 bg-[--bg-base] shadow-2xl shadow-violet-500/10 ring-1 ring-violet-400/10 dark:border-violet-400/25 dark:shadow-violet-900/30"
        style={{ maxHeight: "min(90vh, 700px)" }}
      >
        <header className="flex shrink-0 items-center justify-between px-5 py-3">
          <div>
            <h2
              id="create-agent-title"
              className="bg-gradient-to-r from-violet-600 to-cyan-600 bg-clip-text text-[15px] font-semibold text-transparent dark:from-violet-300 dark:to-cyan-300"
            >
              Create agent
            </h2>
            <p className="mt-0.5 text-[11px] text-[--text-tertiary]">
              Register a new autonomous agent with cryptographic identity
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-[--text-tertiary] transition-colors hover:bg-[--bg-hover] hover:text-[--text-primary]"
            aria-label="Close"
          >
            <X className="size-4" aria-hidden />
          </button>
        </header>

        <div className="shrink-0">
          <CreateAgentStepProgress step={step as CreateAgentFlowStep} creating={step === 5} />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <div key={String(step)} className="create-agent-step-content">
          {step === 1 ? (
            <Step1
              name={form.name}
              description={form.description}
              scopes={form.permissionScopes}
              onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
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
              localInferenceMode={form.localInferenceMode}
              model={form.model}
              cloudOnly={cloudOnly}
              onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
            />
          ) : null}

          {step === 4 ? <Step4 deviceVerified={deviceVerified} /> : null}

          {step === 5 ? <CreateAgentSubmitProgress runtime={form.runtime} /> : null}

          {step === "result" && result ? (
            <ResultPanel
              data={result}
              onClose={onClose}
            />
          ) : null}

          {error ? (
            <p className="mt-3 rounded-md border border-[--danger]/40 bg-[--danger]/10 px-3 py-2 text-[12px] text-[--danger]">
              {error}
            </p>
          ) : null}
          </div>
        </div>

        {step !== "result" && step !== 5 ? (
          <footer className="flex shrink-0 items-center justify-between border-t border-[--border-subtle] bg-[--bg-subtle]/40 px-5 py-3">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  if (step === 1) onClose();
                  else setStep(((step as number) - 1) as Step);
                }}
                className="text-[12px] font-medium text-[--text-tertiary] transition-colors hover:text-[--text-primary]"
                disabled={submitting}
              >
                {step === 1 ? "Cancel" : "Back"}
              </button>
              <span className="text-[11px] text-[--text-tertiary]">
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
                if (step === 1) setStep(2);
                else if (step === 2) setStep(3);
                else if (step === 3) setStep(4);
                else if (step === 4) void goNextFromStep4();
              }}
              className={cn(
                "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[12px] font-semibold shadow-md motion-safe:transition-[filter,transform] motion-safe:duration-200",
                "bg-gradient-to-r from-violet-600 via-indigo-600 to-cyan-600 text-white shadow-violet-500/25 hover:brightness-110 active:scale-[0.98]",
                "disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none dark:from-violet-500 dark:via-indigo-500 dark:to-cyan-500",
              )}
            >
              {submitting ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
              {step === 4 ? "Verify & create" : "Next →"}
            </button>
          </footer>
        ) : null}

        {step === "result" ? (
          <footer className="flex shrink-0 items-center justify-end border-t border-[--border-subtle] px-5 py-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md bg-[--accent] px-3 py-1.5 text-[12px] font-medium text-[--accent-contrast] transition-colors hover:bg-[--accent-hover]"
            >
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
  onChange,
}: {
  readonly name: string;
  readonly description: string;
  readonly scopes: PermissionScope[];
  readonly onChange: (patch: Partial<FormState>) => void;
}) {
  const toggle = (scope: PermissionScope) => {
    const set = new Set(scopes);
    if (set.has(scope)) set.delete(scope);
    else set.add(scope);
    onChange({ permissionScopes: Array.from(set) });
  };

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="text-[12px] font-medium text-[--text-secondary]">Agent name</span>
        <input
          type="text"
          value={name}
          maxLength={120}
          autoFocus
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="e.g. Leads Generator"
          className="mt-1.5 w-full rounded-md border border-[--border-subtle] bg-[--bg-base] px-3 py-1.5 text-[13px] text-[--text-primary] outline-none focus:border-[--accent]"
        />
      </label>

      <label className="block">
        <span className="text-[12px] font-medium text-[--text-secondary]">
          Role description <span className="text-[--text-tertiary] font-normal">(optional — becomes system prompt)</span>
        </span>
        <textarea
          value={description}
          rows={5}
          onChange={(e) => onChange({ description: e.target.value })}
          placeholder="e.g. Generate a list of potential sales leads based on the target market. Focus on company size, industry, and decision maker contact info."
          className="mt-1.5 w-full resize-none rounded-md border border-[--border-subtle] bg-[--bg-base] px-3 py-1.5 text-[13px] text-[--text-primary] outline-none focus:border-[--accent]"
        />
      </label>

      <div>
        <p className="text-[12px] font-medium text-[--text-secondary]">Permission scopes</p>
        <p className="mt-0.5 text-[11px] text-[--text-tertiary]">
          What this agent is allowed to do. Pick the smallest set that does the job.
        </p>
        <ul className="mt-2 space-y-1">
          {ALL_PERMISSION_SCOPES.map((scope) => {
            const checked = scopes.includes(scope);
            return (
              <li key={scope}>
                <label className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-[var(--glass-row-hover)]">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(scope)}
                    className="mt-0.5"
                  />
                  <div>
                    <span className="font-mono text-[12px] text-[--text-primary]">{scope}</span>
                    <span className="ml-2 text-[12px] text-[--text-tertiary]">
                      {PERMISSION_SCOPE_LABELS[scope]}
                    </span>
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
  localInferenceMode,
  model,
  cloudOnly,
  onChange,
}: {
  readonly runtime: AgentRuntime;
  readonly llmMode: LlmMode;
  readonly localInferenceMode: LocalInferenceMode | null;
  readonly model: string;
  readonly cloudOnly?: boolean;
  readonly onChange: (patch: Partial<FormState>) => void;
}) {
  const modelOptions: readonly string[] =
    runtime === "cloud" || runtime === "hybrid" || llmMode === "proxy"
      ? CLOUD_MODELS
      : LOCAL_MODELS;

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
                model: CLOUD_MODELS[0],
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
                model: CLOUD_MODELS[0],
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
            Team agents use Cloud or Hybrid. Hybrid workers need the Qlix daemon running on someone&apos;s
            machine.
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
                  model: CLOUD_MODELS.includes(model as (typeof CLOUD_MODELS)[number])
                    ? model
                    : CLOUD_MODELS[0],
                })
              }
            />
          </div>
        </div>
      ) : null}

      <label className="block">
        <span className="text-[12px] font-medium text-[--text-secondary]">AI Model</span>
        <select
          value={model}
          onChange={(e) => onChange({ model: e.target.value })}
          className="mt-1.5 w-full rounded-md border border-[--border-subtle] bg-[--bg-base] px-3 py-1.5 text-[13px] text-[--text-primary] outline-none focus:border-[--accent]"
        >
          {modelOptions.map((m) => (
            <option key={m} value={m} className="bg-white text-black">
              {m.replace("openrouter/", "")}
            </option>
          ))}
        </select>
        <p className="mt-1 text-[11px] text-[--text-tertiary]">
          {runtime === "cloud" || runtime === "hybrid"
            ? "Used for all LLM calls (routed through Qlix)."
            : "Override with your local model if needed."}
        </p>
      </label>
    </div>
  );
}

const runtimeCardSelected =
  "border-2 border-violet-500 bg-gradient-to-br from-violet-500/20 via-indigo-500/10 to-cyan-500/5 ring-2 ring-violet-400/40 shadow-md shadow-violet-500/15 dark:border-violet-400 dark:from-violet-500/25 dark:ring-violet-400/35";
const runtimeCardIdle =
  "border border-[--border-default] bg-[--bg-base] hover:border-violet-400/45 hover:bg-violet-500/5";

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
      className={cn(
        "relative rounded-lg p-3 text-left transition-all duration-200",
        active ? runtimeCardSelected : runtimeCardIdle,
      )}
    >
      {active ? (
        <span
          className="absolute right-2 top-2 flex size-5 items-center justify-center rounded-full bg-violet-600 text-white dark:bg-violet-500"
          aria-hidden
        >
          <Check className="size-3" />
        </span>
      ) : null}
      <div
        className={cn(
          "text-[12px] font-medium",
          active ? "text-violet-800 dark:text-violet-100" : "text-[--text-primary]",
        )}
      >
        {title}
      </div>
      <p className="mt-1 text-[11px] text-[--text-tertiary]">{description}</p>
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
      className={cn(
        "relative rounded-lg p-3 text-left transition-all duration-200",
        active ? runtimeCardSelected : runtimeCardIdle,
      )}
    >
      {active ? (
        <span
          className="absolute right-2 top-2 flex size-5 items-center justify-center rounded-full bg-violet-600 text-white dark:bg-violet-500"
          aria-hidden
        >
          <Check className="size-3" />
        </span>
      ) : null}
      <div
        className={cn(
          "flex items-center gap-2 text-[12px] font-medium",
          active ? "text-violet-800 dark:text-violet-100" : "text-[--text-primary]",
        )}
      >
        <span className={cn(active && "text-violet-600 dark:text-violet-300")}>{icon}</span>
        {title}
      </div>
      <p className="mt-1 text-[11px] text-[--text-tertiary]">{description}</p>
    </button>
  );
}

function Step4({ deviceVerified }: { readonly deviceVerified: boolean }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-[--text-primary]">
        <ShieldCheck className="size-4" aria-hidden />
        <span className="text-[13px] font-medium">Device verification</span>
      </div>
      {deviceVerified ? (
        <p className="text-[12px] text-[--text-secondary]">
          On the next step, your browser will ask you to confirm with your passkey (biometrics or PIN) before
          the agent is created. This proves you are at the device right now.
        </p>
      ) : (
        <p className="text-[12px] text-[--text-secondary]">
          Click <span className="font-medium">Verify &amp; create</span> to register a passkey, then confirm
          with your device. The agent cannot be issued without this proof.
        </p>
      )}
    </div>
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
  const autoDownloadFiredRef = useRef(false);
  const starterPackMissing = isHybrid && !hybridStarterPack?.base64;
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
            message: "Daemon not connected yet. Download credentials and run qlix daemon start.",
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
            {runnerStatus.state === "loading" ? "Provisioning runner…" : null}
            {runnerStatus.state === "provisioning"
              ? `Provisioning runner… (${runnerStatus.provisioningStatus ?? "provisioning"})`
              : null}
            {runnerStatus.state === "running"
              ? `Runner is online${runnerStatus.lastHeartbeatAt ? ` (last heartbeat ${runnerStatus.lastHeartbeatAt})` : ""}`
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
              Restart runner
            </button>
          ) : null}
        </div>
      ) : isHybrid ? (
        <div className="rounded-md border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-[12px] text-[--text-primary]">
          <span className="font-medium">Next: connect this agent on your computer</span>
          <div className="mt-2 text-[11px] text-[--text-secondary]">
            {runnerStatus.state === "loading" ? "Checking daemon…" : null}
            {runnerStatus.state === "running"
              ? `Daemon online${runnerStatus.lastHeartbeatAt ? ` (heartbeat ${runnerStatus.lastHeartbeatAt})` : ""}. You can chat with this agent in the dashboard.`
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
