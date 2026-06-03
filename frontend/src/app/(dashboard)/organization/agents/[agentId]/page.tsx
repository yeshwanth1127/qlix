import { AgentDetailView } from "@/components/qlix/agents/AgentDetailView";

interface AgentDetailPageProps {
  params: Promise<{ agentId: string }>;
}

export default async function OrganizationAgentDetailPage({ params }: AgentDetailPageProps) {
  const { agentId } = await params;
  return <AgentDetailView agentId={agentId} routePrefix="/organization" />;
}
