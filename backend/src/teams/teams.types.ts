import type { PermissionScope } from '../agents/agents.types.js';

export type TeamStatus = 'draft' | 'active' | 'archived';
export type TeamRunStatus = 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'canceled';
export type A2ATaskStatus =
  | 'submitted'
  | 'working'
  | 'input_required'
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'rejected';

export type TeamRunEventType =
  | 'run_started'
  | 'supervisor_step'
  | 'task_delegated'
  | 'task_status_update'
  | 'tool_called'
  | 'brain_queried'
  | 'result_received'
  | 'scope_requested'
  | 'approval_granted'
  | 'artifact_produced'
  | 'subtask_completed'
  | 'run_completed'
  | 'run_failed'
  | 'result_delivered'
  | 'user_injection';

/**
 * Which deterministic stage-goal playbook the orchestrator applies to a run.
 *
 * This is stored on the team rather than inferred from member scopes at run time.
 * Inferring it meant that rewiring a team (adding a member, changing delegated
 * scopes) could silently switch the whole execution strategy, so the pipeline a
 * user sees would stop describing the pipeline that actually runs.
 *
 * `undefined` means "never resolved" — legacy teams created before the field
 * existed. Those are detected once on their next run and then persisted.
 */
export type TeamPlaybook = 'none';

export interface TeamConfig {
  maxParallelWorkers: number;
  subtaskTimeoutMs: number;
  retryPolicy: 'none' | 'once' | 'twice';
  humanInLoopTriggers: string[];
  /** Deterministic stage-goal playbook. Resolved once, then sticky. */
  playbook?: TeamPlaybook;
  /** When true, workers run sequentially and each receives prior results as context. */
  pipelineMode?: boolean;
  /**
   * When true, the supervisor LLM decides the worker order on every run based on
   * each agent's description. When false (default), workers run strictly in
   * ascending `stageOrder` set on each member.
   */
  autoSequence?: boolean;
  /** Override model for all agents in this team (supervisor + all workers). */
  defaultModel?: string;
}

export interface TeamMemberDTO {
  id: string;
  teamId: string;
  agentId: string;
  role: string;
  delegatedScopes: PermissionScope[];
  agentCardSnapshot: Record<string, unknown> | null;
  /** Pipeline stage (1-indexed). Lower = earlier in the pipeline. */
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
  type: 'text' | 'json' | 'file';
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
  status: 'pending' | 'approved' | 'denied';
  requestedAt: string;
  resolvedAt: string | null;
}

export type TeamRunSourceChannel = 'web' | 'whatsapp';
export type TeamRunReplyChannel = 'whatsapp' | 'none';

export interface TeamRunDTO {
  id: string;
  teamId: string;
  orgId: string;
  startedByUserId: string;
  goal: string;
  sourceChannel: TeamRunSourceChannel;
  sourceConnectorId: string | null;
  replyChannel: TeamRunReplyChannel;
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

export type TeamAgentRole = 'supervisor' | 'worker';

export interface TeamRunnerStatusEntry {
  agentId: string;
  name: string;
  did: string;
  role: TeamAgentRole;
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
  status: A2ATaskStatus;
  messages: Array<{ role: string; content: string; timestampMs: number }>;
  artifacts: TeamRunArtifact[];
  inputRequest: unknown | null;
  inputResponse: unknown | null;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface CreateTeamInput {
  orgId: string;
  name: string;
  description?: string;
  /** Assigned after creation via PATCH /:id/supervisor */
  supervisorAgentId?: string | null;
  members?: Array<{
    agentId: string;
    role: string;
    delegatedScopes: PermissionScope[];
  }>;
  config?: Partial<TeamConfig>;
}

export interface AddTeamMemberInput {
  agentId: string;
  role: string;
  delegatedScopes: PermissionScope[];
}

export interface StartTeamRunInput {
  goal: string;
}

export const DEFAULT_TEAM_CONFIG: TeamConfig = {
  maxParallelWorkers: 3,
  subtaskTimeoutMs: 180_000,
  retryPolicy: 'once',
  humanInLoopTriggers: ['web.transaction', 'finance.spend_50', 'finance.spend_100'],
  pipelineMode: true,
  autoSequence: false,
};

export interface ReorderTeamMembersInput {
  /** Ordered list of memberIds — index 0 becomes stage 1. Every member runs in its own stage. */
  memberIds?: string[];
  /**
   * Ordered list of stages. Each inner array is one pipeline stage; members sharing a
   * stage run concurrently. `[[a], [b, c], [d]]` → a, then b and c together, then d.
   * Takes precedence over `memberIds` when both are supplied.
   */
  stages?: string[][];
}
