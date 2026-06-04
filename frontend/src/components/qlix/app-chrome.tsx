"use client";

import { usePathname } from "next/navigation";
import { useCallback, useMemo, useRef } from "react";
import { cn } from "@/lib/utils/cn";
import { consoleRoutePrefix } from "@/lib/workspace";
import { getConsoleNavItems } from "@/lib/navigation/individualNav";
import { canAccessBilling, canSeeOrgSettings } from "@/lib/org-permissions";
import { AppSidebar } from "./app-sidebar";
import { AppTopbar } from "./app-topbar";
import { StaggeredMenu, type StaggeredMenuHandle } from "./StaggeredMenu";
import { useSession } from "./session-context";

/**
 * Fixed topbar + responsive sidebar + scrollable main (pt-12, pl sidebar on desktop).
 * On mobile, the hamburger opens the StaggeredMenu animated overlay.
 */
export function AppChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { session } = useSession();
  const staggeredMenuRef = useRef<StaggeredMenuHandle>(null);

  const routePrefix = session
    ? consoleRoutePrefix(session.user.workspaceKind ?? session.organization.workspaceKind)
    : "/organization";

  const homeHref = `${routePrefix}/overview`;
  const isOrgConsole = routePrefix === "/organization";

  const workspaceLabel =
    session?.organization.workspaceKind === "organization"
      ? session.organization.name
      : "Personal";

  const showUpgradeCta =
    (session?.user.workspaceKind ?? session?.organization.workspaceKind) === "individual";

  const isFullHeightPage = /\/teams(\/|$)/.test(pathname);

  const navItems = useMemo(() => {
    const all = getConsoleNavItems(routePrefix);
    if (routePrefix !== "/organization") return all;
    if (session?.organization.workspaceKind !== "organization") return all;
    return all.filter((i) => {
      if (i.href.endsWith("/settings")) return canSeeOrgSettings(session.user.role);
      if (i.href.endsWith("/billing")) return canAccessBilling(session.user.role);
      return true;
    });
  }, [routePrefix, session]);

  const staggeredItems = useMemo(
    () => navItems.map((item) => ({ href: item.href, label: item.label })),
    [navItems],
  );

  const handleMobileNav = useCallback(() => {
    staggeredMenuRef.current?.toggle();
  }, []);

  return (
    <div data-org-console={isOrgConsole ? "true" : undefined}>
      <AppTopbar
        onOpenMobileNav={handleMobileNav}
        workspaceLabel={workspaceLabel}
        homeHref={homeHref}
        variant={isOrgConsole ? "organization" : "default"}
      />

      {/* StaggeredMenu — mobile only; desktop uses AppSidebar */}
      <div className="md:hidden">
        <StaggeredMenu
          ref={staggeredMenuRef}
          position="left"
          colors={["#1a1a2e", "#0f0f1a"]}
          items={staggeredItems}
          renderHeader={false}
          displayItemNumbering={false}
          accentColor="var(--accent)"
        />
      </div>

      <AppSidebar
        currentPath={pathname}
        routePrefix={routePrefix}
        showUpgradeCta={showUpgradeCta}
        variant={isOrgConsole ? "organization" : "default"}
      />
      <main
        className={cn(
          "bg-transparent pt-12 transition-[padding] duration-150 ease-out",
          isOrgConsole ? "md:pl-52" : "md:pl-14 lg:pl-52",
          isFullHeightPage && "flex flex-col",
        )}
        style={isFullHeightPage ? { height: "calc(100dvh - 3rem)" } : undefined}
      >
        {isFullHeightPage ? (
          <div className="animate-qlix-fade-in flex flex-1 overflow-hidden">
            {children}
          </div>
        ) : (
          <div
            className={cn(
              "animate-qlix-fade-in mx-auto py-6",
              isOrgConsole ? "max-w-[1800px] px-6" : "max-w-5xl px-8",
            )}
          >
            {children}
          </div>
        )}
      </main>
    </div>
  );
}
