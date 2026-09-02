"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Check, Circle, Loader2 } from "lucide-react";
import { SketchPageHeader } from "@/components/qlix/sketch";
import {
  hireEmployee,
  listEmployeeEngagements,
  preflightEmployeeHire,
  type EmployeeEngagementDTO,
} from "@/lib/employees-api";
import { getGtmDiscoveryWorkspace, type GtmTeamSlot } from "@/lib/gtm-api";
import { addTeamMember, createTeam, setSupervisorAgent } from "@/lib/teams-api";

type BuildStep = {
  key: string;
  label: string;
  status: "pending" | "active" | "done" | "error";
  errorMessage?: string;
};

function uniqueHireSlots(slots: readonly GtmTeamSlot[]): GtmTeamSlot[] {
  const seen = new Set<string>();
  return slots.filter((slot) => {
    if (seen.has(slot.roleSlug)) return false;
    seen.add(slot.roleSlug);
    return true;
  });
}

function resolveEngagement(
  slots: readonly GtmTeamSlot[],
  engagements: EmployeeEngagementDTO[],
): Map<string, EmployeeEngagementDTO> {
  const byRole = new Map<string, EmployeeEngagementDTO>();
  for (const engagement of engagements) {
    if (engagement.status !== "active") continue;
    if (!byRole.has(engagement.roleSlug)) byRole.set(engagement.roleSlug, engagement);
  }
  const resolved = new Map<string, EmployeeEngagementDTO>();
  for (const slot of uniqueHireSlots(slots)) {
    const existing = byRole.get(slot.roleSlug);
    if (existing) resolved.set(slot.roleSlug, existing);
  }
  return resolved;
}

