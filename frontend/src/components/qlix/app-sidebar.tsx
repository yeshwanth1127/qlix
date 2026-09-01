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
import styles from "./LineSidebarNav.module.css";

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
  const [accountOpen, setAccountOpen] = useState(false);

  const items = useMemo(() => {
    const all = getConsoleNavItems(routePrefix, session?.user.billingExempt ?? false, session?.organization.enabledPluginIds ?? []);
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
    "sketch-press flex items-center gap-3 rounded-none border border-transparent px-3 py-2.5 text-[11px] uppercase tracking-[0.08em] leading-snug transition-colors duration-150 ease-out";
  const navLinkActive =
    "border-transparent bg-transparent font-bold text-[#8BC53D]";
  const navLinkIdle =
    "bg-transparent text-white hover:border-transparent hover:bg-transparent hover:text-[#E2F0CC]";

  return (
    <aside
      className="qlix-app-sidebar fixed inset-y-0 left-0 z-40 hidden flex-col bg-[#011207]/[0.97] backdrop-blur-2xl md:flex"
      aria-label="Primary navigation"
      style={{ width: SKETCH_SIDEBAR_WIDTH }}
    >
      <div className="shrink-0 px-5 pb-5 pt-6">
        <Link href={homeHref} className="block text-[#E2F0CC] transition-opacity duration-200 hover:opacity-80">
          <QlixWordmark surface="dark" className="text-[32px]" />
        </Link>
        <p className="mt-2 border-t border-[#E2F0CC]/20 pt-2 text-[9px] font-bold uppercase tracking-[0.22em] text-[#E2F0CC]/45">Agent workspace</p>
      </div>

      {moreOpen && (more.length > 0 || showUpgradeCta) ? (
        <div className="sketch-panel-in absolute bottom-6 left-full z-50 ml-3 w-60 max-h-[min(70vh,28rem)] overflow-y-auto rounded-2xl border border-[#8BC53D]/20 bg-[#011207]/95 p-3 text-[#E2F0CC] shadow-[0_24px_64px_-24px_rgba(1,18,7,0.65)] backdrop-blur-2xl">
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

      <div className="flex min-h-0 flex-1 flex-col justify-end overflow-y-auto overscroll-contain px-3 pb-5">
        <div className="mb-2 px-3 text-[9px] font-semibold uppercase tracking-[0.2em] text-[#E2F0CC]/35">Workspace</div>
        <nav className={styles.nav}>
          {primary.map((item, index) => {
            const active = isConsoleNavActive(item.href, currentPath, overviewHref);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                style={{ "--qlix-stagger-i": index } as React.CSSProperties}
                className={cn(styles.item, active && styles.active, "qlix-nav-in")}
              >
                <span className={styles.marker} aria-hidden />
                <span className={styles.label}>
                  <span className={styles.index}>{String(index + 1).padStart(2, "0")}</span>
                  <Icon className="size-3.5 shrink-0" strokeWidth={1.8} aria-hidden />
                  <span>{item.label}</span>
                </span>
              </Link>
            );
          })}
          {(more.length > 0 || showUpgradeCta) && (
            <button
              type="button"
              onClick={() => {
                setMoreOpen((v) => !v);
                setAccountOpen(false);
              }}
              aria-current={moreOpen || moreActive ? "page" : undefined}
              style={{ "--qlix-stagger-i": primary.length } as React.CSSProperties}
              className={cn(styles.item, (moreOpen || moreActive) && styles.active, "qlix-nav-in w-full text-left")}
            >
              <span className={styles.marker} aria-hidden />
              <span className={styles.label}>
                <span className={styles.index}>{String(primary.length + 1).padStart(2, "0")}</span>
                <span className="flex size-3.5 items-center justify-center text-base font-light">+</span>
                <span>More tools</span>
              </span>
            </button>
          )}
          <div className="pt-2">
            <UserAccountMenu
              variant="sidebar"
              open={accountOpen}
              onOpenChange={(next) => {
                setAccountOpen(next);
                if (next) setMoreOpen(false);
              }}
            />
          </div>
        </nav>
      </div>
    </aside>
  );
}
