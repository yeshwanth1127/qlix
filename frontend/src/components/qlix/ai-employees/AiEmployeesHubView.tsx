"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Briefcase, ChevronRight, Loader2, UserCheck } from "lucide-react";
import {
  listEmployeeEngagements,
  listEmployeeRoles,
  type EmployeeEngagementDTO,
  type RoleCatalogEntry,
} from "@/lib/employees-api";
import {
  SketchBox,
  SketchPageHeader,
  SketchRow,
  sketchButtonPrimary,
} from "@/components/qlix/sketch";

export function AiEmployeesHubView({
  routePrefix,
}: {
  readonly routePrefix: "/individual" | "/organization";
}) {
  const [roles, setRoles] = useState<RoleCatalogEntry[] | null>(null);
  const [engagements, setEngagements] = useState<EmployeeEngagementDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [r, e] = await Promise.all([listEmployeeRoles(), listEmployeeEngagements()]);
      setRoles(r);
      setEngagements(e);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load AI Employees");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SketchPageHeader title="AI Employees" />
      <p className="mb-4 font-serif text-[11px] uppercase tracking-widest text-black/50">
        Hire ready-made role agents with outcomes, connectors, and guardrails built in
      </p>

      {loading ? (
        <p className="flex items-center gap-2 text-[13px] text-black/50">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Loading…
        </p>
      ) : null}
      {error ? (
        <SketchBox className="mb-4 px-3 py-2">
          <p className="text-[13px] text-black">{error}</p>
        </SketchBox>
      ) : null}

      {engagements && engagements.length > 0 ? (
        <section className="mb-6">
          <h2 className="mb-2 font-serif text-[11px] uppercase tracking-widest text-black/50">
            Your team
          </h2>
          <SketchBox className="flex flex-col gap-2 p-3">
            {engagements.map((e) => (
              <Link key={e.id} href={`${routePrefix}/ai-employees/${e.roleSlug}`}>
                <SketchRow className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-[13px] text-black">
                    <UserCheck className="size-4" aria-hidden />
                    {e.agent.name}
                    <span className="text-black/45">· {e.packSnapshot.label}</span>
                  </span>
                  <ChevronRight className="size-4 text-black/40" aria-hidden />
                </SketchRow>
              </Link>
            ))}
          </SketchBox>
        </section>
      ) : null}

      <section>
        <h2 className="mb-2 font-serif text-[11px] uppercase tracking-widest text-black/50">
          Open roles
        </h2>
        <SketchBox className="flex flex-col gap-2 p-3">
          {(roles ?? []).map((role) => (
            <Link key={role.slug} href={`${routePrefix}/ai-employees/${role.slug}`}>
              <SketchRow className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2 text-[13px] text-black">
                  <Briefcase className="size-4 shrink-0" aria-hidden />
                  <span className="truncate">{role.label}</span>
                  {!role.hireable ? (
                    <span className="shrink-0 text-[10px] uppercase text-amber-700">Setup needed</span>
                  ) : role.hireMode === "limited" ? (
                    <span className="shrink-0 text-[10px] uppercase text-black/45">Limited</span>
                  ) : null}
                </span>
                <ChevronRight className="size-4 shrink-0 text-black/40" aria-hidden />
              </SketchRow>
            </Link>
          ))}
        </SketchBox>
      </section>

      <p className="mt-6 text-[12px] text-black/50">
        Need something custom? Use{" "}
        <Link href={`${routePrefix}/agent-builder`} className="text-black underline underline-offset-2">
          AI Builder
        </Link>{" "}
        instead.
      </p>
    </div>
  );
}
