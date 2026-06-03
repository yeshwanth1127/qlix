"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, Hammer, Wrench } from "lucide-react";
import { getAgent, type AgentDTO } from "@/lib/agents-api";
import { ReflectiveCard } from "@/components/qlix/ReflectiveCard";

export function AgentSkillsPlaceholderView({
  routePrefix,
  agentId,
}: {
  readonly routePrefix: "/individual" | "/organization";
  readonly agentId: string;
}) {
  const [loading, setLoading] = useState(true);
  const [agent, setAgent] = useState<AgentDTO | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void getAgent(agentId)
      .then((res) => {
        if (cancelled) return;
        if (!res) {
          setAgent(null);
          setError("Agent not found.");
          return;
        }
        setAgent(res.agent);
      })
      .catch(() => {
        if (!cancelled) setError("Failed to load agent.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  return (
    <div className="animate-qlix-fade-in space-y-4">
      <Link
        href={`${routePrefix}/skills`}
        className="inline-flex items-center gap-1 text-[12px] text-[--text-tertiary] hover:text-[--text-secondary]"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        Back to skills
      </Link>

      <header className="flex items-start gap-3">
        <div className="qlix-glass-muted flex size-9 items-center justify-center rounded-lg text-[--accent]">
          <Hammer className="size-[18px]" strokeWidth={1.75} aria-hidden />
        </div>
        <div>
          <h1 className="text-base font-medium tracking-[-0.01em] text-[--text-primary]">
            {loading ? "Skills" : `Skills — ${agent?.name ?? "Unknown agent"}`}
          </h1>
          <p className="text-[13px] text-[--text-tertiary]">
            Placeholder view. Skill wiring and editing will be connected in the next phase.
          </p>
        </div>
      </header>

      <ReflectiveCard className="rounded-xl" contentClassName="p-4">
        {loading ? (
          <p className="text-[13px] text-[--text-tertiary]">Loading agent…</p>
        ) : error ? (
          <p className="text-[13px] text-[--danger]">{error}</p>
        ) : (
          <div className="space-y-2">
            {["Web Search", "Browser", "File Read", "File Write", "HTTP Request"].map((skill) => (
              <div
                key={skill}
                className="flex items-center justify-between rounded-lg border border-[--border-subtle] px-3 py-2"
              >
                <span className="inline-flex items-center gap-2 text-[13px] text-[--text-primary]">
                  <Wrench className="size-4 text-[--accent]" aria-hidden />
                  {skill}
                </span>
                <span className="text-[11px] text-[--text-tertiary]">Placeholder</span>
              </div>
            ))}
          </div>
        )}
      </ReflectiveCard>
    </div>
  );
}

