import { AgentSkillsPlaceholderView } from "@/components/qlix/skills/AgentSkillsPlaceholderView";

export default async function IndividualAgentSkillsPage({
  params,
}: {
  readonly params: Promise<{ agentId: string }>;
}) {
  const { agentId } = await params;
  return <AgentSkillsPlaceholderView routePrefix="/individual" agentId={agentId} />;
}

