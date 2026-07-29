"use client";

import { Cloud, Cpu, Laptop, ShieldAlert, ShieldCheck, Users, X, Plus } from "lucide-react";
import type { AgentCreationPlan, NLAgentSpec, NLWorkerSpec } from "@/lib/nl-builder-api";
import {
  ALL_PERMISSION_SCOPES,
  FORCE_JIT_SCOPES,
  PERMISSION_SCOPE_LABELS,
  CLOUD_MODELS,
  LOCAL_MODELS,
  type PermissionScope,
  type AgentRuntime,
} from "@/lib/agents-api";
import { scopesRequireHybrid } from "@/lib/agent-runtime";
import { SketchBox, sketchInput, sketchLabel } from "@/components/qlix/sketch";

interface NLPlanPreviewProps {
  readonly plan: AgentCreationPlan;
  readonly onPlanChange: (plan: AgentCreationPlan) => void;
}

const RUNTIME_ICON: Record<AgentRuntime, React.ReactNode> = {
  cloud: <Cloud className="size-3.5" aria-hidden />,
  hybrid: <Laptop className="size-3.5" aria-hidden />,
  local: <Cpu className="size-3.5" aria-hidden />,
};

const RUNTIME_LABELS: Record<AgentRuntime, string> = {
  cloud: "Cloud — runs on Qlix servers",
  hybrid: "Hybrid — Qlix-hosted, tools run locally",
  local: "Local — fully on your machine",
};

function modelsForRuntime(runtime: AgentRuntime): readonly string[] {
  return runtime === "local" ? LOCAL_MODELS : CLOUD_MODELS;
}

function defaultModelForRuntime(runtime: AgentRuntime): string {
  return modelsForRuntime(runtime)[0];
}

function applyRuntimeDefaults(
  spec: NLAgentSpec | NLWorkerSpec,
  runtime: AgentRuntime,
): Partial<NLAgentSpec> {
  const availableModels = modelsForRuntime(runtime);
  const model = availableModels.includes(spec.model as never)
    ? spec.model
    : defaultModelForRuntime(runtime);
  if (runtime === "cloud" || runtime === "hybrid") {
    return { runtime, model, llmMode: "proxy", localInferenceMode: null };
  }
  return { runtime, model, llmMode: "proxy", localInferenceMode: "cloud_api" };
}

function toggleScope(
  scope: PermissionScope,
  permissionScopes: PermissionScope[],
  jitScopes: PermissionScope[],
): { permissionScopes: PermissionScope[]; jitScopes: PermissionScope[] } {
  const has = permissionScopes.includes(scope);
  if (has) {
    return {
      permissionScopes: permissionScopes.filter((s) => s !== scope),
      jitScopes: jitScopes.filter((s) => s !== scope),
    };
  }
  const newPerms = [...permissionScopes, scope];
  const newJit = FORCE_JIT_SCOPES.includes(scope as never)
    ? [...jitScopes.filter((s) => s !== scope), scope]
    : jitScopes;
  return { permissionScopes: newPerms, jitScopes: newJit };
}

interface AgentCardProps {
  readonly spec: NLAgentSpec | NLWorkerSpec;
  readonly label?: string;
  readonly accent?: boolean;
  readonly onChange: (patch: Partial<NLAgentSpec>) => void;
}

function reconcileSpecRuntime(spec: NLAgentSpec | NLWorkerSpec): Partial<NLAgentSpec> | null {
  if (!scopesRequireHybrid(spec.permissionScopes) || spec.runtime === "hybrid" || spec.runtime === "local") {
    return null;
  }
  return applyRuntimeDefaults(spec, "hybrid");
}

