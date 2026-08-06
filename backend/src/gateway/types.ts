/**
 * Unified gateway types — OpenClaw-style channel turn kernel for Qlix.
 * All channels (web, WhatsApp, Slack, teams) normalize into InboundMessage.
 */

export type GatewayChannel =
  | 'web'
  | 'whatsapp'
  | 'slack'
  | 'telegram'
  | 'system'
  | 'cron'
  | 'local';

export type GatewayTargetType = 'agent' | 'team';

export type AdmissionAction = 'proceed' | 'interrupt' | 'followup' | 'steer' | 'reject' | 'queued';

export interface DeliveryTarget {
  channel: GatewayChannel;
  /** Org that owns the connector token (Slack outbound delivery). */
  orgId?: string | null;
  /** WhatsApp connector id, Slack team/channel, etc. */
  connectorId?: string | null;
  /** Peer address for delivery (E.164 JID, Slack channel, conversation id). */
  peerId?: string | null;
  /** Optional thread / conversation for reply routing. */
  threadId?: string | null;
  /** User-facing label for ack messages. */
  label?: string | null;
}

export interface InboundAttachment {
  id?: string;
  fileName: string;
  mimeType?: string;
  url?: string;
  sizeBytes?: number;
  textPreview?: string;
}

export interface InboundMessage {
  channel: GatewayChannel;
  orgId: string | null;
  userId: string;
  /** Authenticated user email (billing / exempt checks). */
  email?: string;
  /** Stable peer identity within the channel (user id, WhatsApp JID, Slack user). */
  peerId: string;
  /** Optional thread (conversation id, Slack thread_ts). */
  threadId?: string | null;
  body: string;
  /** User-visible text when body includes runner-only attachment blocks. */
  displayBody?: string;
  attachments?: InboundAttachment[];
  skills?: string[];
  inferenceModel?: string | null;
  useBrain?: boolean;
  deliveryTarget: DeliveryTarget;
  /** Pre-resolved route (web chat already knows agent + conversation). */
  preResolved?: Partial<ResolvedRoute>;
  metadata?: Record<string, unknown>;
}

export interface ResolvedRoute {
  targetType: GatewayTargetType;
  agentId?: string;
  teamId?: string;
  conversationId?: string;
  orgId: string | null;
  userId: string;
  /** Display name for queued ack. */
  targetName?: string;
  /** Channel marker stored on AgentRun.teamRole (e.g. whatsapp, slack). */
  teamRole?: string | null;
  routeHint?: string | null;
  sessionKey: string;
}

export interface GatewayTurnAccepted {
  status: 'accepted';
  runId: string;
  messageId?: string;
  sessionKey: string;
  targetType: GatewayTargetType;
  /** Immediate channel ack (WhatsApp "Queued — …"). */
  ackReply?: string;
}

export interface GatewayTurnRejected {
  status: 'rejected';
  reason: string;
  sessionKey?: string;
  ackReply?: string;
}

export interface GatewayTurnQueued {
  status: 'queued';
  sessionKey: string;
  ackReply?: string;
}

export interface GatewayTurnSteered {
  status: 'steered';
  runId: string;
  sessionKey: string;
  ackReply?: string;
}

export type GatewayTurnResult =
  | GatewayTurnAccepted
  | GatewayTurnRejected
  | GatewayTurnQueued
  | GatewayTurnSteered;

export interface AdmissionDecision {
  action: AdmissionAction;
  /** When action is not proceed, the turn result to return. */
  result?: GatewayTurnResult;
  /** Active run id when steer/interrupt applies. */
  activeRunId?: string;
}

export interface ReplyPayload {
  runId: string;
  ok: boolean;
  result?: unknown;
  errorMessage?: string | null;
  agentName?: string | null;
  prompt?: string | null;
}

export interface ChannelAdapter {
  channel: GatewayChannel;
  deliver(target: DeliveryTarget, payload: ReplyPayload): Promise<void>;
}
