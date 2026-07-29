"use client";

import Link from "next/link";
import { QlixWordmark } from "./landing/QlixWordmark";
import { UserAccountMenu } from "./user-account-menu";

interface AppTopbarProps {
  readonly workspaceLabel: string;
  readonly homeHref: string;
  readonly showLogo?: boolean;
  readonly sidebarOffset?: string;
}

/** Dashboard top bar — workspace label and account. Logo lives in the left sidebar. */
export function AppTopbar({
  workspaceLabel,
  homeHref,
  showLogo = false,
  sidebarOffset,
}: AppTopbarProps) {
  return (
    <header
      className="fixed top-0 z-50 flex h-12 items-center justify-between border-b border-black/10 bg-white/70 px-4 shadow-[0_10px_30px_-24px_rgba(16,14,22,0.35)] backdrop-blur-xl transition-shadow duration-300"
      style={sidebarOffset ? { left: sidebarOffset, right: 0 } : { insetInline: 0 }}
      role="banner"
    >
      {showLogo ? (
        <Link href={homeHref} className="shrink-0 text-black">
          <QlixWordmark className="text-[26px]" />
        </Link>
      ) : (
        <span aria-hidden className="shrink-0" />
      )}
      <div className="flex min-w-0 items-center justify-end gap-3 pl-4">
        <span className="truncate font-serif text-[11px] uppercase tracking-widest text-black/60">
          {workspaceLabel}
        </span>
        <UserAccountMenu variant="chrome" />
      </div>
    </header>
  );
}
