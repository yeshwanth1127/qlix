"use client";

import { useCallback, useEffect, useState, type ComponentType, type ReactNode } from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Check,
  Copy,
  MessageCircle,
  Play,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import {
  addTeamMember,
  deleteTeam,
  deleteTeamMemberAgent,
  deleteTeamSupervisor,
  getTeam,
  getTeamRunnersStatus,
  listConversationWorkflows,
  reorderTeamMembers,
  setSupervisorAgent,
  updateTeamConfig,
  updateTeamMemberScopes,
  type TeamDTO,
  type TeamMemberDTO,
  type TeamRunnerStatusEntry,
  type TeamRunnersStatusDTO,
  type ConversationWorkflowOption,
} from "@/lib/teams-api";
import { listAgents, restartCloudRunner, type AgentDTO, type PermissionScope } from "@/lib/agents-api";
import { cn } from "@/lib/utils/cn";
import { SketchBox, sketchButton, sketchButtonPrimary } from "@/components/qlix/sketch";
import { CreateAgentModal } from "@/components/qlix/agents/CreateAgentModal";
import { DelegatedScopePicker } from "@/components/qlix/teams/DelegatedScopePicker";
import { useSession } from "@/components/qlix/session-context";
import { TeamRunView } from "./TeamRunView";

const OUTREACH_PLUGIN_ID = "outreach";

interface TeamDetailViewProps {
  readonly team: TeamDTO;
  readonly routePrefix: string;
  readonly onDeleted: () => void;
  readonly onUpdated: (team: TeamDTO) => void;
}

type ActiveTab = "build" | "run";

type AgentCreatePurpose = "supervisor" | "worker";

/** Muted ink — `text-black/NN` is force-inked inside the console, so hierarchy
 *  has to come from the ink variables. */
const INK_SOFT = "text-[color:var(--ink-soft)]";
const INK_FAINT = "text-[color:var(--ink-faint)]";
const HAIRLINE = "border-[color:var(--ink-border)]";

/** Quiet borderless control used for section actions. */
const quietButton =
  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] text-[color:var(--ink-soft)] transition-colors hover:bg-black/[0.05] hover:text-black disabled:pointer-events-none disabled:opacity-40";

type Presence = "online" | "starting" | "attention" | "offline" | "unknown";

function presenceOf(entry: TeamRunnerStatusEntry | undefined): Presence {
  if (!entry) return "unknown";
  if (entry.ready) return "online";
  if (entry.inferenceError) return "attention";
  if (entry.provisioningStatus === "provisioning") return "starting";
  if (entry.provisioningStatus === "failed") return "attention";
  return "offline";
}

const PRESENCE_LABEL: Record<Presence, string> = {
  online: "Online",
  starting: "Getting ready",
  attention: "Needs attention",
  offline: "Offline",
  unknown: "Checking…",
};

const PRESENCE_DOT: Record<Presence, string> = {
  online: "bg-[color:var(--sketch-green)]",
  starting: "bg-[color:var(--warning)] animate-pulse",
  attention: "bg-[color:var(--sketch-red)]",
  offline: "bg-[color:var(--ink-faint)]",
  unknown: "bg-[color:var(--ink-faint)]",
};

function shortDid(did: string): string {
  if (did.length <= 18) return did;
  return `${did.slice(0, 8)}…${did.slice(-6)}`;
}

function IconAction({
  icon: Icon,
  label,
  onClick,
  busy = false,
  spin = false,
  disabled = false,
  danger = false,
}: {
  readonly icon: ComponentType<{ size?: number; className?: string }>;
  readonly label: string;
  readonly onClick: () => void;
  readonly busy?: boolean;
  /** Spin the icon while busy — only meaningful for the refresh glyph. */
  readonly spin?: boolean;
  readonly disabled?: boolean;
  readonly danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      title={label}
      aria-label={label}
      className={cn(
        "grid size-7 shrink-0 place-items-center rounded-full transition-colors",
        INK_FAINT,
        "hover:bg-black/[0.06] hover:text-black disabled:pointer-events-none disabled:opacity-30",
        danger && "hover:bg-[color:var(--sketch-red-soft)] hover:text-[color:var(--sketch-red)]",
      )}
    >
      <Icon size={13} className={busy && spin ? "animate-spin" : undefined} />
    </button>
  );
}

