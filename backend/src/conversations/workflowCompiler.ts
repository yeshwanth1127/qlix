import type { CompiledConversationWorkflow, ConversationWorkflow, WorkflowNode } from './workflow.types.js';

const TERMINAL_TYPES = new Set<WorkflowNode['type']>(['complete', 'fail', 'handoff']);

function destinations(node: WorkflowNode): string[] {
  switch (node.type) {
    case 'send':
    case 'ask':
    case 'collect':
    case 'wait':
      return [node.next];
    case 'branch':
      return [...node.cases.map((entry) => entry.next), node.default];
    case 'classify':
      return [...node.intents.map((intent) => intent.next), node.unclearNext];
    case 'action':
    case 'subflow':
      return [node.next, ...(node.onError ? [node.onError] : [])];
    case 'approval':
      return [node.next, ...(node.onReject ? [node.onReject] : [])];
    default:
      return [];
  }
}

export function compileConversationWorkflow(workflow: ConversationWorkflow): CompiledConversationWorkflow {
  if (!workflow.key.trim()) throw new Error('Workflow key is required');
  if (!Number.isInteger(workflow.version) || workflow.version < 1) {
    throw new Error('Workflow version must be a positive integer');
  }
  if (workflow.nodes.length === 0) throw new Error('Workflow must contain at least one node');

  const nodes = new Map<string, WorkflowNode>();
  for (const node of workflow.nodes) {
    if (!node.id.trim()) throw new Error('Workflow node id is required');
    if (nodes.has(node.id)) throw new Error(`Duplicate workflow node id: ${node.id}`);
    nodes.set(node.id, node);
  }
  if (!nodes.has(workflow.entryNodeId)) {
    throw new Error(`Workflow entry node does not exist: ${workflow.entryNodeId}`);
  }
  for (const node of nodes.values()) {
    for (const destination of destinations(node)) {
      if (!nodes.has(destination)) {
        throw new Error(`Workflow node ${node.id} points to missing node ${destination}`);
      }
    }
    if (node.type === 'wait' && (!Number.isFinite(node.delayMs) || node.delayMs < 0)) {
      throw new Error(`Workflow wait node ${node.id} has an invalid delay`);
    }
    if (node.type === 'collect' && node.validation?.pattern) {
      try {
        new RegExp(node.validation.pattern);
      } catch {
        throw new Error(`Workflow collect node ${node.id} has an invalid validation pattern`);
      }
    }
  }

  const reachable = new Set<string>();
  const queue = [workflow.entryNodeId];
  while (queue.length) {
    const id = queue.shift()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    const node = nodes.get(id)!;
    queue.push(...destinations(node));
  }
  const unreachable = [...nodes.keys()].filter((id) => !reachable.has(id));
  if (unreachable.length) throw new Error(`Unreachable workflow nodes: ${unreachable.join(', ')}`);
  if (![...reachable].some((id) => TERMINAL_TYPES.has(nodes.get(id)!.type))) {
    throw new Error('Workflow must have a reachable terminal node');
  }

  return { ...workflow, nodes };
}
