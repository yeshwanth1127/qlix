export type TemplateValue = string | number | boolean | null | Record<string, unknown> | unknown[];

export type WorkflowNode =
  | { id: string; type: 'send'; content: string; channel?: string; next: string }
  | { id: string; type: 'ask'; content: string; variable: string; next: string }
  | {
      id: string;
      type: 'collect';
      content: string;
      variable: string;
      next: string;
      validation?: { pattern?: string; allowed?: string[]; required?: boolean; retryPrompt?: string };
    }
  | {
      id: string;
      type: 'branch';
      variable: string;
      cases: Array<{ equals?: TemplateValue; oneOf?: TemplateValue[]; next: string }>;
      default: string;
    }
  | {
      id: string;
      type: 'classify';
      variable: string;
      intents: Array<{ label: string; examples?: string[]; next: string }>;
      unclearNext: string;
      minimumConfidence?: number;
    }
  | { id: string; type: 'action'; action: string; input?: Record<string, TemplateValue>; resultVariable?: string; next: string; onError?: string }
  | { id: string; type: 'wait'; delayMs: number; purpose?: string; next: string }
  | { id: string; type: 'approval'; prompt: string; next: string; onReject?: string }
  | { id: string; type: 'subflow'; workflowKey: string; input?: Record<string, TemplateValue>; resultVariable?: string; next: string; onError?: string }
  | { id: string; type: 'handoff'; target: string; reason?: string }
  | { id: string; type: 'complete'; result?: Record<string, TemplateValue> }
  | { id: string; type: 'fail'; message: string };

export type ConversationWorkflow = {
  key: string;
  version: number;
  entryNodeId: string;
  nodes: WorkflowNode[];
  metadata?: Record<string, unknown>;
};

export type CompiledConversationWorkflow = Omit<ConversationWorkflow, 'nodes'> & {
  nodes: ReadonlyMap<string, WorkflowNode>;
};
