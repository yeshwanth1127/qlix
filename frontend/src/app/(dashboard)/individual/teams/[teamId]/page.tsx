"use client";

import { use } from "react";
import { TeamDetailPage } from "@/components/qlix/teams/TeamDetailPage";

export default function IndividualTeamDetailPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId } = use(params);
  return <TeamDetailPage teamId={teamId} routePrefix="/individual" />;
}
