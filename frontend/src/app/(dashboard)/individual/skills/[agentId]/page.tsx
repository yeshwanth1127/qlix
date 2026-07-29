import { AgentSkillsView } from "@/components/qlix/skills/AgentSkillsView";

export default async function IndividualAgentSkillsPage({
  params,
}: {
  readonly params: Promise<{ agentId: string }>;
}) {
  const { agentId } = await params;
  return <AgentSkillsView routePrefix="/individual" agentId={agentId} />;
}

