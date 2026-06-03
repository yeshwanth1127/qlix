/**
 * Org RBAC for UI — keep in sync with backend/src/lib/orgPermissions.ts
 */

export type OrgRole = "owner" | "admin" | "member";

export function normalizeOrgRole(role: string): OrgRole {
  const r = role.toLowerCase();
  if (r === "owner" || r === "admin" || r === "member") return r;
  return "member";
}

export function canSeeOrgSettings(role: string): boolean {
  const r = normalizeOrgRole(role);
  return r === "owner" || r === "admin";
}

export function canManageMembers(role: string): boolean {
  const r = normalizeOrgRole(role);
  return r === "owner" || r === "admin";
}

export function canChangeMemberRoles(role: string): boolean {
  return normalizeOrgRole(role) === "owner" || normalizeOrgRole(role) === "admin";
}

export function canDeactivateMembers(role: string): boolean {
  return normalizeOrgRole(role) === "owner" || normalizeOrgRole(role) === "admin";
}

/** Billing / plan (when routes exist). */
export function canAccessBilling(role: string): boolean {
  return normalizeOrgRole(role) === "owner";
}

export function canDeleteAgent(role: string): boolean {
  const r = normalizeOrgRole(role);
  return r === "owner" || r === "admin";
}

export function canManageBrain(role: string): boolean {
  const r = normalizeOrgRole(role);
  return r === "owner" || r === "admin";
}
