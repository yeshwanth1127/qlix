/**
 * Backfill always-on scopes (brain.query) onto existing standard agents.
 * Runs once at boot after first-party MCP servers are registered.
 */
import { prisma } from '../lib/prisma.js';
import { enforceJitRules } from './jit.js';
import { wireAgentMcpFromScopes } from './agentMcpWire.js';
import {
  missingDefaultAgentScopes,
  withDefaultAgentScopes,
} from './defaultAgentScopes.js';
import type { PermissionScope } from './agents.types.js';

export async function ensureDefaultAgentScopesAllAgents(): Promise<void> {
  const agents = await prisma.agent.findMany({
    where: {
      agentKind: 'standard',
    },
    select: {
      id: true,
      userId: true,
      orgId: true,
      permissionScopes: true,
      jitScopes: true,
    },
  });

  let updated = 0;
  for (const agent of agents) {
    const missing = missingDefaultAgentScopes(agent.permissionScopes);
    if (missing.length === 0) continue;

    const permissionScopes = withDefaultAgentScopes(agent.permissionScopes);
    const jitFiltered = (agent.jitScopes as PermissionScope[]).filter((s) =>
      permissionScopes.includes(s),
    );
    const { jitScopes, alwaysScopes } = enforceJitRules(permissionScopes, jitFiltered);

    // Persist non-MCP + brain.query; MCP tools are re-synced from bindings below.
    const nonMcpPermission = permissionScopes.filter((s) => !s.startsWith('mcp.'));
    const nonMcpJit = jitScopes.filter((s) => !s.startsWith('mcp.'));
    const nonMcpAlways = alwaysScopes.filter((s) => !s.startsWith('mcp.'));

    await prisma.agent.update({
      where: { id: agent.id },
      data: {
        permissionScopes: nonMcpPermission,
        jitScopes: nonMcpJit,
        alwaysScopes: nonMcpAlways,
      },
    });

    await wireAgentMcpFromScopes({
      userId: agent.userId,
      orgId: agent.orgId,
      agentId: agent.id,
      scopes: permissionScopes,
    });

    updated += 1;
  }

  console.info(
    `[default-scopes] backfilled brain.query on ${updated}/${agents.length} standard agent(s)`,
  );
}
