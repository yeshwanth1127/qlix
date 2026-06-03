"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, Clock, Play, Plus, RefreshCw, Search, ShieldCheck, Sparkles, Trash2, UserPlus, Users, X } from "lucide-react";
import {
  addTeamMember,
  deleteTeam,
  deleteTeamMemberAgent,
  deleteTeamSupervisor,
  getTeam,
  getTeamRunnersStatus,
  listTeamRuns,
  reorderTeamMembers,
  setSupervisorAgent,
  updateTeamConfig,
  updateTeamMemberScopes,
  type TeamDTO,
  type TeamMemberDTO,
  type TeamRunnerStatusEntry,
  type TeamRunDTO,
  type TeamRunnersStatusDTO,
} from "@/lib/teams-api";
import { listAgents, restartCloudRunner, type AgentDTO, type PermissionScope } from "@/lib/agents-api";
import { cn } from "@/lib/utils/cn";
import { CreateAgentModal } from "@/components/qlix/agents/CreateAgentModal";
import { DelegatedScopePicker } from "@/components/qlix/teams/DelegatedScopePicker";
import { TeamRunView } from "./TeamRunView";
import { TeamRunHistoryView } from "./TeamRunHistoryView";

interface TeamDetailViewProps {
  readonly team: TeamDTO;
  readonly routePrefix: string;
  readonly deviceVerified: boolean;
  readonly onDeleted: () => void;
  readonly onUpdated: (team: TeamDTO) => void;
}

type ActiveTab = "build" | "run" | "history";

type AgentCreatePurpose = "supervisor" | "worker";
type AddMode = "create" | "existing";

const STATUS_BADGE: Record<string, string> = {
  active: "text-emerald-400 bg-emerald-400/10",
  draft: "text-yellow-400 bg-yellow-400/10",
  archived: "text-white/40 bg-white/5",
};

function runnerBadge(entry: TeamRunnerStatusEntry | undefined): {
  label: string;
  className: string;
} {
  if (!entry) return { label: "unknown", className: "text-white/30 bg-white/5" };
  if (entry.ready) return { label: "online", className: "text-emerald-400 bg-emerald-400/10" };
  if (entry.provisioningStatus === "provisioning")
    return { label: "provisioning", className: "text-yellow-400 bg-yellow-400/10" };
  if (entry.provisioningStatus === "failed")
    return { label: "failed", className: "text-red-400 bg-red-400/10" };
  return { label: "offline", className: "text-white/40 bg-white/5" };
}

function RunnerRow({
  entry,
  agentsHrefPrefix,
  onRestart,
  restarting,
}: {
  readonly entry: TeamRunnerStatusEntry | undefined;
  readonly agentsHrefPrefix: string;
  readonly onRestart: () => void;
  readonly restarting: boolean;
}) {
  if (!entry) {
    return <p className="mt-2 text-[11px] text-white/30">Loading runner status…</p>;
  }
  const badge = runnerBadge(entry);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
      <span className={cn("rounded-full px-2 py-0.5 font-medium", badge.className)}>{badge.label}</span>
      {entry.containerName && (
        <span className="font-mono text-white/25 truncate max-w-[200px]" title={entry.containerName}>
          {entry.containerName}
        </span>
      )}
      {entry.inferenceError && (
        <span className="text-red-400/80">{entry.inferenceError}</span>
      )}
      <button
        type="button"
        onClick={onRestart}
        disabled={restarting}
        className="inline-flex items-center gap-1 text-indigo-400 hover:text-indigo-300 disabled:opacity-40"
        title="Stop container, rebuild Docker image with latest SDK, restart"
      >
        <RefreshCw size={11} className={restarting ? "animate-spin" : ""} />
        {restarting ? "Rebuilding…" : "Rebuild"}
      </button>
      <Link
        href={`${agentsHrefPrefix}/agents/${entry.agentId}`}
        className="text-white/30 hover:text-white/60"
      >
        Agent detail →
      </Link>
    </div>
  );
}

