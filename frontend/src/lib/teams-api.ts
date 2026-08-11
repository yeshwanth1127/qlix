import type { ApiErrorBody } from "./auth-api";
import type { PermissionScope } from "./agents-api";

const defaultBase = "http://localhost:4000";

function apiBase(): string {
  return (process.env.NEXT_PUBLIC_API_BASE_URL ?? defaultBase).replace(/\/$/, "");
}

// ─── Types ──────────────────────────────────────────────────────────────────

export type TeamStatus = "draft" | "active" | "archived";
export type TeamRunStatus =
  | "queued"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "canceled";

export type TeamRunEventType =
  | "run_started"
  | "supervisor_step"
  | "task_delegated"
  | "task_status_update"
  | "tool_called"
  | "brain_queried"
  | "result_received"
  | "scope_requested"
  | "approval_granted"
  | "artifact_produced"
  | "subtask_completed"
  | "run_completed"
  | "run_failed"
  | "result_delivered"
  | "user_injection";

/** Deterministic stage-goal playbook, pinned on the team at creation. */
export type TeamPlaybook = "none";

export interface TeamConfig {
  maxParallelWorkers: number;
  subtaskTimeoutMs: number;
  retryPolicy: "none" | "once" | "twice";
  humanInLoopTriggers: string[];
  /**
   * Which stage goals this team's workers receive. Stored rather than inferred, so
   * editing members can't silently change how the pipeline behaves. Absent on teams
   * created before the field existed, until their next run backfills it.
   */
  playbook?: TeamPlaybook;
  pipelineMode?: boolean;
  /**
   * When true, the supervisor LLM decides the worker order on every run based on each
   * agent's description. When false (default), workers run strictly in the order set on
   * the team (drag/up-down arrows in the members list).
   */
  autoSequence?: boolean;
  /** Default model for all agents in this team (overrides each agent's own model). */
  defaultModel?: string;
}

export interface TeamMemberDTO {
  id: string;
  teamId: string;
  agentId: string;
  role: string;
  delegatedScopes: PermissionScope[];
  agentCardSnapshot: Record<string, unknown> | null;
  /** Pipeline stage (1-indexed). Lower runs earlier. */
  stageOrder: number;
  addedAt: string;
  agent?: {
    id: string;
    name: string;
    did: string;
    status: string;
    permissionScopes: PermissionScope[];
    agentKind: string;
  };
}

export interface TeamDTO {
  id: string;
  orgId: string;
  createdByUserId: string;
  supervisorAgentId: string | null;
  did: string;
  name: string;
  description: string | null;
  status: TeamStatus;
  config: TeamConfig;
  createdAt: string;
  updatedAt: string;
  members?: TeamMemberDTO[];
  supervisorAgent?: {
    id: string;
    name: string;
    did: string;
    status: string;
  };
}

export interface TeamRunArtifact {
  id: string;
  type: "text" | "json" | "file";
  name: string;
  content: unknown;
  agentId: string;
  createdAt: string;
}

export interface ScopeEscalation {
  id: string;
  agentId: string;
  scope: string;
  reason: string;
  status: "pending" | "approved" | "denied";
  requestedAt: string;
  resolvedAt: string | null;
}

export type TeamRunSourceChannel = "web" | "whatsapp";
export type TeamRunReplyChannel = "whatsapp" | "none";

