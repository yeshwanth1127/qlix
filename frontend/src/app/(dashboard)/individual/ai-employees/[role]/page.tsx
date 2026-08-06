import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AiEmployeeRoleView } from "@/components/qlix/ai-employees/AiEmployeeRoleView";
import { isAiEmployeeRoleSlug } from "@/lib/ai-employees";

function RoleFallback() {
  return <div className="py-8 text-[13px] text-black/50">Loading role…</div>;
}

export default async function IndividualAiEmployeeRolePage({
  params,
}: {
  readonly params: Promise<{ role: string }>;
}) {
  const { role: slug } = await params;
  if (!isAiEmployeeRoleSlug(slug)) notFound();
  return (
    <Suspense fallback={<RoleFallback />}>
      <AiEmployeeRoleView routePrefix="/individual" roleSlug={slug} />
    </Suspense>
  );
}
