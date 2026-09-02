import { Suspense } from "react";
import { GtmWorkspaceView } from "@/components/qlix/gtm/GtmWorkspaceView";

export default function OrganizationGtmPage() {
  return (
    <Suspense fallback={<p className="py-10 text-center text-[13px] text-black/45">Loading GTM…</p>}>
      <GtmWorkspaceView />
    </Suspense>
  );
}
