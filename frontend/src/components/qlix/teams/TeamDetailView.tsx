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
import {
  SketchBox,
  SketchRow,
  sketchButton,
  sketchInput,
  sketchLabel,
} from "@/components/qlix/sketch";
import { CreateAgentModal } from "@/components/qlix/agents/CreateAgentModal";
import { DelegatedScopePicker } from "@/components/qlix/teams/DelegatedScopePicker";
import { TeamRunView } from "./TeamRunView";
import { TeamRunHistoryView } from "./TeamRunHistoryView";

interface TeamDetailViewProps {
  readonly team: TeamDTO;
  readonly routePrefix: string;
  readonly onDeleted: () => void;
  readonly onUpdated: (team: TeamDTO) => void;
}

type ActiveTab = "build" | "run" | "history";

type AgentCreatePurpose = "supervisor" | "worker";
type AddMode = "create" | "existing";

function runnerStatusLabel(entry: TeamRunnerStatusEntry | undefined): string {
  if (!entry) return "Unknown";
  if (entry.ready) return "Online";
  if (entry.provisioningStatus === "provisioning") return "Starting up";
  if (entry.provisioningStatus === "failed") return "Failed to start";
  return "Offline";
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
    return <p className="mt-2 text-[11px] text-black/50">Loading status…</p>;
  }
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
      <span className="font-serif uppercase tracking-widest text-black/60">{runnerStatusLabel(entry)}</span>
      {entry.inferenceError && (
        <span className="text-black">{entry.inferenceError}</span>
      )}
      <button
        type="button"
        onClick={onRestart}
        disabled={restarting}
        className={`${sketchButton} gap-1 py-0.5`}
        title="Restart this agent to pick up the latest updates"
      >
        <RefreshCw size={11} className={restarting ? "animate-spin" : ""} />
        {restarting ? "Restarting…" : "Restart"}
      </button>
      <Link
        href={`${agentsHrefPrefix}/agents/${entry.agentId}`}
        className="underline underline-offset-2 text-black/50 hover:text-black"
      >
        Agent detail →
      </Link>
    </div>
  );
}

