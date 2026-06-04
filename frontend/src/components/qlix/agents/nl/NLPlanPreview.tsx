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
import { cn } from "@/lib/utils/cn";

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

function AgentCard({ spec, label, accent = false, onChange }: AgentCardProps) {
  const availableModels = modelsForRuntime(spec.runtime);

  return (
    <div
      className={cn(
        "rounded-lg border bg-[--bg-base] p-4 space-y-3",
        accent ? "border-violet-500/30 ring-1 ring-violet-400/10" : "border-[--border-subtle]",
      )}
    >
      {label && (
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[--text-tertiary]">
          {accent && <ShieldCheck className="size-3 text-violet-400" aria-hidden />}
          {label}
        </div>
      )}

      {/* Name */}
      <label className="block">
        <span className="text-[11px] text-[--text-tertiary]">Name</span>
        <input
          type="text"
          value={spec.name}
          maxLength={120}
          onChange={(e) => onChange({ name: e.target.value })}
          className="mt-0.5 w-full rounded border border-[--border-subtle] bg-[--bg-subtle] px-2.5 py-1 text-[12px] text-[--text-primary] outline-none focus:border-[--accent]"
        />
      </label>

      {/* Description */}
      <label className="block">
        <span className="text-[11px] text-[--text-tertiary]">Description / system prompt</span>
        <textarea
          value={spec.description}
          rows={3}
          onChange={(e) => onChange({ description: e.target.value })}
          className="mt-0.5 w-full resize-none rounded border border-[--border-subtle] bg-[--bg-subtle] px-2.5 py-1 text-[12px] text-[--text-primary] outline-none focus:border-[--accent]"
        />
      </label>

      {/* Runtime + Model row */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <span className="text-[11px] text-[--text-tertiary]">Runtime</span>
          <div className="mt-0.5 relative">
            <select
              value={spec.runtime}
              onChange={(e) => {
                const rt = e.target.value as AgentRuntime;
                onChange(applyRuntimeDefaults(spec, rt));
              }}
              className="w-full appearance-none rounded border border-[--border-subtle] bg-[--bg-subtle] pl-6 pr-2.5 py-1 text-[12px] text-[--text-primary] outline-none focus:border-[--accent]"
            >
              {(["cloud", "hybrid", "local"] as AgentRuntime[]).map((rt) => (
                <option key={rt} value={rt} className="bg-white text-black">
                  {RUNTIME_LABELS[rt]}
                </option>
              ))}
            </select>
            <span className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-[--text-tertiary]">
              {RUNTIME_ICON[spec.runtime]}
            </span>
          </div>
        </div>
        <div>
          <span className="text-[11px] text-[--text-tertiary]">Model</span>
          <select
            value={spec.model}
            onChange={(e) => onChange({ model: e.target.value })}
            className="mt-0.5 w-full rounded border border-[--border-subtle] bg-[--bg-subtle] px-2.5 py-1 text-[12px] text-[--text-primary] outline-none focus:border-[--accent]"
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
        <p className="mb-1.5 text-[11px] text-[--text-tertiary]">Permissions</p>
        <div className="flex flex-wrap gap-1">
          {spec.permissionScopes.map((s) => {
            const isJit = FORCE_JIT_SCOPES.includes(s as never);
            return (
              <button
                key={s}
                type="button"
                title={`Remove ${s}`}
                onClick={() => onChange(toggleScope(s, spec.permissionScopes, spec.jitScopes))}
                className={cn(
                  "inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] transition-opacity hover:opacity-70",
                  isJit
                    ? "border border-amber-500/40 bg-amber-500/10 text-amber-300"
                    : "border border-[--border-subtle] bg-[--bg-subtle] text-[--text-secondary]",
                )}
              >
                {isJit && <ShieldAlert className="size-2.5" aria-hidden />}
                {s}
                <X className="size-2.5 ml-0.5 opacity-60" aria-hidden />
              </button>
            );
          })}

          {/* Add scope dropdown */}
          {ALL_PERMISSION_SCOPES.filter((s) => !spec.permissionScopes.includes(s)).length > 0 && (
            <div className="relative group">
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded border border-dashed border-[--border-subtle] px-1.5 py-0.5 text-[10px] text-[--text-tertiary] hover:border-[--accent]/40 hover:text-[--text-primary] transition-colors"
              >
                <Plus className="size-2.5" aria-hidden />
                Add
              </button>
              <div className="absolute left-0 top-full z-10 mt-1 hidden group-focus-within:block min-w-[180px] rounded-lg border border-[--border-subtle] bg-[--bg-elevated] py-1 shadow-lg">
                {ALL_PERMISSION_SCOPES.filter((s) => !spec.permissionScopes.includes(s)).map((s) => {
                  const isJit = FORCE_JIT_SCOPES.includes(s as never);
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => onChange(toggleScope(s, spec.permissionScopes, spec.jitScopes))}
                      className="flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-[--bg-subtle]"
                    >
                      <span className="font-mono text-[10px] text-[--text-primary]">{s}</span>
                      {isJit && <ShieldAlert className="size-2.5 mt-0.5 shrink-0 text-amber-400" aria-hidden />}
                      <span className="text-[10px] text-[--text-tertiary]">
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
          <p className="mt-1 text-[10px] text-amber-400/80">
            <ShieldAlert className="inline size-2.5 mr-0.5" aria-hidden />
            JIT scopes require approval on every invocation
          </p>
        )}
      </div>

      {spec.rationale && (
        <p className="text-[11px] leading-relaxed text-[--text-tertiary] italic">{spec.rationale}</p>
      )}
    </div>
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
          <p className="rounded-md border border-[--border-subtle] bg-[--bg-subtle]/40 px-3 py-2 text-[11px] text-[--text-tertiary]">
            {plan.rationale}
          </p>
        )}
      </div>
    );
  }

  const team = plan.team;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-[12px] font-medium text-[--text-primary]">
        <Users className="size-4 text-[--accent]" aria-hidden />
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
        <p className="rounded-md border border-[--border-subtle] bg-[--bg-subtle]/40 px-3 py-2 text-[11px] text-[--text-tertiary]">
          {plan.rationale}
        </p>
      )}
    </div>
  );
}
