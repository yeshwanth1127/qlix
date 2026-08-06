import type { PermissionScope } from './agents.types.js';

/**
 * `lean` keeps every granted scope but drops rarely-used management tools (create a
 * channel, bulk CRM ops) from the schema sent each round. Unlike `minimal`/`coding`
 * it is not a scope filter, so it never changes what the agent is permitted to do —
 * only what it is shown by default. Applied in the SDK's tool_budget module.
 */
export type ToolProfile = 'minimal' | 'coding' | 'lean' | 'full';

const MINIMAL_SCOPES: ReadonlySet<string> = new Set([
  'web.read',
  'web.research',
  'brain.query',
  'brain.knowledge_read',
]);

const CODING_SCOPES: ReadonlySet<string> = new Set([
  ...MINIMAL_SCOPES,
  'web.click',
  'system.file_read',
  'system.file_write',
]);

/**
 * Filter granted scopes by OpenClaw-style tool profile.
 * `full` returns the input unchanged.
 */
export function filterScopesByToolProfile(
  scopes: PermissionScope[],
  profile: ToolProfile | string | null | undefined,
): PermissionScope[] {
  const p = (profile ?? 'full').toLowerCase() as ToolProfile;
  // `lean` narrows the tool schema, not the permission set — see the type doc above.
  if (p === 'full' || p === 'lean') return scopes;
  const allow = p === 'minimal' ? MINIMAL_SCOPES : CODING_SCOPES;
  return scopes.filter((s) => allow.has(s) || s.startsWith('mcp.'));
}

export function isValidToolProfile(value: unknown): value is ToolProfile {
  return value === 'minimal' || value === 'coding' || value === 'lean' || value === 'full';
}
