"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { PublicSiteFooter, PublicSiteHeader } from "./PublicSiteChrome";

export const DOCS_NAV: { href: string; label: string }[] = [
  { href: "/docs", label: "Overview" },
  { href: "/docs/authentication", label: "Authentication" },
  { href: "/docs/scopes", label: "Scopes" },
  { href: "/docs/jit", label: "JIT approvals" },
  { href: "/docs/errors", label: "Errors & limits" },
  { href: "/docs/api", label: "API reference" },
];

function isDocsNavActive(href: string, pathname: string): boolean {
  if (href === "/docs") return pathname === "/docs";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function DocsShell({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="relative min-h-dvh bg-[#E2F0CC] text-[#012F13]">
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(28,24,48,0.06),_transparent_55%)]"
        aria-hidden
      />
      <div className="relative z-10 flex min-h-dvh flex-col">
        <PublicSiteHeader />
        <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-6 py-10 sm:px-10 lg:flex-row lg:gap-12">
          <aside className="w-full shrink-0 lg:w-52">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-black/40">Developer API</p>
            <nav className="mt-4 flex flex-col gap-1">
              {DOCS_NAV.map((item) => {
                const active = isDocsNavActive(item.href, pathname);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={
                      active
                        ? "rounded-lg bg-[#012F13]/[0.06] px-2.5 py-1.5 text-[13px] font-medium text-[#012F13]"
                        : "rounded-lg px-2.5 py-1.5 text-[13px] text-black/55 transition-colors hover:bg-black/[0.04] hover:text-[#012F13]"
                    }
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </aside>
          <main className="min-w-0 flex-1 pb-10">
            <h1 className="text-3xl font-semibold tracking-tight text-[#012F13] sm:text-4xl">{title}</h1>
            <div className="mt-8">{children}</div>
          </main>
        </div>
        <PublicSiteFooter />
      </div>
    </div>
  );
}
