/**
 * Creates a preconfigured lead-gen pipeline team (scrape → qualify → send).
 */
import { AgentsService } from '../agents/agents.service.js';
import { TeamsService } from '../teams/teams.service.js';
import { ensureQlixLeadsMcpForOrg } from './ensureQlixLeadsMcp.js';
import { prisma } from '../lib/prisma.js';
import { McpRepository } from '../mcp/mcp.repository.js';
import { mcpService } from '../mcp/mcp.service.js';

const mcpRepo = new McpRepository();

const DEFAULT_MODEL = 'openrouter/qlix/auto';

export async function createLeadGenPipelineTeam(params: {
  orgId: string;
  userId: string;
  backendBaseUrl: string;
}): Promise<{ id: string; name: string }> {
  await ensureQlixLeadsMcpForOrg(params.orgId, params.userId);

  const mcpServer = await prisma.mcpServer.findUnique({
    where: { orgId_slug: { orgId: params.orgId, slug: 'qlix-leads' } },
    select: { id: true },
  });

  const agentsService = new AgentsService();
  const teamsService = new TeamsService();

  const baseAgent = {
    runtime: 'cloud' as const,
    model: DEFAULT_MODEL,
    llmMode: 'proxy' as const,
    localInferenceMode: null,
    orgId: params.orgId,
  };

  const finderResult = await agentsService.createAgent(params.userId, {
    ...baseAgent,
    name: 'GMB Lead Finder',
    description: 'Searches Google Business Profile and extracts structured leads.',
    permissionScopes: [],
    jitScopes: [],
  });

  const qualifierResult = await agentsService.createAgent(params.userId, {
    ...baseAgent,
    name: 'Lead Qualifier',
    description: 'Enriches scraped leads by visiting business websites with agent-browser to find contact emails.',
    permissionScopes: ['web.read', 'web.click', 'brain.query'],
    jitScopes: [],
  });

  const senderResult = await agentsService.createAgent(params.userId, {
    ...baseAgent,
    name: 'Outreach Sender',
    description: 'Sends personalized outreach emails to qualified leads.',
    permissionScopes: ['email.read', 'email.send'],
    jitScopes: ['email.send'],
  });

  if (mcpServer) {
    for (const agentId of [finderResult.agent.id, senderResult.agent.id]) {
      await mcpRepo.upsertBinding({
        agentId,
        mcpServerId: mcpServer.id,
        allowedTools: ['gmb_search_leads', 'get_campaign', 'list_leads', 'export_leads', 'start_outreach'],
      });
      await mcpService.syncAgentScopes(agentId);
    }
    await mcpRepo.upsertBinding({
      agentId: qualifierResult.agent.id,
      mcpServerId: mcpServer.id,
      allowedTools: ['list_leads', 'get_campaign', 'update_lead_email', 'record_lead_enrichment'],
    });
    await mcpService.syncAgentScopes(qualifierResult.agent.id);
  }

  const team = await teamsService.createTeam(
    params.userId,
    {
      orgId: params.orgId,
      name: 'Lead Gen Pipeline',
      description: 'GMB scrape → qualify → email outreach',
      supervisorAgentId: finderResult.agent.id,
      members: [
        {
          agentId: finderResult.agent.id,
          role: 'Lead finder',
          delegatedScopes: [
            'mcp.qlix-leads.gmb_search_leads',
            'mcp.qlix-leads.list_leads',
          ],
        },
        {
          agentId: qualifierResult.agent.id,
          role: 'Qualifier',
          delegatedScopes: [
            'web.read',
            'web.click',
            'mcp.qlix-leads.list_leads',
            'mcp.qlix-leads.get_campaign',
            'mcp.qlix-leads.update_lead_email',
            'mcp.qlix-leads.record_lead_enrichment',
          ],
        },
        {
          agentId: senderResult.agent.id,
          role: 'Outreach',
          delegatedScopes: ['email.send', 'mcp.qlix-leads.list_leads', 'mcp.qlix-leads.start_outreach'],
        },
      ],
      config: {
        pipelineMode: true,
        autoSequence: false,
        maxParallelWorkers: 1,
      },
    },
    params.backendBaseUrl,
  );

  return { id: team.id, name: team.name };
}
