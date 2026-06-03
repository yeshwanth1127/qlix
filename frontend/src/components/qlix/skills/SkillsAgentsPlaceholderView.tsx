"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Bot, Hammer } from "lucide-react";
import { listAgents, type AgentDTO } from "@/lib/agents-api";
import { useSession } from "@/components/qlix/session-context";
import { ReflectiveCard } from "@/components/qlix/ReflectiveCard";

export function SkillsAgentsPlaceholderView({
  routePrefix,
}: {
  readonly routePrefix: "/individual" | "/organization";
}) {
  const { session } = useSession();
  const [loading, setLoading] = useState(true);
  const [agents, setAgents] = useState<AgentDTO[]>([]);
  const [error, setError] = useState<string | null>(null);

  const orgId = useMemo(() => {
    if (routePrefix !== "/organization") return null;
    return session?.organization.id ?? null;
  }, [routePrefix, session]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void listAgents(orgId)
      .then((rows) => {
        if (cancelled) return;
        if (!rows) {
          setError("Failed to load agents.");
          setAgents([]);
          return;
        }
        setAgents(rows);
      })
      .catch(() => {
        if (cancelled) return;
        setError("Failed to load agents.");
        setAgents([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  return (
    <div className="animate-qlix-fade-in space-y-4">
      <header className="flex items-start gap-3">
        <div className="qlix-glass-muted flex size-9 items-center justify-center rounded-lg text-[--accent]">
          <Hammer className="size-[18px]" strokeWidth={1.75} aria-hidden />
        </div>
        <div>
          <h1 className="text-base font-medium tracking-[-0.01em] text-[--text-primary]">Skills</h1>
          <p className="text-[13px] text-[--text-tertiary]">
            Placeholder: choose an agent to view and manage its skills.
          </p>
        </div>
      </header>

      <ReflectiveCard className="rounded-xl" contentClassName="p-4">
        {loading ? (
          <p className="text-[13px] text-[--text-tertiary]">Loading agents…</p>
        ) : error ? (
          <p className="text-[13px] text-[--danger]">{error}</p>
        ) : agents.length === 0 ? (
          <p className="text-[13px] text-[--text-tertiary]">No agents found yet.</p>
        ) : (
          <ul className="space-y-2">
            {agents.map((agent) => (
              <li key={agent.id}>
                <Link
                  href={`${routePrefix}/skills/${agent.id}`}
                  className="qlix-glass-box-interactive flex items-center justify-between rounded-lg border border-[--border-subtle] px-3 py-2 text-[13px]"
                >
                  <span className="inline-flex items-center gap-2 text-[--text-primary]">
                    <Bot className="size-4 text-[--accent]" aria-hidden />
                    {agent.name}
                  </span>
                  <span className="text-[11px] text-[--text-tertiary] capitalize">{agent.runtime}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </ReflectiveCard>
    </div>
  );
}

