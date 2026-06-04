"use client";

import { useSession } from "@/components/qlix/session-context";
import { NLAgentBuilderPage } from "@/components/qlix/agents/nl/NLAgentBuilderPage";

export default function OrganizationAgentBuilderPage() {
  const { session } = useSession();
  const orgId = session?.organization.id ?? null;
  const deviceVerified = session?.user.deviceVerified === true;
  return <NLAgentBuilderPage orgId={orgId} deviceVerified={deviceVerified} />;
}
