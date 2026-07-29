import { AgentsService } from '../agents/agents.service.js';
import { McpRepository } from '../mcp/mcp.repository.js';
import { mcpService } from '../mcp/mcp.service.js';
import { prisma } from '../lib/prisma.js';
import { ensureQlixJobsMcpForOrg } from './ensureQlixJobsMcp.js';
import type { PermissionScope } from '../agents/agents.types.js';

const DEFAULT_MODEL = 'openrouter/openai/gpt-4o-mini';

const APPLY_SCOPES: PermissionScope[] = [
  'web.read',
  'web.click',
  'web.transaction',
] as PermissionScope[];

const JOBS_TOOLS = [
  'upsert_candidate_profile',
  'stage_resume',
  'search_jobs',
  'queue_applications',
  'list_applications',
  'get_apply_brief',
  'record_application_result',
] as const;

/**
 * Provision a cloud Job Apply Copilot agent with browser + qlix-jobs MCP scopes.
 */
export async function createJobApplyAgent(params: {
  orgId: string;
  userId: string;
  name?: string;
}): Promise<{ agentId: string; name: string }> {
  await ensureQlixJobsMcpForOrg(params.orgId, params.userId);

  const mcpServer = await prisma.mcpServer.findUnique({
    where: { orgId_slug: { orgId: params.orgId, slug: 'qlix-jobs' } },
    select: { id: true },
  });

  const agentsService = new AgentsService();
  const mcpRepo = new McpRepository();

  const result = await agentsService.createAgent(params.userId, {
    orgId: params.orgId,
    name: params.name ?? 'Job Apply Copilot',
    description:
      'Fills Greenhouse / Lever / Ashby apply forms from your candidate profile. Always waits for JIT approval before submit.',
    runtime: 'cloud',
    model: DEFAULT_MODEL,
    llmMode: 'proxy',
    localInferenceMode: null,
    permissionScopes: APPLY_SCOPES,
    jitScopes: ['web.transaction'],
  });

  if (mcpServer) {
    await mcpRepo.upsertBinding({
      agentId: result.agent.id,
      mcpServerId: mcpServer.id,
      allowedTools: [...JOBS_TOOLS],
    });
    await mcpService.syncAgentScopes(result.agent.id);
  }

  return { agentId: result.agent.id, name: result.agent.name };
}
