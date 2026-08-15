import type {
  ConversationEffect,
  ConversationRuntimeState,
  ConversationSignal,
} from './conversation.types.js';
import type {
  CompiledConversationWorkflow,
  TemplateValue,
  WorkflowNode,
} from './workflow.types.js';

export type RuntimeTransition = {
  state: ConversationRuntimeState;
  effects: ConversationEffect[];
  result?: Record<string, unknown>;
};

const MAX_AUTOMATIC_STEPS = 100;

function cloneState(state: ConversationRuntimeState): ConversationRuntimeState {
  return {
    ...state,
    variables: { ...state.variables },
    nodeVisits: { ...state.nodeVisits },
    frameStack: [...state.frameStack],
    waiting: state.waiting ? { ...state.waiting } : undefined,
  };
}

function normalizeComparable(value: unknown): unknown {
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}

function equalValue(left: unknown, right: unknown): boolean {
  return normalizeComparable(left) === normalizeComparable(right);
}

function interpolateString(template: string, variables: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_match, path: string) => {
    const value = path.split('.').reduce<unknown>((current, key) => {
      if (!current || typeof current !== 'object') return undefined;
      return (current as Record<string, unknown>)[key];
    }, variables);
    return value == null ? '' : String(value);
  });
}

function resolveTemplate(value: TemplateValue, variables: Record<string, unknown>): unknown {
  if (typeof value === 'string') return interpolateString(value, variables);
  if (Array.isArray(value)) return value.map((entry) => resolveTemplate(entry as TemplateValue, variables));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, resolveTemplate(entry as TemplateValue, variables)]),
    );
  }
  return value;
}

function inputForNode(node: Extract<WorkflowNode, { type: 'action' | 'subflow' }>, variables: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(node.input ?? {}).map(([key, value]) => [key, resolveTemplate(value, variables)]),
  );
}

function visit(state: ConversationRuntimeState, nodeId: string): number {
  const count = (state.nodeVisits[nodeId] ?? 0) + 1;
  state.nodeVisits[nodeId] = count;
  return count;
}

function effectIndex(state: ConversationRuntimeState, nodeId: string): number {
  return state.nodeVisits[nodeId] ?? 1;
}

function validateCollected(node: Extract<WorkflowNode, { type: 'collect' }>, text: string): boolean {
  const value = text.trim();
  if (node.validation?.required !== false && !value) return false;
  if (node.validation?.allowed?.length) {
    return node.validation.allowed.some((allowed) => equalValue(allowed, value));
  }
  if (node.validation?.pattern) return new RegExp(node.validation.pattern).test(value);
  return true;
}

