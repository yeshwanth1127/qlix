"use client";

import Link from "next/link";
import type { TeamDTO } from "@/lib/teams-api";
import {
  SketchBox,
  SketchPageHeader,
  SketchRow,
  sketchButton,
  sketchLabel,
} from "@/components/qlix/sketch";

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
  return (
    <div className="flex h-full min-h-0 flex-col">
      <SketchPageHeader
        title="Teams"
        actions={
          <>
            <button type="button" onClick={onRefresh} className={sketchButton}>
              Refresh
            </button>
            <button type="button" onClick={onCreateClick} className={sketchButton}>
              + New
            </button>
          </>
        }
      />

      <SketchBox className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain p-3">
        {loading ? (
          <p className={sketchLabel}>Loading…</p>
        ) : error ? (
          <p className="text-[13px] text-black">{error}</p>
        ) : teams.length === 0 ? (
          <p className="py-8 text-center font-serif text-[11px] uppercase tracking-widest text-black/50">
            No teams yet
          </p>
        ) : (
          teams.map((team) => (
            <Link key={team.id} href={`${routePrefix}/teams/${team.id}`}>
              <SketchRow className="flex items-center justify-between">
                <span className="text-[13px] text-black">{team.name}</span>
                <span className="font-serif text-[10px] uppercase text-black/50">
                  {(team.members ?? []).length} agents
                </span>
              </SketchRow>
            </Link>
          ))
        )}
      </SketchBox>
    </div>
  );
}
