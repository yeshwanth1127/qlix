"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { type AgentDTO, deleteAgent, deleteAllAgents, listAgents } from "@/lib/agents-api";
import { useSession } from "@/components/qlix/session-context";
import { canDeleteAgentRecord } from "@/lib/org-permissions";
import { cn } from "@/lib/utils/cn";
import {
  SketchBox,
  SketchListSkeleton,
  SketchPageHeader,
  SketchRow,
  sketchButtonDanger,
  sketchButtonGhost,
  sketchButtonPrimary,
  sketchButtonSecondary,
  sketchInput,
  sketchLabel,
} from "@/components/qlix/sketch";
import { CreateAgentModal } from "./CreateAgentModal";
import {
  agentListStatusClassName,
  deriveAgentDisplayStatus,
  formatDidCompact,
} from "./agentStatus";

interface AgentsSplitViewProps {
  readonly routePrefix: "/individual" | "/organization";
}

export function AgentsSplitView({ routePrefix }: AgentsSplitViewProps) {
  const { session } = useSession();

  const [agents, setAgents] = useState<AgentDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SketchPageHeader
        title="Agents"
        actions={
          <>
            {agents && agents.length > 0 ? (
              <button type="button" onClick={openConfirm} className={sketchButtonDanger}>
                Delete All
              </button>
            ) : null}
            <button type="button" onClick={() => setOpen(true)} className={sketchButtonPrimary}>
              + New
            </button>
          </>
        }
      />

      <SketchBox className="flex min-h-0 flex-1 flex-col gap-2 p-3">
        {loading ? (
          <SketchListSkeleton rows={6} />
        ) : error ? (
          <p className="text-[13px] text-black">{error}</p>
        ) : !agents || agents.length === 0 ? (
          <div className="flex flex-col items-center py-14 text-center">
            <div className="qlix-empty-glow mb-5 size-11 rounded-2xl border border-black/12 bg-[var(--sketch-tint-purple)]" />
            <p className={cn(sketchLabel, "normal-case tracking-normal text-black/50")}>
              You haven&apos;t registered any agents yet.
            </p>
            <button
              type="button"
              onClick={() => setOpen(true)}
              className={cn(sketchButtonPrimary, "mt-5")}
            >
              Register your first agent →
            </button>
          </div>
        ) : (
          agents.map((a, index) => {
            const status = deriveAgentDisplayStatus(a);
            const isProvisioning = status === "provisioning" || status === "restarting";
            return (
              <SketchRow
                key={a.id}
                className={cn(
                  "agents-list-row relative flex flex-wrap items-center justify-between gap-2 overflow-hidden",
                  isProvisioning && "border-[color:var(--warning)]/40 bg-[var(--sketch-tint-amber)]",
                )}
                style={{ animationDelay: `${index * 40}ms` } as React.CSSProperties}
              >
                <div className="min-w-[min(100%,18rem)] flex-[1_1_18rem]">
                  <Link
                    href={`${routePrefix}/agents/${a.id}`}
                    className="truncate text-[13px] font-medium text-black transition-colors hover:text-[color:var(--sketch-purple)]"
                  >
                    {a.name}
                  </Link>
                  <div className="font-mono text-[10px] text-black/40" title={a.did}>
                    {formatDidCompact(a.did)}
                  </div>
                  {isProvisioning ? (
                    <div className="mt-2 w-full max-w-sm">
                      <p className="whitespace-normal break-normal text-[11px] font-medium leading-snug text-[color:var(--warning)]">
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
                <div className="flex shrink-0 items-center gap-2.5">
                  <span
                    className={cn(
                      sketchLabel,
                      "text-[10px]",
                      agentListStatusClassName(status),
                    )}
                  >
                    {status}
                  </span>
                  <Link
                    href={`${routePrefix}/agents/${a.id}/chat`}
                    className={sketchButtonSecondary}
                  >
                    Chat
                  </Link>
                  <Link
                    href={`${routePrefix}/agents/${a.id}`}
                    className={sketchButtonGhost}
                  >
                    Details
                  </Link>
                  {canDeleteAgentRow(a) ? (
                    <button
                      type="button"
                      onClick={() => openDeleteOne(a)}
                      className={sketchButtonDanger}
                    >
                      Delete
                    </button>
                  ) : null}
                </div>
              </SketchRow>
            );
          })
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
        <div className="qlix-backdrop-in fixed inset-0 z-50 flex items-center justify-center bg-white/70 p-4 backdrop-blur-sm">
          <div className="qlix-scale-in w-full max-w-sm rounded-2xl border border-black/12 bg-white/95 p-6 shadow-[var(--sketch-shadow-hover)] backdrop-blur-xl">
            <h2 className={sketchLabel}>Delete agent?</h2>
            <p className="mt-2 text-[12px] text-black/60">
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
              <p className="mt-2 text-[12px] text-black">{deleteOneError}</p>
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
        <div className="qlix-backdrop-in fixed inset-0 z-50 flex items-center justify-center bg-white/70 p-4 backdrop-blur-sm">
          <div className="qlix-scale-in w-full max-w-sm rounded-2xl border border-black/12 bg-white/95 p-6 shadow-[var(--sketch-shadow-hover)] backdrop-blur-xl">
            <h2 className={sketchLabel}>Delete all agents?</h2>
            <p className="mt-2 text-[12px] text-black/60">
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
            {deleteError ? <p className="mt-2 text-[12px] text-black">{deleteError}</p> : null}
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
