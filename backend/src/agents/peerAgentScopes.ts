/**
 * Other agents exposed as buildable permission scopes (`agent.ask.<agentId>`).
 *
 * "Agent B is available to agent A" is a capability grant, so it is modelled as a scope rather
 * than as a new relationship table. That choice is what makes the feature cheap: JIT approval,
 * verifiable credentials, audit, team `delegatedScopes`, the scope editor and the Visual Builder
 * palette are all driven off the scope catalog, so they pick this up with no code of their own.
 *
 * Deliberately mirrors `mcpScopeCatalog.ts` — same problem shape (per-target grants over a
 * dynamic, per-org set of targets), so it should look the same.
 */
import { prisma } from '../lib/prisma.js';
import type { AgentRuntime, PermissionScope } from './agents.types.js';
import type { ScopeDef } from './scopeCatalog.js';

const AGENT_ASK_PREFIX = 'agent.ask.';

export function isAgentAskScope(scope: string): boolean {
  return scope.startsWith(AGENT_ASK_PREFIX);
}

export function agentAskScopeFor(agentId: string): PermissionScope {
  return `${AGENT_ASK_PREFIX}${agentId}` as PermissionScope;
}

/** The target agent id inside an `agent.ask.<agentId>` scope, or null if it isn't one. */
export function agentIdFromAskScope(scope: string): string | null {
  if (!isAgentAskScope(scope)) return null;
  const id = scope.slice(AGENT_ASK_PREFIX.length);
  return id.length > 0 ? id : null;
}

/** Every agent the given scope set is allowed to ask. */
export function askableAgentIds(scopes: readonly string[]): string[] {
  const ids = new Set<string>();
  for (const scope of scopes) {
    const id = agentIdFromAskScope(scope);
    if (id) ids.add(id);
  }
  return [...ids];
}

/**
 * Org agents as scope defs, so "Ask <Agent>" is grantable anywhere scopes are.
 *
 * `excludeAgentId` drops the holder itself — an agent asking itself is what the existing nested
 * sub-agent path is for, and offering it here would just be a confusing way to deadlock.
 */
export async function getPeerAgentScopeDefsForOrg(
  orgId: string | null,
  excludeAgentId?: string,
): Promise<ScopeDef[]> {
  if (!orgId) return [];

  const agents = await prisma.agent.findMany({
    where: {
      orgId,
      status: { not: 'revoked' },
      // Only agents that can actually be reached: `local` agents have no backend-dispatchable
      // runner, the same constraint teams enforce in assertCloudAgentInOrg.
      runtime: { in: ['cloud', 'hybrid'] },
      ...(excludeAgentId ? { id: { not: excludeAgentId } } : {}),
    },
    select: { id: true, name: true, description: true },
    orderBy: { name: 'asc' },
  });

  return agents.map((agent) => ({
    id: agentAskScopeFor(agent.id),
    label: `Ask ${agent.name}`,
    description:
      agent.description?.trim()
        ? `Hand work to "${agent.name}" and get its answer back — ${agent.description.trim()}`
        : `Hand work to the "${agent.name}" agent and get its answer back`,
    // Not forced: asking a colleague is not inherently privileged, and the target still enforces
    // its own scopes on whatever it does. Users can still mark it JIT per agent.
    forceJit: false,
    runtimes: ['cloud', 'hybrid'] as AgentRuntime[],
  }));
}
