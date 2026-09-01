"use client";

import { use } from "react";
import { AssessmentSessionDetailView } from "@/components/qlix/assessment/AssessmentSessionDetailView";

export default function OrganizationAssessmentDetailPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = use(params);
  return <AssessmentSessionDetailView sessionId={sessionId} routePrefix="/organization" />;
}