export function GtmTeamBuildFlow({ routePrefix = "/organization" }: { readonly routePrefix?: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [teamName, setTeamName] = useState("GTM Discovery Team");
  const [slots, setSlots] = useState<GtmTeamSlot[]>([]);
  const [engagements, setEngagements] = useState<EmployeeEngagementDTO[]>([]);
  const [steps, setSteps] = useState<BuildStep[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [workspaceResult, existingEngagements] = await Promise.all([
          getGtmDiscoveryWorkspace(),
          listEmployeeEngagements(),
        ]);
        if (cancelled) return;
        if (!workspaceResult.ok) {
          setError(workspaceResult.message);
          return;
        }
        const suggested = [...workspaceResult.workspace.suggestedTeam];
        setSlots(suggested);
        setEngagements(existingEngagements);
        const summary = workspaceResult.workspace.plan?.content?.summary;
        if (summary) {
          const short = summary.split(/[.!?]/)[0]?.trim();
          if (short && short.length <= 80) setTeamName(`${short} Team`);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load team plan");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const hireSlots = useMemo(() => uniqueHireSlots(slots), [slots]);
  const alreadyBuilt = useMemo(
    () => resolveEngagement(slots, engagements),
    [slots, engagements],
  );
  const allAgentsReady = hireSlots.every((slot) => alreadyBuilt.has(slot.roleSlug));

  function patchStep(key: string, patch: Partial<BuildStep>) {
    setSteps((current) => current.map((step) => (step.key === key ? { ...step, ...patch } : step)));
  }

  async function buildTeam() {
    if (busy || hireSlots.length === 0) return;
    setBusy(true);
    setError(null);

    const hireSteps: BuildStep[] = hireSlots.map((slot) => ({
      key: `hire-${slot.roleSlug}`,
      label: alreadyBuilt.has(slot.roleSlug)
        ? `${slot.suggestedName} — already on your team`
        : `Building ${slot.slotLabel.toLowerCase()} — ${slot.suggestedName}`,
      status: alreadyBuilt.has(slot.roleSlug) ? "done" : "pending",
    }));
    hireSteps.push({ key: "assemble", label: `Assembling team — ${teamName}`, status: "pending" });
    setSteps(hireSteps);

    const hired = new Map(alreadyBuilt);

    try {
      for (const slot of hireSlots) {
        const stepKey = `hire-${slot.roleSlug}`;
        if (hired.has(slot.roleSlug)) {
          patchStep(stepKey, { status: "done" });
          continue;
        }

        patchStep(stepKey, { status: "active" });
        const preflight = await preflightEmployeeHire(slot.roleSlug, [...slot.suggestedPlatforms]);
        const limitedMode = preflight.hireMode === "limited" || preflight.readiness !== "ready";
        const { engagement } = await hireEmployee({
          roleSlug: slot.roleSlug,
          name: slot.suggestedName,
          selectedPlatformIds: [...slot.suggestedPlatforms],
          limitedMode,
        });
        hired.set(slot.roleSlug, engagement);
        patchStep(stepKey, { status: "done" });
      }

      patchStep("assemble", { status: "active" });
      const orderedAgents = hireSlots.map((slot) => hired.get(slot.roleSlug)!);
      const [supervisor, ...workers] = orderedAgents;

      const team = await createTeam({
        name: teamName.trim() || "GTM Discovery Team",
        description: "Parallel GTM discovery team assembled from your plan.",
        config: {
          maxParallelWorkers: Math.max(workers.length, 1),
          subtaskTimeoutMs: 120_000,
          retryPolicy: "once",
          humanInLoopTriggers: ["web.transaction"],
          pipelineMode: true,
          autoSequence: false,
        },
      });

      await setSupervisorAgent(team.id, supervisor.agentId);

      for (let i = 0; i < workers.length; i += 1) {
        const worker = workers[i]!;
        const slot = hireSlots[i + 1]!;
        await addTeamMember(team.id, {
          agentId: worker.agentId,
          role: slot.slotId,
          delegatedScopes: worker.agent.permissionScopes,
        });
      }

      patchStep("assemble", { status: "done", label: `Team assembled — ${team.name}` });
      router.push(`${routePrefix}/teams/${team.id}?built=gtm`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Team build failed";
      setError(message);
      setSteps((current) =>
        current.map((step) =>
          step.status === "active" ? { ...step, status: "error", errorMessage: message } : step,
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <p className="py-10 text-center text-[13px] text-black/45">Loading team plan…</p>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SketchPageHeader
        title="Build your GTM team"
        subtitle="One team, parallel execution — research, email, and support agents working together."
        actions={(
          <Link
            href={`${routePrefix}/gtm`}
            className="border border-black px-3 py-2 font-serif text-[10px] uppercase tracking-widest"
          >
            Back to workspace
          </Link>
        )}
      />

      <div className="py-4 sm:py-8">
        {error ? (
          <p className="mb-4 border border-black bg-[#f4d7cf] px-3 py-2 text-[12px]" role="alert">{error}</p>
        ) : null}

        {slots.length === 0 ? (
          <p className="text-[13px] text-black/55">No team suggested yet. Complete your discovery plan first.</p>
        ) : (
          <div className="space-y-4">
            <section className="border border-black/25 bg-[#fbfaf6] p-5">
              <h2 className="font-serif text-[10px] uppercase tracking-[0.16em] text-black/45">Team preview</h2>
              <label className="mt-3 block">
                <span className="font-serif text-[10px] uppercase tracking-widest text-black/40">Team name</span>
                <input
                  value={teamName}
                  onChange={(e) => setTeamName(e.target.value)}
                  disabled={busy}
                  className="mt-1 w-full max-w-md border border-black/20 bg-white px-3 py-2 text-[14px]"
                />
              </label>
              <ul className="mt-4 space-y-3">
                {slots.map((slot) => {
                  const built = alreadyBuilt.has(slot.roleSlug);
                  return (
                    <li key={`${slot.slotId}-${slot.roleSlug}`} className="flex gap-3 border border-black/10 bg-white p-4 text-[13px]">
                      {built ? (
                        <Check className="mt-0.5 size-4 shrink-0 text-black" aria-hidden />
                      ) : (
                        <Circle className="mt-0.5 size-4 shrink-0 text-black/25" aria-hidden />
                      )}
                      <div>
                        <p className="font-medium text-black">{slot.slotLabel}</p>
                        <p className="text-[12px] text-black/55">{slot.roleLabel} · {slot.suggestedName}</p>
                        <p className="mt-1 text-[12px] text-black/60">{slot.mission}</p>
                        <p className="mt-1 font-serif text-[9px] uppercase tracking-widest text-black/40">Runs in parallel</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>

            {steps.length > 0 ? (
              <section className="border border-black/25 bg-[#fbfaf6] p-5">
                <h2 className="font-serif text-[10px] uppercase tracking-[0.16em] text-black/45">Building</h2>
                <ol className="mt-3 space-y-2">
                  {steps.map((step) => (
                    <li key={step.key} className="flex items-start gap-2 text-[12px]">
                      {step.status === "done" ? (
                        <Check className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                      ) : step.status === "active" ? (
                        <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin" aria-hidden />
                      ) : step.status === "error" ? (
                        <Circle className="mt-0.5 size-3.5 shrink-0 text-[#8b1e12]" aria-hidden />
                      ) : (
                        <Circle className="mt-0.5 size-3.5 shrink-0 text-black/25" aria-hidden />
                      )}
                      <span className={step.status === "error" ? "text-[#8b1e12]" : "text-black/70"}>
                        {step.label}
                        {step.errorMessage ? ` — ${step.errorMessage}` : null}
                      </span>
                    </li>
                  ))}
                </ol>
              </section>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => void buildTeam()}
                className="bg-black px-5 py-3 font-serif text-[10px] uppercase tracking-widest text-white disabled:opacity-40"
              >
                {allAgentsReady ? "Assemble team" : "Build team"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
