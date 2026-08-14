"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils/cn";
import { QlixWordmark } from "./landing/QlixWordmark";
import { UserAccountMenu } from "./user-account-menu";
import { useSession } from "./session-context";
import { getAdminNavItems } from "./admin-nav";
import { MobileChromeHeader } from "./mobile-chrome-header";
import { SketchFrame, SketchShell } from "./sketch";
import { sketchNavLink, SKETCH_SIDEBAR_WIDTH } from "./sketch/tokens";

export function AdminChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { session, loading } = useSession();
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!session) {
      router.replace("/sign-in");
      return;
    }
    if (!session.user.isSuperAdmin) {
      const kind = session.user.workspaceKind ?? session.organization.workspaceKind;
      router.replace(kind === "organization" ? "/organization/overview" : "/individual/overview");
    }
  }, [loading, router, session]);

  const items = useMemo(() => getAdminNavItems(), []);

  if (loading || !session) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center font-serif text-[13px] uppercase tracking-widest text-black/50">
        Loading…
      </div>
    );
  }
  if (!session.user.isSuperAdmin) {
    return null;
  }

  const sidebar = (
    <aside
      className="fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-black/10 bg-white/55 shadow-[inset_-1px_0_0_rgba(255,255,255,0.6),10px_0_36px_-28px_rgba(16,14,22,0.35)] backdrop-blur-2xl md:flex"
      style={{ width: SKETCH_SIDEBAR_WIDTH }}
      aria-label="Admin navigation"
    >
      <div className="shrink-0 px-4 pt-5">
        <Link href="/admin/overview" className="block text-black">
          <QlixWordmark className="text-[34px]" />
        </Link>
      </div>
      <nav className="flex min-h-0 flex-1 flex-col justify-end space-y-2 px-4 pb-6">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              style={active ? { color: "var(--sketch-purple)" } : undefined}
              className={cn(
                sketchNavLink,
                "rounded-md border border-transparent py-1.5 pl-2.5 text-[10px] leading-snug transition-all duration-200",
                active
                  ? "border-l-[3px] border-l-[color:var(--sketch-purple)] bg-[color:var(--sketch-purple-soft)] font-semibold"
                  : "hover:border-black hover:bg-[color:var(--sketch-purple-soft)]",
              )}
            >
              {item.label.toUpperCase()}
            </Link>
          );
        })}
        <UserAccountMenu variant="sidebar" />
      </nav>
    </aside>
  );

  const bottomNav = (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-black/10 bg-white/80 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden">
      <nav className="flex h-14 items-center gap-1 overflow-x-auto px-3" aria-label="Admin navigation">
        {moreOpen ? (
          <>
            <button
              type="button"
              onClick={() => setMoreOpen(false)}
              className={cn(sketchNavLink, "shrink-0 whitespace-nowrap px-2 py-1 text-[10px]")}
            >
              ← BACK
            </button>
            {items.slice(3).map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMoreOpen(false)}
                  className={cn(
                    sketchNavLink,
                    "shrink-0 whitespace-nowrap px-2 py-1 text-[10px]",
                    active && "font-semibold underline underline-offset-4",
                  )}
                >
                  {item.label.toUpperCase()}
                </Link>
              );
            })}
          </>
        ) : (
          <>
            {items.slice(0, 3).map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    sketchNavLink,
                    "shrink-0 whitespace-nowrap px-2 py-1 text-[10px]",
                    active && "font-semibold underline underline-offset-4",
                  )}
                >
                  {item.label.toUpperCase()}
                </Link>
              );
            })}
            {items.length > 3 ? (
              <button
                type="button"
                onClick={() => setMoreOpen(true)}
                className={cn(sketchNavLink, "shrink-0 whitespace-nowrap px-2 py-1 text-[10px]")}
              >
                + MORE
              </button>
            ) : null}
          </>
        )}
      </nav>
    </div>
  );

  return (
    <SketchShell
      sidebar={sidebar}
      topbar={<MobileChromeHeader homeHref="/admin/overview" workspaceLabel="Admin" />}
      bottomNav={bottomNav}
    >
      <SketchFrame>{children}</SketchFrame>
    </SketchShell>
  );
}
