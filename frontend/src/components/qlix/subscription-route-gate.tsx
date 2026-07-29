"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { consoleRoutePrefix } from "@/lib/workspace";
import { useSession } from "./session-context";

function isExemptPath(pathname: string, routePrefix: string): boolean {
  if (pathname === `${routePrefix}/subscriptions` || pathname.startsWith(`${routePrefix}/subscriptions/`)) {
    return true;
  }
  if (pathname === `${routePrefix}/settings` || pathname.startsWith(`${routePrefix}/settings/`)) {
    return true;
  }
  return false;
}

/**
 * When the org trial has ended (and no active plan), keep the user on Subscriptions
 * (or Settings for logout/profile). Session is the source of truth — not edge middleware.
 */
export function SubscriptionRouteGate({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const router = useRouter();
  const pathname = usePathname();
  const { session, loading } = useSession();

  useEffect(() => {
    if (loading || !session) return;
    if (session.user.billingExempt || session.user.isSuperAdmin) return;
    // Missing subscription payload (stale client) fail closed → subscriptions.
    const access = session.organization.subscription?.access ?? "required";
    if (access !== "required") return;
    const kind = session.user.workspaceKind ?? session.organization.workspaceKind;
    const routePrefix = consoleRoutePrefix(kind);
    if (isExemptPath(pathname, routePrefix)) return;
    router.replace(`${routePrefix}/subscriptions`);
  }, [session, loading, pathname, router]);

  if (loading || !session) {
    return (
      <div className="pt-12 text-center text-[13px] text-[--text-tertiary]">
        Loading…
      </div>
    );
  }

  if (
    !session.user.billingExempt &&
    !session.user.isSuperAdmin &&
    (session.organization.subscription?.access ?? "required") === "required"
  ) {
    const kind = session.user.workspaceKind ?? session.organization.workspaceKind;
    const routePrefix = consoleRoutePrefix(kind);
    if (!isExemptPath(pathname, routePrefix)) {
      return (
        <div className="pt-12 text-center text-[13px] text-[--text-tertiary]">
          Redirecting to subscriptions…
        </div>
      );
    }
  }

  return <>{children}</>;
}
