"use client";

import Link from "next/link";
import type { AiEmployeeRole } from "@/lib/ai-employees";
import { SketchBox, SketchPageHeader } from "@/components/qlix/sketch";

export function AiEmployeeRolePlaceholderView({
  routePrefix,
  role,
}: {
  readonly routePrefix: "/individual" | "/organization";
  readonly role: AiEmployeeRole;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <SketchPageHeader title={role.label} />
      <p className="mb-4 font-serif text-[11px] uppercase tracking-widest text-black/50">
        <Link
          href={`${routePrefix}/ai-employees`}
          className="text-black/50 transition-colors hover:text-black/80"
        >
          ← AI Employees
        </Link>
      </p>
      <SketchBox className="flex flex-col gap-3 p-5">
        <p className="text-[13px] leading-relaxed text-black/70">
          The {role.label} AI employee is coming soon. You&apos;ll be able to
          hire and configure this role agent from here.
        </p>
      </SketchBox>
    </div>
  );
}