function acceptSignal(
  state: ConversationRuntimeState,
  workflow: CompiledConversationWorkflow,
  signal: ConversationSignal,
  effects: ConversationEffect[],
): { result?: Record<string, unknown> } {
  if (signal.type === 'cancel') {
    state.status = 'canceled';
    state.waiting = undefined;
    state.error = signal.reason;
    return {};
  }
  if (signal.type === 'start') {
    if (state.status !== 'created') throw new Error('A conversation can only be started once');
    Object.assign(state.variables, signal.payload ?? {});
    state.status = 'active';
    return {};
  }
  if (!state.waiting || state.waiting.nodeId !== state.currentNodeId) {
    throw new Error(`Conversation is not waiting for ${signal.type}`);
  }
  const node = workflow.nodes.get(state.currentNodeId!);
  if (!node) throw new Error(`Current workflow node does not exist: ${state.currentNodeId}`);

  if (signal.type === 'inbound' && (node.type === 'ask' || node.type === 'collect')) {
    if (node.type === 'collect' && !validateCollected(node, signal.text)) {
      visit(state, node.id);
      effects.push({
        type: 'send',
        nodeId: node.id,
        operationIndex: effectIndex(state, node.id),
        content: interpolateString(node.validation?.retryPrompt ?? node.content, state.variables),
      });
      return {};
    }
    state.variables[node.variable] = signal.text.trim();
    Object.assign(state.variables, signal.payload ?? {});
    state.waiting = undefined;
    state.status = 'active';
    state.currentNodeId = node.next;
    return {};
  }
  if (signal.type === 'action_result' && node.type === 'classify') {
    const result = signal.result as { label?: unknown; confidence?: unknown } | undefined;
    const label = typeof result?.label === 'string' ? result.label : '';
    const confidence = typeof result?.confidence === 'number' ? result.confidence : 0;
    const intent = node.intents.find((candidate) => candidate.label === label);
    const threshold = node.minimumConfidence ?? 0.7;
    const accepted = Boolean(signal.ok && intent && confidence >= threshold);
    state.variables[`${node.variable}Classification`] = {
      label: accepted ? intent!.label : 'unclear',
      confidence,
      method: 'plugin',
    };
    state.currentNodeId = accepted ? intent!.next : node.unclearNext;
    state.waiting = undefined;
    state.status = 'active';
    return {};
  }
  if (signal.type === 'action_result' && node.type === 'action') {
    if (signal.ok) {
      if (node.resultVariable) state.variables[node.resultVariable] = signal.result;
      state.currentNodeId = node.next;
    } else if (node.onError) {
      state.variables.lastActionError = signal.error ?? 'Action failed';
      state.currentNodeId = node.onError;
    } else {
      state.status = 'failed';
      state.error = signal.error ?? 'Action failed';
    }
    state.waiting = undefined;
    if (state.status !== 'failed') state.status = 'active';
    return {};
  }
  if (signal.type === 'timer_fired' && node.type === 'wait') {
    Object.assign(state.variables, signal.payload ?? {});
    state.waiting = undefined;
    state.status = 'active';
    state.currentNodeId = node.next;
    return {};
  }
  if (signal.type === 'approval_result' && node.type === 'approval') {
    Object.assign(state.variables, signal.payload ?? {});
    state.waiting = undefined;
    state.status = 'active';
    state.currentNodeId = signal.approved ? node.next : (node.onReject ?? node.next);
    return {};
  }
  if (signal.type === 'subflow_result' && node.type === 'subflow') {
    if (signal.ok) {
      if (node.resultVariable) state.variables[node.resultVariable] = signal.result;
      state.currentNodeId = node.next;
    } else if (node.onError) {
      state.variables.lastSubflowError = signal.error ?? 'Subflow failed';
      state.currentNodeId = node.onError;
    } else {
      state.status = 'failed';
      state.error = signal.error ?? 'Subflow failed';
    }
    state.waiting = undefined;
    if (state.status !== 'failed') state.status = 'active';
    return {};
  }
  throw new Error(`Signal ${signal.type} is invalid while waiting at node ${node.id}`);
}

