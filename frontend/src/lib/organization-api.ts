const defaultBase = "http://localhost:4000";

function apiBase(): string {
  return (process.env.NEXT_PUBLIC_API_BASE_URL ?? defaultBase).replace(/\/$/, "");
}

export interface OrgMemberRow {
  readonly id: string;
  readonly email: string;
  readonly displayName: string | null;
  readonly role: string;
  readonly isActive: boolean;
  readonly createdAt: string;
}

export interface OrgInvitationRow {
  readonly id: string;
  readonly email: string;
  readonly role: string;
  readonly expiresAt: string;
  readonly createdAt: string;
  readonly invitedByUserId: string;
}

export interface OrganizationMembersResponse {
  readonly members: OrgMemberRow[];
  readonly invitations: OrgInvitationRow[];
}

export async function getOrganizationMembers(): Promise<OrganizationMembersResponse | null> {
  const response = await fetch(`${apiBase()}/api/v1/organization/members`, {
    credentials: "include",
  });
  if (response.status === 401 || response.status === 403) return null;
  if (!response.ok) return null;
  return response.json() as Promise<OrganizationMembersResponse>;
}

export async function createOrganizationInvitation(input: {
  email: string;
  role: "admin" | "member";
}): Promise<
  | { ok: true; inviteToken: string; invitation: { id: string; email: string; role: string; expiresAt: string } }
  | { ok: false; message: string }
> {
  const response = await fetch(`${apiBase()}/api/v1/organization/invitations`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = (await response.json().catch(() => null)) as {
    inviteToken?: string;
    invitation?: { id: string; email: string; role: string; expiresAt: string };
    error?: { message?: string };
  } | null;
  if (!response.ok) {
    return { ok: false, message: body?.error?.message ?? "Failed to create invitation" };
  }
  if (!body?.inviteToken || !body.invitation) {
    return { ok: false, message: "Invalid response" };
  }
  return { ok: true, inviteToken: body.inviteToken, invitation: body.invitation };
}

export async function revokeOrganizationInvitation(id: string): Promise<boolean> {
  const response = await fetch(`${apiBase()}/api/v1/organization/invitations/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  return response.ok;
}

export async function updateOrganizationMemberRole(
  userId: string,
  role: "admin" | "member",
): Promise<{ ok: boolean; message?: string }> {
  const response = await fetch(`${apiBase()}/api/v1/organization/members/${userId}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  });
  const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
  if (!response.ok) {
    return { ok: false, message: body?.error?.message ?? "Failed to update role" };
  }
  return { ok: true };
}

export async function deactivateOrganizationMember(userId: string): Promise<{ ok: boolean; message?: string }> {
  const response = await fetch(`${apiBase()}/api/v1/organization/members/${userId}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (response.status === 204) return { ok: true };
  const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
  return { ok: false, message: body?.error?.message ?? "Failed to remove member" };
}
