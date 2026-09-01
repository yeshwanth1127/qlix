"use client";

import Link from "next/link";
import { cn } from "@/lib/utils/cn";
import { QlixWordmark } from "./landing/QlixWordmark";
import { LogoutButton, UserAccountMenu } from "./user-account-menu";
import { sketchLabel } from "./sketch/tokens";

interface MobileChromeHeaderProps {
  readonly homeHref: string;
  readonly workspaceLabel?: string;
}

/** Fixed top bar for &lt; md — logo + account. Desktop uses the left sidebar instead. */
export function MobileChromeHeader({ homeHref, workspaceLabel }: MobileChromeHeaderProps) {
  return (
    <header
      className="fixed inset-x-0 top-0 z-50 flex h-12 items-center justify-between border-b border-black/[0.08] bg-[#E2F0CC]/75 px-4 shadow-[0_8px_24px_-20px_rgba(16,14,22,0.25)] backdrop-blur-2xl md:hidden"
      role="banner"
    >
      <Link
        href={homeHref}
        className="shrink-0 text-black transition-opacity duration-200 hover:opacity-80"
      >
        <QlixWordmark className="text-[26px]" />
      </Link>
      <div className="flex min-w-0 items-center gap-3">
        {workspaceLabel ? (
          <span className={cn(sketchLabel, "max-w-[7rem] truncate text-[10px] sm:max-w-[12rem]")}>
            {workspaceLabel}
          </span>
        ) : null}
        <UserAccountMenu variant="chrome" />
        <LogoutButton />
      </div>
    </header>
  );
}
