import { AgentSkillsView } from "@/components/qlix/skills/AgentSkillsView";

export default async function OrganizationAgentSkillsPage({
  params,
}: {
  readonly params: Promise<{ agentId: string }>;
}) {
  const { agentId } = await params;
  return <AgentSkillsView routePrefix="/organization" agentId={agentId} />;
}

