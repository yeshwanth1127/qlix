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
import { useSession } from "./session-context";
import { sketchNavLink } from "./sketch/tokens";

interface AppBottomNavProps {
  readonly currentPath: string;
  readonly routePrefix: string;
  readonly showUpgradeCta: boolean;
}

export function AppBottomNav({ currentPath, routePrefix, showUpgradeCta }: AppBottomNavProps) {
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

  const tabBase =
    "sketch-press shrink-0 whitespace-nowrap rounded-full px-3 py-2 text-[10px] transition-all duration-200 ease-out";
  const tabActive =
    "bg-[color:var(--sketch-purple-soft)] font-semibold text-[color:var(--sketch-purple)]";
  const tabIdle = "text-black/50 hover:bg-black/[0.04] hover:text-black/75";

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-black/[0.08] bg-white/80 pb-[env(safe-area-inset-bottom)] shadow-[0_-10px_28px_-22px_rgba(16,14,22,0.3)] backdrop-blur-2xl md:hidden">
      <nav
        className="flex h-14 items-center gap-0.5 overflow-x-auto px-2.5"
        aria-label="Primary navigation"
      >
        {moreOpen ? (
          <>
            <button
              type="button"
              onClick={() => setMoreOpen(false)}
              className={cn(sketchNavLink, tabBase, tabIdle)}
            >
              ← BACK
            </button>
            {more.map((item) => {
              const active = isConsoleNavActive(item.href, currentPath, overviewHref);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMoreOpen(false)}
                  className={cn(sketchNavLink, tabBase, active ? tabActive : tabIdle)}
                >
                  {item.label.toUpperCase()}
                </Link>
              );
            })}
            {showUpgradeCta ? (
              <Link
                href={`${routePrefix}/upgrade`}
                onClick={() => setMoreOpen(false)}
                className={cn(sketchNavLink, tabBase, tabIdle)}
              >
                UPGRADE TO ORG
              </Link>
            ) : null}
          </>
        ) : (
          <>
            {primary.map((item) => {
              const active = isConsoleNavActive(item.href, currentPath, overviewHref);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(sketchNavLink, tabBase, active ? tabActive : tabIdle)}
                >
                  {item.label.toUpperCase()}
                </Link>
              );
            })}
            {(more.length > 0 || showUpgradeCta) && (
              <button
                type="button"
                onClick={() => setMoreOpen(true)}
                className={cn(
                  sketchNavLink,
                  tabBase,
                  moreActive ? tabActive : tabIdle,
                )}
              >
                + MORE
              </button>
            )}
          </>
        )}
      </nav>
    </div>
  );
}
