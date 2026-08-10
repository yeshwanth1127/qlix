/**
 * Scopes every standard agent receives regardless of NL intent, role pack, or
 * operator-selected scopes. Applied at create/update and backfilled on boot.
 */
import type { PermissionScope } from './agents.types.js';

export const DEFAULT_SCHEDULE_SCOPES = [
  'mcp.qlix-schedule.schedule_create',
  'mcp.qlix-schedule.schedule_list',
  'mcp.qlix-schedule.schedule_get',
  'mcp.qlix-schedule.schedule_update',
  'mcp.qlix-schedule.schedule_cancel',
] as const satisfies readonly PermissionScope[];

/** Always-on defaults: org brain access + schedule MCP tools. */
export const DEFAULT_AGENT_SCOPES = [
  'brain.query',
  ...DEFAULT_SCHEDULE_SCOPES,
] as const satisfies readonly PermissionScope[];

/** Merge always-on defaults into a scope list (order: existing first, then missing defaults). */
export function withDefaultAgentScopes(
  scopes: readonly string[],
): PermissionScope[] {
  const out: PermissionScope[] = [];
  const seen = new Set<string>();
  for (const s of scopes) {
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s as PermissionScope);
  }
  for (const s of DEFAULT_AGENT_SCOPES) {
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

export function missingDefaultAgentScopes(scopes: readonly string[]): PermissionScope[] {
  const have = new Set(scopes);
  return DEFAULT_AGENT_SCOPES.filter((s) => !have.has(s));
}
