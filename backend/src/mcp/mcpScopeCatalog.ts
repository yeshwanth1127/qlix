/**
 * MCP tools exposed as buildable permission scopes (`mcp.<slug>.<tool>`) for the AI builder.
 */
import { prisma } from '../lib/prisma.js';
import { scopeFor } from './mcp.governance.js';
import type { AgentRuntime, PermissionScope } from '../agents/agents.types.js';
import type { ScopeDef } from '../agents/scopeCatalog.js';

const MCP_SCOPE_PREFIX = 'mcp.';

export function isMcpScope(scope: string): boolean {
  return scope.startsWith(MCP_SCOPE_PREFIX);
}

/** Parse `mcp.<slug>.<tool>` or `mcp.<slug>.*` into binding requests grouped by server slug. */
export function extractMcpBindingRequests(
  scopes: readonly string[],
): Map<string, string[] | '*'> {
  const bySlug = new Map<string, Set<string>>();
  const wildcards = new Set<string>();

  for (const scope of scopes) {
    if (!isMcpScope(scope)) continue;
    const rest = scope.slice(MCP_SCOPE_PREFIX.length);
    const dot = rest.indexOf('.');
    if (dot <= 0) continue;
    const slug = rest.slice(0, dot);
    const tool = rest.slice(dot + 1);
    if (!tool) continue;

    if (tool === '*') {
      wildcards.add(slug);
      bySlug.delete(slug);
      continue;
    }
    if (wildcards.has(slug)) continue;
    if (!bySlug.has(slug)) bySlug.set(slug, new Set());
    bySlug.get(slug)!.add(tool);
  }

  const out = new Map<string, string[] | '*'>();
  for (const slug of wildcards) out.set(slug, '*');
  for (const [slug, tools] of bySlug) {
    if (!wildcards.has(slug)) out.set(slug, Array.from(tools));
  }
  return out;
}

/** Registered MCP server tools as scope defs for NL agent planning. */
export async function getMcpScopeDefsForOrg(orgId: string | null): Promise<ScopeDef[]> {
  if (!orgId) return [];

  const servers = await prisma.mcpServer.findMany({
    where: { orgId, enabled: true, status: { not: 'revoked' } },
    include: { tools: true },
    orderBy: { name: 'asc' },
  });

  const defs: ScopeDef[] = [];
  for (const server of servers) {
    for (const tool of server.tools) {
      if (tool.defaultGovernance === 'blocked') continue;
      defs.push({
        id: scopeFor(server.slug, tool.name) as PermissionScope,
        label: `${server.name}: ${tool.name}`,
        description: tool.description || `Call MCP tool "${tool.name}" on ${server.name}`,
        forceJit: tool.defaultGovernance === 'jit',
        runtimes: ['cloud', 'hybrid'] as AgentRuntime[],
      });
    }
  }
  return defs;
}
