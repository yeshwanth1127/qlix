"use client";

import { OrgOverviewDashboard } from "@/components/qlix/org-overview-dashboard";
import { SketchPageHeader, SketchPageSkeleton, sketchButtonSecondary } from "@/components/qlix/sketch";
import { useDashboardHome } from "@/lib/hooks/use-dashboard-home";

export default function OrganizationOverviewPage() {
  const { data, error, loading, refresh } = useDashboardHome();

  if (loading) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <SketchPageHeader title="Overview" />
        <SketchPageSkeleton metrics={1} rows={6} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="w-full space-y-2">
        <p className="text-[13px] text-black">{error ?? "Could not load dashboard."}</p>
        <button type="button" onClick={() => void refresh()} className={sketchButtonSecondary}>
          Retry
        </button>
      </div>
    );
  }

  if (data.metrics.kind !== "organization") {
    return (
      <p className="w-full text-[13px] text-black/50">
        This workspace is not an organization console.
      </p>
    );
  }

  return <OrgOverviewDashboard data={data} />;
}