/** One agent in the team — name, presence, and actions that surface on hover. */
function AgentRow({
  name,
  stage,
  meta,
  entry,
  agentHref,
  restarting,
  onRestart,
  onDelete,
  deleting = false,
  onMove,
  canMoveUp = false,
  canMoveDown = false,
  onToggleScopes,
  scopesOpen = false,
  children,
}: {
  readonly name: string;
  readonly stage?: number | null;
  readonly meta?: ReactNode;
  readonly entry: TeamRunnerStatusEntry | undefined;
  readonly agentHref: string;
  readonly restarting: boolean;
  readonly onRestart: () => void;
  readonly onDelete: () => void;
  readonly deleting?: boolean;
  readonly onMove?: (direction: "up" | "down") => void;
  readonly canMoveUp?: boolean;
  readonly canMoveDown?: boolean;
  readonly onToggleScopes?: () => void;
  readonly scopesOpen?: boolean;
  readonly children?: ReactNode;
}) {
  const presence = presenceOf(entry);

  return (
    <div className="group px-5 py-4 transition-colors hover:bg-[#E2F0CC]/55">
      <div className="flex items-center gap-4">
        <span
          className={cn(
            "grid size-7 shrink-0 place-items-center rounded-full border font-mono text-[11px] tabular-nums",
            HAIRLINE,
            INK_SOFT,
          )}
        >
          {stage != null ? (
            stage
          ) : (
            <span className="size-1.5 rounded-full bg-[color:var(--ink-faint)]" aria-hidden />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-medium text-black">{name}</p>
          <p className={cn("mt-1 flex flex-wrap items-center gap-x-2.5 text-[11.5px]", INK_SOFT)}>
            <span
              className="inline-flex items-center gap-1.5"
              title={entry?.inferenceError ?? undefined}
            >
              <span className={cn("size-1.5 rounded-full", PRESENCE_DOT[presence])} aria-hidden />
              {PRESENCE_LABEL[presence]}
            </span>
            {meta}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-200 focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
          {onMove && (
            <>
              <IconAction
                icon={ArrowUp}
                label="Move earlier"
                onClick={() => onMove("up")}
                disabled={!canMoveUp}
              />
              <IconAction
                icon={ArrowDown}
                label="Move later"
                onClick={() => onMove("down")}
                disabled={!canMoveDown}
              />
            </>
          )}
          {onToggleScopes && (
            <IconAction
              icon={SlidersHorizontal}
              label={scopesOpen ? "Close permissions" : "Permissions"}
              onClick={onToggleScopes}
            />
          )}
          <IconAction
            icon={RefreshCw}
            label="Restart agent"
            onClick={onRestart}
            busy={restarting}
            spin
          />
          <Link
            href={agentHref}
            title="Open agent"
            aria-label="Open agent"
            className={cn(
              "grid size-7 shrink-0 place-items-center rounded-full transition-colors hover:bg-black/[0.06] hover:text-black",
              INK_FAINT,
            )}
          >
            <ArrowUpRight size={13} />
          </Link>
          <IconAction
            icon={Trash2}
            label="Delete agent"
            onClick={onDelete}
            busy={deleting}
            danger
          />
        </div>
      </div>

      {children}
    </div>
  );
}

function Section({
  title,
  count,
  action,
  children,
}: {
  readonly title: string;
  readonly count?: number;
  readonly action?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <section>
      <div className="mb-3 flex items-end justify-between gap-4 px-1">
        <h3 className="text-[11px] font-medium uppercase tracking-[0.16em] text-black">
          {title}
          {count != null && count > 0 && (
            <span className={cn("ml-2 font-mono tracking-normal", INK_FAINT)}>{count}</span>
          )}
        </h3>
        {action}
      </div>
      <SketchBox className="overflow-hidden">{children}</SketchBox>
    </section>
  );
}

export function TeamDetailView({ team, routePrefix, onDeleted, onUpdated }: TeamDetailViewProps) {
  const { session } = useSession();
  const outreachEnabled =
    session?.organization?.enabledPluginIds?.includes(OUTREACH_PLUGIN_ID) ?? false;
  const [tab, setTab] = useState<ActiveTab>("build");
  const [deleting, setDeleting] = useState(false);
  const [showCreateAgent, setShowCreateAgent] = useState(false);
  const [createPurpose, setCreatePurpose] = useState<AgentCreatePurpose>("supervisor");
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [runnersStatus, setRunnersStatus] = useState<TeamRunnersStatusDTO | null>(null);
  const [restartingId, setRestartingId] = useState<string | null>(null);
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
  const [workflows, setWorkflows] = useState<ConversationWorkflowOption[]>([]);
  const [workflowsLoading, setWorkflowsLoading] = useState(true);
  const [savingConversationMode, setSavingConversationMode] = useState(false);
  const [savingMemberScopes, setSavingMemberScopes] = useState(false);
  const [copied, setCopied] = useState<"did" | "trigger" | null>(null);

  const workerCount = team.members?.length ?? 0;
  const allReady = runnersStatus?.allReady ?? false;
  const canRun = allReady;
  const autoSequence = Boolean(team.config.autoSequence);
  const managedWorkflowId = team.config.conversationWorkflowVersionId ?? null;

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
    if (!outreachEnabled) {
      setWorkflows([]);
      setWorkflowsLoading(false);
      return;
    }
    let active = true;
    setWorkflowsLoading(true);
    void listConversationWorkflows()
      .then((items) => { if (active) setWorkflows(items); })
      .catch(() => {
        if (active) setWorkflows([]);
      })
      .finally(() => { if (active) setWorkflowsLoading(false); });
    return () => { active = false; };
  }, [team.orgId, outreachEnabled]);

  async function copyToClipboard(value: string, key: "did" | "trigger") {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1600);
    } catch {
      // clipboard unavailable — nothing to do
    }
  }

  async function handleRestartRunner(agentId: string) {
    setRestartingId(agentId);
    try {
      await restartCloudRunner(agentId);
      await pollRunners();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to restart agent");
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
    if (reorderingId || autoSequence) return;
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

  async function handleConversationModeChange(workflowVersionId: string | null) {
    if (savingConversationMode) return;
    setSavingConversationMode(true);
    setActionError(null);
    try {
      const updated = await updateTeamConfig(team.id, { conversationWorkflowVersionId: workflowVersionId });
      onUpdated(updated);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to update conversation mode");
    } finally {
      setSavingConversationMode(false);
    }
  }

  const tabs: { id: ActiveTab; label: string; disabled?: boolean }[] = [
    { id: "build", label: "Team" },
    { id: "run", label: "Run" },
  ];

  const isRunTab = tab === "run";

  const headerPresence: Presence = !team.supervisorAgentId
    ? "offline"
    : allReady
      ? "online"
      : runnersStatus
        ? "starting"
        : "unknown";
  const headerStatus = !team.supervisorAgentId
    ? "Draft"
    : allReady
      ? "Ready"
      : runnersStatus
        ? "Getting ready"
        : "Checking…";

  const orderedMembers = [...(team.members ?? [])].sort(
    (a, b) => (a.stageOrder ?? 0) - (b.stageOrder ?? 0) || a.addedAt.localeCompare(b.addedAt),
  );

  const trigger = `@${team.name}: `;

  const readinessLine = !team.supervisorAgent
    ? "Add a supervisor to get started."
    : workerCount === 0
      ? "Add at least one agent for the supervisor to work with."
      : "Getting your agents ready…";

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className={cn("shrink-0 px-8", isRunTab ? "pt-4 pb-3" : "pt-7 pb-6")}>
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <h2 className="truncate text-[21px] font-semibold tracking-[-0.02em] text-black">
              {team.name}
            </h2>
            {!isRunTab && team.description && (
              <p className={cn("mt-2 max-w-xl text-[13px] leading-relaxed", INK_SOFT)}>
                {team.description}
              </p>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {!isRunTab && (
              <button
                type="button"
                onClick={() => void copyToClipboard(team.did, "did")}
                title={`${team.did} — click to copy`}
                className={cn(quietButton, "font-mono")}
              >
                {copied === "did" ? <Check size={11} /> : <Copy size={11} />}
                {shortDid(team.did)}
              </button>
            )}
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border bg-[#E2F0CC]/55 px-2.5 py-1 text-[10px] uppercase tracking-[0.14em]",
                HAIRLINE,
                INK_SOFT,
              )}
            >
              <span className={cn("size-1.5 rounded-full", PRESENCE_DOT[headerPresence])} aria-hidden />
              {headerStatus}
            </span>
            <IconAction
              icon={Trash2}
              label="Delete team"
              onClick={() => void handleDelete()}
              busy={deleting}
              danger
            />
          </div>
        </div>
      </header>

      <div className={cn("flex shrink-0 items-center gap-7 border-b px-8", HAIRLINE)}>
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              if (t.disabled) return;
              setTab(t.id);
            }}
            disabled={t.disabled}
            title={t.disabled ? "Available once every agent is online" : undefined}
            className={cn(
              "relative py-3 text-[11px] font-medium uppercase tracking-[0.16em] transition-colors",
              t.disabled
                ? cn("cursor-not-allowed", INK_FAINT)
                : tab === t.id
                  ? "text-black"
                  : cn(INK_SOFT, "hover:text-black"),
            )}
          >
            {t.label}
            {tab === t.id && (
              <span className="absolute inset-x-0 -bottom-px h-px bg-black" aria-hidden />
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
          <div className="mx-auto w-full max-w-3xl space-y-9 px-8 py-9">
            {actionError && (
              <p className="rounded-2xl bg-[color:var(--sketch-red-soft)] px-4 py-2.5 text-[12px] text-[color:var(--sketch-red)]">
                {actionError}
              </p>
            )}

            <Section
              title="Supervisor"
              action={
                team.supervisorAgent && (
                  <button type="button" onClick={openCreateSupervisor} className={quietButton}>
                    Replace
                  </button>
                )
              }
            >
              {team.supervisorAgent ? (
                <AgentRow
                  name={team.supervisorAgent.name}
                  entry={runnerByAgentId(team.supervisorAgent.id)}
                  agentHref={`${routePrefix}/agents/${team.supervisorAgent.id}`}
                  restarting={restartingId === team.supervisorAgent.id}
                  onRestart={() => void handleRestartRunner(team.supervisorAgent!.id)}
                  onDelete={() => void handleDeleteSupervisor()}
                  meta={<span className={INK_FAINT}>Plans the work and delegates</span>}
                />
              ) : (
                <div className="flex flex-col items-center gap-4 px-6 py-9 text-center">
                  <p className={cn("max-w-sm text-[13px] leading-relaxed", INK_SOFT)}>
                    A supervisor breaks the goal into steps, hands them to your agents, and pulls the
                    results together.
                  </p>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={openCreateSupervisor} className={sketchButton}>
                      New agent
                    </button>
                    <button
                      type="button"
                      onClick={() => void openExistingPicker("supervisor")}
                      className={quietButton}
                    >
                      Use existing
                    </button>
                  </div>
                </div>
              )}
            </Section>

            <Section
              title="Agents"
              count={workerCount}
              action={
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={autoSequence}
                    onClick={() => void handleToggleAutoSequence(!autoSequence)}
                    disabled={togglingAutoSequence}
                    title={
                      autoSequence
                        ? "The supervisor picks the order for every run. Turn off to run agents top to bottom."
                        : "Agents run top to bottom. Turn on to let the supervisor pick the order each run."
                    }
                    className={quietButton}
                  >
                    <span
                      className={cn(
                        "relative h-[14px] w-[26px] rounded-full transition-colors",
                        autoSequence ? "bg-black" : "bg-black/15",
                      )}
                      aria-hidden
                    >
                      <span
                        className={cn(
                          "absolute top-[2px] size-[10px] rounded-full bg-[#E2F0CC] transition-all",
                          autoSequence ? "left-[14px]" : "left-[2px]",
                        )}
                      />
                    </span>
                    Auto order
                  </button>
                  <span className={cn("select-none", INK_FAINT)}>·</span>
                  <button type="button" onClick={openCreateWorker} className={quietButton}>
                    New agent
                  </button>
                  <button
                    type="button"
                    onClick={() => void openExistingPicker("worker")}
                    className={quietButton}
                  >
                    Use existing
                  </button>
                </div>
              }
            >
              {orderedMembers.length > 0 ? (
                <div className="divide-y divide-black/10">
                  {orderedMembers.map((m, idx, arr) => (
                    <AgentRow
                      key={m.id}
                      name={m.agent?.name ?? m.agentId}
                      stage={autoSequence ? null : idx + 1}
                      entry={runnerByAgentId(m.agentId)}
                      agentHref={`${routePrefix}/agents/${m.agentId}`}
                      restarting={restartingId === m.agentId}
                      onRestart={() => void handleRestartRunner(m.agentId)}
                      onDelete={() => void handleDeleteWorker(m)}
                      deleting={removingId === m.agentId}
                      onMove={
                        autoSequence ? undefined : (dir) => void handleMoveMember(m, dir)
                      }
                      canMoveUp={idx > 0 && reorderingId === null}
                      canMoveDown={idx < arr.length - 1 && reorderingId === null}
                      onToggleScopes={() => {
                        if (editingMemberId === m.id) {
                          setEditingMemberId(null);
                          return;
                        }
                        setEditingMemberId(m.id);
                        setEditScopes(m.delegatedScopes);
                      }}
                      scopesOpen={editingMemberId === m.id}
                      meta={
                        m.delegatedScopes.length > 0 ? (
                          <span className={INK_FAINT}>
                            {m.delegatedScopes.length} permission
                            {m.delegatedScopes.length === 1 ? "" : "s"}
                          </span>
                        ) : undefined
                      }
                    >
                      {editingMemberId === m.id && (
                        <div className="mt-4 space-y-3 pl-11">
                          <DelegatedScopePicker
                            availableScopes={m.agent?.permissionScopes ?? []}
                            selected={editScopes}
                            onChange={setEditScopes}
                            disabled={savingMemberScopes}
                          />
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => void saveMemberScopes(m)}
                              disabled={savingMemberScopes}
                              className={sketchButton}
                            >
                              {savingMemberScopes ? "Saving…" : "Save"}
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingMemberId(null)}
                              className={quietButton}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </AgentRow>
                  ))}
                </div>
              ) : (
                <p className={cn("px-6 py-9 text-center text-[13px]", INK_SOFT)}>
                  No agents yet — add the ones this team should work with.
                </p>
              )}
            </Section>

            <Section title="Conversation mode">
              <div className="space-y-4 px-5 py-5">
                <div className="grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => void handleConversationModeChange(null)}
                    disabled={savingConversationMode}
                    className={cn(
                      "rounded-xl border px-4 py-3 text-left transition-colors disabled:opacity-50",
                      !managedWorkflowId ? "border-black bg-black/[0.04]" : cn(HAIRLINE, "hover:bg-black/[0.03]"),
                    )}
                  >
                    <span className="block text-[13px] font-medium text-black">Standard</span>
                    <span className={cn("mt-1 block text-[11.5px] leading-relaxed", INK_SOFT)}>
                      Agents use their tools normally for each run.
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const next = managedWorkflowId ?? workflows[0]?.workflowVersionId;
                      if (next) void handleConversationModeChange(next);
                    }}
                    disabled={savingConversationMode || workflowsLoading || workflows.length === 0}
                    className={cn(
                      "rounded-xl border px-4 py-3 text-left transition-colors disabled:opacity-50",
                      managedWorkflowId ? "border-black bg-black/[0.04]" : cn(HAIRLINE, "hover:bg-black/[0.03]"),
                    )}
                  >
                    <span className="block text-[13px] font-medium text-black">Managed workflow</span>
                    <span className={cn("mt-1 block text-[11.5px] leading-relaxed", INK_SOFT)}>
                      Runs a tracked, branched conversation for every contact.
                    </span>
                  </button>
                </div>

                {managedWorkflowId && (
                  <label className="block">
                    <span className={cn("mb-1.5 block text-[11px] uppercase tracking-[0.14em]", INK_SOFT)}>
                      Workflow
                    </span>
                    <select
                      value={managedWorkflowId}
                      onChange={(event) => void handleConversationModeChange(event.target.value)}
                      disabled={savingConversationMode || workflowsLoading}
                      className={cn(
                        "w-full rounded-xl border bg-[#E2F0CC]/60 px-3.5 py-2.5 text-[13px] text-black outline-none focus:border-black disabled:opacity-50",
                        HAIRLINE,
                      )}
                    >
                      {workflows.map((workflow) => (
                        <option key={workflow.workflowVersionId} value={workflow.workflowVersionId}>
                          {workflow.name} · v{workflow.version}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                {!workflowsLoading && !outreachEnabled && (
                  <p className={cn("text-[11.5px]", INK_SOFT)}>
                    Enable the Outreach plugin to use managed conversation workflows.
                  </p>
                )}
                {!workflowsLoading && outreachEnabled && workflows.length === 0 && (
                  <p className={cn("text-[11.5px]", INK_SOFT)}>
                    No published workflows are available. Standard mode remains active.
                  </p>
                )}
                {savingConversationMode && (
                  <p className={cn("text-[11.5px]", INK_SOFT)}>Saving conversation mode…</p>
                )}
              </div>
            </Section>

            <div className={cn("flex flex-wrap items-center justify-between gap-3 border-t pt-6", HAIRLINE)}>
              <button
                type="button"
                onClick={() => void copyToClipboard(trigger, "trigger")}
                title="Send this in your WhatsApp self-chat to start the team. While it runs: @ to add guidance, !status, !cancel."
                className={quietButton}
              >
                {copied === "trigger" ? <Check size={11} /> : <MessageCircle size={11} />}
                <span className="font-mono">@{team.name}: your goal</span>
              </button>

              {canRun ? (
                <button
                  type="button"
                  onClick={() => setTab("run")}
                  className={cn(sketchButtonPrimary, "gap-1.5")}
                >
                  <Play size={12} />
                  Start a run
                </button>
              ) : (
                <p className={cn("text-[12px]", INK_SOFT)}>{readinessLine}</p>
              )}
            </div>
          </div>
        )}

        {tab === "run" && (
          <TeamRunView team={team} canSend={canRun} onTeamUpdated={onUpdated} />
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/10 p-4 backdrop-blur-sm">
      <SketchBox className="relative w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between gap-4 px-6 pt-6">
          <h2 className="text-[11px] font-medium uppercase tracking-[0.16em] text-black">
            {purpose === "supervisor" ? "Choose a supervisor" : "Add an agent"}
          </h2>
          <IconAction icon={X} label="Close" onClick={onClose} />
        </div>

        <div className="px-6 pt-4">
          <div className={cn("flex items-center gap-2 rounded-full border bg-[#E2F0CC]/60 px-3.5 py-2", HAIRLINE)}>
            <Search size={13} className={cn("shrink-0", INK_FAINT)} />
            <input
              type="text"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search"
              className="flex-1 bg-transparent text-[13px] text-black outline-none"
              autoFocus
            />
          </div>
        </div>

        <div className="max-h-72 overflow-auto px-3 py-3">
          {loading ? (
            <p className={cn("py-8 text-center text-[13px]", INK_SOFT)}>Loading…</p>
          ) : filtered.length === 0 ? (
            <p className={cn("px-3 py-8 text-center text-[13px] leading-relaxed", INK_SOFT)}>
              {agents.length === 0
                ? "No agents available yet. Create one from the Agents page first."
                : "Nothing matches your search."}
            </p>
          ) : (
            filtered.map((agent) => (
              <button
                key={agent.id}
                type="button"
                onClick={() => (purpose === "worker" ? onSelectWorker(agent) : onAdd(agent))}
                disabled={addingId === agent.id}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-black/[0.04] disabled:opacity-50",
                  pendingWorkerAgent?.id === agent.id && "bg-black/[0.05]",
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-medium text-black">{agent.name}</p>
                  {agent.description && (
                    <p className={cn("mt-0.5 truncate text-[11.5px]", INK_SOFT)}>
                      {agent.description}
                    </p>
                  )}
                </div>
                {pendingWorkerAgent?.id === agent.id ? (
                  <Check size={13} className="shrink-0 text-black" />
                ) : (
                  <span className={cn("shrink-0 text-[11px]", INK_FAINT)}>
                    {addingId === agent.id ? "Adding…" : purpose === "worker" ? "Select" : "Add"}
                  </span>
                )}
              </button>
            ))
          )}
        </div>

        {purpose === "worker" && pendingWorkerAgent && (
          <div className={cn("space-y-3 border-t px-6 py-5", HAIRLINE)}>
            <p className={cn("text-[11px] uppercase tracking-[0.16em]", INK_SOFT)}>
              What {pendingWorkerAgent.name} may use
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
              className={sketchButtonPrimary}
            >
              {addingId === pendingWorkerAgent.id ? "Adding…" : "Add to team"}
            </button>
          </div>
        )}
      </SketchBox>
    </div>
  );
}
