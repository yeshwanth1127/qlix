"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Brain, Check, Cloud, Cpu, Loader2 } from "lucide-react";
import { useSession } from "@/components/qlix/session-context";
import { AiBrainConsoleView } from "@/components/qlix/ai-brain/AiBrainConsoleView";
import {
  ensureAiBrainAgent,
  getAiBrainStatus,
  type AiBrainHosting,
  type AiBrainStatusResponse,
} from "@/lib/ai-brain-api";
import { canManageBrain } from "@/lib/org-permissions";
import { obtainAgentCreateStepUpToken } from "@/lib/webauthn";
import { cn } from "@/lib/utils/cn";

const btnPrimary =
  "inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-violet-600 via-indigo-600 to-cyan-600 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-violet-500/25 transition-[filter,transform] duration-200 hover:brightness-110 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 dark:from-violet-500 dark:via-indigo-500 dark:to-cyan-500";

const btnSecondary =
  "inline-flex items-center justify-center gap-2 rounded-lg border border-violet-400/40 bg-violet-50/80 px-4 py-2 text-sm font-medium text-violet-900 transition-colors hover:border-cyan-400/50 hover:bg-cyan-50/60 dark:border-violet-400/35 dark:bg-[--bg-subtle] dark:text-violet-100/85 dark:hover:bg-indigo-950/40 disabled:pointer-events-none disabled:opacity-40";

const panel =
  "rounded-xl border border-violet-500/15 bg-[--bg-elevated] shadow-[0_1px_2px_rgba(0,0,0,0.04)] ring-1 ring-inset ring-violet-500/10 dark:border-violet-400/20 dark:shadow-[0_4px_24px_rgba(99,102,241,0.12)] dark:ring-violet-400/15";

const hostingCardSelected =
  "border-2 border-violet-500 bg-gradient-to-br from-violet-500/20 via-indigo-500/10 to-cyan-500/5 ring-2 ring-violet-400/40 shadow-md shadow-violet-500/15 dark:border-violet-400 dark:from-violet-500/25 dark:ring-violet-400/35";
const hostingCardIdle =
  "border border-[--border-default] bg-[--bg-base] hover:border-violet-400/45 hover:bg-violet-500/5";

function SetupShell({ children }: { readonly children: ReactNode }) {
  return (
    <div className="animate-qlix-fade-in min-h-[calc(100vh-4rem)] bg-[--bg-base]">
      <div className="mx-auto max-w-xl space-y-6 px-4 pb-20 pt-10 md:pt-14">
        <header className="space-y-2 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500/20 to-cyan-500/20 text-violet-600 dark:text-cyan-300">
            <Brain className="size-6" strokeWidth={1.25} aria-hidden />
          </div>
          <h1 className="bg-gradient-to-r from-violet-600 via-fuchsia-500 to-cyan-500 bg-clip-text text-2xl font-semibold tracking-tight text-transparent dark:from-violet-300 dark:via-fuchsia-300 dark:to-cyan-300">
            AI Brain
          </h1>
          <p className="text-[13px] leading-relaxed text-[--text-secondary]">
            Centralized org knowledge for RAG, with audit attribution on Exora Layer 5.
          </p>
        </header>
        {children}
      </div>
    </div>
  );
}

function BrainHostingCard({
  active,
  icon,
  title,
  description,
  onClick,
}: {
  readonly active: boolean;
  readonly icon: ReactNode;
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
        active ? hostingCardSelected : hostingCardIdle,
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
      <p className="mt-1 text-[11px] leading-relaxed text-[--text-tertiary]">{description}</p>
    </button>
  );
}

