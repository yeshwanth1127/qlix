"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { LayoutDashboard, Loader2, LogOut, Settings, User } from "lucide-react";
import { postLogout } from "@/lib/auth-api";
import { consoleRoutePrefix } from "@/lib/workspace";
import { cn } from "@/lib/utils/cn";
import { useSession } from "./session-context";

type MenuVariant = "chrome" | "individual";

interface UserAccountMenuProps {
  readonly variant?: MenuVariant;
}

export function UserAccountMenu({ variant = "chrome" }: UserAccountMenuProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const { session, refresh } = useSession();

  useEffect(() => {
    function onPointerDown(ev: MouseEvent | PointerEvent) {
      if (!wrapRef.current?.contains(ev.target as Node)) {
        setOpen(false);
      }
    }
    function onEscape(ev: KeyboardEvent) {
      if (ev.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onEscape);
    };
  }, []);

  async function logout() {
    setBusy(true);
    try {
      await postLogout();
      await refresh();
      router.push("/sign-in");
      router.refresh();
    } finally {
      setBusy(false);
      setOpen(false);
    }
  }

  if (!session) return null;

  const kind = session.user.workspaceKind ?? session.organization.workspaceKind;
  const prefix = consoleRoutePrefix(kind);
  const settingsHref = `${prefix}/settings`;

  const isChrome = variant === "chrome";

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex size-8 flex-shrink-0 items-center justify-center rounded-full transition-colors",
          isChrome
            ? "qlix-glass-muted text-[--text-secondary] hover:bg-[var(--glass-surface-bg-hover)] hover:text-[--text-primary]"
            : "qlix-glass-muted text-neutral-300 hover:bg-[var(--glass-surface-bg-hover)] hover:text-neutral-100",
        )}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Account menu"
      >
        <User className="size-[18px]" strokeWidth={1.75} aria-hidden />
      </button>

      {open ? (
        <div
          role="menu"
          className="qlix-glass-box absolute right-0 z-[100] mt-1 min-w-[260px] rounded-lg py-2 shadow-xl"
        >
          <div className="border-b border-[--border-subtle] px-3 pb-2 dark:border-neutral-800">
            <p className="text-[13px] font-medium text-[--text-primary] dark:text-neutral-100">Account</p>
            <p className="mt-0.5 truncate text-[12px] text-[--text-secondary] dark:text-neutral-400">
              {session.user.displayName?.trim() || "No display name"}
            </p>
            <p className="truncate font-mono text-[11px] text-[--text-tertiary] dark:text-neutral-500">
              {session.user.email}
            </p>
          </div>
          <dl className="space-y-1.5 px-3 py-2 text-[12px]">
            <div className="flex justify-between gap-4">
              <dt className="text-[--text-tertiary] dark:text-neutral-500">Role</dt>
              <dd className="text-[--text-primary] capitalize dark:text-neutral-300">{session.user.role}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-[--text-tertiary] dark:text-neutral-500">Workspace</dt>
              <dd className="text-[--text-primary] dark:text-neutral-300">
                {kind === "organization" ? "Organization" : "Individual"}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-[--text-tertiary] dark:text-neutral-500">Org</dt>
              <dd className="truncate text-right text-[--text-secondary] dark:text-neutral-400">
                {session.organization.name}
              </dd>
            </div>
          </dl>
          <div
            role="separator"
            className="my-1 border-t border-[--border-subtle] dark:border-neutral-800"
          />
          <Link
            href={settingsHref}
            role="menuitem"
            onClick={() => setOpen(false)}
            className={cn(
              "mx-2 flex items-center gap-2 rounded-md px-2 py-2 text-[13px] transition-colors",
              isChrome
                ? "text-[--text-secondary] hover:bg-[--bg-hover]"
                : "text-neutral-300 hover:bg-neutral-900",
            )}
          >
            <Settings className="size-4 shrink-0 opacity-70" strokeWidth={1.75} aria-hidden />
            Account settings
          </Link>
          {session.user.isSuperAdmin ? (
            <Link
              href="/admin/overview"
              role="menuitem"
              onClick={() => setOpen(false)}
              className={cn(
                "mx-2 flex items-center gap-2 rounded-md px-2 py-2 text-[13px] transition-colors",
                isChrome
                  ? "text-[--text-secondary] hover:bg-[--bg-hover]"
                  : "text-neutral-300 hover:bg-neutral-900",
              )}
            >
              <LayoutDashboard className="size-4 shrink-0 opacity-70" strokeWidth={1.75} aria-hidden />
              Super admin
            </Link>
          ) : null}
          <button
            type="button"
            role="menuitem"
            disabled={busy}
            onClick={() => void logout()}
            className={cn(
              "mx-2 flex w-[calc(100%-1rem)] items-center gap-2 rounded-md px-2 py-2 text-left text-[13px] transition-colors disabled:opacity-50",
              isChrome
                ? "text-[--danger] hover:bg-[--danger-subtle]"
                : "text-red-400 hover:bg-red-950/30",
            )}
          >
            {busy ? (
              <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
            ) : (
              <LogOut className="size-4 shrink-0 opacity-80" strokeWidth={1.75} aria-hidden />
            )}
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