function drive(
  state: ConversationRuntimeState,
  workflow: CompiledConversationWorkflow,
  effects: ConversationEffect[],
): { result?: Record<string, unknown> } {
  for (let step = 0; step < MAX_AUTOMATIC_STEPS && state.status === 'active'; step++) {
    const node = workflow.nodes.get(state.currentNodeId ?? '');
    if (!node) throw new Error(`Workflow node does not exist: ${state.currentNodeId}`);
    visit(state, node.id);
    const operationIndex = effectIndex(state, node.id);

    switch (node.type) {
      case 'send':
        effects.push({ type: 'send', nodeId: node.id, operationIndex, channel: node.channel, content: interpolateString(node.content, state.variables) });
        state.currentNodeId = node.next;
        break;
      case 'ask':
      case 'collect':
        effects.push({ type: 'send', nodeId: node.id, operationIndex, content: interpolateString(node.content, state.variables) });
        state.waiting = { kind: 'input', nodeId: node.id, variable: node.variable };
        state.status = 'waiting_input';
        break;
      case 'branch': {
        const value = state.variables[node.variable];
        const match = node.cases.find((entry) =>
          entry.equals !== undefined
            ? equalValue(value, entry.equals)
            : entry.oneOf?.some((candidate) => equalValue(value, candidate)),
        );
        state.currentNodeId = match?.next ?? node.default;
        break;
      }
      case 'classify': {
        const raw = state.variables[node.variable];
        const text = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
        const deterministic = node.intents.find((intent) =>
          intent.label.toLowerCase() === text ||
          intent.examples?.some((example) => example.trim().toLowerCase() === text),
        );
        if (deterministic) {
          state.variables[`${node.variable}Classification`] = {
            label: deterministic.label,
            confidence: 1,
            method: 'deterministic',
          };
          state.currentNodeId = deterministic.next;
          break;
        }
        effects.push({
          type: 'action',
          nodeId: node.id,
          operationIndex,
          action: 'conversation.classify',
          input: {
            text: raw,
            allowedIntents: node.intents.map((intent) => intent.label),
            minimumConfidence: node.minimumConfidence ?? 0.7,
          },
        });
        state.waiting = { kind: 'action', nodeId: node.id };
        state.status = 'waiting_action';
        break;
      }
      case 'action':
        effects.push({ type: 'action', nodeId: node.id, operationIndex, action: node.action, input: inputForNode(node, state.variables) });
        state.waiting = { kind: 'action', nodeId: node.id };
        state.status = 'waiting_action';
        break;
      case 'wait':
        effects.push({ type: 'timer', nodeId: node.id, operationIndex, delayMs: node.delayMs, purpose: node.purpose });
        state.waiting = { kind: 'timer', nodeId: node.id };
        state.status = 'waiting_timer';
        break;
      case 'approval':
        effects.push({ type: 'approval', nodeId: node.id, operationIndex, prompt: interpolateString(node.prompt, state.variables) });
        state.waiting = { kind: 'approval', nodeId: node.id };
        state.status = 'waiting_approval';
        break;
      case 'subflow':
        effects.push({ type: 'subflow', nodeId: node.id, operationIndex, workflowKey: node.workflowKey, input: inputForNode(node, state.variables) });
        state.waiting = { kind: 'subflow', nodeId: node.id };
        state.status = 'waiting_action';
        break;
      case 'handoff':
        effects.push({ type: 'handoff', nodeId: node.id, operationIndex, target: node.target, reason: node.reason ? interpolateString(node.reason, state.variables) : undefined });
        state.status = 'handed_off';
        state.waiting = undefined;
        break;
      case 'complete': {
        const result = Object.fromEntries(
          Object.entries(node.result ?? state.variables).map(([key, value]) => [key, resolveTemplate(value as TemplateValue, state.variables)]),
        );
        state.status = 'completed';
        state.currentNodeId = null;
        state.waiting = undefined;
        return { result };
      }
      case 'fail':
        state.status = 'failed';
        state.error = interpolateString(node.message, state.variables);
        state.waiting = undefined;
        break;
    }
  }
  if (state.status === 'active') throw new Error(`Workflow exceeded ${MAX_AUTOMATIC_STEPS} automatic steps`);
  return {};
}

export function createInitialConversationState(
  workflow: CompiledConversationWorkflow,
  variables: Record<string, unknown> = {},
): ConversationRuntimeState {
  return {
    workflowKey: workflow.key,
    workflowVersion: workflow.version,
    status: 'created',
    currentNodeId: workflow.entryNodeId,
    variables: { ...variables },
    nodeVisits: {},
    frameStack: [],
  };
}

export function transitionConversation(
  current: ConversationRuntimeState,
  workflow: CompiledConversationWorkflow,
  signal: ConversationSignal,
): RuntimeTransition {
  if (current.workflowKey !== workflow.key || current.workflowVersion !== workflow.version) {
    throw new Error('Conversation state and workflow version do not match');
  }
  const state = cloneState(current);
  const effects: ConversationEffect[] = [];
  const accepted = acceptSignal(state, workflow, signal, effects);
  if (state.status === 'canceled' || state.status === 'failed') return { state, effects, ...accepted };
  const driven = drive(state, workflow, effects);
  return { state, effects, result: driven.result ?? accepted.result };
}
