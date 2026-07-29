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
import { cn } from "@/lib/utils/cn";
import { SketchBox, sketchButton, sketchLabel } from "@/components/qlix/sketch";

const hostingCardSelected = "border-2 border-black bg-white";
const hostingCardIdle = "border border-black bg-white hover:bg-black/5";

function SetupShell({ children }: { readonly children: ReactNode }) {
  return (
    <div className="min-h-[calc(100vh-4rem)]">
      <div className="mx-auto max-w-xl space-y-6 px-4 pb-20 pt-10 md:pt-14">
        <header className="space-y-2 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full border border-black/15 bg-white/60 backdrop-blur-sm">
            <Brain className="size-6 stroke-[1.25] text-black" aria-hidden />
          </div>
          <h1 className={sketchLabel}>exa</h1>
          <p className="text-[13px] leading-relaxed text-black/70">
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
      className={cn("relative p-3 text-left transition-all duration-200", active ? hostingCardSelected : hostingCardIdle)}
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
      <p className="mt-1 text-[11px] leading-relaxed text-black/50">{description}</p>
    </button>
  );
}

export function AiBrainPageGate() {
  const { session, loading: sessionLoading } = useSession();
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
    const res = await ensureAiBrainAgent("cloud");
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
      <div className="flex min-h-[50vh] items-center justify-center text-[13px] text-black/50">
        <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
        Loading…
      </div>
    );
  }

  if (loading) {
    return (
      <SetupShell>
        <SketchBox className="flex items-center justify-center gap-2 px-6 py-12 text-[13px] text-black/50">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Checking brain status…
        </SketchBox>
      </SetupShell>
    );
  }

  if (brain) {
    return <AiBrainConsoleView />;
  }

  if (!manageBrain) {
    return (
      <SetupShell>
        <SketchBox className="space-y-2 px-6 py-8 text-center">
          <p className="text-[13px] font-medium text-black">Brain not set up yet</p>
          <p className="text-[13px] text-black/70">
            An organization owner or admin must choose hosting and provision the org AI brain before you can query
            knowledge here.
          </p>
        </SketchBox>
      </SetupShell>
    );
  }

  if (provisionHosting === "local") {
    return (
      <SetupShell>
        {error ? (
          <SketchBox className="px-4 py-3 text-[13px] text-black">{error}</SketchBox>
        ) : null}
        <SketchBox className="space-y-4 p-6">
          <div className="flex items-center gap-2 text-sm font-semibold text-black">
            <Cpu className="size-5 text-black" aria-hidden />
            Local brain hosting
          </div>
          <p className="text-[13px] leading-relaxed text-black/70">
            Run your org AI brain on your own machine. Self-hosting isn't available yet; it's reserved for a future
            release.
          </p>
          <p className="text-[13px] text-black/50">
            For now, choose Qlix cloud hosting to set up your brain agent and knowledge base.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              className={sketchButton}
              onClick={() => {
                setProvisionHosting(null);
                setError(null);
              }}
            >
              Choose hosting again
            </button>
            <button type="button" className={sketchButton} onClick={() => setProvisionHosting("cloud")}>
              Switch to cloud
            </button>
          </div>
        </SketchBox>
      </SetupShell>
    );
  }

  return (
    <SetupShell>
      {error ? (
        <SketchBox className="px-4 py-3 text-[13px] text-black">{error}</SketchBox>
      ) : null}
      <SketchBox className="space-y-5 p-6">
        <div>
          <h2 className={sketchLabel}>Where should your brain run?</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-black/70">
            The org brain is a dedicated agent with its own DID and audit trail. Choose hosting before the console opens.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <BrainHostingCard
            active={provisionHosting === "cloud"}
            icon={<Cloud className="size-4" aria-hidden />}
            title="Qlix cloud"
            description="Fully managed on Qlix cloud. Available today."
            onClick={() => setProvisionHosting("cloud")}
          />
          <BrainHostingCard
            active={(provisionHosting as string) === "local"}
            icon={<Cpu className="size-4" aria-hidden />}
            title="Local"
            description="Runs on your machine with the Qlix SDK. Coming soon."
            onClick={() => setProvisionHosting("local")}
          />
        </div>
        {provisionHosting === "cloud" ? (
          <div className="space-y-3 border-t border-black pt-4">
            <p className="text-[12px] text-black/50">
              Provisions the org brain agent on Qlix cloud using your signed-in session.
            </p>
            <button
              type="button"
              disabled={provisioning}
              onClick={() => void onEnsureBrainCloud()}
              className={`${sketchButton} w-full gap-2 sm:w-auto disabled:opacity-40`}
            >
              {provisioning ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Setting up…
                </>
              ) : (
                "Provision on cloud"
              )}
            </button>
          </div>
        ) : (
          <p className="text-[12px] text-black/50">Select cloud or local to continue.</p>
        )}
      </SketchBox>
    </SetupShell>
  );
}
