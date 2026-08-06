import { notFound } from "next/navigation";
import { AiEmployeeHireWizard } from "@/components/qlix/ai-employees/AiEmployeeHireWizard";
import { isAiEmployeeRoleSlug } from "@/lib/ai-employees";

export default async function OrganizationAiEmployeeHirePage({
  params,
}: {
  readonly params: Promise<{ role: string }>;
}) {
  const { role: slug } = await params;
  if (!isAiEmployeeRoleSlug(slug)) notFound();
  return (
    <div className="flex h-full min-h-0 flex-col">
      <AiEmployeeHireWizard routePrefix="/organization" roleSlug={slug} />
    </div>
  );
}
