"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Info, Search, Trash2 } from "lucide-react";
import { type AgentDTO, deleteAgent, deleteAllAgents, listAgents } from "@/lib/agents-api";
import { useSession } from "@/components/qlix/session-context";
import { canDeleteAgentRecord } from "@/lib/org-permissions";
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
import { CreateAgentModal } from "./CreateAgentModal";
import {
  agentRuntimeLabel,
  agentStatusDotClassName,
  agentStatusLabel,
  deriveAgentDisplayStatus,
  formatDidCompact,
} from "./agentStatus";

interface AgentsSplitViewProps {
  readonly routePrefix: "/individual" | "/organization";
}

/** `text-black/NN` is force-inked inside the console, so muted copy uses the ink vars. */
const INK_SOFT = "text-[color:var(--ink-soft)]";
const INK_FAINT = "text-[color:var(--ink-faint)]";
const HAIRLINE = "border-[color:var(--ink-border)]";

const quietButton =
  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] text-[color:var(--ink-soft)] transition-colors hover:bg-black/[0.05] hover:text-black disabled:pointer-events-none disabled:opacity-40";

/** Number of agents past which the list gets its own search field. */
const SEARCH_THRESHOLD = 6;

export function AgentsSplitView({ routePrefix }: AgentsSplitViewProps) {
  const { session } = useSession();

  const [agents, setAgents] = useState<AgentDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmInput, setConfirmInput] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const [deleteTarget, setDeleteTarget] = useState<AgentDTO | null>(null);
  const [deleteTargetInput, setDeleteTargetInput] = useState("");
  const [deletingOne, setDeletingOne] = useState(false);
  const [deleteOneError, setDeleteOneError] = useState<string | null>(null);
  const deleteTargetRef = useRef<HTMLInputElement>(null);

  const isOrg = routePrefix === "/organization";
  const orgId = isOrg ? (session?.organization.id ?? null) : null;

  const refresh = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const data = await listAgents(orgId);
      if (!data) {
        setError("Could not load agents (try signing in again).");
        setAgents(null);
        return;
      }
      setAgents(data);
    } catch {
      setError("Network error");
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const hasProvisioningAgents =
    agents?.some((agent) => {
      const status = deriveAgentDisplayStatus(agent);
      return status === "provisioning" || status === "restarting";
    }) ?? false;

  useEffect(() => {
    if (!hasProvisioningAgents) return;
    const timer = window.setInterval(() => void refresh(false), 2500);
    return () => window.clearInterval(timer);
  }, [hasProvisioningAgents, refresh]);

  const onlineCount = useMemo(
    () =>
      (agents ?? []).filter((a) => {
        const s = deriveAgentDisplayStatus(a);
        return s === "online" || s === "active";
      }).length,
    [agents],
  );

  const visibleAgents = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return agents ?? [];
    return (agents ?? []).filter(
      (a) => a.name.toLowerCase().includes(q) || a.did.toLowerCase().includes(q),
    );
  }, [agents, search]);

  const openConfirm = () => {
    setConfirmInput("");
    setDeleteError(null);
    setConfirmOpen(true);
    setTimeout(() => confirmRef.current?.focus(), 50);
  };

  const handleDeleteAll = async () => {
    if (confirmInput !== "DELETE") return;
    setDeleting(true);
    setDeleteError(null);
    const result = await deleteAllAgents();
    setDeleting(false);
    if (result.ok) {
      setConfirmOpen(false);
      setAgents([]);
    } else {
      setDeleteError(result.errorMessage ?? "Failed to delete agents");
    }
  };

  const handleCreated = (agent: AgentDTO) => {
    setAgents((prev) => [agent, ...(prev ?? [])]);
  };

  const canDeleteAgentRow = (agent: AgentDTO): boolean =>
    session != null && canDeleteAgentRecord(agent, session);

  const openDeleteOne = (agent: AgentDTO) => {
    setDeleteTarget(agent);
    setDeleteTargetInput("");
    setDeleteOneError(null);
    setTimeout(() => deleteTargetRef.current?.focus(), 50);
  };

  const handleDeleteOne = async () => {
    if (!deleteTarget) return;
    if (deleteTargetInput.trim() !== deleteTarget.name.trim()) return;
    setDeletingOne(true);
    setDeleteOneError(null);
    const result = await deleteAgent(deleteTarget.id, deleteTargetInput.trim());
    setDeletingOne(false);
    if (result.ok) {
      setAgents((prev) => prev?.filter((a) => a.id !== deleteTarget.id) ?? []);
      setDeleteTarget(null);
      return;
    }
    setDeleteOneError(result.errorMessage ?? "Failed to delete agent");
  };

  const total = agents?.length ?? 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SketchPageHeader
        title="Agents"
        subtitle={
          total > 0
            ? `${total} agent${total === 1 ? "" : "s"}${onlineCount > 0 ? ` · ${onlineCount} online` : ""}`
            : undefined
        }
        actions={
          <>
            {total >= SEARCH_THRESHOLD ? (
              <label
                className={cn(
                  "hidden items-center gap-2 rounded-full border bg-[#E2F0CC]/60 px-3 py-1.5 sm:flex",
                  HAIRLINE,
                )}
              >
                <Search size={13} className={cn("shrink-0", INK_FAINT)} aria-hidden />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search"
                  aria-label="Search agents"
                  className="w-32 bg-transparent text-[12.5px] text-black outline-none"
                />
              </label>
            ) : null}
            {total > 0 ? (
              <button type="button" onClick={openConfirm} className={quietButton}>
                Delete all
              </button>
            ) : null}
            <button type="button" onClick={() => setOpen(true)} className={sketchButtonPrimary}>
              New agent
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
            <p className="text-[15px] font-medium text-black">No agents yet</p>
            <p className={cn("mt-1.5 max-w-xs text-[12.5px] leading-relaxed", INK_SOFT)}>
              Agents do the work for you — describe what you need and Qlix builds one.
            </p>
            <button
              type="button"
              onClick={() => setOpen(true)}
              className={cn(sketchButtonPrimary, "mt-6")}
            >
              Create your first agent
            </button>
          </div>
        ) : visibleAgents.length === 0 ? (
          <p className={cn("px-6 py-16 text-center text-[13px]", INK_SOFT)}>
            No agents match “{search}”.
          </p>
        ) : (
          <div className="min-h-0 flex-1 divide-y divide-black/10 overflow-y-auto overscroll-contain">
            {visibleAgents.map((a, index) => {
              const status = deriveAgentDisplayStatus(a);
              const isProvisioning = status === "provisioning" || status === "restarting";
              return (
                <div
                  key={a.id}
                  className="agents-list-row group relative flex items-center gap-4 px-5 py-4 transition-colors hover:bg-[#E2F0CC]/55"
                  style={{ animationDelay: `${index * 40}ms` } as React.CSSProperties}
                >
                  <Link
                    href={`${routePrefix}/agents/${a.id}/chat`}
                    aria-label={`Chat with ${a.name}`}
                    className="absolute inset-0"
                  />

                  <span
                    className={cn(
                      "pointer-events-none relative grid size-8 shrink-0 place-items-center rounded-full border bg-[#E2F0CC]/70 text-[12px] font-semibold text-black",
                      HAIRLINE,
                    )}
                    aria-hidden
                  >
                    {a.name.trim().charAt(0).toUpperCase() || "•"}
                    <span
                      className={cn(
                        "absolute -bottom-0.5 -right-0.5 size-2 rounded-full ring-2 ring-white",
                        agentStatusDotClassName(status),
                      )}
                    />
                  </span>

                  <div className="pointer-events-none relative min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-medium text-black">{a.name}</p>
                    <p
                      className={cn(
                        "mt-0.5 flex flex-wrap items-center gap-x-2 text-[11.5px]",
                        INK_SOFT,
                      )}
                    >
                      <span>{agentStatusLabel(status)}</span>
                      <span className={INK_FAINT}>·</span>
                      <span>{agentRuntimeLabel(a.runtime, a.agentKind)}</span>
                      <span className={cn("hidden sm:inline", INK_FAINT)}>·</span>
                      <span
                        className={cn("hidden font-mono text-[10.5px] sm:inline", INK_FAINT)}
                        title={a.did}
                      >
                        {formatDidCompact(a.did)}
                      </span>
                    </p>

                    {isProvisioning ? (
                      <div className="mt-2 w-full max-w-sm">
                        <p className="text-[11px] leading-snug text-[color:var(--warning)]">
                          Building your agent. This might take a few minutes.
                        </p>
                        <div
                          className="mt-1.5 h-1 overflow-hidden rounded-full bg-black/8"
                          role="progressbar"
                          aria-label={`Building ${a.name}`}
                        >
                          <div className="create-agent-progress-shimmer h-full w-1/3 rounded-full bg-[color:var(--sketch-purple)]" />
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className="relative flex shrink-0 items-center gap-1">
                    <Link
                      href={`${routePrefix}/agents/${a.id}`}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border bg-[#E2F0CC]/70 px-3 py-1 text-[11px] font-medium text-black transition-colors hover:bg-black hover:text-white",
                        HAIRLINE,
                      )}
                    >
                      <Info size={12} />
                      Details
                    </Link>
                    {canDeleteAgentRow(a) ? (
                      <button
                        type="button"
                        onClick={() => openDeleteOne(a)}
                        aria-label={`Delete ${a.name}`}
                        title="Delete agent"
                        className={cn(
                          "grid size-7 shrink-0 place-items-center rounded-full opacity-0 transition-all hover:bg-[color:var(--sketch-red-soft)] hover:text-[color:var(--sketch-red)] focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100",
                          INK_FAINT,
                        )}
                      >
                        <Trash2 size={13} />
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </SketchBox>

      <CreateAgentModal
        open={open}
        onClose={() => {
          setOpen(false);
          void refresh();
        }}
        onCreated={handleCreated}
        orgId={orgId}
      />

      {deleteTarget ? (
        <div className="qlix-backdrop-in fixed inset-0 z-50 flex items-center justify-center bg-[#E2F0CC]/70 p-4 backdrop-blur-sm">
          <div className="qlix-scale-in w-full max-w-sm rounded-2xl border border-black/12 bg-[#E2F0CC]/95 p-6 shadow-[var(--sketch-shadow-hover)] backdrop-blur-xl">
            <h2 className={sketchLabel}>Delete agent?</h2>
            <p className={cn("mt-2 text-[12.5px] leading-relaxed", INK_SOFT)}>
              This permanently deletes{" "}
              <span className="font-medium text-black">{deleteTarget.name}</span>, its credentials,
              and audit rows. Type the agent name to confirm.
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

      {confirmOpen ? (
        <div className="qlix-backdrop-in fixed inset-0 z-50 flex items-center justify-center bg-[#E2F0CC]/70 p-4 backdrop-blur-sm">
          <div className="qlix-scale-in w-full max-w-sm rounded-2xl border border-black/12 bg-[#E2F0CC]/95 p-6 shadow-[var(--sketch-shadow-hover)] backdrop-blur-xl">
            <h2 className={sketchLabel}>Delete all agents?</h2>
            <p className={cn("mt-2 text-[12.5px] leading-relaxed", INK_SOFT)}>
              Type DELETE to confirm. This cannot be undone.
            </p>
            <input
              ref={confirmRef}
              type="text"
              value={confirmInput}
              onChange={(e) => setConfirmInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleDeleteAll();
              }}
              placeholder="DELETE"
              className={cn(sketchInput, "mt-4")}
            />
            {deleteError ? (
              <p className="mt-2 text-[12px] text-[color:var(--sketch-red)]">{deleteError}</p>
            ) : null}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmOpen(false)} className={sketchButtonGhost}>
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteAll()}
                disabled={confirmInput !== "DELETE" || deleting}
                className={sketchButtonDanger}
              >
                {deleting ? "Deleting…" : "Delete all"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