export function TeamDetailView({ team, routePrefix, deviceVerified, onDeleted, onUpdated }: TeamDetailViewProps) {
  const [tab, setTab] = useState<ActiveTab>("build");
  const [deleting, setDeleting] = useState(false);
  const [showCreateAgent, setShowCreateAgent] = useState(false);
  const [createPurpose, setCreatePurpose] = useState<AgentCreatePurpose>("supervisor");
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [runnersStatus, setRunnersStatus] = useState<TeamRunnersStatusDTO | null>(null);
  const [restartingId, setRestartingId] = useState<string | null>(null);
  const [historyRuns, setHistoryRuns] = useState<TeamRunDTO[]>([]);
  const [showExistingPicker, setShowExistingPicker] = useState(false);
  const [pickerPurpose, setPickerPurpose] = useState<AgentCreatePurpose>("worker");
  const [existingAgents, setExistingAgents] = useState<AgentDTO[]>([]);
  const [pickerSearch, setPickerSearch] = useState("");
  const [pickerLoading, setPickerLoading] = useState(false);
  const [addingExistingId, setAddingExistingId] = useState<string | null>(null);
  const [pendingWorkerAgent, setPendingWorkerAgent] = useState<AgentDTO | null>(null);
  const [pickerDelegatedScopes, setPickerDelegatedScopes] = useState<PermissionScope[]>([]);
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [editScopes, setEditScopes] = useState<PermissionScope[]>([]);
  const [reorderingId, setReorderingId] = useState<string | null>(null);
  const [togglingAutoSequence, setTogglingAutoSequence] = useState(false);
  const [savingMemberScopes, setSavingMemberScopes] = useState(false);

  const workerCount = team.members?.length ?? 0;
  const allReady = runnersStatus?.allReady ?? false;
  const canRun = allReady;

  const runnerByAgentId = useCallback(
    (agentId: string) => runnersStatus?.runners.find((r) => r.agentId === agentId),
    [runnersStatus],
  );

  const pollRunners = useCallback(async () => {
    try {
      const status = await getTeamRunnersStatus(team.id);
      setRunnersStatus(status);
    } catch {
      // ignore transient errors
    }
  }, [team.id]);

  useEffect(() => {
    if (tab !== "build") return;
    void pollRunners();
    const interval = setInterval(() => void pollRunners(), 2500);
    return () => clearInterval(interval);
  }, [tab, pollRunners]);

  useEffect(() => {
    if (tab !== "history") return;
    void listTeamRuns(team.id).then(setHistoryRuns).catch(() => {});
  }, [tab, team.id]);

  async function handleRestartRunner(agentId: string) {
    setRestartingId(agentId);
    try {
      await restartCloudRunner(agentId);
      await pollRunners();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to restart runner");
    } finally {
      setRestartingId(null);
    }
  }

  function promptConfirmName(label: string, expected: string): string | null {
    const typed = window.prompt(
      `This permanently deletes ${label} from the database and stops/removes its Docker runner.\n\nType "${expected}" to confirm:`,
    );
    if (typed == null) return null;
    return typed.trim();
  }

  async function handleDelete() {
    const confirmName = promptConfirmName("this team and all its agents", team.name);
    if (!confirmName) return;
    if (confirmName !== team.name.trim()) {
      alert("Team name did not match.");
      return;
    }
    setDeleting(true);
    try {
      await deleteTeam(team.id, confirmName);
      onDeleted();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete team");
      setDeleting(false);
    }
  }

  async function handleDeleteSupervisor() {
    const name = team.supervisorAgent?.name;
    if (!name) return;
    const confirmName = promptConfirmName("the supervisor agent", name);
    if (!confirmName) return;
    if (confirmName !== name.trim()) {
      alert("Agent name did not match.");
      return;
    }
    setActionError(null);
    try {
      const updated = await deleteTeamSupervisor(team.id, confirmName);
      onUpdated(updated);
      await pollRunners();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to delete supervisor");
    }
  }

  async function handleDeleteWorker(member: TeamMemberDTO) {
    const name = member.agent?.name ?? member.agentId;
    const confirmName = promptConfirmName("this worker agent", name);
    if (!confirmName) return;
    if (confirmName !== name.trim()) {
      alert("Agent name did not match.");
      return;
    }
    setRemovingId(member.agentId);
    try {
      await deleteTeamMemberAgent(team.id, member.agentId, confirmName);
      const updated = await getTeam(team.id);
      onUpdated(updated);
      await pollRunners();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete worker");
    } finally {
      setRemovingId(null);
    }
  }

  function openCreateSupervisor() {
    setCreatePurpose("supervisor");
    setActionError(null);
    setShowCreateAgent(true);
  }

  function openCreateWorker() {
    setCreatePurpose("worker");
    setActionError(null);
    setShowCreateAgent(true);
  }

  async function openExistingPicker(purpose: AgentCreatePurpose) {
    setPickerPurpose(purpose);
    setPickerSearch("");
    setActionError(null);
    setShowExistingPicker(true);
    setPickerLoading(true);
    try {
      const agents = await listAgents(team.orgId);
      // Only cloud agents, exclude already-in-team agents and supervisor
      const existingIds = new Set([
        ...(team.members?.map((m) => m.agentId) ?? []),
        ...(team.supervisorAgentId ? [team.supervisorAgentId] : []),
      ]);
      setExistingAgents(
        (agents ?? []).filter(
          (a) => (a.runtime === "cloud" || a.runtime === "hybrid") && !existingIds.has(a.id),
        ),
      );
    } catch {
      setActionError("Failed to load agents");
      setShowExistingPicker(false);
    } finally {
      setPickerLoading(false);
    }
  }

  async function handleAddExistingAgent(agent: AgentDTO, delegatedScopes?: PermissionScope[]) {
    setAddingExistingId(agent.id);
    setActionError(null);
    try {
      if (pickerPurpose === "supervisor") {
        const updated = await setSupervisorAgent(team.id, agent.id);
        onUpdated(updated);
        setShowExistingPicker(false);
        setPendingWorkerAgent(null);
      } else {
        const scopes = delegatedScopes ?? pickerDelegatedScopes;
        await addTeamMember(team.id, {
          agentId: agent.id,
          role: "worker",
          delegatedScopes: scopes,
        });
        const updated = await getTeam(team.id);
        onUpdated(updated);
        setShowExistingPicker(false);
        setPendingWorkerAgent(null);
      }
      await pollRunners();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to add agent to team");
    } finally {
      setAddingExistingId(null);
    }
  }

  function selectWorkerForScopes(agent: AgentDTO) {
    setPendingWorkerAgent(agent);
    setPickerDelegatedScopes(agent.permissionScopes ?? []);
  }

  async function saveMemberScopes(member: TeamMemberDTO) {
    setSavingMemberScopes(true);
    setActionError(null);
    try {
      await updateTeamMemberScopes(team.id, member.agentId, editScopes);
      const updated = await getTeam(team.id);
      onUpdated(updated);
      setEditingMemberId(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to update scopes");
    } finally {
      setSavingMemberScopes(false);
    }
  }

  async function handleAgentCreated(agent: { id: string; name: string }) {
    setShowCreateAgent(false);
    setActionError(null);
    try {
      if (createPurpose === "supervisor") {
        const updated = await setSupervisorAgent(team.id, agent.id);
        onUpdated(updated);
      } else {
        await addTeamMember(team.id, {
          agentId: agent.id,
          role: "worker",
          delegatedScopes: [],
        });
        const updated = await getTeam(team.id);
        onUpdated(updated);
      }
      await pollRunners();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to configure agent for team");
    }
  }


  async function handleMoveMember(member: TeamMemberDTO, direction: "up" | "down") {
    if (reorderingId || team.config.autoSequence) return;
    const ordered = [...(team.members ?? [])].sort(
      (a, b) => (a.stageOrder ?? 0) - (b.stageOrder ?? 0) || a.addedAt.localeCompare(b.addedAt),
    );
    const i = ordered.findIndex((m) => m.id === member.id);
    if (i < 0) return;
    const j = direction === "up" ? i - 1 : i + 1;
    if (j < 0 || j >= ordered.length) return;
    const next = [...ordered];
    [next[i], next[j]] = [next[j]!, next[i]!];
    const optimisticMembers = next.map((m, idx) => ({ ...m, stageOrder: idx + 1 }));
    const previousMembers = team.members;
    setReorderingId(member.id);
    setActionError(null);
    onUpdated({ ...team, members: optimisticMembers });
    try {
      const updated = await reorderTeamMembers(team.id, next.map((m) => m.id));
      onUpdated(updated);
    } catch (err) {
      onUpdated({ ...team, members: previousMembers });
      setActionError(err instanceof Error ? err.message : "Failed to reorder pipeline");
    } finally {
      setReorderingId(null);
    }
  }

  async function handleToggleAutoSequence(next: boolean) {
    if (togglingAutoSequence) return;
    setTogglingAutoSequence(true);
    setActionError(null);
    try {
      const updated = await updateTeamConfig(team.id, { autoSequence: next });
      onUpdated(updated);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to update team config");
    } finally {
      setTogglingAutoSequence(false);
    }
  }

  const tabs: { id: ActiveTab; label: string; disabled?: boolean }[] = [
    { id: "build", label: "Build" },
    { id: "run", label: "Run", disabled: !canRun },
    { id: "history", label: "History" },
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-white/90">{team.name}</h2>
            <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", STATUS_BADGE[team.status] ?? "text-white/40 bg-white/5")}>
              {team.status === "draft" ? "Draft — needs supervisor" : team.status}
            </span>
          </div>
          {team.description && (
            <p className="mt-0.5 text-xs text-white/50">{team.description}</p>
          )}
          <p className="mt-1 text-xs text-white/30 font-mono">{team.did}</p>
          <div className="mt-2 rounded border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 max-w-xl">
            <p className="text-[10px] font-medium text-emerald-300/90">WhatsApp (self-chat)</p>
            <p className="mt-1 text-[11px] font-mono text-white/55 break-all">
              @{team.name}: &lt;goal&gt; or @{team.name} &lt;goal&gt;
            </p>
            <p className="mt-1 text-[10px] text-white/35">
              Teams run only with @. @ &lt;goal&gt; uses the default team from Connectors. Mid-run: @ more guidance · !status · !cancel
            </p>
          </div>
        </div>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="flex items-center gap-1.5 rounded px-3 py-1.5 text-xs text-red-400 hover:bg-red-400/10 transition-colors disabled:opacity-40"
        >
          <Trash2 size={13} />
          Delete
        </button>
      </div>

      <div className="flex border-b border-white/10 px-6">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => !t.disabled && setTab(t.id)}
            disabled={t.disabled}
            className={cn(
              "mr-4 py-2 text-xs font-medium capitalize transition-colors",
              t.disabled
                ? "text-white/20 cursor-not-allowed"
                : tab === t.id
                  ? "border-b-2 border-indigo-500 text-indigo-400"
                  : "text-white/40 hover:text-white/70",
            )}
          >
            {t.label}
            {t.id === "run" && !canRun && (
              <span className="ml-1 text-white/20">(runners not ready)</span>
            )}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto">
        {tab === "build" && (
          <div className="px-6 py-5 space-y-6">
            {actionError && (
              <div className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
                {actionError}
              </div>
            )}

            <div>
              <div className="flex items-center gap-2 mb-3">
                <ShieldCheck size={14} className="text-indigo-400" />
                <span className="text-xs font-semibold text-white/70">Supervisor Agent</span>
                <span className="text-xs text-white/30">(required, cloud)</span>
              </div>

              {team.supervisorAgent ? (
                <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/5 px-4 py-3">
                  <p className="text-sm font-medium text-white/85">{team.supervisorAgent.name}</p>
                  <p className="text-xs text-white/40 font-mono mt-0.5">{team.supervisorAgent.did}</p>
                  <RunnerRow
                    entry={runnerByAgentId(team.supervisorAgent.id)}
                    agentsHrefPrefix={routePrefix}
                    onRestart={() => handleRestartRunner(team.supervisorAgent!.id)}
                    restarting={restartingId === team.supervisorAgent.id}
                  />
                  <div className="mt-2 flex items-center gap-3">
                    <button
                      onClick={openCreateSupervisor}
                      className="text-xs text-indigo-400/70 hover:text-indigo-400 transition-colors"
                    >
                      Replace supervisor
                    </button>
                    <button
                      onClick={handleDeleteSupervisor}
                      className="flex items-center gap-1 text-xs text-red-400/70 hover:text-red-400 transition-colors"
                      title="Deletes supervisor agent from DB and Docker"
                    >
                      <Trash2 size={13} />
                      Delete
                    </button>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-white/15 bg-white/3 px-4 py-5 flex flex-col items-center gap-3">
                  <p className="text-xs text-white/40 text-center">
                    Cloud supervisor runs in Docker (ADK). It decomposes goals, delegates to workers, and synthesizes results.
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={openCreateSupervisor}
                      className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
                    >
                      <ShieldCheck size={13} />
                      Create New
                    </button>
                    <button
                      onClick={() => void openExistingPicker("supervisor")}
                      className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-medium border border-white/15 hover:bg-white/5 text-white/60 hover:text-white/90 transition-colors"
                    >
                      <Plus size={13} />
                      Use Existing Agent
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Users size={14} className="text-white/50" />
                  <span className="text-xs font-semibold text-white/70">
                    Worker Agents
                    {workerCount > 0 && <span className="ml-1.5 text-white/40">({workerCount})</span>}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={openCreateWorker}
                    className="flex items-center gap-1 rounded px-2.5 py-1.5 text-xs font-medium text-indigo-400 border border-indigo-500/30 hover:bg-indigo-500/10 transition-colors"
                  >
                    <UserPlus size={12} />
                    Create New
                  </button>
                  <button
                    onClick={() => void openExistingPicker("worker")}
                    className="flex items-center gap-1 rounded px-2.5 py-1.5 text-xs font-medium text-white/50 border border-white/15 hover:bg-white/5 hover:text-white/80 transition-colors"
                  >
                    <Plus size={12} />
                    Use Existing
                  </button>
                </div>
              </div>

              {/* Pipeline sequencing controls */}
              <div className="mb-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2 flex items-start gap-3">
                <Sparkles size={14} className="mt-0.5 shrink-0 text-indigo-400/80" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-medium text-white/80">Pipeline order</p>
                    <label className="flex items-center gap-2 text-[11px] text-white/60 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={Boolean(team.config.autoSequence)}
                        onChange={(e) => void handleToggleAutoSequence(e.target.checked)}
                        disabled={togglingAutoSequence}
                        className="size-3.5 rounded border-white/20 bg-white/10 accent-indigo-500"
                      />
                      Auto-sequence (supervisor decides on every run)
                    </label>
                  </div>
                  <p className="mt-1 text-[11px] text-white/40">
                    {team.config.autoSequence
                      ? "Supervisor LLM picks the order on every run from each agent's description. Stage numbers below are ignored."
                      : "Workers run strictly in the order shown below. Add agents in any order — use the arrows to set the sequence."}
                  </p>
                </div>
              </div>

              {team.members && team.members.length > 0 ? (
                <div className="space-y-2">
                  {[...team.members]
                    .sort(
                      (a, b) =>
                        (a.stageOrder ?? 0) - (b.stageOrder ?? 0) ||
                        a.addedAt.localeCompare(b.addedAt),
                    )
                    .map((m, idx, arr) => (
                    <div key={m.id} className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 flex items-start gap-3">
                      {/* Stage badge + reorder arrows. Greyed when autoSequence is on. */}
                      <div
                        className={cn(
                          "flex flex-col items-center gap-0.5 shrink-0 pt-0.5",
                          team.config.autoSequence && "opacity-30",
                        )}
                        title={
                          team.config.autoSequence
                            ? "Auto-sequence is on — stage order is ignored"
                            : "Pipeline stage"
                        }
                      >
                        <button
                          type="button"
                          onClick={() => void handleMoveMember(m, "up")}
                          disabled={
                            team.config.autoSequence || idx === 0 || reorderingId !== null
                          }
                          className="rounded p-0.5 text-white/40 hover:text-indigo-400 disabled:opacity-25 disabled:hover:text-white/40"
                          aria-label="Move stage up"
                        >
                          <ArrowUp size={11} />
                        </button>
                        <span className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-white/70 tabular-nums">
                          {idx + 1}
                        </span>
                        <button
                          type="button"
                          onClick={() => void handleMoveMember(m, "down")}
                          disabled={
                            team.config.autoSequence ||
                            idx === arr.length - 1 ||
                            reorderingId !== null
                          }
                          className="rounded p-0.5 text-white/40 hover:text-indigo-400 disabled:opacity-25 disabled:hover:text-white/40"
                          aria-label="Move stage down"
                        >
                          <ArrowDown size={11} />
                        </button>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white/80">{m.agent?.name ?? m.agentId}</p>
                        <p className="text-xs text-white/40 mt-0.5">
                          Role: <span className="text-white/60">{m.role}</span>
                          {m.delegatedScopes.length > 0 && (
                            <span className="ml-2 text-white/30">
                              · {m.delegatedScopes.join(", ")}
                            </span>
                          )}
                        </p>
                        {editingMemberId === m.id ? (
                          <div className="mt-2 space-y-2">
                            <DelegatedScopePicker
                              availableScopes={m.agent?.permissionScopes ?? []}
                              selected={editScopes}
                              onChange={setEditScopes}
                              disabled={savingMemberScopes}
                            />
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => void saveMemberScopes(m)}
                                disabled={savingMemberScopes}
                                className="text-[11px] text-indigo-400 hover:text-indigo-300"
                              >
                                Save scopes
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingMemberId(null)}
                                className="text-[11px] text-white/35 hover:text-white/60"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingMemberId(m.id);
                              setEditScopes(m.delegatedScopes);
                            }}
                            className="mt-1 text-[11px] text-white/30 hover:text-indigo-400"
                          >
                            Edit delegated scopes
                          </button>
                        )}
                        <RunnerRow
                          entry={runnerByAgentId(m.agentId)}
                          agentsHrefPrefix={routePrefix}
                          onRestart={() => handleRestartRunner(m.agentId)}
                          restarting={restartingId === m.agentId}
                        />
                      </div>
                      <button
                        onClick={() => handleDeleteWorker(m)}
                        disabled={removingId === m.agentId}
                        className="flex items-center gap-1 text-xs text-red-400/70 hover:text-red-400 transition-colors disabled:opacity-40"
                        title="Deletes agent from DB and Docker"
                      >
                        <Trash2 size={13} />
                        Delete
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-white/30 py-2">
                  No worker agents yet. Each worker gets its own cloud Docker runner on the team network.
                </p>
              )}
            </div>

            {allReady ? (
              <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 flex items-center gap-2">
                <Play size={13} className="text-emerald-400 shrink-0" />
                <p className="text-xs text-emerald-300/80">
                  All cloud runners are online. Switch to the <strong>Run</strong> tab to start a task.
                </p>
              </div>
            ) : (
              <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-4 py-3 flex items-center gap-2">
                <Clock size={13} className="text-yellow-400 shrink-0" />
                <p className="text-xs text-yellow-300/80">
                  Waiting for cloud runners: need supervisor + at least one worker, all with fresh heartbeat.
                  Filter Docker: <code className="font-mono text-white/50">docker ps --filter label=com.qlix.team.id={team.id}</code>
                </p>
              </div>
            )}
          </div>
        )}

        {tab === "run" && canRun && (
          <TeamRunView team={team} onRunStarted={() => {}} />
        )}

        {tab === "history" && (
          <TeamRunHistoryView
            teamId={team.id}
            runs={historyRuns}
            onRefresh={async () => {
              const runs = await listTeamRuns(team.id);
              setHistoryRuns(runs);
            }}
          />
        )}
      </div>

      {showCreateAgent && (
        <CreateAgentModal
          open={showCreateAgent}
          orgId={team.orgId}
          deviceVerified={deviceVerified}
          cloudOnly
          onClose={() => setShowCreateAgent(false)}
          onCreated={handleAgentCreated}
        />
      )}

      {showExistingPicker && (
        <ExistingAgentPicker
          purpose={pickerPurpose}
          agents={existingAgents}
          loading={pickerLoading}
          search={pickerSearch}
          addingId={addingExistingId}
          pendingWorkerAgent={pendingWorkerAgent}
          pickerDelegatedScopes={pickerDelegatedScopes}
          onPickerScopesChange={setPickerDelegatedScopes}
          onSearchChange={setPickerSearch}
          onAdd={(agent) => void handleAddExistingAgent(agent)}
          onSelectWorker={selectWorkerForScopes}
          onClose={() => {
            setShowExistingPicker(false);
            setPendingWorkerAgent(null);
          }}
        />
      )}
    </div>
  );
}

function ExistingAgentPicker({
  purpose,
  agents,
  loading,
  search,
  addingId,
  pendingWorkerAgent,
  pickerDelegatedScopes,
  onPickerScopesChange,
  onSearchChange,
  onAdd,
  onSelectWorker,
  onClose,
}: {
  readonly purpose: AgentCreatePurpose;
  readonly agents: AgentDTO[];
  readonly loading: boolean;
  readonly search: string;
  readonly addingId: string | null;
  readonly pendingWorkerAgent: AgentDTO | null;
  readonly pickerDelegatedScopes: PermissionScope[];
  readonly onPickerScopesChange: (scopes: PermissionScope[]) => void;
  readonly onSearchChange: (v: string) => void;
  readonly onAdd: (agent: AgentDTO) => void;
  readonly onSelectWorker: (agent: AgentDTO) => void;
  readonly onClose: () => void;
}) {
  const filtered = agents.filter(
    (a) =>
      a.name.toLowerCase().includes(search.toLowerCase()) ||
      (a.description ?? "").toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="relative w-full max-w-md rounded-xl border border-white/10 bg-[#0e0e12] shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-white/90">
              Use existing agent as {purpose}
            </h2>
            <p className="mt-0.5 text-xs text-white/40">
              Only cloud agents not already in this team are shown.
            </p>
          </div>
          <button onClick={onClose} className="text-white/30 hover:text-white/70">
            <X size={16} />
          </button>
        </div>

        <div className="px-5 pt-3 pb-1">
          <div className="flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-1.5">
            <Search size={13} className="text-white/30 shrink-0" />
            <input
              type="text"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search agents…"
              className="flex-1 bg-transparent text-xs text-white/80 outline-none placeholder:text-white/25"
              autoFocus
            />
          </div>
        </div>

        <div className="max-h-72 overflow-auto px-5 py-2 space-y-1">
          {loading ? (
            <p className="py-4 text-center text-xs text-white/30">Loading agents…</p>
          ) : filtered.length === 0 ? (
            <p className="py-4 text-center text-xs text-white/30">
              {agents.length === 0
                ? "No eligible cloud agents found. Create one on the Agents page first."
                : "No agents match your search."}
            </p>
          ) : (
            filtered.map((agent) => (
              <div
                key={agent.id}
                className="flex items-center justify-between rounded-lg border border-white/8 bg-white/4 px-3 py-2.5 hover:bg-white/7 transition-colors"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white/85 truncate">{agent.name}</p>
                  {agent.description && (
                    <p className="text-xs text-white/40 truncate mt-0.5">{agent.description}</p>
                  )}
                  <p className="text-xs text-white/25 font-mono truncate mt-0.5">
                    {agent.cloudProvisioningStatus ?? agent.status}
                  </p>
                </div>
                <button
                  onClick={() =>
                    purpose === "worker" ? onSelectWorker(agent) : onAdd(agent)
                  }
                  disabled={addingId === agent.id}
                  className="ml-3 shrink-0 rounded px-3 py-1 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white transition-colors disabled:opacity-50"
                >
                  {addingId === agent.id ? "Adding…" : purpose === "worker" ? "Select" : "Add"}
                </button>
              </div>
            ))
          )}
        </div>

        {purpose === "worker" && pendingWorkerAgent && (
          <div className="border-t border-white/10 px-5 py-3 space-y-2">
            <p className="text-xs text-white/50">
              Delegated scopes for <strong className="text-white/80">{pendingWorkerAgent.name}</strong>
            </p>
            <DelegatedScopePicker
              availableScopes={pendingWorkerAgent.permissionScopes ?? []}
              selected={pickerDelegatedScopes}
              onChange={onPickerScopesChange}
            />
            <button
              type="button"
              onClick={() => onAdd(pendingWorkerAgent)}
              disabled={addingId === pendingWorkerAgent.id}
              className="rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              Add worker with selected scopes
            </button>
          </div>
        )}

        <div className="border-t border-white/10 px-5 py-3 flex justify-end">
          <button
            onClick={onClose}
            className="text-xs text-white/40 hover:text-white/70 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