export interface TeamRunDTO {
  id: string;
  teamId: string;
  orgId: string;
  startedByUserId: string;
  goal: string;
  sourceChannel?: TeamRunSourceChannel;
  sourceConnectorId?: string | null;
  replyChannel?: TeamRunReplyChannel;
  status: TeamRunStatus;
  supervisorTrace: unknown[];
  artifacts: TeamRunArtifact[];
  scopeEscalations: ScopeEscalation[];
  result: unknown | null;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface TeamRunEventDTO {
  id: string;
  runId: string;
  teamId: string;
  agentId: string | null;
  seq: number;
  eventType: TeamRunEventType;
  payload: unknown;
  prevHash: string;
  timestampMs: string;
}

export interface TeamRunnerStatusEntry {
  agentId: string;
  name: string;
  did: string;
  role: "supervisor" | "worker";
  runtime: string;
  provisioningStatus: string | null;
  heartbeatFresh: boolean;
  inferenceError: string | null;
  containerName: string | null;
  cloudRunnerId: string | null;
  ready: boolean;
}

export interface TeamRunnersStatusDTO {
  teamId: string;
  allReady: boolean;
  runners: TeamRunnerStatusEntry[];
}

export interface A2ATaskDTO {
  id: string;
  runId: string;
  teamId: string;
  fromAgentId: string;
  toAgentId: string;
  agentRunId: string | null;
  goal: string;
  status: string;
  messages: Array<{ role: string; content: string; timestampMs: number }>;
  artifacts: TeamRunArtifact[];
  inputRequest: unknown | null;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

// ─── API calls ───────────────────────────────────────────────────────────────

export async function listTeams(): Promise<TeamDTO[]> {
  const res = await fetch(`${apiBase()}/api/v1/teams`, { credentials: "include" });
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new Error(err?.error?.message ?? "Failed to list teams");
  }
  const data = (await res.json()) as { teams: TeamDTO[] };
  return data.teams;
}

export async function getTeamRunnersStatus(teamId: string): Promise<TeamRunnersStatusDTO> {
  const res = await fetch(`${apiBase()}/api/v1/teams/${teamId}/runners-status`, {
    credentials: "include",
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new Error(err?.error?.message ?? "Failed to load runners status");
  }
  return res.json() as Promise<TeamRunnersStatusDTO>;
}

export async function getTeam(teamId: string): Promise<TeamDTO> {
  const res = await fetch(`${apiBase()}/api/v1/teams/${teamId}`, { credentials: "include" });
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new Error(err?.error?.message ?? "Failed to load team");
  }
  const data = (await res.json()) as { team: TeamDTO };
  return data.team;
}

export interface CreateTeamBody {
  name: string;
  description?: string;
  config?: Partial<TeamConfig>;
}

export async function createTeam(
  body: CreateTeamBody,
  _stepUpToken?: string,
): Promise<TeamDTO> {
  const res = await fetch(`${apiBase()}/api/v1/teams`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new Error(err?.error?.message ?? "Failed to create team");
  }
  const data = (await res.json()) as { team: TeamDTO };
  return data.team;
}

export async function deleteTeam(teamId: string, confirmName: string): Promise<void> {
  const res = await fetch(`${apiBase()}/api/v1/teams/${teamId}`, {
    method: "DELETE",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirmName }),
  });
  if (!res.ok && res.status !== 204) {
    const err = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new Error(err?.error?.message ?? "Failed to delete team");
  }
}

export async function deleteTeamSupervisor(
  teamId: string,
  confirmName: string,
): Promise<TeamDTO> {
  const res = await fetch(`${apiBase()}/api/v1/teams/${teamId}/supervisor`, {
    method: "DELETE",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirmName }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new Error(err?.error?.message ?? "Failed to delete supervisor");
  }
  const data = (await res.json()) as { team: TeamDTO };
  return data.team;
}

export async function deleteTeamMemberAgent(
  teamId: string,
  agentId: string,
  confirmName: string,
): Promise<void> {
  const res = await fetch(`${apiBase()}/api/v1/teams/${teamId}/members/${agentId}`, {
    method: "DELETE",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirmName }),
  });
  if (!res.ok && res.status !== 204) {
    const err = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new Error(err?.error?.message ?? "Failed to delete team agent");
  }
}

export async function setSupervisorAgent(teamId: string, agentId: string): Promise<TeamDTO> {
  const res = await fetch(`${apiBase()}/api/v1/teams/${teamId}/supervisor`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agentId }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new Error(err?.error?.message ?? "Failed to set supervisor");
  }
  const data = (await res.json()) as { team: TeamDTO };
  return data.team;
}

