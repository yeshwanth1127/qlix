"use client";

import { useState } from "react";
import { postChangePassword, postLogout } from "@/lib/auth-api";
import { useSession } from "./session-context";
import {
  SketchBox,
  SketchPageHeader,
  SketchRow,
  SketchSection,
  sketchButtonDanger,
  sketchButtonPrimary,
  sketchInput,
  sketchLabel,
} from "./sketch";

export function SettingsView() {
  const { session } = useSession();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function onChangePassword(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSuccess(false);

    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New password and confirmation don't match.");
      return;
    }

    setSaving(true);
    try {
      const result = await postChangePassword({ currentPassword, newPassword });
      if (!result.ok) {
        setError(result.errorMessage ?? "Could not change password.");
        return;
      }
      setSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-6 overflow-auto pb-6">
      <SketchPageHeader title="Settings" />

      <SketchSection title="Profile">
        <SketchBox className="flex flex-col gap-3 p-4">
          <SketchRow className="flex items-center justify-between">
            <span className={sketchLabel}>Email</span>
            <span className="text-[13px] text-black">{session?.user.email ?? "—"}</span>
          </SketchRow>
          <SketchRow className="flex items-center justify-between">
            <span className={sketchLabel}>Display name</span>
            <span className="text-[13px] text-black">{session?.user.displayName ?? "—"}</span>
          </SketchRow>
          <SketchRow className="flex items-center justify-between">
            <span className={sketchLabel}>Workspace</span>
            <span className="text-[13px] text-black">{session?.organization.name ?? "—"}</span>
          </SketchRow>
          <SketchRow className="flex items-center justify-between">
            <span className={sketchLabel}>Role</span>
            <span className="text-[13px] capitalize text-black">{session?.user.role ?? "—"}</span>
          </SketchRow>
        </SketchBox>
      </SketchSection>

      <SketchSection title="Password">
        <SketchBox className="p-4">
          <form onSubmit={onChangePassword} className="flex flex-col gap-3">
            {error ? <p className="text-[13px] text-[color:var(--sketch-red)]">{error}</p> : null}
            {success ? <p className="text-[13px] text-black">Password changed.</p> : null}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="currentPassword" className={sketchLabel}>
                Current password
              </label>
              <input
                id="currentPassword"
                type="password"
                autoComplete="current-password"
                required
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                className={sketchInput}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="newPassword" className={sketchLabel}>
                New password
              </label>
              <input
                id="newPassword"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                className={sketchInput}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="confirmPassword" className={sketchLabel}>
                Confirm new password
              </label>
              <input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                className={sketchInput}
              />
            </div>
            <button type="submit" disabled={saving} className={`${sketchButtonPrimary} self-start`}>
              {saving ? "Saving…" : "Change password"}
            </button>
          </form>
        </SketchBox>
      </SketchSection>

      <SketchSection title="Account">
        <SketchBox className="flex items-center justify-between p-4">
          <p className="text-[13px] text-black/60">Sign out of Qlix on this device.</p>
          <button type="button" onClick={() => void postLogout().then(() => window.location.assign("/"))} className={sketchButtonDanger}>
            Sign out
          </button>
        </SketchBox>
      </SketchSection>
    </div>
  );
}
