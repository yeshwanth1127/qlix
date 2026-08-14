"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { Info, Search, Trash2 } from "lucide-react";
import { deleteTeam, type TeamDTO, type TeamStatus } from "@/lib/teams-api";
import { cn } from "@/lib/utils/cn";
import {
  SketchBox,
  SketchListSkeleton,
  SketchPageHeader,
  sketchButtonDanger,
  sketchButtonGhost,
  sketchButtonPrimary,
  sketchInput,
  sketchLabel,
} from "@/components/qlix/sketch";

interface TeamsListViewProps {
  readonly teams: TeamDTO[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly routePrefix: string;
  readonly onCreateClick: () => void;
  readonly onDeleted: (teamId: string) => void;
}

/** `text-black/NN` is force-inked inside the console, so muted copy uses the ink vars. */
const INK_SOFT = "text-[color:var(--ink-soft)]";
const INK_FAINT = "text-[color:var(--ink-faint)]";
const HAIRLINE = "border-[color:var(--ink-border)]";

/** Number of teams past which the list gets its own search field. */
const SEARCH_THRESHOLD = 6;

const STATUS_LABEL: Record<TeamStatus, string> = {
  active: "Active",
  draft: "Draft",
  archived: "Archived",
};

function teamStatusDotClassName(status: TeamStatus): string {
  if (status === "active") return "bg-[color:var(--success)]";
  if (status === "draft") return "bg-[color:var(--warning)]";
  return "bg-[color:var(--ink-faint)]";
}

function formatDidCompact(did: string): string {
  if (did.length <= 28) return did;
  return `${did.slice(0, 16)}…${did.slice(-10)}`;
}

function memberCount(team: TeamDTO): number {
  const workers = team.members?.length ?? 0;
  return workers + (team.supervisorAgentId || team.supervisorAgent ? 1 : 0);
}

export function TeamsListView({
  teams,
  loading,
  error,
  routePrefix,
  onCreateClick,
  onDeleted,
}: TeamsListViewProps) {
  const [search, setSearch] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<TeamDTO | null>(null);
  const [deleteTargetInput, setDeleteTargetInput] = useState("");
  const [deletingOne, setDeletingOne] = useState(false);
  const [deleteOneError, setDeleteOneError] = useState<string | null>(null);
  const deleteTargetRef = useRef<HTMLInputElement>(null);

  const total = teams.length;
  const activeCount = useMemo(
    () => teams.filter((t) => t.status === "active").length,
    [teams],
  );

  const visibleTeams = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return teams;
    return teams.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.did.toLowerCase().includes(q) ||
        (t.description ?? "").toLowerCase().includes(q) ||
        (t.supervisorAgent?.name ?? "").toLowerCase().includes(q),
    );
  }, [teams, search]);

  const openDeleteOne = (team: TeamDTO) => {
    setDeleteTarget(team);
    setDeleteTargetInput("");
    setDeleteOneError(null);
    setTimeout(() => deleteTargetRef.current?.focus(), 50);
  };

  const handleDeleteOne = async () => {
    if (!deleteTarget) return;
    if (deleteTargetInput.trim() !== deleteTarget.name.trim()) return;
    setDeletingOne(true);
    setDeleteOneError(null);
    try {
      await deleteTeam(deleteTarget.id, deleteTargetInput.trim());
      onDeleted(deleteTarget.id);
      setDeleteTarget(null);
    } catch (err) {
      setDeleteOneError(err instanceof Error ? err.message : "Failed to delete team");
    } finally {
      setDeletingOne(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SketchPageHeader
        title="Teams"
        subtitle={
          total > 0
            ? `${total} team${total === 1 ? "" : "s"}${activeCount > 0 ? ` · ${activeCount} active` : ""}`
            : undefined
        }
        actions={
          <>
            {total >= SEARCH_THRESHOLD ? (
              <label
                className={cn(
                  "hidden items-center gap-2 rounded-full border bg-white/60 px-3 py-1.5 sm:flex",
                  HAIRLINE,
                )}
              >
                <Search size={13} className={cn("shrink-0", INK_FAINT)} aria-hidden />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search"
                  aria-label="Search teams"
                  className="w-32 bg-transparent text-[12.5px] text-black outline-none"
                />
              </label>
            ) : null}
            <button type="button" onClick={onCreateClick} className={sketchButtonPrimary}>
              New team
            </button>
          </>
        }
      />

      <SketchBox className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {loading ? (
          <div className="p-3">
            <SketchListSkeleton rows={6} />
          </div>
        ) : error ? (
          <p className="p-5 text-[13px] text-black">{error}</p>
        ) : total === 0 ? (
          <div className="flex flex-col items-center px-6 py-20 text-center">
            <div className="qlix-empty-glow mb-6 size-11 rounded-2xl border border-black/12 bg-[var(--sketch-tint-purple)]" />
            <p className="text-[15px] font-medium text-black">No teams yet</p>
            <p className={cn("mt-1.5 max-w-xs text-[12.5px] leading-relaxed", INK_SOFT)}>
              Teams coordinate a supervisor and workers on shared runs — create one to
              start collaborating.
            </p>
            <button
              type="button"
              onClick={onCreateClick}
              className={cn(sketchButtonPrimary, "mt-6")}
            >
              Create your first team
            </button>
          </div>
        ) : visibleTeams.length === 0 ? (
          <p className={cn("px-6 py-16 text-center text-[13px]", INK_SOFT)}>
            No teams match “{search}”.
          </p>
        ) : (
          <div className="min-h-0 flex-1 divide-y divide-black/10 overflow-y-auto overscroll-contain">
            {visibleTeams.map((team, index) => {
              const count = memberCount(team);
              const supervisorName = team.supervisorAgent?.name;
              return (
                <div
                  key={team.id}
                  className="agents-list-row group relative flex items-center gap-4 px-5 py-4 transition-colors hover:bg-white/55"
                  style={{ animationDelay: `${index * 40}ms` } as React.CSSProperties}
                >
                  <Link
                    href={`${routePrefix}/teams/${team.id}`}
                    aria-label={`Open ${team.name}`}
                    className="absolute inset-0"
                  />

                  <span
                    className={cn(
                      "pointer-events-none relative grid size-8 shrink-0 place-items-center rounded-full border bg-white/70 text-[12px] font-semibold text-black",
                      HAIRLINE,
                    )}
                    aria-hidden
                  >
                    {team.name.trim().charAt(0).toUpperCase() || "•"}
                    <span
                      className={cn(
                        "absolute -bottom-0.5 -right-0.5 size-2 rounded-full ring-2 ring-white",
                        teamStatusDotClassName(team.status),
                      )}
                    />
                  </span>

                  <div className="pointer-events-none relative min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-medium text-black">{team.name}</p>
                    <p
                      className={cn(
                        "mt-0.5 flex flex-wrap items-center gap-x-2 text-[11.5px]",
                        INK_SOFT,
                      )}
                    >
                      <span>{STATUS_LABEL[team.status]}</span>
                      <span className={INK_FAINT}>·</span>
                      <span>
                        {count} agent{count === 1 ? "" : "s"}
                      </span>
                      {supervisorName ? (
                        <>
                          <span className={INK_FAINT}>·</span>
                          <span className="truncate">{supervisorName}</span>
                        </>
                      ) : null}
                      <span className={cn("hidden sm:inline", INK_FAINT)}>·</span>
                      <span
                        className={cn("hidden font-mono text-[10.5px] sm:inline", INK_FAINT)}
                        title={team.did}
                      >
                        {formatDidCompact(team.did)}
                      </span>
                    </p>
                    {team.description ? (
                      <p className={cn("mt-1 truncate text-[11.5px]", INK_FAINT)}>
                        {team.description}
                      </p>
                    ) : null}
                  </div>

                  <div className="relative flex shrink-0 items-center gap-1">
                    <Link
                      href={`${routePrefix}/teams/${team.id}`}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border bg-white/70 px-3 py-1 text-[11px] font-medium text-black transition-colors hover:bg-black hover:text-white",
                        HAIRLINE,
                      )}
                    >
                      <Info size={12} />
                      Open
                    </Link>
                    <button
                      type="button"
                      onClick={() => openDeleteOne(team)}
                      aria-label={`Delete ${team.name}`}
                      title="Delete team"
                      className={cn(
                        "grid size-7 shrink-0 place-items-center rounded-full opacity-0 transition-all hover:bg-[color:var(--sketch-red-soft)] hover:text-[color:var(--sketch-red)] focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100",
                        INK_FAINT,
                      )}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </SketchBox>

      {deleteTarget ? (
        <div className="qlix-backdrop-in fixed inset-0 z-50 flex items-center justify-center bg-white/70 p-4 backdrop-blur-sm">
          <div className="qlix-scale-in w-full max-w-sm rounded-2xl border border-black/12 bg-white/95 p-6 shadow-[var(--sketch-shadow-hover)] backdrop-blur-xl">
            <h2 className={sketchLabel}>Delete team?</h2>
            <p className={cn("mt-2 text-[12.5px] leading-relaxed", INK_SOFT)}>
              This permanently deletes{" "}
              <span className="font-medium text-black">{deleteTarget.name}</span> and its run
              history. Type the team name to confirm.
            </p>
            <input
              ref={deleteTargetRef}
              type="text"
              value={deleteTargetInput}
              onChange={(e) => setDeleteTargetInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleDeleteOne();
              }}
              placeholder={deleteTarget.name}
              autoComplete="off"
              className={cn(sketchInput, "mt-4")}
            />
            {deleteOneError ? (
              <p className="mt-2 text-[12px] text-[color:var(--sketch-red)]">{deleteOneError}</p>
            ) : null}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className={sketchButtonGhost}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteOne()}
                disabled={
                  deleteTargetInput.trim() !== deleteTarget.name.trim() || deletingOne
                }
                className={sketchButtonDanger}
              >
                {deletingOne ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
