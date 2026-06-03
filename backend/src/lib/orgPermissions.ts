/**
 * Organization RBAC — mirrors product rules (owner / admin / member).
 * Keep in sync with frontend/src/lib/org-permissions.ts
 */

export const ORG_ROLES = ['owner', 'admin', 'member'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export const INVITE_ROLES = ['admin', 'member'] as const;
export type InviteRole = (typeof INVITE_ROLES)[number];

export type OrgAction =
  | 'list_members'
  | 'manage_invitations'
  | 'change_member_roles'
  | 'deactivate_members'
  | 'org_settings'
  | 'billing'
  | 'delete_agent'
  | 'manage_brain';

const OWNER_ACTIONS: ReadonlySet<OrgAction> = new Set([
  'list_members',
  'manage_invitations',
  'change_member_roles',
  'deactivate_members',
  'org_settings',
  'billing',
  'delete_agent',
  'manage_brain',
]);

/** Admin: like owner except billing and org settings / danger zone. */
const ADMIN_ACTIONS: ReadonlySet<OrgAction> = new Set([
  'list_members',
  'manage_invitations',
  'change_member_roles',
  'deactivate_members',
  'delete_agent',
  'manage_brain',
]);

const MEMBER_ACTIONS: ReadonlySet<OrgAction> = new Set(['list_members']);

export function normalizeOrgRole(role: string): OrgRole {
  const r = role.toLowerCase();
  if (r === 'owner' || r === 'admin' || r === 'member') return r;
  return 'member';
}

export function roleCan(role: string, action: OrgAction): boolean {
  const r = normalizeOrgRole(role);
  if (r === 'owner') return OWNER_ACTIONS.has(action);
  if (r === 'admin') return ADMIN_ACTIONS.has(action);
  return MEMBER_ACTIONS.has(action);
}

export function isInviteRole(value: string): value is InviteRole {
  return value === 'admin' || value === 'member';
}
