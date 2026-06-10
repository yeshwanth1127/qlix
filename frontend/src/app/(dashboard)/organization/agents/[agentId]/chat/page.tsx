import { AgentChatPage } from "@/components/qlix/agents/AgentChatPage";

interface AgentChatRouteProps {
  params: Promise<{ agentId: string }>;
}

export default async function OrganizationAgentChatPage({ params }: AgentChatRouteProps) {
  const { agentId } = await params;
  return <AgentChatPage agentId={agentId} routePrefix="/organization" />;
}
