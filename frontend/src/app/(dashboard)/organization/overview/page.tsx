"use client";

import { OrgOverviewDashboard } from "@/components/qlix/org-overview-dashboard";
import { useDashboardHome } from "@/lib/hooks/use-dashboard-home";

export default function OrganizationOverviewPage() {
  const { data, error, loading, refresh } = useDashboardHome();

  if (loading) {
    return (
      <div className="w-full">
        <p className="text-[13px] text-neutral-500">Loading organization overview…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="w-full space-y-2">
        <p className="text-[13px] text-red-500">{error ?? "Could not load dashboard."}</p>
        <button
          type="button"
          onClick={() => void refresh()}
          className="text-[13px] font-medium text-blue-500 hover:underline"
        >
          Retry
        </button>
      </div>
    );
  }

  if (data.metrics.kind !== "organization") {
    return (
      <p className="w-full text-[13px] text-neutral-500">This workspace is not an organization console.</p>
    );
  }

  return <OrgOverviewDashboard data={data} />;
}
