"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  getConsoleNavItems,
  isConsoleNavActive,
  splitConsoleNavItems,
} from "@/lib/navigation/individualNav";
import { canAccessBilling, canSeeOrgSettings } from "@/lib/org-permissions";
import { cn } from "@/lib/utils/cn";
import { QlixWordmark } from "./landing/QlixWordmark";
import { useSession } from "./session-context";
import { UserAccountMenu } from "./user-account-menu";
import { sketchLabel, sketchNavLink, SKETCH_SIDEBAR_WIDTH } from "./sketch/tokens";

interface AppSidebarProps {
  readonly currentPath: string;
  readonly routePrefix: string;
  readonly showUpgradeCta: boolean;
  readonly homeHref: string;
}

/** Left sketch sidebar — logo at top, nav links bottom-aligned. */
export function AppSidebar({
  currentPath,
  routePrefix,
  showUpgradeCta,
  homeHref,
}: AppSidebarProps) {
  const { session } = useSession();
  const [moreOpen, setMoreOpen] = useState(false);

  const items = useMemo(() => {
    const all = getConsoleNavItems(routePrefix, session?.user.billingExempt ?? false);
    if (routePrefix !== "/organization") return all;
    if (session?.organization.workspaceKind !== "organization") return all;
    return all.filter((i) => {
      if (i.href.endsWith("/settings")) return canSeeOrgSettings(session.user.role);
      if (i.href.endsWith("/billing")) return canAccessBilling(session.user.role);
      return true;
    });
  }, [routePrefix, session]);

  const { primary, more } = useMemo(() => splitConsoleNavItems(items), [items]);
  const overviewHref = `${routePrefix}/overview`;
  const moreActive = more.some((item) => isConsoleNavActive(item.href, currentPath, overviewHref));

  const navLinkBase =
    "sketch-press rounded-lg border-l-[3px] border-transparent py-2 pl-2.5 pr-2 text-[10px] leading-snug transition-all duration-200 ease-out";
  const navLinkActive =
    "border-[color:var(--sketch-purple)] bg-[color:var(--sketch-purple-soft)] font-semibold text-[color:var(--sketch-purple)]";
  const navLinkIdle =
    "text-black/50 hover:border-[color:var(--sketch-purple)]/40 hover:bg-[color:var(--sketch-purple-soft)]/60 hover:text-black/80 hover:pl-3";

  return (
    <aside
      className="fixed inset-y-0 left-0 z-40 hidden w-40 flex-col border-r border-black/[0.08] bg-white/60 shadow-[inset_-1px_0_0_rgba(255,255,255,0.65),12px_0_40px_-30px_rgba(16,14,22,0.28)] backdrop-blur-2xl md:flex"
      aria-label="Primary navigation"
      style={{ width: SKETCH_SIDEBAR_WIDTH }}
    >
      <div className="shrink-0 px-4 pt-6">
        <Link href={homeHref} className="block text-black transition-opacity duration-200 hover:opacity-80">
          <QlixWordmark className="text-[34px]" />
        </Link>
      </div>

      {moreOpen && (more.length > 0 || showUpgradeCta) ? (
        <div className="sketch-panel-in absolute bottom-6 left-full z-50 ml-3 w-56 max-h-[min(70vh,28rem)] overflow-y-auto rounded-2xl border border-black/10 bg-white/92 p-3 shadow-[0_16px_40px_-20px_rgba(16,14,22,0.35)] backdrop-blur-2xl">
          <div className="mb-2.5 flex items-center justify-between border-b border-black/8 pb-2">
            <span className={cn(sketchLabel, "text-[10px]")}>More</span>
            <button
              type="button"
              onClick={() => setMoreOpen(false)}
              className="sketch-press flex size-7 items-center justify-center rounded-full text-[16px] leading-none text-black/40 transition-colors hover:bg-black/[0.04] hover:text-black"
              aria-label="Close more menu"
            >
              ×
            </button>
          </div>
          <ul className="space-y-1.5">
            {more.map((item, index) => {
              const active = isConsoleNavActive(item.href, currentPath, overviewHref);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setMoreOpen(false)}
                    style={{ "--qlix-stagger-i": index } as React.CSSProperties}
                    className={cn(
                      sketchNavLink,
                      navLinkBase,
                      "qlix-nav-in",
                      active ? navLinkActive : navLinkIdle,
                    )}
                  >
                    {item.label.toUpperCase()}
                  </Link>
                </li>
              );
            })}
            {showUpgradeCta ? (
              <li>
                <Link
                  href={`${routePrefix}/upgrade`}
                  onClick={() => setMoreOpen(false)}
                  className={cn(sketchNavLink, navLinkBase, navLinkIdle)}
                >
                  Upgrade to org
                </Link>
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col justify-end overflow-y-auto overscroll-contain px-3.5 pb-6">
        <nav className="space-y-1">
          {primary.map((item, index) => {
            const active = isConsoleNavActive(item.href, currentPath, overviewHref);
            return (
              <Link
                key={item.href}
                href={item.href}
                style={{ "--qlix-stagger-i": index } as React.CSSProperties}
                className={cn(
                  sketchNavLink,
                  navLinkBase,
                  "qlix-nav-in",
                  active ? navLinkActive : navLinkIdle,
                )}
              >
                {item.label.toUpperCase()}
              </Link>
            );
          })}
          {(more.length > 0 || showUpgradeCta) && (
            <button
              type="button"
              onClick={() => setMoreOpen((v) => !v)}
              style={{ "--qlix-stagger-i": primary.length } as React.CSSProperties}
              className={cn(
                sketchNavLink,
                navLinkBase,
                "qlix-nav-in w-full text-left",
                moreOpen || moreActive ? navLinkActive : navLinkIdle,
              )}
            >
              + MORE
            </button>
          )}
          <div className="pt-2">
            <UserAccountMenu variant="sidebar" />
          </div>
        </nav>
      </div>
    </aside>
  );
}
