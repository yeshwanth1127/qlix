export interface ExecutionBudget {
  maxPromptTokens?: number;
  maxCompletionTokens?: number;
  maxInferenceRounds?: number;
  maxToolCalls?: number;
  maxContextTokens?: number;
  maxLatencyMs?: number;
}

export interface ExecutionUsage {
  promptTokens: number;
  completionTokens: number;
  inferenceRounds: number;
  toolCalls: number;
  contextTokens: number;
  latencyMs: number;
}

export class ExecutionBudgetExceededError extends Error {
  readonly code = 'execution_budget_exceeded';
  constructor(public readonly dimension: keyof ExecutionUsage, public readonly used: number, public readonly limit: number) {
    super(`Execution budget exceeded for ${dimension}: ${used}/${limit}`);
  }
}

const BUDGET_TO_USAGE: Array<[keyof ExecutionBudget, keyof ExecutionUsage]> = [
  ['maxPromptTokens', 'promptTokens'],
  ['maxCompletionTokens', 'completionTokens'],
  ['maxInferenceRounds', 'inferenceRounds'],
  ['maxToolCalls', 'toolCalls'],
  ['maxContextTokens', 'contextTokens'],
  ['maxLatencyMs', 'latencyMs'],
];

export function emptyExecutionUsage(): ExecutionUsage {
  return {
    promptTokens: 0,
    completionTokens: 0,
    inferenceRounds: 0,
    toolCalls: 0,
    contextTokens: 0,
    latencyMs: 0,
  };
}

export function assertExecutionBudget(usage: ExecutionUsage, budget?: ExecutionBudget): void {
  if (!budget) return;
  for (const [budgetKey, usageKey] of BUDGET_TO_USAGE) {
    const limit = budget[budgetKey];
    if (typeof limit === 'number' && usage[usageKey] > limit) {
      throw new ExecutionBudgetExceededError(usageKey, usage[usageKey], limit);
    }
  }
}

export type BudgetShadowDecision = {
  mode: 'shadow';
  ok: boolean;
  dimension?: keyof ExecutionUsage;
  used?: number;
  limit?: number;
};

/** Compare usage to a budget without blocking execution. */
export function evaluateBudgetShadow(usage: ExecutionUsage, budget?: ExecutionBudget): BudgetShadowDecision {
  if (!budget) return { mode: 'shadow', ok: true };
  for (const [budgetKey, usageKey] of BUDGET_TO_USAGE) {
    const limit = budget[budgetKey];
    if (typeof limit === 'number' && usage[usageKey] > limit) {
      return { mode: 'shadow', ok: false, dimension: usageKey, used: usage[usageKey], limit };
    }
  }
  return { mode: 'shadow', ok: true };
}

export interface GraphNode {
  id: string;
  dependsOn: readonly string[];
}

/** Nodes whose dependencies have all completed successfully. */
export function readyNodeIds(
  nodes: readonly GraphNode[],
  completed: ReadonlySet<string>,
  blocked: ReadonlySet<string> = new Set(),
): string[] {
  return nodes
    .filter((node) => {
      if (completed.has(node.id) || blocked.has(node.id)) return false;
      return node.dependsOn.every((dep) => completed.has(dep));
    })
    .map((node) => node.id);
}

/** Run independent work concurrently while preserving input order in the Result. */
export async function mapConcurrentOrdered<T, R>(
  values: readonly T[],
  concurrency: number,
  execute: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  const limit = Math.min(values.length, Math.max(1, Math.floor(concurrency || 1)));
  let cursor = 0;
  const lanes = Array.from({ length: limit }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= values.length) return;
      results[index] = await execute(values[index]!, index);
    }
  });
  await Promise.all(lanes);
  return results;
}

