"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { getTeam, type TeamDTO } from "@/lib/teams-api";
import { useSession } from "@/components/qlix/session-context";
import { sketchButton } from "@/components/qlix/sketch";
import { TeamDetailView } from "./TeamDetailView";

interface TeamDetailPageProps {
  readonly teamId: string;
  readonly routePrefix: string;
}

export function TeamDetailPage({ teamId, routePrefix }: TeamDetailPageProps) {
  const router = useRouter();
  const { session } = useSession();
  const [team, setTeam] = useState<TeamDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getTeam(teamId);
      setTeam(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load team");
    } finally {
      setLoading(false);
    }
  }, [teamId]);

  useEffect(() => { void load(); }, [load]);

  const backHref = `${routePrefix}/teams`;

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col bg-white">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-black px-4">
        <button
          type="button"
          onClick={() => router.push(backHref)}
          className={`${sketchButton} gap-1.5 py-1`}
        >
          <ArrowLeft size={13} />
          Teams
        </button>

        {team && (
          <>
            <span className="text-black/30">/</span>
            <span className="truncate max-w-xs text-xs font-medium text-black/70">
              {team.name}
            </span>
          </>
        )}

        {!loading && (
          <button
            type="button"
            onClick={load}
            className={`${sketchButton} ml-auto p-1`}
            title="Refresh"
          >
            <RefreshCw size={13} />
          </button>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {loading && (
          <div className="flex h-full items-center justify-center text-sm text-black/50">
            Loading team…
          </div>
        )}
        {error && (
          <div className="flex h-full flex-col items-center justify-center gap-3">
            <p className="text-sm text-black">{error}</p>
            <button type="button" onClick={load} className={sketchButton}>
              Retry
            </button>
          </div>
        )}
        {team && session && (
          <TeamDetailView
            team={team}
            routePrefix={routePrefix}
            onDeleted={() => router.push(backHref)}
            onUpdated={(updated) => setTeam(updated)}
          />
        )}
      </div>
    </div>
  );
}
