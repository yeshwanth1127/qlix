"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Bolt, X } from "lucide-react";
import { getConsoleNavItems, isConsoleNavActive } from "@/lib/navigation/individualNav";
import { formatOrganizationPlanLabel } from "@/lib/workspace";
import { canAccessBilling, canSeeOrgSettings } from "@/lib/org-permissions";
import { cn } from "@/lib/utils/cn";
import { useSession } from "./session-context";
import { ReflectiveCard } from "./ReflectiveCard";

interface MobileDrawerProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly currentPath: string;
  readonly routePrefix: string;
  readonly showUpgradeCta: boolean;
  readonly variant?: "default" | "organization";
}

/**
 * Full-height left drawer for &lt; md — matches sidebar links.
 */
export function MobileDrawer({
  isOpen,
  onClose,
  currentPath,
  routePrefix,
  showUpgradeCta,
  variant = "default",
}: MobileDrawerProps) {
  const { session } = useSession();
  const items = useMemo(() => {
    const all = getConsoleNavItems(routePrefix);
    if (routePrefix !== "/organization") return all;
    if (session?.organization.workspaceKind !== "organization") return all;
    return all.filter((i) => {
      if (i.href.endsWith("/settings")) return canSeeOrgSettings(session.user.role);
      if (i.href.endsWith("/billing")) return canAccessBilling(session.user.role);
      return true;
    });
  }, [routePrefix, session]);
  const overviewHref = `${routePrefix}/overview`;
  const org = variant === "organization";

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[60] md:hidden">
      <button
        type="button"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        aria-label="Close menu"
        onClick={onClose}
      />
      <div
        className="qlix-glass-sidebar absolute left-0 top-0 flex h-full w-52 flex-col shadow-[0_24px_80px_rgba(0,0,0,0.6)]"
        role="dialog"
        aria-modal="true"
      >
        <div className="flex h-12 items-center justify-between border-b border-[--border-subtle] px-3">
          <span className="text-[13px] font-medium text-[--text-primary]">Menu</span>
          <button
            type="button"
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-md text-[--text-tertiary] hover:bg-[--bg-hover]"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>
        {org ? (
          <div className="border-b border-[--border-subtle] px-4 py-3">
            <div className="text-[10px] font-medium uppercase tracking-widest text-[--text-tertiary]">
              Developer environment
            </div>
            <div className="mt-1 truncate text-sm font-semibold text-white" title={session?.user.displayName ?? session?.user.email}>
              {session?.user.displayName ?? session?.user.email ?? "Qlix console"}
            </div>
          </div>
        ) : null}
        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
          {items.map((item) => {
            const active = isConsoleNavActive(item.href, currentPath, overviewHref);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={cn(
                  "flex items-center gap-2.5 text-[13px] transition-colors duration-150",
                  org ? "px-3 py-2" : "rounded-md px-2.5 py-2",
                  org && active
                    ? "border-l-2 border-blue-500 bg-[--bg-active] font-medium text-white"
                    : org
                      ? "border-l-2 border-transparent text-[--text-secondary] hover:bg-[--bg-hover]"
                      : active
                        ? "bg-[--bg-active] font-medium text-[--text-primary]"
                        : "rounded-md text-[--text-secondary] hover:bg-[--bg-hover]",
                )}
              >
                <Icon
                  className={cn(
                    "size-4 shrink-0",
                    org && active ? "text-[--accent]" : "text-[--text-tertiary]",
                  )}
                  strokeWidth={1.75}
                />
                {item.label}
              </Link>
            );
          })}
        </nav>
        {showUpgradeCta ? (
          <div className="border-t border-[--border-subtle] p-3">
            <Link
              href={`${routePrefix}/upgrade`}
              onClick={onClose}
              className="qlix-glass-muted block rounded-lg px-3 py-2 text-center text-[12px] text-[--text-secondary]"
            >
              Upgrade to org →
            </Link>
          </div>
        ) : org ? (
          <div className="border-t border-[--border-subtle] p-4">
            <ReflectiveCard className="rounded" contentClassName="flex items-center gap-3 p-3">
              <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--org-cta-bg)]/20">
                <Bolt className="size-3.5 text-[--accent]" strokeWidth={2} aria-hidden />
              </div>
              <div className="min-w-0">
                <div className="truncate text-[10px] text-[--text-tertiary]">Usage plan</div>
                <div className="truncate text-[11px] font-semibold text-white">
                  {formatOrganizationPlanLabel(session?.organization.plan)} plan
                </div>
              </div>
            </ReflectiveCard>
          </div>
        ) : null}
      </div>
    </div>
  );
}
