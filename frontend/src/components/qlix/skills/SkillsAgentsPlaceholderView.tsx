"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Bot, Hammer } from "lucide-react";
import { listAgents, type AgentDTO } from "@/lib/agents-api";
import { useSession } from "@/components/qlix/session-context";
import {
  SketchBox,
  SketchPageHeader,
  SketchRow,
  sketchLabel,
} from "@/components/qlix/sketch";

export function SkillsAgentsPlaceholderView({
  routePrefix,
}: {
  readonly routePrefix: "/individual" | "/organization";
}) {
  const { session } = useSession();
  const [loading, setLoading] = useState(true);
  const [agents, setAgents] = useState<AgentDTO[]>([]);
  const [error, setError] = useState<string | null>(null);

  const orgId = routePrefix === "/organization" ? (session?.organization.id ?? null) : null;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void listAgents(orgId)
      .then((rows) => {
        if (cancelled) return;
        if (!rows) {
          setError("Could not load agents.");
          setAgents([]);
          return;
        }
        setAgents(rows);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SketchPageHeader title="Skills" />
      <p className="mb-4 font-serif text-[11px] uppercase tracking-widest text-black/50">
        Per-agent skill packs and tool bindings
      </p>
      <SketchBox className="flex flex-col gap-2 p-3">
        {loading ? (
          <p className={sketchLabel}>Loading…</p>
        ) : error ? (
          <p className="text-[13px] text-black">{error}</p>
        ) : agents.length === 0 ? (
          <p className="py-8 text-center font-serif text-[11px] uppercase tracking-widest text-black/50">
            No agents yet
          </p>
        ) : (
          agents.map((agent) => (
            <Link key={agent.id} href={`${routePrefix}/skills/${agent.id}`}>
              <SketchRow className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-[13px] text-black">
                  <Bot className="size-4" aria-hidden />
                  {agent.name}
                </span>
                <Hammer className="size-4 text-black/40" aria-hidden />
              </SketchRow>
            </Link>
          ))
        )}
      </SketchBox>
    </div>
  );
}
