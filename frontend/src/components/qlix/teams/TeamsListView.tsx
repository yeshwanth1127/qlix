"use client";

import { useMemo } from "react";
import { Plus, RefreshCw, UsersRound } from "lucide-react";
import type { TeamDTO } from "@/lib/teams-api";
import FlowingMenu, { type FlowingMenuItem } from "./FlowingMenu";

interface TeamsListViewProps {
  readonly teams: TeamDTO[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly routePrefix: string;
  readonly onCreateClick: () => void;
  readonly onRefresh: () => void;
}

export function TeamsListView({
  teams,
  loading,
  error,
  routePrefix,
  onCreateClick,
  onRefresh,
}: TeamsListViewProps) {
  const menuItems = useMemo<FlowingMenuItem[]>(
    () =>
      teams.map((team) => ({
        link: `${routePrefix}/teams/${team.id}`,
        text: team.name,
        agents: (team.members ?? [])
          .map((m) => m.agent?.name)
          .filter((name): name is string => Boolean(name)),
      })),
    [teams, routePrefix],
  );

  return (
    <div className="flex w-full flex-1 flex-col bg-transparent">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <span className="text-sm font-semibold text-white/80">Teams</span>
        <div className="flex items-center gap-1">
          <button
            onClick={onRefresh}
            className="rounded p-1 text-white/40 transition-colors hover:bg-white/5 hover:text-white/80"
            title="Refresh"
          >
            <RefreshCw size={13} />
          </button>
          <button
            onClick={onCreateClick}
            className="flex items-center gap-1 rounded bg-indigo-600 px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-indigo-500"
          >
            <Plus size={12} />
            New
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1">
        {loading && (
          <div className="px-4 py-8 text-center text-xs text-white/30">Loading…</div>
        )}
        {error && <div className="px-4 py-4 text-xs text-red-400">{error}</div>}
        {!loading && !error && teams.length === 0 && (
          <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
            <UsersRound size={28} className="text-white/20" />
            <p className="text-xs text-white/40">
              No teams yet. Create your first team to get started.
            </p>
          </div>
        )}
        {!loading && !error && teams.length > 0 && (
          <FlowingMenu
            items={menuItems}
            speed={18}
            textColor="rgba(255,255,255,0.9)"
            bgColor="transparent"
            marqueeBgColor="#ffffff"
            marqueeTextColor="#0a0a0b"
            borderColor="rgba(255,255,255,0.08)"
          />
        )}
      </div>
    </div>
  );
}