export function TeamDetailView({ team, routePrefix, onDeleted, onUpdated }: TeamDetailViewProps) {
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
      alert(err instanceof Error ? err.message : "Failed to restart agent");
    } finally {
      setRestartingId(null);
    }
  }

  function promptConfirmName(label: string, expected: string): string | null {
    const typed = window.prompt(
      `This permanently deletes ${label} and stops its agent.\n\nType "${expected}" to confirm:`,
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

  const isRunTab = tab === "run" && canRun;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white">
      <div
        className={cn(
          "flex shrink-0 items-center justify-between border-b border-black px-6",
          isRunTab ? "py-2" : "py-4",
        )}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-base font-semibold text-black">{team.name}</h2>
            <span className="shrink-0 font-serif text-[10px] uppercase tracking-widest text-black/50">
              {team.status === "draft" ? "Draft — needs supervisor" : team.status}
            </span>
          </div>
          {!isRunTab && team.description && (
            <p className="mt-0.5 text-xs text-black/60">{team.description}</p>
          )}
          {!isRunTab && <p className="mt-1 font-mono text-xs text-black/40">{team.did}</p>}
          {!isRunTab && (
            <SketchBox className="mt-2 max-w-xl px-3 py-2">
              <p className={`${sketchLabel} text-[10px]`}>WhatsApp (self-chat)</p>
              <p className="mt-1 break-all font-mono text-[11px] text-black/70">
                @{team.name}: &lt;goal&gt; or @{team.name} &lt;goal&gt;
              </p>
              <p className="mt-1 text-[10px] text-black/50">
                Teams run only with @. @ &lt;goal&gt; uses the default team from Connectors. Mid-run: @ more guidance · !status · !cancel
              </p>
            </SketchBox>
          )}
        </div>
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting}
          className={`${sketchButton} shrink-0 gap-1.5 disabled:opacity-40`}
        >
          <Trash2 size={13} />
          Delete
        </button>
      </div>

      <div className="flex shrink-0 border-b border-black px-6">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => !t.disabled && setTab(t.id)}
            disabled={t.disabled}
            className={cn(
              "mr-4 py-2 font-serif text-[11px] uppercase tracking-widest transition-colors",
              t.disabled
                ? "cursor-not-allowed text-black/25"
                : tab === t.id
                  ? "border-b-2 border-black text-black"
                  : "text-black/50 hover:text-black",
            )}
          >
            {t.label}
            {t.id === "run" && !canRun && (
              <span className="ml-1 normal-case tracking-normal text-black/30">(not ready yet)</span>
            )}
          </button>
        ))}
      </div>

      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col",
          isRunTab ? "overflow-hidden" : "overflow-auto",
        )}
      >
        {tab === "build" && (
          <div className="px-6 py-5 space-y-6">
            {actionError && (
              <SketchBox className="px-3 py-2 text-xs text-black">{actionError}</SketchBox>
            )}

            <div>
              <div className="mb-3 flex items-center gap-2">
                <ShieldCheck size={14} className="text-black" />
                <span className={`${sketchLabel} normal-case`}>Supervisor Agent</span>
                <span className="text-xs text-black/50">(required, cloud)</span>
              </div>

              {team.supervisorAgent ? (
                <SketchBox className="px-4 py-3">
                  <p className="text-sm font-medium text-black">{team.supervisorAgent.name}</p>
                  <p className="mt-0.5 font-mono text-xs text-black/50">{team.supervisorAgent.did}</p>
                  <RunnerRow
                    entry={runnerByAgentId(team.supervisorAgent.id)}
                    agentsHrefPrefix={routePrefix}
                    onRestart={() => handleRestartRunner(team.supervisorAgent!.id)}
                    restarting={restartingId === team.supervisorAgent.id}
                  />
                  <div className="mt-2 flex items-center gap-3">
                    <button type="button" onClick={openCreateSupervisor} className={sketchButton}>
                      Replace supervisor
                    </button>
                    <button
                      type="button"
                      onClick={handleDeleteSupervisor}
                      className={`${sketchButton} gap-1`}
                      title="Permanently deletes this agent"
                    >
                      <Trash2 size={13} />
                      Delete
                    </button>
                  </div>
                </SketchBox>
              ) : (
                <SketchBox className="flex flex-col items-center gap-3 border-dashed px-4 py-5">
                  <p className="text-center text-xs text-black/50">
                    The supervisor agent runs in the cloud. It decomposes goals, delegates to workers, and synthesizes results.
                  </p>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={openCreateSupervisor} className={`${sketchButton} gap-1.5`}>
                      <ShieldCheck size={13} />
                      Create New
                    </button>
                    <button
                      type="button"
                      onClick={() => void openExistingPicker("supervisor")}
                      className={`${sketchButton} gap-1.5`}
                    >
                      <Plus size={13} />
                      Use Existing Agent
                    </button>
                  </div>
                </SketchBox>
              )}
            </div>

            <div>
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Users size={14} className="text-black/60" />
                  <span className={`${sketchLabel} normal-case`}>
                    Worker Agents
                    {workerCount > 0 && <span className="ml-1.5 text-black/50">({workerCount})</span>}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={openCreateWorker} className={`${sketchButton} gap-1`}>
                    <UserPlus size={12} />
                    Create New
                  </button>
                  <button
                    type="button"
                    onClick={() => void openExistingPicker("worker")}
                    className={`${sketchButton} gap-1`}
                  >
                    <Plus size={12} />
                    Use Existing
                  </button>
                </div>
              </div>

              <SketchBox className="mb-3 flex items-start gap-3 px-3 py-2">
                <Sparkles size={14} className="mt-0.5 shrink-0 text-black/60" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-medium text-black">Pipeline order</p>
                    <label className="flex cursor-pointer items-center gap-2 text-[11px] text-black/60">
                      <input
                        type="checkbox"
                        checked={Boolean(team.config.autoSequence)}
                        onChange={(e) => void handleToggleAutoSequence(e.target.checked)}
                        disabled={togglingAutoSequence}
                        className="size-3.5 accent-black"
                      />
                      Auto-sequence (supervisor decides on every run)
                    </label>
                  </div>
                  <p className="mt-1 text-[11px] text-black/50">
                    {team.config.autoSequence
                      ? "Supervisor LLM picks the order on every run from each agent's description. Stage numbers below are ignored."
                      : "Workers run strictly in the order shown below. Add agents in any order — use the arrows to set the sequence."}
                  </p>
                </div>
              </SketchBox>

              {team.members && team.members.length > 0 ? (
                <div className="space-y-2">
                  {[...team.members]
                    .sort(
                      (a, b) =>
                        (a.stageOrder ?? 0) - (b.stageOrder ?? 0) ||
                        a.addedAt.localeCompare(b.addedAt),
                    )
                    .map((m, idx, arr) => (
                    <SketchRow key={m.id} className="flex items-start gap-3 border-black">
                      <div
                        className={cn(
                          "flex shrink-0 flex-col items-center gap-0.5 pt-0.5",
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
                          className="rounded p-0.5 text-black/50 hover:text-black disabled:opacity-25"
                          aria-label="Move stage up"
                        >
                          <ArrowUp size={11} />
                        </button>
                        <span className="border border-black px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-black">
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
                          className="rounded p-0.5 text-black/50 hover:text-black disabled:opacity-25"
                          aria-label="Move stage down"
                        >
                          <ArrowDown size={11} />
                        </button>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-black">{m.agent?.name ?? m.agentId}</p>
                        <p className="mt-0.5 text-xs text-black/50">
                          Role: <span className="text-black/70">{m.role}</span>
                          {m.delegatedScopes.length > 0 && (
                            <span className="ml-2 text-black/40">
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
                                className={sketchButton}
                              >
                                Save scopes
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingMemberId(null)}
                                className={sketchButton}
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
                            className={`${sketchButton} mt-1 py-0.5 normal-case tracking-normal`}
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
                        type="button"
                        onClick={() => handleDeleteWorker(m)}
                        disabled={removingId === m.agentId}
                        className={`${sketchButton} gap-1 disabled:opacity-40`}
                        title="Permanently deletes this agent"
                      >
                        <Trash2 size={13} />
                        Delete
                      </button>
                    </SketchRow>
                  ))}
                </div>
              ) : (
                <p className="py-2 text-xs text-black/50">
                  No worker agents yet. Each worker runs on its own in the cloud.
                </p>
              )}
            </div>

            {allReady ? (
              <SketchBox className="flex items-center gap-2 px-4 py-3">
                <Play size={13} className="shrink-0 text-black" />
                <p className="text-xs text-black/70">
                  All agents are online. Switch to the <strong>Run</strong> tab to start a task.
                </p>
              </SketchBox>
            ) : (
              <SketchBox className="flex items-center gap-2 px-4 py-3">
                <Clock size={13} className="shrink-0 text-black" />
                <p className="text-xs text-black/70">
                  Waiting for agents to come online: you need a supervisor and at least one worker.
                </p>
              </SketchBox>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/80 p-4">
      <div className="relative w-full max-w-md border-2 border-black bg-white">
        <div className="flex items-center justify-between border-b border-black px-5 py-4">
          <div>
            <h2 className={sketchLabel}>
              Use existing agent as {purpose}
            </h2>
            <p className="mt-0.5 text-xs text-black/50">
              Only cloud agents not already in this team are shown.
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-black/40 hover:text-black">
            <X size={16} />
          </button>
        </div>

        <div className="px-5 pb-1 pt-3">
          <div className="flex items-center gap-2 border border-black px-3 py-1.5">
            <Search size={13} className="shrink-0 text-black/40" />
            <input
              type="text"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search agents…"
              className="flex-1 bg-transparent text-xs text-black outline-none placeholder:text-black/30"
              autoFocus
            />
          </div>
        </div>

        <div className="max-h-72 space-y-1 overflow-auto px-5 py-2">
          {loading ? (
            <p className="py-4 text-center text-xs text-black/50">Loading agents…</p>
          ) : filtered.length === 0 ? (
            <p className="py-4 text-center text-xs text-black/50">
              {agents.length === 0
                ? "No eligible cloud agents found. Create one on the Agents page first."
                : "No agents match your search."}
            </p>
          ) : (
            filtered.map((agent) => (
              <SketchRow
                key={agent.id}
                className="flex items-center justify-between border-black"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-black">{agent.name}</p>
                  {agent.description && (
                    <p className="mt-0.5 truncate text-xs text-black/50">{agent.description}</p>
                  )}
                  <p className="mt-0.5 truncate font-mono text-xs text-black/40">
                    {agent.cloudProvisioningStatus ?? agent.status}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    purpose === "worker" ? onSelectWorker(agent) : onAdd(agent)
                  }
                  disabled={addingId === agent.id}
                  className={`${sketchButton} ml-3 shrink-0 disabled:opacity-50`}
                >
                  {addingId === agent.id ? "Adding…" : purpose === "worker" ? "Select" : "Add"}
                </button>
              </SketchRow>
            ))
          )}
        </div>

        {purpose === "worker" && pendingWorkerAgent && (
          <div className="space-y-2 border-t border-black px-5 py-3">
            <p className="text-xs text-black/60">
              Delegated scopes for <strong className="text-black">{pendingWorkerAgent.name}</strong>
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
              className={`${sketchButton} disabled:opacity-50`}
            >
              Add worker with selected scopes
            </button>
          </div>
        )}

        <div className="flex justify-end border-t border-black px-5 py-3">
          <button type="button" onClick={onClose} className={sketchButton}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
