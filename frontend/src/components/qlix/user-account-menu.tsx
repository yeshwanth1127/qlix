"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { LayoutDashboard, Loader2, LogOut, Settings, User } from "lucide-react";
import { postLogout } from "@/lib/auth-api";
import { consoleRoutePrefix } from "@/lib/workspace";
import { cn } from "@/lib/utils/cn";
import { sketchNavLink } from "./sketch/tokens";
import { useSession } from "./session-context";

type MenuVariant = "chrome" | "individual" | "sidebar";

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
  const isSidebar = variant === "sidebar";

  const triggerClass = isSidebar
    ? cn(
        sketchNavLink,
        "rounded-md border-l-2 border-transparent py-1.5 pl-2.5 text-left text-[10px] leading-snug transition-all duration-200",
        open
          ? "border-[color:var(--sketch-purple)] bg-[color:var(--sketch-purple-soft)] font-semibold"
          : "hover:border-[color:var(--sketch-purple)]/45 hover:bg-[color:var(--sketch-purple-soft)]/70 hover:pl-3",
      )
    : cn(
        "flex size-8 flex-shrink-0 items-center justify-center rounded-full border border-black/15 bg-white/70 text-black backdrop-blur-sm transition-colors hover:border-black hover:bg-black hover:text-white",
      );

  const panelClass = isSidebar
    ? "absolute bottom-0 left-full z-[100] ml-2 w-[min(260px,calc(100vw-2rem))] min-w-0 rounded-2xl border border-black/10 bg-white/90 py-2 shadow-[0_24px_56px_-24px_rgba(16,14,22,0.35)] backdrop-blur-xl"
    : "absolute right-0 z-[100] mt-1 w-[min(280px,calc(100vw-2rem))] rounded-2xl border border-black/10 bg-white/90 py-2 shadow-[0_24px_56px_-24px_rgba(16,14,22,0.35)] backdrop-blur-xl";

  const menuItemClass =
    "mx-2 flex items-center gap-2 rounded-lg px-2 py-2 text-[12px] text-black transition-colors hover:bg-black/5";

  const signOutClass =
    "mx-2 flex w-[calc(100%-1rem)] items-center gap-2 rounded-lg px-2 py-2 text-left text-[12px] text-black transition-colors hover:bg-[var(--sketch-tint-rose)] hover:text-[color:var(--sketch-red)] disabled:opacity-50";

  return (
    <div ref={wrapRef} className={cn("relative", isSidebar && "w-full")}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(triggerClass, isSidebar && "w-full")}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Account menu"
      >
        {isSidebar ? (
          "ACCOUNT"
        ) : (
          <User className="size-[18px]" strokeWidth={1.75} aria-hidden />
        )}
      </button>

      {open ? (
        <div role="menu" className={panelClass}>
          <div className="border-b border-black/10 px-3 pb-2">
            <p className="text-[13px] font-medium text-black">Account</p>
            <p className="mt-0.5 truncate text-[12px] text-black/60">
              {session.user.displayName?.trim() || "No display name"}
            </p>
            <p className="truncate font-mono text-[11px] text-black/45">{session.user.email}</p>
          </div>
          <dl className="space-y-1.5 px-3 py-2 text-[12px]">
            <div className="flex justify-between gap-4">
              <dt className="text-black/45">Role</dt>
              <dd className="capitalize text-black">{session.user.role}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-black/45">Workspace</dt>
              <dd className="text-black">{kind === "organization" ? "Organization" : "Individual"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-black/45">Org</dt>
              <dd className="truncate text-right text-black/60">{session.organization.name}</dd>
            </div>
          </dl>
          <div role="separator" className="my-1 border-t border-black/10" />
          <Link
            href={settingsHref}
            role="menuitem"
            onClick={() => setOpen(false)}
            className={menuItemClass}
          >
            <Settings className="size-4 shrink-0 opacity-70" strokeWidth={1.75} aria-hidden />
            Account settings
          </Link>
          {session.user.isSuperAdmin ? (
            <Link
              href="/admin/overview"
              role="menuitem"
              onClick={() => setOpen(false)}
              className={menuItemClass}
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
            className={signOutClass}
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
