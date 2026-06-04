"use client";

import { useSession } from "@/components/qlix/session-context";
import { NLAgentBuilderPage } from "@/components/qlix/agents/nl/NLAgentBuilderPage";

export default function IndividualAgentBuilderPage() {
  const { session } = useSession();
  const deviceVerified = session?.user.deviceVerified === true;
  return <NLAgentBuilderPage orgId={null} deviceVerified={deviceVerified} />;
}
