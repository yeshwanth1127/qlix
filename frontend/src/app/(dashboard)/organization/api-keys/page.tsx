"use client";

import { Suspense } from "react";
import { ApiPortalView } from "@/components/qlix/api-portal";

export default function OrganizationApiKeysPage() {
  return (
    <Suspense fallback={<div className="py-8 text-[13px] text-black/50">Loading API portal…</div>}>
      <ApiPortalView />
    </Suspense>
  );
}
