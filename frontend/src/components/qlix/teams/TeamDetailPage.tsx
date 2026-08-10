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

  const quiet =
    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] text-[color:var(--ink-soft)] transition-colors hover:bg-black/[0.05] hover:text-black";

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center px-6">
        <button type="button" onClick={() => router.push(backHref)} className={quiet}>
          <ArrowLeft size={13} />
          Teams
        </button>

        {!loading && (
          <button
            type="button"
            onClick={load}
            className={`${quiet} ml-auto`}
            title="Refresh"
            aria-label="Refresh"
          >
            <RefreshCw size={13} />
          </button>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {loading && (
          <div className="flex h-full items-center justify-center text-[13px] text-[color:var(--ink-soft)]">
            Loading team…
          </div>
        )}
        {error && (
          <div className="flex h-full flex-col items-center justify-center gap-3">
            <p className="text-[13px] text-black">{error}</p>
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
