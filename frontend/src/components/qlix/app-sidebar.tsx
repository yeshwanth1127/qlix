"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Bolt } from "lucide-react";
import { getConsoleNavItems, isConsoleNavActive } from "@/lib/navigation/individualNav";
import { formatOrganizationPlanLabel } from "@/lib/workspace";
import { canAccessBilling, canSeeOrgSettings } from "@/lib/org-permissions";
import { cn } from "@/lib/utils/cn";
import { useSession } from "./session-context";
import { ReflectiveCard } from "./ReflectiveCard";

interface AppSidebarProps {
  readonly currentPath: string;
  readonly routePrefix: string;
  readonly showUpgradeCta: boolean;
  readonly variant?: "default" | "organization";
}

/**
 * Desktop / tablet sidebar: icon-only from md to lg (individual); org stays full width from md.
 */
export function AppSidebar({
  currentPath,
  routePrefix,
  showUpgradeCta,
  variant = "default",
}: AppSidebarProps) {
  const { session } = useSession();
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
  const overviewHref = `${routePrefix}/overview`;
  const org = variant === "organization";

  return (
    <aside
      className={cn(
        "qlix-glass-sidebar fixed left-0 top-12 z-30 hidden h-[calc(100vh-3rem)] flex-col md:flex",
        org ? "w-52" : "w-14 lg:w-52",
      )}
      aria-label="Primary navigation"
    >
      {org ? (
        <div className="border-b border-[--border-subtle] px-4 pb-4 pt-2">
          <div className="text-[10px] font-medium uppercase tracking-widest text-[--text-tertiary]">
            Developer environment
          </div>
          <div className="mt-1 truncate text-sm font-semibold text-white" title={session?.user.displayName ?? session?.user.email}>
            {session?.user.displayName ?? session?.user.email ?? "Qlix console"}
          </div>
        </div>
      ) : null}
      <nav
        className={cn(
          "flex flex-1 flex-col gap-0.5 overflow-y-auto py-4",
          org ? "space-y-0.5 px-2" : "px-1.5",
        )}
      >
        {items.map((item) => {
          const active = isConsoleNavActive(item.href, currentPath, overviewHref);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group relative flex items-center gap-3 text-[13px] transition-all duration-200 ease-out",
                org ? "px-4 py-2" : "gap-2.5 rounded-md px-2.5 py-1.5",
                org && active
                  ? "border-l-2 border-blue-500 bg-[--bg-active] font-medium text-white"
                  : org
                    ? "border-l-2 border-transparent text-[--text-tertiary] hover:translate-x-0.5 hover:border-blue-500/40 hover:bg-[--bg-hover] hover:text-white"
                    : active
                      ? "bg-[--bg-active] font-medium text-[--text-primary]"
                      : "cursor-pointer text-[--text-secondary] hover:translate-x-0.5 hover:bg-[--bg-hover] hover:text-[--text-primary]",
                !org && "rounded-md",
              )}
            >
              {!org && active ? (
                <span
                  className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-[--accent]"
                  aria-hidden
                />
              ) : null}
              <Icon
                className={cn(
                  "size-4 shrink-0",
                  org && active
                    ? "text-[--accent]"
                    : org
                      ? "text-[--text-tertiary] group-hover:text-[--accent]"
                      : active
                        ? "text-[--accent]"
                        : "text-[--text-tertiary] group-hover:text-[--accent]",
                )}
                strokeWidth={1.75}
              />
              <span className={cn("truncate", !org && "hidden lg:inline")}>{item.label}</span>
            </Link>
          );
        })}
      </nav>
      {showUpgradeCta ? (
        <div className="border-t border-[--border-subtle] p-3">
          <Link
            href={`${routePrefix}/upgrade`}
            className="qlix-glass-muted qlix-glass-box-interactive hidden rounded-lg px-3 py-2 text-center text-[12px] font-medium text-[--text-secondary] hover:text-[--text-primary] lg:block"
          >
            Working with a team?{" "}
            <span className="text-[--accent]">Upgrade to org →</span>
          </Link>
          <p className="text-center text-[10px] text-[--text-tertiary] lg:hidden">Qlix</p>
        </div>
      ) : org ? (
        <div className="mt-auto border-t border-[--border-subtle] p-4">
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
      ) : (
        <div className="border-t border-[--border-subtle] p-3">
          <p className="text-center text-[10px] text-[--text-tertiary]">Qlix</p>
        </div>
      )}
    </aside>
  );
}
