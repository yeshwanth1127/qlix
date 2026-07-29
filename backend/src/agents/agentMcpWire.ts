/**
 * Wire MCP server bindings after agent creation when planned scopes include mcp.*.
 */
import { ensureQlixLeadsMcpForOrg } from '../leads/ensureQlixLeadsMcp.js';
import { ensureQlixJobsMcpForOrg } from '../jobs/ensureQlixJobsMcp.js';
import { mcpService } from '../mcp/mcp.service.js';
import { isMcpScope } from '../mcp/mcpScopeCatalog.js';
import { prisma } from '../lib/prisma.js';

export async function wireAgentMcpFromScopes(input: {
  userId: string;
  orgId: string | null;
  agentId: string;
  scopes: readonly string[];
}): Promise<void> {
  const { userId, agentId, scopes } = input;
  if (!scopes.some(isMcpScope)) return;

  // Guest/individual agents have agent.orgId = null, but their owning user always
  // belongs to a workspace org that holds the MCP servers (same fallback the email
  // connector uses). Without this, mcp.* scopes are granted but never bound → the
  // agent has the permission but no actual tool, so it can't scrape/list leads.
  let orgId = input.orgId;
  if (!orgId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { orgId: true },
    });
    orgId = user?.orgId ?? null;
  }
  if (!orgId) return;

  if (scopes.some((s) => s.startsWith('mcp.qlix-leads.'))) {
    await ensureQlixLeadsMcpForOrg(orgId, userId);
  }
  if (scopes.some((s) => s.startsWith('mcp.qlix-jobs.'))) {
    await ensureQlixJobsMcpForOrg(orgId, userId);
  }

  await mcpService.applyMcpBindingsFromScopes(agentId, orgId, scopes);
}
