"use client";

import { useCallback, useEffect, useState } from "react";
import {
  SketchBox,
  SketchPageHeader,
  SketchRow,
  SketchSection,
  sketchButton,
  sketchInput,
  sketchLabel,
} from "./sketch";
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

const selectClass = `${sketchInput} h-9 w-auto px-2 py-0`;

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
        <SketchPageHeader title="Members" />
        <p className="-mt-4 max-w-2xl text-[13px] leading-relaxed text-black/60">
          Invite teammates, assign roles, and control access. Members cannot change org settings or billing.
        </p>
      </div>

      {error ? (
        <SketchBox className="px-3 py-2">
          <p className="text-[13px] text-black">{error}</p>
        </SketchBox>
      ) : null}

      {canManageMembers(role) ? (
        <SketchSection title="Invite Member">
          <SketchBox className="p-5">
            <form onSubmit={onInvite} className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="min-w-0 flex-1 space-y-1">
                <label htmlFor="invite-email" className={sketchLabel}>
                  Email
                </label>
                <input
                  id="invite-email"
                  type="email"
                  required
                  value={inviteEmail}
                  onChange={(ev) => setInviteEmail(ev.target.value)}
                  className={`${sketchInput} h-9 py-0`}
                  placeholder="colleague@company.com"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="invite-role" className={sketchLabel}>
                  Role
                </label>
                <select
                  id="invite-role"
                  value={inviteRole}
                  onChange={(ev) => setInviteRole(ev.target.value as "admin" | "member")}
                  className={selectClass}
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <button type="submit" disabled={inviteBusy} className={`${sketchButton} h-9 shrink-0`}>
                {inviteBusy ? "Sending…" : "Create invite"}
              </button>
            </form>
            {inviteMessage ? <p className="mt-3 text-[12px] text-black/60">{inviteMessage}</p> : null}
            {inviteLink ? (
              <div className="mt-2">
                <p className={sketchLabel}>Sign-up link (copy once)</p>
                <code className="mt-1 block break-all border border-black bg-white p-2 text-[11px] text-black/60">
                  {inviteLink}
                </code>
              </div>
            ) : null}
          </SketchBox>
        </SketchSection>
      ) : null}

      <SketchSection title="Pending Invitations">
        <SketchBox className="overflow-hidden">
          {loading ? (
            <p className="p-4 text-[13px] text-black/50">Loading…</p>
          ) : invitations.length === 0 ? (
            <p className="p-4 font-serif text-[11px] uppercase tracking-widest text-black/50">
              No pending invitations.
            </p>
          ) : (
            <ul className="flex flex-col">
              {invitations.map((inv) => (
                <SketchRow key={inv.id} as="li" className="flex flex-wrap items-center justify-between gap-2 border-t-0 border-b border-black last:border-b-0">
                  <div>
                    <p className="text-[13px] text-black">{inv.email}</p>
                    <p className="text-[12px] text-black/50">
                      Role: {inv.role} · Expires {new Date(inv.expiresAt).toLocaleString()}
                    </p>
                  </div>
                  {canManageMembers(role) ? (
                    <button
                      type="button"
                      onClick={() => void onRevokeInvite(inv.id)}
                      className={sketchButton}
                    >
                      Revoke
                    </button>
                  ) : null}
                </SketchRow>
              ))}
            </ul>
          )}
        </SketchBox>
      </SketchSection>

      <SketchSection title="People">
        <SketchBox className="overflow-hidden">
          {loading ? (
            <p className="p-4 text-[13px] text-black/50">Loading…</p>
          ) : (
            <>
            <div className="divide-y divide-black/15 md:hidden">
              {members.map((m) => {
                const canEditRole =
                  canChangeMemberRoles(role) &&
                  m.id !== selfId &&
                  normalizeOrgRole(m.role) !== "owner" &&
                  !(normalizeOrgRole(role) === "admin" && normalizeOrgRole(m.role) === "admin");
                const canRemove =
                  canDeactivateMembers(role) &&
                  m.id !== selfId &&
                  normalizeOrgRole(m.role) !== "owner" &&
                  !(normalizeOrgRole(role) === "admin" && normalizeOrgRole(m.role) === "admin");
                return (
                  <div key={m.id} className="space-y-3 px-3 py-3">
                    <div className="flex items-center gap-3">
                      <div
                        className="flex size-8 shrink-0 items-center justify-center border border-black text-[11px] font-medium text-black/60"
                        aria-hidden
                      >
                        {initials(m.displayName, m.email)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium text-black">
                          {m.displayName?.trim() || m.email}
                        </div>
                        <div className="truncate text-[12px] text-black/50">{m.email}</div>
                      </div>
                      <span className="shrink-0 font-serif text-[10px] uppercase text-black/50">
                        {m.isActive ? "Active" : "Inactive"}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {normalizeOrgRole(m.role) === "owner" ? (
                        <span className={sketchLabel}>Owner</span>
                      ) : canEditRole ? (
                        <select
                          value={m.role === "admin" ? "admin" : "member"}
                          onChange={(ev) =>
                            void onChangeRole(m.id, ev.target.value as "admin" | "member")
                          }
                          className={`${sketchInput} h-auto w-auto px-2 py-1 text-[12px]`}
                        >
                          <option value="member">Member</option>
                          <option value="admin">Admin</option>
                        </select>
                      ) : (
                        <span className="font-serif text-[11px] uppercase text-black/60">{m.role}</span>
                      )}
                      {canRemove ? (
                        <button
                          type="button"
                          onClick={() => void onDeactivate(m.id)}
                          className={sketchButton}
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-left text-[13px]">
                <thead>
                  <tr className="border-b border-black">
                    <th className={`px-4 py-2 ${sketchLabel}`}>User</th>
                    <th className={`px-4 py-2 ${sketchLabel}`}>Role</th>
                    <th className={`px-4 py-2 ${sketchLabel}`}>Status</th>
                    <th className={`px-4 py-2 ${sketchLabel}`}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => (
                    <tr key={m.id} className="border-b border-black/20 last:border-0">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div
                            className="flex size-8 shrink-0 items-center justify-center border border-black text-[11px] font-medium text-black/60"
                            aria-hidden
                          >
                            {initials(m.displayName, m.email)}
                          </div>
                          <div>
                            <div className="font-medium text-black">
                              {m.displayName?.trim() || m.email}
                            </div>
                            <div className="text-[12px] text-black/50">{m.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {normalizeOrgRole(m.role) === "owner" ? (
                          <span className={sketchLabel}>Owner</span>
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
                            className={`${sketchInput} h-auto px-2 py-1 text-[12px]`}
                          >
                            <option value="member">Member</option>
                            <option value="admin">Admin</option>
                          </select>
                        ) : (
                          <span className="font-serif text-[11px] uppercase text-black/60">{m.role}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-serif text-[11px] uppercase text-black/60">
                          {m.isActive ? "Active" : "Inactive"}
                        </span>
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
                            className={sketchButton}
                          >
                            Remove
                          </button>
                        ) : (
                          <span className="text-[12px] text-black/40">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </>
          )}
        </SketchBox>
      </SketchSection>
    </div>
  );
}
