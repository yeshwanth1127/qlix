"use client";

import Link from "next/link";
import { QlixWordmark } from "@/components/qlix/landing/QlixWordmark";
import { useSession } from "@/components/qlix/session-context";
import { consoleHomePath, consoleRoutePrefix } from "@/lib/workspace";

export function PublicSiteHeader() {
  const { session, loading } = useSession();
  const kind = session?.user.workspaceKind ?? session?.organization.workspaceKind;
  const consoleHref = kind ? `${consoleRoutePrefix(kind)}/overview` : consoleHomePath("individual");
  const apiHref = kind ? `${consoleRoutePrefix(kind)}/api-keys` : "/sign-in";

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-black/10 px-6 sm:px-10">
      <Link href="/" className="flex items-center text-[#1c1830]">
        <QlixWordmark className="text-[34px]" />
      </Link>
      <nav className="flex items-center gap-5 text-[12px] font-medium uppercase tracking-wider text-black/45">
        <Link href="/docs" className="transition-colors hover:text-[#1c1830]">
          Docs
        </Link>
        <Link href="/privacy" className="transition-colors hover:text-[#1c1830]">
          Privacy
        </Link>
        <Link href="/terms" className="transition-colors hover:text-[#1c1830]">
          Terms
        </Link>
        {!loading && session && !session.user.isGuest ? (
          <>
            <Link href={apiHref} className="transition-colors hover:text-[#1c1830]">
              API
            </Link>
            <Link
              href={consoleHref}
              className="rounded-full border border-black/15 bg-white/60 px-3.5 py-1.5 text-[12px] normal-case tracking-normal text-[#1c1830] transition-colors hover:border-black/30 hover:bg-white/90"
            >
              Console
            </Link>
          </>
        ) : (
          <Link
            href="/sign-in"
            className="rounded-full border border-black/15 bg-white/60 px-3.5 py-1.5 text-[12px] normal-case tracking-normal text-[#1c1830] transition-colors hover:border-black/30 hover:bg-white/90"
          >
            Sign in
          </Link>
        )}
      </nav>
    </header>
  );
}

export function PublicSiteFooter() {
  return (
    <footer className="border-t border-black/10 px-6 py-4 sm:px-10">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 text-[11px] uppercase tracking-widest text-black/40">
        <span>© {new Date().getFullYear()} Qlix · Exora</span>
        <div className="flex gap-6">
          <Link href="/docs" className="transition-colors hover:text-black/70">
            Docs
          </Link>
          <Link href="/privacy" className="transition-colors hover:text-black/70">
            Privacy
          </Link>
          <Link href="/terms" className="transition-colors hover:text-black/70">
            Terms
          </Link>
          <Link href="/" className="transition-colors hover:text-black/70">
            Home
          </Link>
        </div>
      </div>
    </footer>
  );
}
