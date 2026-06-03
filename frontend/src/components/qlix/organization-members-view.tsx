"use client";

import { useCallback, useEffect, useState } from "react";
import { ReflectiveCard } from "./ReflectiveCard";
import {
  createOrganizationInvitation,
  deactivateOrganizationMember,
  getOrganizationMembers,
  revokeOrganizationInvitation,
  updateOrganizationMemberRole,
  type OrgInvitationRow,
  type OrgMemberRow,
} from "@/lib/organization-api";
import {
  canChangeMemberRoles,
  canDeactivateMembers,
  canManageMembers,
  normalizeOrgRole,
} from "@/lib/org-permissions";
import { postSessionRefresh } from "@/lib/auth-api";
import { useSession } from "./session-context";

function initials(displayName: string | null, email: string): string {
  const s = (displayName?.trim() || email).trim();
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  }
  return s.slice(0, 2).toUpperCase();
}

export function OrganizationMembersView() {
  const { session, refresh } = useSession();
  const role = session?.user.role ?? "member";
  const selfId = session?.user.id;

  const [members, setMembers] = useState<OrgMemberRow[]>([]);
  const [invitations, setInvitations] = useState<OrgInvitationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "member">("member");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [inviteMessage, setInviteMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const data = await getOrganizationMembers();
    if (!data) {
      setError("Could not load members.");
      setMembers([]);
      setInvitations([]);
    } else {
      setMembers(data.members);
      setInvitations(data.invitations);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(t);
  }, [load]);

  async function onInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteMessage(null);
    setInviteToken(null);
    setInviteBusy(true);
    try {
      const res = await createOrganizationInvitation({
        email: inviteEmail.trim().toLowerCase(),
        role: inviteRole,
      });
      if (!res.ok) {
        setInviteMessage(res.message);
        return;
      }
      setInviteToken(res.inviteToken);
      setInviteMessage(
        "Invitation created. Share the sign-up link below (email delivery is not wired yet).",
      );
      setInviteEmail("");
      await load();
    } finally {
      setInviteBusy(false);
    }
  }

  async function onRevokeInvite(id: string) {
    const ok = await revokeOrganizationInvitation(id);
    if (ok) await load();
  }

  async function onChangeRole(userId: string, next: "admin" | "member") {
    const res = await updateOrganizationMemberRole(userId, next);
    if (!res.ok) {
      setError(res.message ?? "Update failed");
      return;
    }
    if (userId === selfId) {
      await postSessionRefresh();
      await refresh();
    }
    await load();
  }

  async function onDeactivate(userId: string) {
    if (!window.confirm("Remove this member from the organization?")) return;
    const res = await deactivateOrganizationMember(userId);
    if (!res.ok) {
      setError(res.message ?? "Remove failed");
      return;
    }
    await load();
  }

  const inviteLink =
    typeof window !== "undefined" && inviteToken
      ? `${window.location.origin}/sign-in?mode=sign-up&workspace=organization&invite=${encodeURIComponent(inviteToken)}`
      : null;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-base font-medium tracking-[-0.01em] text-[--text-primary]">Members</h1>
        <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-[--text-secondary]">
          Invite teammates, assign roles, and control access. Members cannot change org settings or billing.
        </p>
      </div>

      {error ? (
        <p className="rounded border border-[--danger]/30 bg-[--danger-subtle] px-3 py-2 text-[13px] text-[--danger]">
          {error}
        </p>
      ) : null}

      {canManageMembers(role) ? (
        <ReflectiveCard className="rounded" contentClassName="p-5">
          <h2 className="text-[13px] font-medium text-[--text-primary]">Invite member</h2>
          <form onSubmit={onInvite} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1 space-y-1">
              <label htmlFor="invite-email" className="block text-[12px] text-[--text-tertiary]">
                Email
              </label>
              <input
                id="invite-email"
                type="email"
                required
                value={inviteEmail}
                onChange={(ev) => setInviteEmail(ev.target.value)}
                className="qlix-glass-input h-9 w-full rounded px-3 text-[13px] text-[--text-primary] outline-none focus:border-[--border-strong] focus:ring-1 focus:ring-[--accent-border]"
                placeholder="colleague@company.com"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="invite-role" className="block text-[12px] text-[--text-tertiary]">
                Role
              </label>
              <select
                id="invite-role"
                value={inviteRole}
                onChange={(ev) => setInviteRole(ev.target.value as "admin" | "member")}
                className="qlix-glass-input h-9 rounded px-2 text-[13px] text-[--text-primary] outline-none focus:border-[--border-strong]"
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <button
              type="submit"
              disabled={inviteBusy}
              className="h-9 shrink-0 rounded bg-[var(--org-cta-bg)] px-4 text-[13px] font-medium text-[var(--org-cta-fg)] hover:opacity-90 disabled:opacity-50"
            >
              {inviteBusy ? "Sending…" : "Create invite"}
            </button>
          </form>
          {inviteMessage ? <p className="mt-3 text-[12px] text-[--text-secondary]">{inviteMessage}</p> : null}
          {inviteLink ? (
            <div className="mt-2">
              <p className="text-[11px] font-medium uppercase tracking-wider text-[--text-tertiary]">
                Sign-up link (copy once)
              </p>
              <code className="qlix-glass-muted mt-1 block break-all rounded p-2 text-[11px] text-[--text-secondary]">
                {inviteLink}
              </code>
            </div>
          ) : null}
        </ReflectiveCard>
      ) : null}

      <ReflectiveCard className="overflow-hidden rounded">
        <div className="qlix-glass-inset border-b border-[--border-default] px-4 py-3">
          <h2 className="text-[13px] font-medium text-[--text-primary]">Pending invitations</h2>
        </div>
        {loading ? (
          <p className="p-4 text-[13px] text-[--text-tertiary]">Loading…</p>
        ) : invitations.length === 0 ? (
          <p className="p-4 text-[13px] text-[--text-tertiary]">No pending invitations.</p>
        ) : (
          <ul className="divide-y divide-[--border-default]">
            {invitations.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <div>
                  <p className="text-[13px] text-[--text-primary]">{inv.email}</p>
                  <p className="text-[12px] text-[--text-tertiary]">
                    Role: {inv.role} · Expires {new Date(inv.expiresAt).toLocaleString()}
                  </p>
                </div>
                {canManageMembers(role) ? (
                  <button
                    type="button"
                    onClick={() => void onRevokeInvite(inv.id)}
                    className="text-[12px] font-medium text-[--danger] hover:underline"
                  >
                    Revoke
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </ReflectiveCard>

      <ReflectiveCard className="overflow-hidden rounded">
        <div className="qlix-glass-inset border-b border-[--border-default] px-4 py-3">
          <h2 className="text-[13px] font-medium text-[--text-primary]">People</h2>
        </div>
        {loading ? (
          <p className="p-4 text-[13px] text-[--text-tertiary]">Loading…</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-[--border-default] text-[11px] font-medium uppercase tracking-wider text-[--text-tertiary]">
                  <th className="px-4 py-2">User</th>
                  <th className="px-4 py-2">Role</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[--border-default]">
                {members.map((m) => (
                  <tr key={m.id}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div
                          className="qlix-glass-input flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-medium text-[--text-secondary]"
                          aria-hidden
                        >
                          {initials(m.displayName, m.email)}
                        </div>
                        <div>
                          <div className="font-medium text-[--text-primary]">
                            {m.displayName?.trim() || m.email}
                          </div>
                          <div className="text-[12px] text-[--text-tertiary]">{m.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {normalizeOrgRole(m.role) === "owner" ? (
                        <span className="rounded border border-[--accent]/20 bg-[--accent]/5 px-2 py-0.5 text-[10px] font-medium text-[--accent]">
                          Owner
                        </span>
                      ) : canChangeMemberRoles(role) &&
                        m.id !== selfId &&
                        normalizeOrgRole(m.role) !== "owner" &&
                        !(
                          normalizeOrgRole(role) === "admin" && normalizeOrgRole(m.role) === "admin"
                        ) ? (
                        <select
                          value={m.role === "admin" ? "admin" : "member"}
                          onChange={(ev) =>
                            void onChangeRole(m.id, ev.target.value as "admin" | "member")
                          }
                          className="qlix-glass-input rounded px-2 py-1 text-[12px] text-[--text-primary] outline-none focus:border-[--border-strong]"
                        >
                          <option value="member">Member</option>
                          <option value="admin">Admin</option>
                        </select>
                      ) : (
                        <span className="capitalize text-[--text-secondary]">{m.role}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[--text-secondary]">
                      {m.isActive ? "Active" : "Inactive"}
                    </td>
                    <td className="px-4 py-3">
                      {canDeactivateMembers(role) &&
                      m.id !== selfId &&
                      normalizeOrgRole(m.role) !== "owner" &&
                      !(
                        normalizeOrgRole(role) === "admin" && normalizeOrgRole(m.role) === "admin"
                      ) ? (
                        <button
                          type="button"
                          onClick={() => void onDeactivate(m.id)}
                          className="text-[12px] font-medium text-[--danger] hover:underline"
                        >
                          Remove
                        </button>
                      ) : (
                        <span className="text-[12px] text-[--text-tertiary]">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ReflectiveCard>
    </div>
  );
}
