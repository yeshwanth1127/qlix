import { AgentSkillsPlaceholderView } from "@/components/qlix/skills/AgentSkillsPlaceholderView";

export default async function OrganizationAgentSkillsPage({
  params,
}: {
  readonly params: Promise<{ agentId: string }>;
}) {
  const { agentId } = await params;
  return <AgentSkillsPlaceholderView routePrefix="/organization" agentId={agentId} />;
}

