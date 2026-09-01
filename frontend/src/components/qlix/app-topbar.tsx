"use client";

import Link from "next/link";
import { QlixWordmark } from "./landing/QlixWordmark";
import { LogoutButton, UserAccountMenu } from "./user-account-menu";
import { cn } from "@/lib/utils/cn";

interface AppTopbarProps {
  readonly workspaceLabel: string;
  readonly homeHref: string;
  readonly showLogo?: boolean;
  readonly sidebarOffset?: string;
}

/** Dashboard top bar — workspace label and account. Sits above main content, not over the left rail. */
export function AppTopbar({
  workspaceLabel,
  homeHref,
  showLogo = false,
  sidebarOffset,
}: AppTopbarProps) {
  return (
    <header
      className={cn(
        "fixed top-0 right-0 z-[70] flex h-12 items-center justify-between border-b border-black/10 bg-[#E2F0CC]/70 px-4 shadow-[0_10px_30px_-24px_rgba(16,14,22,0.35)] backdrop-blur-xl transition-shadow duration-300",
        !sidebarOffset && "left-[13rem] md:left-[18rem]",
      )}
      style={sidebarOffset ? { left: sidebarOffset, right: 0 } : undefined}
      role="banner"
    >
      {showLogo ? (
        <Link href={homeHref} className="shrink-0 text-black">
          <QlixWordmark className="text-[26px]" />
        </Link>
      ) : (
        <span aria-hidden className="shrink-0" />
      )}
      <div className="ml-auto flex min-w-0 items-center justify-end gap-3">
        <span className="truncate font-serif text-[11px] uppercase tracking-widest text-black/60">
          {workspaceLabel}
        </span>
        <UserAccountMenu variant="chrome" />
        <LogoutButton />
      </div>
    </header>
  );
}
