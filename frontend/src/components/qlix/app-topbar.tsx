"use client";

import Link from "next/link";
import {
  ArrowLeftRight,
  Bell,
  ChevronDown,
  HelpCircle,
  Menu,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { ThemeToggle } from "./theme-toggle";
import { UserAccountMenu } from "./user-account-menu";

interface AppTopbarProps {
  readonly onOpenMobileNav: () => void;
  readonly workspaceLabel: string;
  readonly homeHref: string;
  readonly variant?: "default" | "organization";
}

export function AppTopbar({
  onOpenMobileNav,
  workspaceLabel,
  homeHref,
  variant = "default",
}: AppTopbarProps) {
  const org = variant === "organization";

  return (
    <header
      className="qlix-glass-topbar fixed top-0 inset-x-0 z-50 flex h-12 items-center justify-between px-4"
      role="banner"
    >
      <div className="flex min-w-0 flex-1 items-center gap-3 md:gap-4">
        <button
          type="button"
          onClick={onOpenMobileNav}
          className="flex size-9 shrink-0 items-center justify-center rounded-md text-[--text-tertiary] transition-colors duration-150 ease-out hover:bg-[--bg-hover] hover:text-[--text-primary] md:hidden"
          aria-label="Open navigation menu"
        >
          <Menu className="size-4" strokeWidth={1.75} />
        </button>
        <Link
          href={homeHref}
          className={cn(
            "shrink-0 tracking-tight text-[--text-primary] transition-colors hover:text-[--accent]",
            org ? "text-lg font-semibold" : "text-[15px] font-medium tracking-[-0.01em]",
          )}
        >
          Qlix
        </Link>
        {org ? (
          <>
            <div className="hidden h-4 w-px shrink-0 bg-[--border-default] md:block" aria-hidden />
            <button
              type="button"
              className="hidden min-w-0 max-w-[min(100%,280px)] items-center gap-2 rounded px-2 py-1 text-left text-sm font-medium text-white transition-colors hover:bg-[--bg-hover] md:flex"
            >
              <span className="truncate">{workspaceLabel}</span>
              <ChevronDown className="size-4 shrink-0 text-[--text-tertiary]" strokeWidth={1.75} aria-hidden />
            </button>
          </>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        {!org ? (
          <span className="hidden max-w-[200px] truncate text-[12px] text-[--text-tertiary] sm:inline">
            {workspaceLabel}
          </span>
        ) : null}
        {org ? (
          <>
            <button
              type="button"
              className="hidden rounded-md p-1.5 text-[--text-tertiary] transition-colors hover:bg-[--bg-hover] hover:text-[--text-secondary] sm:block"
              aria-label="Notifications"
            >
              <Bell className="size-[18px]" strokeWidth={1.5} />
            </button>
            <button
              type="button"
              className="hidden rounded-md p-1.5 text-[--text-tertiary] transition-colors hover:bg-[--bg-hover] hover:text-[--text-secondary] sm:block"
              aria-label="Help"
            >
              <HelpCircle className="size-[18px]" strokeWidth={1.5} />
            </button>
            <div className="hidden h-6 w-px bg-[--border-default] sm:block" aria-hidden />
            <button
              type="button"
              className="hidden items-center gap-1.5 rounded-lg bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 px-3 py-1 text-xs font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] transition-[filter,transform] hover:brightness-110 active:scale-[0.98] sm:flex"
            >
              Org switcher
              <ArrowLeftRight className="size-3.5" strokeWidth={2} aria-hidden />
            </button>
          </>
        ) : null}
        <ThemeToggle />
        <UserAccountMenu variant="chrome" />
      </div>
    </header>
  );
}
