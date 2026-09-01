"use client";

import { useSession } from "@/components/qlix/session-context";
import { UsagePage } from "@/components/qlix/usage/UsagePage";

export default function OrganizationUsagePage() {
  const { session } = useSession();
  return <UsagePage organizationName={session?.organization.name} />;
}
