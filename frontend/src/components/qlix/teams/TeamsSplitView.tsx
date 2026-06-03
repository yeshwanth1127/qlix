"use client";

import { useCallback, useEffect, useState } from "react";
import { listTeams, type TeamDTO } from "@/lib/teams-api";
import { TeamsListView } from "./TeamsListView";
import { CreateTeamModal } from "./CreateTeamModal";
import { useSession } from "@/components/qlix/session-context";

interface TeamsSplitViewProps {
  readonly routePrefix: string;
}

export function TeamsSplitView({ routePrefix }: TeamsSplitViewProps) {
  const { session } = useSession();
  const [teams, setTeams] = useState<TeamDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listTeams();
      setTeams(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load teams");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
      <TeamsListView
        teams={teams}
        loading={loading}
        error={error}
        routePrefix={routePrefix}
        onCreateClick={() => setShowCreate(true)}
        onRefresh={load}
      />

      {showCreate && session && (
        <CreateTeamModal
          open={showCreate}
          orgId={session.organization.id}
          deviceVerified={session.user.deviceVerified}
          onClose={() => setShowCreate(false)}
          onCreated={(team) => {
            setTeams((prev) => [team, ...prev]);
            setShowCreate(false);
          }}
        />
      )}
    </div>
  );
}
