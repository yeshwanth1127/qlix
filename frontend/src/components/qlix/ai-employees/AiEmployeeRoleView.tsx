"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Loader2, MessageCircle, Sparkles } from "lucide-react";
import {
  getEmployeeRole,
  listEmployeeEngagements,
  type EmployeeEngagementDTO,
  type RoleCatalogEntry,
} from "@/lib/employees-api";
import { isAiEmployeeRoleSlug } from "@/lib/ai-employees";
import {
  SketchBox,
  SketchPageHeader,
  sketchButtonPrimary,
} from "@/components/qlix/sketch";

export function AiEmployeeRoleView({
  routePrefix,
  roleSlug,
}: {
  readonly routePrefix: "/individual" | "/organization";
  readonly roleSlug: string;
}) {
  const searchParams = useSearchParams();
  const hiredId = searchParams.get("hired");
  const [role, setRole] = useState<RoleCatalogEntry | null>(null);
  const [engagements, setEngagements] = useState<EmployeeEngagementDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAiEmployeeRoleSlug(roleSlug)) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [roleRes, all] = await Promise.all([
          getEmployeeRole(roleSlug),
          listEmployeeEngagements(),
        ]);
        if (cancelled) return;
        setRole(roleRes.role);
        setEngagements(all.filter((e) => e.roleSlug === roleSlug));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [roleSlug]);

  if (loading) {
    return (
      <p className="flex items-center gap-2 text-[13px] text-black/50">
        <Loader2 className="size-4 animate-spin" aria-hidden /> Loading…
      </p>
    );
  }

  if (error || !role) {
    return (
      <SketchBox className="p-4">
        <p className="text-[13px] text-black">{error ?? "Role not found"}</p>
      </SketchBox>
    );
  }

  const justHired = hiredId ? engagements.find((e) => e.id === hiredId) : null;

  return (
    <div className="max-w-2xl">
      <SketchPageHeader title={role.label} />
      <p className="mb-4 font-serif text-[11px] uppercase tracking-widest text-black/50">
        <Link href={`${routePrefix}/ai-employees`} className="hover:text-black/80">
          ← AI Employees
        </Link>
      </p>

      {justHired ? (
        <SketchBox className="mb-4 space-y-3 border-green-600/30 bg-green-50/80 p-5">
          <p className="text-[13px] font-medium text-black">{justHired.agent.name} is on your team.</p>
          <div className="flex flex-wrap gap-2">
            <Link
              href={`${routePrefix}/agents/${justHired.agent.id}/chat`}
              className={`${sketchButtonPrimary} inline-flex items-center gap-1.5`}
            >
              <MessageCircle className="size-3.5" aria-hidden />
              Open chat
            </Link>
            <Link href={`${routePrefix}/agents/${justHired.agent.id}`} className={sketchButtonPrimary}>
              Agent details
            </Link>
          </div>
        </SketchBox>
      ) : null}

      <SketchBox className="mb-4 space-y-3 p-5">
        <p className="text-[13px] leading-relaxed text-black/70">{role.mission}</p>
        <ul className="space-y-2">
          {role.outcomes.map((o) => (
            <li key={o.id} className="text-[12px]">
              <span className="font-medium text-black">{o.title}</span>
              <p className="text-black/55">{o.doneLooksLike}</p>
            </li>
          ))}
        </ul>
        {role.limitationSummary ? (
          <p className="text-[12px] text-amber-900">{role.limitationSummary}</p>
        ) : null}
      </SketchBox>

      {engagements.length > 0 ? (
        <section className="mb-4">
          <h2 className="mb-2 font-serif text-[11px] uppercase tracking-widest text-black/50">Hired</h2>
          <SketchBox className="flex flex-col gap-2 p-3">
            {engagements.map((e) => (
              <Link
                key={e.id}
                href={`${routePrefix}/agents/${e.agent.id}`}
                className="text-[13px] text-black hover:underline"
              >
                {e.agent.name} · {e.status}
              </Link>
            ))}
          </SketchBox>
        </section>
      ) : null}

      {role.hireable ? (
        <Link
          href={`${routePrefix}/ai-employees/${roleSlug}/hire`}
          className={`${sketchButtonPrimary} inline-flex items-center gap-2`}
        >
          <Sparkles className="size-4" aria-hidden />
          Hire {role.label}
        </Link>
      ) : (
        <p className="text-[13px] text-black/60">Enable required capabilities in Skills to hire this role.</p>
      )}
    </div>
  );
}