function AgentCard({ spec, label, accent = false, onChange }: AgentCardProps) {
  const availableModels = modelsForRuntime(spec.runtime);

  const patch = (fields: Partial<NLAgentSpec>) => {
    const next = { ...spec, ...fields } as NLAgentSpec | NLWorkerSpec;
    const runtimeFix = reconcileSpecRuntime(next);
    onChange(runtimeFix ? { ...fields, ...runtimeFix } : fields);
  };

  return (
    <SketchBox className="p-4">
      {label && (
        <div className="mb-4 flex items-center gap-1.5">
          {accent && <ShieldCheck className="size-3 text-black/50" aria-hidden />}
          <span className={sketchLabel}>{label}</span>
        </div>
      )}

      <div className="space-y-5">
        {/* Name */}
        <label className="block">
          <span className={`${sketchLabel} normal-case tracking-normal`}>Name</span>
          <input
            type="text"
            value={spec.name}
            maxLength={120}
            onChange={(e) => patch({ name: e.target.value })}
            className={`${sketchInput} mt-1.5`}
          />
        </label>

        {/* Description */}
        <label className="block">
          <span className={`${sketchLabel} normal-case tracking-normal`}>Description / system prompt</span>
          <textarea
            value={spec.description}
            rows={3}
            onChange={(e) => patch({ description: e.target.value })}
            className={`${sketchInput} mt-1.5 resize-none`}
          />
        </label>

        {/* Runtime + Model row */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <span className={`${sketchLabel} normal-case tracking-normal`}>Runtime</span>
            <div className="relative mt-1.5">
              <select
                value={spec.runtime}
                onChange={(e) => {
                  const rt = e.target.value as AgentRuntime;
                  patch(applyRuntimeDefaults(spec, rt));
                }}
                className={`${sketchInput} appearance-none pl-8`}
              >
                {(["cloud", "hybrid", "local"] as AgentRuntime[]).map((rt) => (
                  <option key={rt} value={rt} className="bg-white text-black">
                    {RUNTIME_LABELS[rt]}
                  </option>
                ))}
              </select>
              <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-black/50">
                {RUNTIME_ICON[spec.runtime]}
              </span>
            </div>
          </div>
          <div>
            <span className={`${sketchLabel} normal-case tracking-normal`}>Model</span>
            <select
              value={spec.model}
              onChange={(e) => patch({ model: e.target.value })}
              className={`${sketchInput} mt-1.5`}
            >
              {availableModels.map((m) => (
                <option key={m} value={m} className="bg-white text-black">
                  {m.replace("openrouter/", "")}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Scopes */}
        <div>
          <p className={sketchLabel}>Permissions</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {spec.permissionScopes.map((s) => {
              const isJit = FORCE_JIT_SCOPES.includes(s as never);
              return (
                <button
                  key={s}
                  type="button"
                  title={`Remove ${s}`}
                  onClick={() => patch(toggleScope(s, spec.permissionScopes, spec.jitScopes))}
                  className="group inline-flex items-center gap-1 border border-black bg-white px-2 py-0.5 font-mono text-[10.5px] text-black transition-colors hover:bg-black hover:text-white"
                >
                  {isJit && <ShieldAlert className="size-2.5 opacity-70" aria-hidden />}
                  {s}
                  <X className="ml-0.5 size-2.5 opacity-50 transition-opacity group-hover:opacity-100" aria-hidden />
                </button>
              );
            })}

            {ALL_PERMISSION_SCOPES.filter((s) => !spec.permissionScopes.includes(s)).length > 0 && (
              <div className="group relative">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 border border-dashed border-black/40 bg-white px-2 py-0.5 text-[10.5px] text-black/50 transition-colors hover:border-black hover:text-black"
                >
                  <Plus className="size-2.5" aria-hidden />
                  Add
                </button>
                <div className="absolute left-0 top-full z-10 mt-1.5 hidden min-w-[200px] border border-black bg-white py-1.5 group-focus-within:block">
                  {ALL_PERMISSION_SCOPES.filter((s) => !spec.permissionScopes.includes(s)).map((s) => {
                    const isJit = FORCE_JIT_SCOPES.includes(s as never);
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => patch(toggleScope(s, spec.permissionScopes, spec.jitScopes))}
                        className="flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors hover:bg-black/5"
                      >
                        <span className="font-mono text-[10.5px] text-black">{s}</span>
                        {isJit && <ShieldAlert className="mt-0.5 size-2.5 shrink-0 text-black/50" aria-hidden />}
                        <span className="text-[10px] leading-relaxed text-black/50">
                          {PERMISSION_SCOPE_LABELS[s]}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          {spec.jitScopes.length > 0 && (
            <p className="mt-1.5 text-[10px] text-black/55">
              <ShieldAlert className="mr-0.5 inline size-2.5" aria-hidden />
              JIT scopes require approval on every invocation
            </p>
          )}
        </div>

        {spec.rationale && (
          <p className="mt-1 border-t border-black/15 pt-3 text-[11.5px] italic leading-relaxed text-black/50">
            {spec.rationale}
          </p>
        )}
      </div>
    </SketchBox>
  );
}

export function NLPlanPreview({ plan, onPlanChange }: NLPlanPreviewProps) {
  if (plan.type === "single") {
    const agent = plan.agent;
    return (
      <div className="space-y-3">
        <AgentCard
          spec={agent}
          label="Agent"
          onChange={(patch) => onPlanChange({ ...plan, agent: { ...agent, ...patch } as NLAgentSpec })}
        />
        {plan.rationale && (
          <p className="px-0 text-[11px] italic text-black/50">
            {plan.rationale}
          </p>
        )}
      </div>
    );
  }

  const team = plan.team;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-[12px] font-medium text-black">
        <Users className="size-4" aria-hidden />
        {team.name}
      </div>

      <AgentCard
        spec={team.supervisor}
        label="Supervisor"
        accent
        onChange={(patch) =>
          onPlanChange({
            ...plan,
            team: { ...team, supervisor: { ...team.supervisor, ...patch } as NLAgentSpec },
          })
        }
      />

      {team.workers.map((worker, i) => (
        <AgentCard
          key={i}
          spec={worker}
          label={`Worker ${i + 1} — ${worker.role}`}
          onChange={(patch) => {
            const workers = team.workers.map((w, idx) =>
              idx === i ? ({ ...w, ...patch } as NLWorkerSpec) : w,
            );
            onPlanChange({ ...plan, team: { ...team, workers } });
          }}
        />
      ))}

      {plan.rationale && (
        <p className="px-0 text-[11px] italic text-black/50">
          {plan.rationale}
        </p>
      )}
    </div>
  );
}
