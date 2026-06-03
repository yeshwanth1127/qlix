"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useSession } from "@/components/qlix/session-context";
import { consoleHomePath } from "@/lib/workspace";

/** Legacy `/overview` → `/individual/overview` or `/organization/overview` from DB workspace kind. */
export default function LegacyOverviewRedirectPage() {
  const router = useRouter();
  const { session, loading } = useSession();

  useEffect(() => {
    if (loading) return;
    if (!session) {
      router.replace("/sign-in");
      return;
    }
    const kind = session.user.workspaceKind ?? session.organization.workspaceKind;
    router.replace(consoleHomePath(kind));
  }, [loading, router, session]);

  return (
    <div className="text-[13px] text-[--text-tertiary]">Redirecting…</div>
  );
}
