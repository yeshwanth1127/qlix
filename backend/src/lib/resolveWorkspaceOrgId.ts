import type { Request } from 'express';

/**
 * Workspace org for writes. Every API key is stored with the creating user's org
 * (`api_keys.org_id`) and `request.auth.orgId` is filled from that. Callers with a
 * key do not pass `orgId`.
 *
 * Session (console) may still send `orgId: null` for individual-workspace agent rows,
 * or omit the field to use the signed-in org.
 */
export function resolveWorkspaceOrgId(request: Request, explicit?: string | null): string | null {
  const bound = request.auth?.orgId?.trim() ? request.auth.orgId : null;
  if (request.auth?.authMethod === 'api_key') {
    return bound;
  }
  if (explicit !== undefined) return explicit;
  return bound;
}
