"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import type { WorkspaceKind } from "@/lib/workspace";
import { consoleRoutePrefix } from "@/lib/workspace";
import { useSession } from "./session-context";

function replaceWorkspaceSegment(pathname: string, target: WorkspaceKind): string {
  const prefix = consoleRoutePrefix(target);
  const tail = pathname.replace(/^\/(individual|organization)/, "") || "/";
  const rest = tail === "/" ? "/overview" : tail;
  return `${prefix}${rest}`;
}

/**
 * Ensures the URL workspace segment matches `session.user.workspaceKind` (DB source of truth).
 */
export function WorkspaceRouteGate({
  expected,
  children,
}: Readonly<{
  expected: WorkspaceKind;
  children: React.ReactNode;
}>) {
  const router = useRouter();
  const pathname = usePathname();
  const { session, loading } = useSession();

  useEffect(() => {
    if (loading) return;
    if (!session) {
      router.replace("/sign-in");
      return;
    }
    const kind = session.user.workspaceKind ?? session.organization.workspaceKind;
    if (kind !== expected) {
      router.replace(replaceWorkspaceSegment(pathname, kind));
    }
  }, [session, loading, pathname, router, expected]);

  if (loading || !session) {
    return (
      <div className="pt-12 text-center text-[13px] text-[--text-tertiary]">
        Loading…
      </div>
    );
  }

  const kind = session.user.workspaceKind ?? session.organization.workspaceKind;
  if (kind !== expected) {
    return null;
  }

  return <>{children}</>;
}
