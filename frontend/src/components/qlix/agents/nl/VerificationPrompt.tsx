"use client";

import type React from "react";
import { Bot, Fingerprint, Loader2, ShieldCheck, X } from "lucide-react";
import type { NLAgentSpec, NLWorkerSpec, AgentCreationPlan } from "@/lib/nl-builder-api";
import { cn } from "@/lib/utils/cn";

interface VerificationPromptProps {
  readonly plan: AgentCreationPlan;
  readonly verifying: boolean;
  readonly error: string | null;
  readonly onVerify: () => void;
  readonly onCancel: () => void;
}

function agentsFromPlan(plan: AgentCreationPlan): Array<NLAgentSpec | NLWorkerSpec> {
  if (plan.type === "single") return [plan.agent];
  return [plan.team.supervisor, ...plan.team.workers];
}

export function VerificationPrompt({
  plan,
  verifying,
  error,
  onVerify,
  onCancel,
}: VerificationPromptProps) {
  const agents = agentsFromPlan(plan);
  const label = plan.type === "team" ? `${agents.length} agents` : `"${agents[0].name}"`;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true">
      <div
        className="relative w-full max-w-md overflow-hidden rounded-xl border border-amber-500/30 shadow-2xl shadow-amber-900/20 ring-1 ring-amber-400/10"
        style={{ backgroundColor: "var(--bg-elevated, #111113)" }}
      >
        {/* grain overlay */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-xl"
          style={{
            backgroundImage: "var(--glass-grain-tile)",
            backgroundSize: "140px 140px",
            backgroundRepeat: "repeat",
            opacity: "var(--glass-grain-opacity)" as unknown as number,
            mixBlendMode: "var(--glass-grain-blend)" as React.CSSProperties["mixBlendMode"],
          }}
        />
        {/* Header */}
        <div className="flex items-start justify-between border-b border-[--border-subtle] px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-amber-500/15 ring-1 ring-amber-500/30">
              <Fingerprint className="size-4 text-amber-400" aria-hidden />
            </div>
            <div>
              <h3 className="text-[13px] font-semibold text-[--text-primary]">
                Device verification required
              </h3>
              <p className="mt-0.5 text-[11px] text-[--text-tertiary]">
                Verify your identity to create {label}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={verifying}
            className="ml-3 shrink-0 rounded p-1 text-[--text-tertiary] hover:bg-[--bg-hover] hover:text-[--text-primary] disabled:opacity-40"
            aria-label="Cancel"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>

        {/* Agent list */}
        <div className="px-5 py-4">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-[--text-tertiary]">
            {plan.type === "team" ? "Agents to create" : "Agent to create"}
          </p>
          <ul className="space-y-1.5">
            {agents.map((agent) => (
              <li
                key={agent.name}
                className="flex items-center gap-2.5 rounded-md border border-[--border-subtle] bg-[--bg-subtle]/40 px-3 py-2"
              >
                <Bot className="size-3.5 shrink-0 text-[--accent]" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-[--text-primary]">
                  {agent.name}
                </span>
                <span className="shrink-0 text-[10px] text-[--text-tertiary]">
                  {agent.runtime} · {agent.permissionScopes.length} scope{agent.permissionScopes.length !== 1 ? "s" : ""}
                </span>
              </li>
            ))}
            {plan.type === "team" && (
              <li className="flex items-center gap-2.5 rounded-md border border-violet-500/20 bg-violet-500/5 px-3 py-2">
                <ShieldCheck className="size-3.5 shrink-0 text-violet-400" aria-hidden />
                <span className="text-[12px] font-medium text-violet-300">Team assembled automatically</span>
              </li>
            )}
          </ul>
        </div>

        {/* Explanation */}
        <div className="border-t border-[--border-subtle] bg-amber-500/5 px-5 py-3 text-[11px] leading-relaxed text-[--text-secondary]">
          Your browser will prompt you to confirm with your passkey (biometrics or PIN).
          This cryptographically proves you authorized this agent creation.
        </div>

        {/* Error */}
        {error ? (
          <div className="mx-5 mb-3 rounded-md border border-[--danger]/40 bg-[--danger]/10 px-3 py-2 text-[12px] text-[--danger]">
            {error}
          </div>
        ) : null}

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 border-t border-[--border-subtle] px-5 py-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={verifying}
            className="text-[12px] font-medium text-[--text-tertiary] transition-colors hover:text-[--text-primary] disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onVerify}
            disabled={verifying}
            className={cn(
              "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[12px] font-semibold text-white shadow-md",
              "bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 shadow-amber-500/25",
              "hover:brightness-110 active:scale-[0.98] motion-safe:transition-[filter,transform] motion-safe:duration-200",
              "disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none",
            )}
          >
            {verifying
              ? <Loader2 className="size-3.5 animate-spin" aria-hidden />
              : <Fingerprint className="size-3.5" aria-hidden />
            }
            {verifying ? "Verifying…" : "Verify & create"}
          </button>
        </div>
      </div>
    </div>
  );
}