export async function addTeamMember(
  teamId: string,
  member: { agentId: string; role: string; delegatedScopes: PermissionScope[] },
): Promise<TeamMemberDTO> {
  const res = await fetch(`${apiBase()}/api/v1/teams/${teamId}/members`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(member),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new Error(err?.error?.message ?? "Failed to add member");
  }
  const data = (await res.json()) as { member: TeamMemberDTO };
  return data.member;
}

export async function updateTeamMemberScopes(
  teamId: string,
  agentId: string,
  delegatedScopes: PermissionScope[],
): Promise<TeamMemberDTO> {
  const res = await fetch(`${apiBase()}/api/v1/teams/${teamId}/members/${agentId}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ delegatedScopes }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new Error(err?.error?.message ?? "Failed to update member scopes");
  }
  const data = (await res.json()) as { member: TeamMemberDTO };
  return data.member;
}

/** @deprecated Use deleteTeamMemberAgent — removes agent from DB and Docker */
export async function removeTeamMember(teamId: string, agentId: string, confirmName: string): Promise<void> {
  return deleteTeamMemberAgent(teamId, agentId, confirmName);
}

/**
 * Reorder team members. `memberIds` must list every member of the team exactly once;
 * index 0 becomes stage 1, etc.
 */
export async function reorderTeamMembers(
  teamId: string,
  memberIds: string[],
): Promise<TeamDTO> {
  const res = await fetch(`${apiBase()}/api/v1/teams/${teamId}/members/order`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ memberIds }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new Error(err?.error?.message ?? "Failed to reorder members");
  }
  const data = (await res.json()) as { team: TeamDTO };
  return data.team;
}

export async function updateTeamConfig(
  teamId: string,
  patch: { autoSequence?: boolean; pipelineMode?: boolean; defaultModel?: string },
): Promise<TeamDTO> {
  const res = await fetch(`${apiBase()}/api/v1/teams/${teamId}/config`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new Error(err?.error?.message ?? "Failed to update team config");
  }
  const data = (await res.json()) as { team: TeamDTO };
  return data.team;
}

export async function listTeamRuns(teamId: string): Promise<TeamRunDTO[]> {
  const res = await fetch(`${apiBase()}/api/v1/teams/${teamId}/runs`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to list runs");
  const data = (await res.json()) as { runs: TeamRunDTO[] };
  return data.runs;
}

export async function getTeamRun(
  teamId: string,
  runId: string,
): Promise<{ run: TeamRunDTO; events: TeamRunEventDTO[]; tasks: A2ATaskDTO[] }> {
  const res = await fetch(`${apiBase()}/api/v1/teams/${teamId}/runs/${runId}`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to load run");
  return res.json() as Promise<{ run: TeamRunDTO; events: TeamRunEventDTO[]; tasks: A2ATaskDTO[] }>;
}

export interface TeamRunPendingJit {
  jitRequestId: string;
  agentId: string;
  scope: string;
  scopeLabel: string;
  context: string;
  runId: string | null;
  conversationId: string | null;
  requestedAt: string;
}

export async function listTeamRunPendingJit(
  teamId: string,
  runId: string,
): Promise<TeamRunPendingJit[]> {
  const res = await fetch(`${apiBase()}/api/v1/teams/${teamId}/runs/${runId}/pending-jit`, {
    credentials: "include",
  });
  if (!res.ok) return [];
  const data = (await res.json().catch(() => null)) as { pending?: TeamRunPendingJit[] } | null;
  return data?.pending ?? [];
}

export async function injectTeamRunMessage(
  teamId: string,
  runId: string,
  message: string,
  files: File[] = [],
): Promise<void> {
  const url = `${apiBase()}/api/v1/teams/${teamId}/runs/${runId}/inject`;
  let res: Response;
  if (files.length > 0) {
    const form = new FormData();
    form.append("message", message);
    for (const file of files) {
      form.append("files", file, file.name || "upload");
    }
    res = await fetch(url, {
      method: "POST",
      credentials: "include",
      body: form,
    });
  } else {
    res = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
  }
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new Error(err?.error?.message ?? "Failed to send message");
  }
  if (files.length > 0) {
    const data = (await res.json().catch(() => null)) as { attachments?: ChatAttachmentChip[] } | null;
    if (!data?.attachments?.length) {
      throw new Error("File upload did not reach the team run. Please try attaching the file again.");
    }
  }
}

export async function cancelTeamRun(teamId: string, runId: string): Promise<void> {
  const res = await fetch(`${apiBase()}/api/v1/teams/${teamId}/runs/${runId}/cancel`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new Error(err?.error?.message ?? "Failed to cancel run");
  }
}



export async function startTeamRun(
  teamId: string,
  goal: string,
  files: File[] = [],
  model?: string | null,
): Promise<{ run: TeamRunDTO; displayGoal: string; attachments?: ChatAttachmentChip[]; model?: string | null }> {
  const url = `${apiBase()}/api/v1/teams/${teamId}/runs`;
  const modelValue = model?.trim() || "";
  let res: Response;
  if (files.length > 0) {
    const form = new FormData();
    form.append("goal", goal);
    if (modelValue) form.append("model", modelValue);
    for (const file of files) {
      form.append("files", file, file.name || "upload");
    }
    res = await fetch(url, {
      method: "POST",
      credentials: "include",
      body: form,
    });
  } else {
    res = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goal, ...(modelValue ? { model: modelValue } : {}) }),
    });
  }
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new Error(err?.error?.message ?? "Failed to start run");
  }
  const data = (await res.json()) as {
    run: TeamRunDTO;
    displayGoal?: string;
    attachments?: ChatAttachmentChip[];
    model?: string | null;
  };
  if (files.length > 0 && !(data.attachments && data.attachments.length > 0)) {
    // Run may already be queued without the file — cancel so we don't silently research without the sheet.
    if (data.run?.id) {
      await cancelTeamRun(teamId, data.run.id).catch(() => undefined);
    }
    throw new Error(
      "File upload did not reach the team run. Please try attaching the file again.",
    );
  }
  return {
    run: data.run,
    displayGoal: data.displayGoal ?? goal,
    ...(data.attachments ? { attachments: data.attachments } : {}),
    ...(data.model != null ? { model: data.model } : {}),
  };
}

export interface ChatAttachmentChip {
  id?: string;
  fileName: string;
  mimeType?: string;
  url?: string;
  sizeBytes?: number;
}

/**
 * Opens an SSE connection to stream live run events.
 * Returns a cleanup function — call it to close the connection.
 */
export function streamTeamRun(
  teamId: string,
  runId: string,
  handlers: {
    onEvent: (event: TeamRunEventDTO) => void;
    onComplete: (data: { status: string; result: unknown }) => void;
    onPaused?: (data: { status: string; teamRunId?: string }) => void;
    onError?: (msg: string) => void;
  },
  afterSeq = -1,
): () => void {
  const url = `${apiBase()}/api/v1/teams/${teamId}/runs/${runId}/stream?afterSeq=${afterSeq}`;
  const es = new EventSource(url, { withCredentials: true });

  es.addEventListener("event", (e: MessageEvent) => {
    try {
      handlers.onEvent(JSON.parse(e.data as string) as TeamRunEventDTO);
    } catch {
      // ignore parse errors
    }
  });

  es.addEventListener("complete", (e: MessageEvent) => {
    try {
      handlers.onComplete(JSON.parse(e.data as string) as { status: string; result: unknown });
    } catch {
      // ignore
    }
    es.close();
  });

  es.addEventListener("paused", (e: MessageEvent) => {
    try {
      handlers.onPaused?.(
        JSON.parse(e.data as string) as {
          status: string;
          teamRunId?: string;
        },
      );
    } catch {
      // ignore
    }
  });

  es.addEventListener("error", () => {
    handlers.onError?.("Stream connection lost");
  });

  return () => es.close();
}
