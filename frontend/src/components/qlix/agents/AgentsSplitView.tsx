"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ExternalLink, Plus } from "lucide-react";
import { type AgentDTO, listAgents } from "@/lib/agents-api";
import { useSession } from "@/components/qlix/session-context";
import { cn } from "@/lib/utils/cn";
import { CreateAgentModal } from "./CreateAgentModal";
import { AgentChatPanel } from "./AgentChatPanel";
import { AgentsChatPlaceholder } from "./AgentsChatPlaceholder";
import {
  AgentStatusBadge,
  RuntimeBadge,
  deriveAgentDisplayStatus,
  formatDidCompact,
} from "./agentStatus";

interface AgentsSplitViewProps {
  readonly routePrefix: "/individual" | "/organization";
}

export function AgentsSplitView({ routePrefix }: AgentsSplitViewProps) {
  const { session } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [agents, setAgents] = useState<AgentDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const isOrg = routePrefix === "/organization";
  const orgId = isOrg ? (session?.organization.id ?? null) : null;
  const deviceVerified = session?.user.deviceVerified === true;

  const selectedAgentId = searchParams.get("agent");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listAgents(orgId);
      if (!data) {
        setError("Could not load agents (try signing in again).");
        setAgents(null);
        return;
      }
      setAgents(data);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleCreated = (agent: AgentDTO) => {
    setAgents((prev) => [agent, ...(prev ?? [])]);
    const next = new URLSearchParams(searchParams.toString());
    next.set("agent", agent.id);
    router.replace(`${pathname}?${next.toString()}`);
  };

  const selectAgent = (id: string) => {
    const next = new URLSearchParams(searchParams.toString());
    next.set("agent", id);
    router.replace(`${pathname}?${next.toString()}`);
  };

  const selectedAgent = useMemo(() => {
    if (!agents || !selectedAgentId) return null;
    return agents.find((a) => a.id === selectedAgentId) ?? null;
  }, [agents, selectedAgentId]);

  return (
    <div className="animate-qlix-fade-in space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="bg-gradient-to-r from-violet-600 via-indigo-500 to-cyan-500 bg-clip-text text-xl font-semibold tracking-tight text-transparent dark:from-violet-300 dark:to-cyan-300">
            Agents
          </h1>
          <p className="max-w-lg text-[13px] leading-relaxed text-[--text-secondary]">
            Register and manage AI agents with DIDs, verifiable credentials, and live cloud runners.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-violet-600 via-indigo-600 to-cyan-600 px-4 py-2 text-[12px] font-semibold text-white shadow-md shadow-violet-500/25 motion-safe:transition-[filter,transform] motion-safe:duration-200 hover:brightness-110 active:scale-[0.98] dark:from-violet-500 dark:via-indigo-500 dark:to-cyan-500"
        >
          <Plus className="size-4" aria-hidden />
          Create agent
        </button>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(380px,42%)_1fr]">
        <section className="overflow-hidden rounded-xl border border-violet-500/15 bg-[--bg-elevated] shadow-sm ring-1 ring-inset ring-violet-500/10 dark:border-violet-400/20 dark:shadow-[0_4px_24px_rgba(99,102,241,0.08)]">
          <div className="border-b border-[--border-subtle] bg-gradient-to-r from-violet-500/[0.06] to-cyan-500/[0.04] px-4 py-3 dark:from-violet-500/10 dark:to-cyan-500/10">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-violet-700/90 dark:text-violet-300/90">
              Agent registry
            </p>
            <p className="mt-0.5 text-[12px] text-[--text-tertiary]">
              {loading ? "Loading…" : `${agents?.length ?? 0} registered`}
            </p>
          </div>

          {loading ? (
            <AgentsRegistrySkeleton />
          ) : error ? (
            <p className="px-4 py-10 text-center text-[13px] text-[--danger]">{error}</p>
          ) : !agents || agents.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <p className="text-[13px] text-[--text-secondary]">No agents yet.</p>
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="mt-4 text-[12px] font-medium text-violet-600 hover:underline dark:text-violet-300"
              >
                Create your first agent →
              </button>
            </div>
          ) : (
            <ul className="max-h-[calc(100vh-12rem)] divide-y divide-[--border-subtle] overflow-y-auto thin-scrollbar">
              {agents.map((a, i) => {
                const isSelected = selectedAgentId === a.id;
                const status = deriveAgentDisplayStatus(a);
                return (
                  <li
                    key={a.id}
                    className="agents-list-row"
                    style={{ animationDelay: `${Math.min(i, 12) * 40}ms` }}
                  >
                    <button
                      type="button"
                      onClick={() => selectAgent(a.id)}
                      className={cn(
                        "group relative flex w-full flex-col gap-2 px-4 py-3.5 text-left motion-safe:transition-colors motion-safe:duration-200",
                        isSelected
                          ? "bg-gradient-to-r from-violet-500/12 via-indigo-500/8 to-transparent dark:from-violet-500/20"
                          : "hover:bg-[var(--glass-row-hover)]",
                      )}
                    >
                      {isSelected ? (
                        <span
                          className="absolute bottom-0 left-0 top-0 w-1 bg-gradient-to-b from-violet-500 to-cyan-500"
                          aria-hidden
                        />
                      ) : null}
                      <div className="flex items-start justify-between gap-2 pl-1">
                        <span className="min-w-0">
                          <span className="block truncate text-[13px] font-semibold text-[--text-primary] group-hover:text-violet-700 dark:group-hover:text-violet-200">
                            {a.name}
                          </span>
                          <span
                            className="mt-1 block font-mono text-[10px] text-[--text-tertiary]"
                            title={a.did}
                          >
                            {formatDidCompact(a.did)}
                          </span>
                        </span>
                        <AgentStatusBadge status={status} />
                      </div>
                      <div className="flex flex-wrap items-center gap-2 pl-1">
                        <RuntimeBadge runtime={a.runtime} agentKind={a.agentKind} />
                        <Link
                          href={`${routePrefix}/agents/${a.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-0.5 text-[10px] font-medium text-[--text-tertiary] hover:text-violet-600 dark:hover:text-violet-300"
                        >
                          Details
                          <ExternalLink className="size-2.5" aria-hidden />
                        </Link>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="min-h-[520px]">
          {selectedAgent ? (
            <AgentChatPanel
              agentId={selectedAgent.id}
              aiBrainHref={isOrg ? `${routePrefix}/ai-brain` : undefined}
            />
          ) : (
            <AgentsChatPlaceholder agents={agents ?? []} onSelect={selectAgent} />
          )}
        </section>
      </div>

      <CreateAgentModal
        open={open}
        onClose={() => {
          setOpen(false);
          void refresh();
        }}
        onCreated={handleCreated}
        orgId={orgId}
        deviceVerified={deviceVerified}
      />
    </div>
  );
}

function AgentsRegistrySkeleton() {
  return (
    <ul className="divide-y divide-[--border-subtle]">
      {[0, 1, 2].map((i) => (
        <li key={i} className="px-4 py-4">
          <div className="h-4 w-2/3 animate-pulse rounded bg-violet-500/10" />
          <div className="mt-2 h-3 w-1/2 animate-pulse rounded bg-[--bg-subtle]" />
          <div className="mt-3 h-5 w-16 animate-pulse rounded-full bg-[--bg-subtle]" />
        </li>
      ))}
    </ul>
  );
}
