import type { PermissionScope } from '../agents/agents.types.js';
import type {
  LiveArtifactState,
  WaitPolicySnapshot,
  WaitStep,
} from '../wait/waitPolicy.types.js';

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
  | 'outbound_blocked'
  | 'user_injection'
  | 'wait_armed'
  | 'wait_ttl_requested'
  | 'wait_ttl_set'
  | 'wait_progress'
  | 'live_artifact_updated'
  | 'wait_fulfilled'
  | 'wait_expired';

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
  /** How much of the completion budget thinking models may spend reasoning. */
  defaultReasoningEffort?: string;
  /** Declarative external-event waits (WhatsApp inbound + side effects). */
  waitSteps?: WaitStep[];
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

export type TeamRunSourceChannel = 'web' | 'whatsapp' | 'api' | 'slack' | 'telegram';
export type TeamRunReplyChannel = 'whatsapp' | 'none';
export type TeamRunInputPurpose = 'authoritative_input' | 'reference_asset';

export interface TeamRunInput {
  id: string;
  ref: string;
  fileName: string;
  mimeType: string;
  url: string;
  sizeBytes: number;
  extractedText?: string;
  sha256: string;
  purpose: TeamRunInputPurpose;
}

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
  /** Durable state used to continue a paused external-event wait. */
  checkpointJson?: TeamRunCheckpoint | null;
  inputs: TeamRunInput[];
  result: unknown | null;
  errorMessage: string | null;
  continuesRunId?: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface TeamRunCheckpoint {
  plan: SubtaskCheckpoint[];
  completedResults: WorkerResultCheckpoint[];
  nextStageIndex: number;
  waitTriggerIds: string[];
  waitReason: string;
  /** True until the user picks a wait duration in team chat. */
  awaitingTtlSelection?: boolean;
  /** Chosen wait deadline (ISO), after TTL is set. */
  waitExpiresAt?: string | null;
  /** Chosen wait duration in hours. */
  waitTtlHours?: number | null;
  /** Model override for this run (survives pause/resume). */
  inferenceModel?: string | null;
  /** Immutable wait policy for this pause/resume cycle. */
  waitPolicySnapshot?: WaitPolicySnapshot;
  /** Live sandbox artifacts updated while waiting. */
  liveArtifacts?: LiveArtifactState[];
  /** Contact metadata captured when outreach messages are sent (name/phone for sheet rows). */
  waitContacts?: Record<string, { name?: string | null; phone?: string | null; recipient?: string | null }>;
  /**
   * WhatsApp contact messages queued during outreach. Delivered only after the run
   * enters wait mode and the user sets a wait TTL — prevents replies arriving before capture is ready.
   */
  pendingWaitOutbounds?: PendingWaitOutbound[];
}

export type PendingWaitOutbound = {
  id: string;
  agentId: string;
  connectorId: string;
  recipient: string;
  /** Text body, poll question, or document display name. */
  message: string;
  kind?: 'text' | 'poll' | 'document';
  pollName?: string;
  pollValues?: string[];
  pollSelectableCount?: number;
  /** Staged file for document outbounds (under tmpdir/qlix-wa-pending). */
  documentFileName?: string;
  documentMimetype?: string;
  documentStagedPath?: string;
  replyInstructions?: string | null;
  jid?: string | null;
  phone?: string | null;
  name?: string | null;
  queuedAt: string;
  /** Last flush error if send failed (item stays queued). */
  lastError?: string | null;
};

export interface SubtaskCheckpoint {
  subtaskId: string;
  agentId: string;
  agentName: string;
  agentDescription?: string;
  role: string;
  goal: string;
  delegatedScopes: PermissionScope[];
  allowedScopes: PermissionScope[];
  stageOrder: number;
  contractId?: string;
  inputRefs: string[];
  allowedSources: TeamRunInputPurpose[];
  knowledgeMode: 'none' | 'reference_only' | 'required';
  outputContract: Record<string, unknown>;
}

export interface WorkerResultCheckpoint {
  subtaskId: string;
  agentId: string;
  agentName: string;
  summary: string;
  findings: string;
  payload?: unknown;
  mailboxMessageId?: string;
  artifacts: TeamRunArtifact[];
  status: 'completed' | 'failed';
  errorMessage?: string;
}

export type TeamMailboxKind = 'message' | 'result';
export type TeamMailboxStatus = 'pending' | 'completed' | 'failed' | 'canceled';

export interface TeamMailboxMessageDTO {
  id: string;
  teamRunId: string;
  teamId: string;
  kind: TeamMailboxKind;
  status: TeamMailboxStatus;
  senderAgentId: string | null;
  recipientAgentId: string | null;
  a2aTaskId: string | null;
  agentRunId: string | null;
  contractId: string | null;
  payload: unknown;
  errorMessage: string | null;
  createdAt: string;
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
  /** When set at create time the team is stored as active. Otherwise assign via PATCH /:id/supervisor. */
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
