"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/utils/cn";
import { consoleRoutePrefix } from "@/lib/workspace";
import { AppSidebar } from "./app-sidebar";
import { MobileDrawer } from "./mobile-drawer";
import { AppTopbar } from "./app-topbar";
import { useSession } from "./session-context";

/**
 * Fixed topbar + responsive sidebar + scrollable main (pt-12, pl sidebar on desktop).
 */
export function AppChrome({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const { session } = useSession();

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

  return (
    <div data-org-console={isOrgConsole ? "true" : undefined}>
      <AppTopbar
        onOpenMobileNav={() => setMobileOpen(true)}
        workspaceLabel={workspaceLabel}
        homeHref={homeHref}
        variant={isOrgConsole ? "organization" : "default"}
      />
      <MobileDrawer
        isOpen={mobileOpen}
        onClose={() => setMobileOpen(false)}
        currentPath={pathname}
        routePrefix={routePrefix}
        showUpgradeCta={showUpgradeCta}
        variant={isOrgConsole ? "organization" : "default"}
      />
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
