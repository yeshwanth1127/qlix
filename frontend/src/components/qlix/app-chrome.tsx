"use client";

import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils/cn";
import { consoleRoutePrefix } from "@/lib/workspace";
import { AppBottomNav } from "./app-bottom-nav";
import { AppSidebar } from "./app-sidebar";
import { GuestClaimBanner } from "./GuestClaimBanner";
import { MobileChromeHeader } from "./mobile-chrome-header";
import { SketchFrame, SketchShell } from "./sketch";
import { useSession } from "./session-context";

/** Dashboard chrome only — used under `(dashboard)/`, not on `/`. */
export function AppChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { session } = useSession();

  const routePrefix = session
    ? consoleRoutePrefix(session.user.workspaceKind ?? session.organization.workspaceKind)
    : "/organization";

  const homeHref = `${routePrefix}/overview`;

  const showUpgradeCta =
    (session?.user.workspaceKind ?? session?.organization.workspaceKind) === "individual";

  const workspaceLabel =
    session?.organization.name ??
    ((session?.user.workspaceKind ?? session?.organization.workspaceKind) === "individual"
      ? "Individual"
      : "Organization");

  const isFullHeightPage =
    /\/teams(\/|$)/.test(pathname) ||
    /\/agent-builder(\/|$)/.test(pathname) ||
    /\/chat(\/|$)/.test(pathname) ||
    /\/ai-employees\/[^/]+\/hire(\/|$)/.test(pathname);
  const isAgentBuilder = /\/agent-builder(\/|$)/.test(pathname);

  const sidebar = (
    <AppSidebar
      currentPath={pathname}
      routePrefix={routePrefix}
      showUpgradeCta={showUpgradeCta}
      homeHref={homeHref}
    />
  );

  const mobileHeader = (
    <MobileChromeHeader homeHref={homeHref} workspaceLabel={workspaceLabel} />
  );

  const bottomNav = (
    <AppBottomNav
      currentPath={pathname}
      routePrefix={routePrefix}
      showUpgradeCta={showUpgradeCta}
    />
  );

  if (isAgentBuilder) {
    return (
      <div data-sketch-console className="bg-white">
        {sidebar}
        {mobileHeader}
        {bottomNav}
        <main
          className={cn(
            "fixed z-10 overflow-hidden",
            "inset-x-0 top-12 bottom-[3.5rem]",
            "md:inset-y-0 md:left-[10rem] md:right-0 md:top-0 md:bottom-0",
          )}
        >
          {children}
        </main>
      </div>
    );
  }

  return (
    <SketchShell
      fullHeight={isFullHeightPage}
      sidebar={sidebar}
      topbar={mobileHeader}
      bottomNav={bottomNav}
    >
      <SketchFrame fullHeight={isFullHeightPage}>
        {!isFullHeightPage ? <GuestClaimBanner /> : null}
        {isFullHeightPage ? (
          <div className={cn("flex min-h-0 flex-1 flex-col overflow-hidden")}>{children}</div>
        ) : (
          children
        )}
      </SketchFrame>
    </SketchShell>
  );
}
