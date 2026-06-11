/**
 * MCP registry service: register/discover servers and keep each agent's
 * `mcp.<slug>.<tool>` scopes in sync with its bindings + per-tool governance.
 *
 * Governance reuses the existing scope model:
 *  - a tool is *offered* to the LLM only if its scope is in the agent's permissionScopes
 *    (tool_router intersects granted scopes), and
 *  - it *requires JIT approval* only if its scope is also in jitScopes (enforced by
 *    `/api/v1/actions/start`). So a JIT tool's scope lives in BOTH lists.
 */
import { prisma } from '../lib/prisma.js';
import { discoverHttpServer, McpHttpError } from './mcpHttpClient.js';
import { mcpOAuth } from './mcp.oauth.js';
import { McpRepository } from './mcp.repository.js';
import { scopeFor, wildcardScopeFor } from './mcp.governance.js';
import type { McpGovernance, McpServerDTO } from './mcp.types.js';

export class McpValidationError extends Error {
  readonly code = 'mcp_invalid';
}

const repo = new McpRepository();

export class McpService {
  /** Run discovery against a server and refresh its cached catalog. */
  async discover(orgId: string, serverId: string): Promise<McpServerDTO> {
    const server = await repo.getForOrg(orgId, serverId);
    if (!server) throw new McpValidationError('Server not found');

    if (server.transport === 'stdio') {
      // The backend cannot spawn a process on the user's machine; the agent's hybrid
      // runner discovers and reports the catalog at first connect. Bind with ["*"] meanwhile.
      await repo.setStatus(
        serverId,
        'pending',
        'stdio servers are discovered by the agent hybrid runner at connect time',
      );
      return (await repo.getForOrg(orgId, serverId))!;
    }

    if (!server.endpointUrl) throw new McpValidationError('http server has no endpoint URL');

    // An OAuth server can't be discovered until the account is connected — stay pending quietly.
    if (server.authType === 'oauth' && !server.oauthConnected) {
      await repo.setStatus(serverId, 'pending', 'Connect the OAuth account to discover tools');
      return (await repo.getForOrg(orgId, serverId))!;
    }

    const secret = await repo.loadSecret(serverId);
    // OAuth servers authenticate with a freshly-refreshed bearer token; others use static headers.
    const headers =
      server.authType === 'oauth' ? await mcpOAuth.bearerHeader(serverId) : secret.headers;
    try {
      const result = await discoverHttpServer({ url: server.endpointUrl, headers });
      await repo.upsertCatalog({
        serverId,
        protocolVersion: result.protocolVersion,
        serverInfo: result.serverInfo,
        tools: result.tools,
      });
    } catch (err) {
      const message = err instanceof McpHttpError ? err.message : err instanceof Error ? err.message : 'discovery failed';
      await repo.setStatus(serverId, 'error', message.slice(0, 500));
      throw new McpValidationError(message);
    }

    // The catalog just changed (tools added/removed, governance/risk recomputed). Re-sync
    // every bound agent so their `mcp.<slug>.*` scopes don't go stale — otherwise removed
    // tools keep their grant and newly-added tools are never offered until an unrelated edit.
    const bindings = await prisma.agentMcpBinding.findMany({
      where: { mcpServerId: serverId },
      select: { agentId: true },
    });
    for (const b of bindings) await this.syncAgentScopes(b.agentId);

    return (await repo.getForOrg(orgId, serverId))!;
  }

  /**
   * Recompute and persist the agent's `mcp.*` scopes from its current bindings.
   * Non-MCP scopes (web.read, email.send, …) are left untouched.
   */
  async syncAgentScopes(agentId: string): Promise<void> {
    const bindings = await prisma.agentMcpBinding.findMany({
      where: { agentId },
      include: { server: { include: { tools: true } } },
    });

    const permission = new Set<string>();
    const jit = new Set<string>();

    for (const binding of bindings) {
      const server = binding.server;
      if (!server.enabled || server.status === 'revoked') continue;
      const slug = server.slug;
      const allowAll = binding.allowedTools.includes('*');
      const knownTools = new Map(server.tools.map((t) => [t.name, t]));

      if (allowAll && server.tools.length === 0) {
        // Catalog not yet known (stdio pre-discovery): allow all, require approval by default.
        permission.add(wildcardScopeFor(slug));
        jit.add(wildcardScopeFor(slug));
        continue;
      }

      const toolNames = allowAll ? server.tools.map((t) => t.name) : binding.allowedTools;
      for (const name of toolNames) {
        const tool = knownTools.get(name);
        const governance: McpGovernance = (tool?.defaultGovernance as McpGovernance) ?? 'jit';
        if (governance === 'blocked') continue;
        permission.add(scopeFor(slug, name));
        if (governance === 'jit') jit.add(scopeFor(slug, name));
      }
    }

    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      select: { permissionScopes: true, jitScopes: true },
    });
    if (!agent) return;

    const isMcp = (s: string) => s.startsWith('mcp.');
    const nextPermission = [...agent.permissionScopes.filter((s) => !isMcp(s)), ...permission];
    const nextJit = [...agent.jitScopes.filter((s) => !isMcp(s)), ...jit];

    await prisma.agent.update({
      where: { id: agentId },
      data: {
        permissionScopes: Array.from(new Set(nextPermission)),
        jitScopes: Array.from(new Set(nextJit)),
      },
    });
  }
}

export const mcpService = new McpService();
export const mcpRepository = repo;
