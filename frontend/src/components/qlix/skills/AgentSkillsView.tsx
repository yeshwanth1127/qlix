"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ShieldCheck, Wrench } from "lucide-react";
import {
  ALL_PERMISSION_SCOPES,
  fetchScopeCatalog,
  getAgent,
  PERMISSION_SCOPE_LABELS,
  type AgentDTO,
} from "@/lib/agents-api";
import {
  SketchBox,
  SketchPageHeader,
  SketchRow,
  sketchLabel,
} from "@/components/qlix/sketch";

export function AgentSkillsView({
  routePrefix,
  agentId,
}: {
  readonly routePrefix: "/individual" | "/organization";
  readonly agentId: string;
}) {
  const [loading, setLoading] = useState(true);
  const [agent, setAgent] = useState<AgentDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<Awaited<ReturnType<typeof fetchScopeCatalog>>>(null);

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
        void fetchScopeCatalog(res.agent.orgId).then((rows) => {
          if (!cancelled) setCatalog(rows);
        });
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

  const labelFor = useMemo(() => {
    const fromCatalog = new Map((catalog ?? []).map((row) => [row.id, row.label]));
    return (scopeId: string) =>
      fromCatalog.get(scopeId) ??
      PERMISSION_SCOPE_LABELS[scopeId as (typeof ALL_PERMISSION_SCOPES)[number]] ??
      scopeId;
  }, [catalog]);

  const skills = useMemo(() => {
    if (!agent) return [];
    return agent.permissionScopes
      .map((scopeId) => ({
        id: scopeId,
        label: labelFor(scopeId),
        needsApproval: agent.jitScopes.includes(scopeId),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [agent, labelFor]);

  return (
    <div className="space-y-4">
      <Link
        href={`${routePrefix}/skills`}
        className="inline-flex items-center gap-1 font-serif text-[11px] uppercase tracking-widest text-black/50 hover:text-black"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        Back to skills
      </Link>

      <SketchPageHeader
        title={loading ? "Skills" : `Skills — ${agent?.name ?? "Unknown agent"}`}
      />
      <p className="-mt-4 text-[13px] text-black/60">
        {loading || error
          ? ""
          : skills.length > 0
            ? `${skills.length} skill${skills.length === 1 ? "" : "s"} granted to this agent. Edit them from the agent's detail page.`
            : "No skills granted yet. Add some from the agent's detail page."}
      </p>

      <SketchBox className="flex flex-col gap-2 p-3">
        {loading ? (
          <p className={sketchLabel}>Loading agent…</p>
        ) : error ? (
          <p className="text-[13px] text-black">{error}</p>
        ) : skills.length === 0 ? (
          <p className={sketchLabel}>No skills granted</p>
        ) : (
          skills.map((skill) => (
            <SketchRow key={skill.id} className="flex items-center justify-between">
              <span className="inline-flex items-center gap-2 text-[13px] text-black">
                <Wrench className="size-4 text-black/40" aria-hidden />
                {skill.label}
              </span>
              {skill.needsApproval ? (
                <span className={`${sketchLabel} inline-flex items-center gap-1`}>
                  <ShieldCheck className="size-3.5" aria-hidden />
                  Needs approval
                </span>
              ) : (
                <span className={sketchLabel}>Always allowed</span>
              )}
            </SketchRow>
          ))
        )}
      </SketchBox>
    </div>
  );
}
