"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { getTeam, type TeamDTO } from "@/lib/teams-api";
import { useSession } from "@/components/qlix/session-context";
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
    <div className="flex min-h-0 w-full flex-1 flex-col bg-transparent">
      {/* Top bar */}
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-white/10 px-4">
        <button
          onClick={() => router.push(backHref)}
          className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-white/40 transition-colors hover:bg-white/5 hover:text-white/80"
        >
          <ArrowLeft size={13} />
          Teams
        </button>

        {team && (
          <>
            <span className="text-white/20">/</span>
            <span className="text-xs font-medium text-white/70 truncate max-w-xs">
              {team.name}
            </span>
          </>
        )}

        {!loading && (
          <button
            onClick={load}
            className="ml-auto rounded p-1 text-white/30 transition-colors hover:bg-white/5 hover:text-white/70"
            title="Refresh"
          >
            <RefreshCw size={13} />
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {loading && (
          <div className="flex h-full items-center justify-center text-sm text-white/30">
            Loading team…
          </div>
        )}
        {error && (
          <div className="flex h-full flex-col items-center justify-center gap-3">
            <p className="text-sm text-red-400">{error}</p>
            <button
              onClick={load}
              className="rounded bg-white/5 px-3 py-1.5 text-xs text-white/60 transition-colors hover:bg-white/10"
            >
              Retry
            </button>
          </div>
        )}
        {team && session && (
          <TeamDetailView
            team={team}
            routePrefix={routePrefix}
            deviceVerified={session.user.deviceVerified}
            onDeleted={() => router.push(backHref)}
            onUpdated={(updated) => setTeam(updated)}
          />
        )}
      </div>
    </div>
  );
}
