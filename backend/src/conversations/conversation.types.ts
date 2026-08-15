export const CONVERSATION_THREAD_STATUSES = [
  'created',
  'active',
  'waiting_input',
  'waiting_timer',
  'waiting_action',
  'waiting_approval',
  'handed_off',
  'completed',
  'failed',
  'canceled',
  'expired',
] as const;

export type ConversationThreadStatus = (typeof CONVERSATION_THREAD_STATUSES)[number];

export type ConversationOwnerType = 'workflow' | 'team' | 'agent' | 'human' | 'api' | 'schedule';

export type ConversationEventType =
  | 'thread_started'
  | 'inbound_received'
  | 'outbound_requested'
  | 'outbound_sent'
  | 'outbound_failed'
  | 'action_requested'
  | 'action_completed'
  | 'action_failed'
  | 'timer_scheduled'
  | 'timer_fired'
  | 'approval_requested'
  | 'approval_resolved'
  | 'subflow_requested'
  | 'handoff_requested'
  | 'thread_completed'
  | 'thread_failed'
  | 'thread_canceled'
  | 'thread_expired'
  | 'legacy_wait_armed';

export type ConversationSignal =
  | { type: 'start'; payload?: Record<string, unknown> }
  | { type: 'inbound'; text: string; payload?: Record<string, unknown> }
  | { type: 'action_result'; actionId: string; ok: boolean; result?: unknown; error?: string }
  | { type: 'timer_fired'; timerId?: string; payload?: Record<string, unknown> }
  | { type: 'approval_result'; approved: boolean; payload?: Record<string, unknown> }
  | { type: 'subflow_result'; ok: boolean; result?: unknown; error?: string }
  | { type: 'cancel'; reason?: string };

export type ConversationEffect =
  | {
      type: 'send';
      nodeId: string;
      operationIndex: number;
      channel?: string;
      content: string;
      metadata?: Record<string, unknown>;
    }
  | {
      type: 'action';
      nodeId: string;
      operationIndex: number;
      action: string;
      input: Record<string, unknown>;
    }
  | {
      type: 'timer';
      nodeId: string;
      operationIndex: number;
      delayMs: number;
      purpose?: string;
    }
  | {
      type: 'approval';
      nodeId: string;
      operationIndex: number;
      prompt: string;
    }
  | {
      type: 'subflow';
      nodeId: string;
      operationIndex: number;
      workflowKey: string;
      input: Record<string, unknown>;
    }
  | {
      type: 'handoff';
      nodeId: string;
      operationIndex: number;
      target: string;
      reason?: string;
    };

export type ConversationFrame = {
  workflowKey: string;
  workflowVersion: number;
  returnNodeId: string | null;
};

export type ConversationRuntimeState = {
  workflowKey: string;
  workflowVersion: number;
  status: ConversationThreadStatus;
  currentNodeId: string | null;
  variables: Record<string, unknown>;
  nodeVisits: Record<string, number>;
  frameStack: ConversationFrame[];
  waiting?: {
    kind: 'input' | 'action' | 'timer' | 'approval' | 'subflow';
    nodeId: string;
    variable?: string;
  };
  error?: string;
};

export type ConversationThreadSnapshot = {
  id: string;
  orgId: string;
  processId: string | null;
  status: ConversationThreadStatus;
  version: number;
  state: ConversationRuntimeState | Record<string, unknown>;
};
