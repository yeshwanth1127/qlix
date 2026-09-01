/** Phase 0 measurement: explain billed prompt tokens by context component and Team stage/attempt. */

export const PROMPT_ATTRIBUTION_TARGET = 0.95;

export type PromptAttribution = {
  promptTokens: number;
  explainedTokens: number;
  unexplainedTokens: number;
  coverage: number;
  byComponent: Record<string, number>;
  meetsTarget: boolean;
};

export type TeamStageAttemptRow = {
  teamRunId: string;
  stageOrder: number;
  attempt: number;
  teamRole: string | null;
  promptTokens: number;
  completionTokens: number;
  explainedTokens: number;
  unexplainedTokens: number;
  coverage: number;
};

function finiteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sumRecord(values: Record<string, number>): number {
  return Object.values(values).reduce((sum, tokens) => sum + Math.max(0, tokens), 0);
}

export function numberRecord(value: unknown): Record<string, number> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([key, item]) => [key, finiteNumber(item)] as const)
    .filter((entry): entry is readonly [string, number] => entry[1] != null && entry[1] >= 0);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

export function extractTeamDispatch(events: Array<{ data: unknown }>): {
  attempt: number | null;
  stageOrder: number | null;
  nodeId: string | null;
  teamRole: string | null;
} {
  for (const event of events) {
    if (!event.data || typeof event.data !== 'object' || Array.isArray(event.data)) continue;
    const data = event.data as Record<string, unknown>;
    if (data.message !== 'team_dispatch') continue;
    return {
      attempt: finiteNumber(data.attempt),
      stageOrder: finiteNumber(data.stageOrder),
      nodeId: typeof data.nodeId === 'string' && data.nodeId ? data.nodeId : null,
      teamRole: typeof data.teamRole === 'string' && data.teamRole ? data.teamRole : null,
    };
  }
  return { attempt: null, stageOrder: null, nodeId: null, teamRole: null };
}

export function attributePromptTokens(input: {
  promptTokens: number;
  components?: Record<string, number> | null;
  rounds?: Array<{ messageTokens?: number; toolsSchemaTokens?: number; components?: Record<string, number> }>;
  runType?: string;
}): PromptAttribution {
  const promptTokens = Math.max(0, Math.floor(input.promptTokens) || 0);
  const byComponent: Record<string, number> = { ...(input.components ?? {}) };
  if (Object.keys(byComponent).length === 0 && input.rounds && input.rounds.length > 0) {
    const last = input.rounds[input.rounds.length - 1];
    if (last.components && Object.keys(last.components).length > 0) {
      Object.assign(byComponent, last.components);
    } else {
      const messages = Math.max(0, last.messageTokens ?? 0);
      const tools = Math.max(0, last.toolsSchemaTokens ?? 0);
      if (messages > 0) byComponent.messages = messages;
      if (tools > 0) byComponent.tools = tools;
    }
  }
  if (Object.keys(byComponent).length === 0 && input.runType === 'brain_query' && promptTokens > 0) {
    byComponent.brain = promptTokens;
  }
  const explainedTokens = sumRecord(byComponent);
  const unexplainedTokens = Math.max(0, promptTokens - explainedTokens);
  if (unexplainedTokens > 0) byComponent.unexplained = unexplainedTokens;
  const coverage = promptTokens > 0 ? Math.min(1, explainedTokens / promptTokens) : 1;
  return {
    promptTokens,
    explainedTokens,
    unexplainedTokens,
    coverage,
    byComponent,
    meetsTarget: coverage >= PROMPT_ATTRIBUTION_TARGET,
  };
}

export function summarizePromptAttribution(runs: PromptAttribution[]): PromptAttribution {
  const promptTokens = runs.reduce((sum, run) => sum + run.promptTokens, 0);
  const byComponent: Record<string, number> = {};
  for (const run of runs) {
    for (const [name, tokens] of Object.entries(run.byComponent)) {
      if (name === 'unexplained') continue;
      byComponent[name] = (byComponent[name] ?? 0) + tokens;
    }
  }
  return attributePromptTokens({ promptTokens, components: byComponent });
}

export function groupTeamTokensByStageAttempt(
  runs: Array<{
    teamRunId: string | null;
    teamRole?: string | null;
    stageOrder: number | null;
    attempt: number | null;
    promptTokens: number;
    completionTokens: number;
    explainedTokens: number;
    unexplainedTokens: number;
    coverage: number;
  }>,
): TeamStageAttemptRow[] {
  const buckets = new Map<string, TeamStageAttemptRow>();
  for (const run of runs) {
    if (!run.teamRunId) continue;
    const stageOrder = run.stageOrder ?? 0;
    const attempt = run.attempt ?? 1;
    const key = `${run.teamRunId}:${stageOrder}:${attempt}:${run.teamRole ?? ''}`;
    const current = buckets.get(key) ?? {
      teamRunId: run.teamRunId,
      stageOrder,
      attempt,
      teamRole: run.teamRole ?? null,
      promptTokens: 0,
      completionTokens: 0,
      explainedTokens: 0,
      unexplainedTokens: 0,
      coverage: 1,
    };
    current.promptTokens += run.promptTokens;
    current.completionTokens += run.completionTokens;
    current.explainedTokens += run.explainedTokens;
    current.unexplainedTokens += run.unexplainedTokens;
    buckets.set(key, current);
  }
  return [...buckets.values()]
    .map((row) => ({
      ...row,
      coverage: row.promptTokens > 0 ? Math.min(1, row.explainedTokens / row.promptTokens) : 1,
    }))
    .sort((a, b) => a.teamRunId.localeCompare(b.teamRunId) || a.stageOrder - b.stageOrder || a.attempt - b.attempt);
}

export function assignMissingTeamAttempts<T extends {
  teamRunId: string | null;
  rankAgentId: string;
  createdAt: string;
  attempt: number | null;
}>(runs: T[]): T[] {
  const grouped = new Map<string, T[]>();
  for (const run of runs) {
    if (!run.teamRunId || run.attempt != null) continue;
    const key = `${run.teamRunId}:${run.rankAgentId}`;
    const list = grouped.get(key) ?? [];
    list.push(run);
    grouped.set(key, list);
  }
  const ranked = new Map<T, number>();
  for (const list of grouped.values()) {
    list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    list.forEach((run, index) => ranked.set(run, index + 1));
  }
  return runs.map((run) => ({ ...run, attempt: run.attempt ?? ranked.get(run) ?? null }));
}
