import { z } from 'zod';
import { ALL_PERMISSION_SCOPES } from './scopeCatalog.js';
import type { PermissionScope } from './agents.types.js';

const BUILTIN_SET = new Set<string>(ALL_PERMISSION_SCOPES);

/** `mcp.<server-slug>.<tool>` or `mcp.<server-slug>.*` */
const MCP_SCOPE_RE = /^mcp\.[a-z0-9-]+(\.[a-z0-9_*_-]+)+$/;

export function isMcpPermissionScope(id: string): boolean {
  return MCP_SCOPE_RE.test(id);
}

export function isValidPermissionScope(id: string): id is PermissionScope {
  if (BUILTIN_SET.has(id)) return true;
  return isMcpPermissionScope(id);
}

/** Zod schema for API bodies — builtin catalog scopes plus dynamic MCP tool scopes. */
export const permissionScopeSchema = z
  .string()
  .refine(isValidPermissionScope, { message: 'Invalid permission scope' });

export const permissionScopesArraySchema = z.array(permissionScopeSchema).min(1).max(64);