export function AiBrainPageGate() {
  const { session, loading: sessionLoading, refresh: refreshSession } = useSession();
  const deviceVerified = session?.user.deviceVerified === true;
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<AiBrainStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [provisionHosting, setProvisionHosting] = useState<AiBrainHosting | null>("cloud");
  const [provisioning, setProvisioning] = useState(false);

  const role = session?.user.role ?? "member";
  const manageBrain = canManageBrain(role);
  const brain = status?.brain;

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await getAiBrainStatus();
    setLoading(false);
    if (!res.ok) {
      setError(res.message);
      setStatus(null);
      return;
    }
    setStatus(res.data);
  }, []);

  useEffect(() => {
    if (sessionLoading || !session) return;
    void loadStatus();
  }, [session, sessionLoading, loadStatus]);

  const onEnsureBrainCloud = async () => {
    setProvisioning(true);
    setError(null);
    const step = await obtainAgentCreateStepUpToken(deviceVerified);
    if (!step.ok) {
      setProvisioning(false);
      setError(step.errorMessage);
      return;
    }
    if (!deviceVerified) {
      await refreshSession();
    }
    const res = await ensureAiBrainAgent(step.stepUpToken, "cloud");
    setProvisioning(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setProvisionHosting(null);
    await loadStatus();
  };

  if (sessionLoading || !session) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-[13px] text-[--text-tertiary]">
        <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
        Loading…
      </div>
    );
  }

  if (loading) {
    return (
      <SetupShell>
        <div className={cn(panel, "flex items-center justify-center gap-2 px-6 py-12 text-[13px] text-[--text-tertiary]")}>
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Checking brain status…
        </div>
      </SetupShell>
    );
  }

  if (brain) {
    return <AiBrainConsoleView />;
  }

  if (!manageBrain) {
    return (
      <SetupShell>
        <div className={cn(panel, "space-y-2 px-6 py-8 text-center")}>
          <p className="text-[13px] font-medium text-[--text-primary]">Brain not set up yet</p>
          <p className="text-[13px] text-[--text-secondary]">
            An organization owner or admin must choose hosting and provision the org AI brain before you can query
            knowledge here.
          </p>
        </div>
      </SetupShell>
    );
  }

  if (provisionHosting === "local") {
    return (
      <SetupShell>
        {error ? (
          <div
            className="rounded-lg border border-[--warning]/30 bg-[--warning-subtle] px-4 py-3 text-[13px] text-[--text-primary]"
            role="alert"
          >
            {error}
          </div>
        ) : null}
        <div className={cn(panel, "space-y-4 p-6")}>
          <div className="flex items-center gap-2 text-sm font-semibold text-[--text-primary]">
            <Cpu className="size-5 text-cyan-600 dark:text-cyan-400" aria-hidden />
            Local brain hosting
          </div>
          <p className="text-[13px] leading-relaxed text-[--text-secondary]">
            Run your org AI brain on your own machine with the Qlix SDK. Local provisioning, sync, and RAG indexing are
            not wired up yet; this path is reserved for a future release.
          </p>
          <p className="text-[13px] text-[--text-tertiary]">
            For now, choose Qlix cloud hosting to provision the canonical brain agent, Docker runner, and knowledge APIs.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              className={btnSecondary}
              onClick={() => {
                setProvisionHosting(null);
                setError(null);
              }}
            >
              Choose hosting again
            </button>
            <button type="button" className={btnPrimary} onClick={() => setProvisionHosting("cloud")}>
              Switch to cloud
            </button>
          </div>
        </div>
      </SetupShell>
    );
  }

  return (
    <SetupShell>
      {error ? (
        <div className="rounded-lg border border-[--warning]/30 bg-[--warning-subtle] px-4 py-3 text-[13px] text-[--text-primary]" role="alert">
          {error}
        </div>
      ) : null}
      <div className={cn(panel, "space-y-5 p-6")}>
        <div>
          <h2 className="text-sm font-semibold text-[--text-primary]">Where should your brain run?</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-[--text-secondary]">
            The org brain is a dedicated agent with its own DID and audit trail. Choose hosting before the console opens.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <BrainHostingCard
            active={provisionHosting === "cloud"}
            icon={<Cloud className="size-4" aria-hidden />}
            title="Qlix cloud"
            description="Runs on Qlix infrastructure with a managed Docker runner. Available today."
            onClick={() => setProvisionHosting("cloud")}
          />
          <BrainHostingCard
            active={provisionHosting === "local"}
            icon={<Cpu className="size-4" aria-hidden />}
            title="Local"
            description="Runs on your machine with the Qlix SDK. Coming soon."
            onClick={() => setProvisionHosting("local")}
          />
        </div>
        {provisionHosting === "cloud" ? (
          <div className="space-y-3 border-t border-[--border-subtle] pt-4">
            <p className="text-[12px] text-[--text-tertiary]">
              {deviceVerified
                ? "Your browser will ask you to confirm with your passkey before the brain agent is issued."
                : "Your browser will prompt you to register a passkey, then provision the brain agent."}
            </p>
            <button
              type="button"
              disabled={provisioning}
              onClick={() => void onEnsureBrainCloud()}
              className={cn(btnPrimary, "w-full sm:w-auto")}
            >
              {provisioning ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Provisioning…
                </>
              ) : (
                "Verify device & provision on cloud"
              )}
            </button>
          </div>
        ) : (
          <p className="text-[12px] text-[--text-tertiary]">Select cloud or local to continue.</p>
        )}
      </div>
    </SetupShell>
  );
}
