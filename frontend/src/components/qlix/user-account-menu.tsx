"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LayoutDashboard, Loader2, LogOut, Settings, User } from "lucide-react";
import { postLogout } from "@/lib/auth-api";
import { consoleRoutePrefix } from "@/lib/workspace";
import { cn } from "@/lib/utils/cn";
import { sketchLabel, sketchNavLink } from "./sketch/tokens";
import { useSession } from "./session-context";

type MenuVariant = "chrome" | "individual" | "sidebar";

interface UserAccountMenuProps {
  readonly variant?: MenuVariant;
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
}

export function UserAccountMenu({
  variant = "chrome",
  open: openProp,
  onOpenChange,
}: UserAccountMenuProps) {
  const [openUncontrolled, setOpenUncontrolled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sidebarPanelPos, setSidebarPanelPos] = useState<{ bottom: number; left: number } | null>(
    null,
  );
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const { session, refresh } = useSession();

  const open = openProp ?? openUncontrolled;

  const setOpen = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      const value = typeof next === "function" ? next(open) : next;
      if (openProp === undefined) setOpenUncontrolled(value);
      onOpenChange?.(value);
    },
    [open, onOpenChange, openProp],
  );

  const updateSidebarPanelPos = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    setSidebarPanelPos({
      bottom: window.innerHeight - rect.bottom,
      left: rect.right + 12,
    });
  }, []);

  useLayoutEffect(() => {
    if (variant !== "sidebar" || !open) {
      setSidebarPanelPos(null);
      return;
    }
    updateSidebarPanelPos();
    window.addEventListener("resize", updateSidebarPanelPos);
    window.addEventListener("scroll", updateSidebarPanelPos, true);
    return () => {
      window.removeEventListener("resize", updateSidebarPanelPos);
      window.removeEventListener("scroll", updateSidebarPanelPos, true);
    };
  }, [open, updateSidebarPanelPos, variant]);

  useEffect(() => {
    function onPointerDown(ev: MouseEvent | PointerEvent) {
      const target = ev.target as Node;
      if (wrapRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
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
  }, [setOpen]);

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
        "rounded-md border border-transparent py-1.5 pl-2.5 text-left text-[10px] leading-snug transition-all duration-200",
        open
          ? "border-l-[3px] border-l-[color:var(--sketch-purple)] bg-[color:var(--sketch-purple-soft)] font-semibold"
          : "hover:border-black hover:bg-[color:var(--sketch-purple-soft)]",
      )
    : cn(
        "flex size-8 flex-shrink-0 items-center justify-center rounded-full border border-black/15 bg-white/70 text-black backdrop-blur-sm transition-colors hover:border-black hover:bg-black hover:text-white",
      );

  const menuItemClass =
    "flex items-center gap-2 rounded-lg px-2 py-2 text-[12px] text-black transition-colors hover:bg-black/5";

  const signOutClass =
    "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-[12px] text-black transition-colors hover:bg-[var(--sketch-tint-rose)] hover:text-[color:var(--sketch-red)] disabled:opacity-50";

  const panelContent = (
    <>
      <div className="border-b border-black/10 px-1 pb-2">
        <p className="truncate text-[12px] text-black/60">
          {session.user.displayName?.trim() || "No display name"}
        </p>
        <p className="truncate font-mono text-[11px] text-black/45">{session.user.email}</p>
      </div>
      <dl className="space-y-1.5 py-2 text-[12px]">
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
    </>
  );

  const sidebarFlyout =
    open && sidebarPanelPos
      ? createPortal(
          <div
            ref={panelRef}
            role="menu"
            style={{ bottom: sidebarPanelPos.bottom, left: sidebarPanelPos.left }}
            className="sketch-panel-in fixed z-[100] w-56 max-h-[min(70vh,28rem)] overflow-y-auto rounded-2xl border border-black/10 bg-white/92 p-3 shadow-[0_16px_40px_-20px_rgba(16,14,22,0.35)] backdrop-blur-2xl"
          >
            <div className="mb-2.5 flex items-center justify-between border-b border-black/8 pb-2">
              <span className={cn(sketchLabel, "text-[10px]")}>Account</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="sketch-press flex size-7 items-center justify-center rounded-full text-[16px] leading-none text-black/40 transition-colors hover:bg-black/[0.04] hover:text-black"
                aria-label="Close account menu"
              >
                ×
              </button>
            </div>
            {panelContent}
          </div>,
          document.body,
        )
      : null;

  const inlinePanel =
    open && !isSidebar ? (
      <div
        ref={panelRef}
        role="menu"
        className="absolute right-0 z-[100] mt-1 w-[min(280px,calc(100vw-2rem))] rounded-2xl border border-black/10 bg-white/90 p-2 shadow-[0_24px_56px_-24px_rgba(16,14,22,0.35)] backdrop-blur-xl"
      >
        <div className="border-b border-black/10 px-1 pb-2">
          <p className="text-[13px] font-medium text-black">Account</p>
        </div>
        {panelContent}
      </div>
    ) : null;

  return (
    <div ref={wrapRef} className={cn("relative", isSidebar && "w-full")}>
      <button
        ref={triggerRef}
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
      {sidebarFlyout}
      {inlinePanel}
    </div>
  );
}
