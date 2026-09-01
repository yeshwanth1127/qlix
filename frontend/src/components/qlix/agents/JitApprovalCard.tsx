"use client";

import { Loader2, ShieldCheck } from "lucide-react";
import { sketchButtonGhost, sketchButtonPrimary } from "@/components/qlix/sketch";
import { isSessionChatJitScope, jitScopeLabel } from "@/lib/jit-api";
import { cn } from "@/lib/utils/cn";

const DETAIL_NOISE = new Set([
  "Waiting for your approval in Qlix",
  "Reply on WhatsApp to approve or deny",
  "Approving covers this whole conversation",
]);

export type JitApprovalCardStep = {
  label: string;
  detail?: string;
  jitRequestId?: string;
  jitChannel?: "dashboard" | "whatsapp";
  jitScope?: string;
  jitContext?: string;
  jitWhatsappExpected?: boolean;
  jitWhatsappStatus?: "disconnected" | "not_linked";
  jitAttempt?: number;
  jitMaxAttempts?: number;
  capabilityGrant?: boolean;
};

function titleForStep(step: JitApprovalCardStep): string {
  if (step.capabilityGrant || step.jitScope === "agent.capability_grant") {
    // Prefer server-provided Capability: label (reason-aware, e.g. Create PDF documents).
    const fromDetail = step.detail
      ?.split(" · ")
      .map((part) => part.trim())
      .find((part) => part.startsWith("Capability: "));
    if (fromDetail) return fromDetail.slice("Capability: ".length);
    if (step.jitScope && step.jitScope !== "agent.capability_grant") {
      const named = jitScopeLabel(step.jitScope);
      if (named && named !== step.jitScope) return named;
    }
    if (step.label && step.label !== "Add capability to continue?") return step.label;
    return "Add this capability?";
  }
  if (step.jitScope) {
    const named = jitScopeLabel(step.jitScope);
    if (named && named !== step.jitScope) return named;
  }
  const fromDetail = step.detail
    ?.split(" · ")
    .map((part) => part.trim())
    .find((part) => part.startsWith("Scope: "));
  if (fromDetail) return fromDetail.slice("Scope: ".length);
  return "Approve this action";
}

function contextForStep(step: JitApprovalCardStep): string | undefined {
  const direct = step.jitContext?.trim();
  if (direct) return direct;
  if (!step.detail) return undefined;
  const kept = step.detail
    .split(" · ")
    .map((part) => part.trim())
    .filter((part) => part && !DETAIL_NOISE.has(part) && !part.startsWith("Scope: "));
  return kept.join(" · ") || undefined;
}

function whatsappHint(step: JitApprovalCardStep): string | null {
  if (step.jitWhatsappExpected) {
    return step.jitWhatsappStatus === "not_linked"
      ? "WhatsApp isn't connected. Approve here, or connect it in Connectors."
      : "WhatsApp is offline. Approve here, or reconnect it in Connectors.";
  }
  if (step.jitChannel === "whatsapp") {
    return step.jitRequestId
      ? "You can also reply Approve or Deny on WhatsApp."
      : "Reply Approve or Deny on WhatsApp to continue.";
  }
  return null;
}

export function JitApprovalCard({
  step,
  deciding = false,
  error,
  onDecide,
  className,
}: {
  readonly step: JitApprovalCardStep;
  readonly deciding?: boolean;
  readonly error?: string | null;
  readonly onDecide: (approved: boolean) => void;
  readonly className?: string;
}) {
  const title = titleForStep(step);
  const context = contextForStep(step);
  const session = isSessionChatJitScope(step.jitScope);
  const hint = whatsappHint(step);
  const canDecide = Boolean(step.jitRequestId);
  const isCapability = Boolean(step.capabilityGrant || step.jitScope === "agent.capability_grant");

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={isCapability ? `Add capability: ${title}` : `Approval needed: ${title}`}
      className={cn(
        "overflow-hidden rounded-[1.35rem] border border-black/12 bg-[#E2F0CC]/90 shadow-[0_10px_32px_-18px_rgba(17,12,34,0.22)] backdrop-blur-xl",
        className,
      )}
    >
      <div className="flex items-start gap-3 px-4 pb-3 pt-3.5">
        <div
          className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border border-black/10 bg-black/[0.03]"
          aria-hidden
        >
          <ShieldCheck className="size-3.5 text-black/70" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-black/40">
            {isCapability ? "Capability" : "Approval"}
          </p>
          <p className="mt-1 text-[14px] font-semibold leading-snug tracking-tight text-black">
            {title}
          </p>
          {isCapability ? (
            <p className="mt-1 text-[12px] leading-relaxed text-black/50">
              I&apos;m not allowed to do this yet. Add this capability so I can continue?
            </p>
          ) : null}
          {context ? (
            <p className="mt-1 line-clamp-3 text-[12px] leading-relaxed text-black/50">{context}</p>
          ) : null}
          {hint ? (
            <p className="mt-1.5 text-[11px] leading-relaxed text-black/40">{hint}</p>
          ) : null}
          {step.jitAttempt && step.jitAttempt > 1 && step.jitMaxAttempts ? (
            <p className="mt-1.5 text-[11px] leading-relaxed text-black/40">
              Asking again ({step.jitAttempt}/{step.jitMaxAttempts})
            </p>
          ) : null}
          {error ? (
            <p className="mt-1.5 text-[11px] leading-relaxed text-[color:var(--sketch-red)]">{error}</p>
          ) : null}
        </div>
      </div>

      <div className="flex items-center gap-2 border-t border-black/[0.06] px-3 py-2.5 sm:px-4">
        {session && !isCapability ? (
          <p className="min-w-0 flex-1 truncate text-[11px] text-black/40">Lasts for this chat</p>
        ) : (
          <span className="min-w-0 flex-1" />
        )}
        {canDecide && deciding ? (
          <div className="flex shrink-0 items-center gap-1.5 text-[11px] text-black/40">
            <Loader2 className="size-3 animate-spin" aria-hidden />
            Working
          </div>
        ) : canDecide ? (
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => onDecide(false)}
              className={cn(sketchButtonGhost, "h-8 px-3 normal-case tracking-normal")}
            >
              {isCapability ? "No" : "Deny"}
            </button>
            <button
              type="button"
              onClick={() => onDecide(true)}
              className={cn(sketchButtonPrimary, "h-8 min-w-[5.75rem] px-3.5 normal-case tracking-normal")}
            >
              {isCapability ? "Add & continue" : "Approve"}
            </button>
          </div>
        ) : (
          <p className="text-[11px] text-black/45">Waiting on WhatsApp</p>
        )}
      </div>
    </div>
  );
}
