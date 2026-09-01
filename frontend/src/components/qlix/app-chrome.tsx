"use client";

import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils/cn";
import { consoleRoutePrefix } from "@/lib/workspace";
import { AppStaggeredMenu } from "./AppStaggeredMenu";
import { AppTopbar } from "./app-topbar";
import { GuestClaimBanner } from "./GuestClaimBanner";
import { SketchFrame, SketchShell } from "./sketch";
import { useSession } from "./session-context";

/** Dashboard chrome only — used under `(dashboard)/`, not on `/`. */
export function AppChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { session } = useSession();

  const routePrefix = session
    ? consoleRoutePrefix(session.user.workspaceKind ?? session.organization.workspaceKind)
    : "/organization";

  const showUpgradeCta =
    (session?.user.workspaceKind ?? session?.organization.workspaceKind) === "individual";

  const isFullHeightPage =
    /\/teams(\/|$)/.test(pathname) ||
    /\/agent-builder(\/|$)/.test(pathname) ||
    // The canvas fills whatever box it is given, so it needs a real height to sit in.
    /\/visual-builder(\/|$)/.test(pathname) ||
    /\/chat(\/|$)/.test(pathname) ||
    /\/ai-employees\/[^/]+\/hire(\/|$)/.test(pathname);
  const isAgentBuilder = /\/agent-builder(\/|$)/.test(pathname);

  const navigation = (
    <AppStaggeredMenu
      currentPath={pathname}
      routePrefix={routePrefix}
      showUpgradeCta={showUpgradeCta}
    />
  );

  const topbar = (
    <AppTopbar
      workspaceLabel={session?.organization.name ?? "Workspace"}
      homeHref={`${routePrefix}/overview`}
    />
  );

  if (isAgentBuilder) {
    return (
      <div data-sketch-console className="bg-[#E2F0CC]">
        {navigation}
        {topbar}
        <main
          className="fixed top-12 bottom-0 right-0 left-[13rem] z-10 overflow-hidden md:left-[18rem]"
        >
          {children}
        </main>
      </div>
    );
  }

  return (
    <SketchShell
      fullHeight={isFullHeightPage}
      sidebar={navigation}
      topbar={topbar}
      overlayNavigation
      persistentNavigation
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
