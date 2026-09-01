const apiBase = () => process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

export interface UsageSummaryItem {
  agentId: string;
  agentName: string;
  totalRuns: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  totalCostUsd: string;
}

export interface UsageSummaryResponse {
  billingCycle: string;
  summary: UsageSummaryItem[];
}

export interface AgentRunUsage {
  runId: string | null;
  conversationId: string | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  totalCostUsd: string;
  model: string | null;
  createdAt: string;
}

export interface AgentUsageResponse {
  agentId: string;
  nextCursor: string | null;
  runs: AgentRunUsage[];
}

export interface UsageRoundDetail {
  round: number;
  estimatedInputTokens: number;
  messageTokens: number;
  toolsSchemaTokens: number;
  retainedToolChars: number;
  components?: Record<string, number>;
}

export interface DetailedUsageRun {
  usageId: string;
  runType: 'agent' | 'brain_query';
  agentId: string;
  agentName: string;
  runId: string | null;
  conversationId: string | null;
  teamRunId: string | null;
  teamId?: string | null;
  teamRole?: string | null;
  stageOrder?: number | null;
  attempt?: number | null;
  parentRunId: string | null;
  invocationKind: string | null;
  sourceChannel: string | null;
  status: string;
  createdAt: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  model: string | null;
  provider: string | null;
  generationId: string | null;
  promptTokens: number;
  cachedPromptTokens: number;
  completionTokens: number;
  totalTokens: number;
  providerCostUsd: string;
  upstreamInferenceCostUsd: string | null;
  roundCount: number;
  peakRequestTokens: number | null;
  estimatedInputTokens: number | null;
  toolsSchemaTokens: number | null;
  rounds: UsageRoundDetail[];
  components?: Record<string, number> | null;
  explainedTokens?: number;
  unexplainedTokens?: number;
  coverage?: number;
  attribution?: Record<string, number>;
}

export interface UsageAttribution {
  promptTokens: number;
  explainedTokens: number;
  unexplainedTokens: number;
  coverage: number;
  byComponent: Record<string, number>;
  meetsTarget: boolean;
  target: number;
}

export interface TeamStageAttemptUsage {
  teamRunId: string;
  stageOrder: number;
  attempt: number;
  teamRole: string | null;
  promptTokens: number;
  completionTokens: number;
  explainedTokens: number;
  unexplainedTokens: number;
  coverage: number;
}

export interface DetailedUsageGroup {
  agentId: string;
  agentName: string;
  totalRuns: number;
  promptTokens: number;
  cachedPromptTokens: number;
  completionTokens: number;
  totalTokens: number;
  providerCostUsd: string;
  runs: DetailedUsageRun[];
}

export interface QualityRate {
  passed: number;
  total: number;
  rate: number;
}

export interface SuccessQuality {
  completion: QualityRate;
  contractPass: QualityRate;
  artifactValidity: QualityRate;
  userRetry: QualityRate;
}

export interface DetailedUsageResponse {
  billingCycle: string;
  truncated: boolean;
  groups: DetailedUsageGroup[];
  attribution?: UsageAttribution;
  teams?: TeamStageAttemptUsage[];
  quality?: SuccessQuality;
}

export async function getUsageSummary(billingCycle?: string): Promise<UsageSummaryResponse | null> {
  const base = await apiBase();
  try {
    const url = new URL(`${base}/api/v1/usage/summary`);
    if (billingCycle) {
      url.searchParams.set('billingCycle', billingCycle);
    }
    const res = await fetch(url.toString(), {
      credentials: 'include',
    });
    if (!res.ok) return null;
    return (await res.json()) as UsageSummaryResponse;
  } catch {
    return null;
  }
}

export async function getAgentUsage(agentId: string, billingCycle?: string): Promise<AgentUsageResponse | null> {
  const base = await apiBase();
  try {
    const url = new URL(`${base}/api/v1/usage/agents/${encodeURIComponent(agentId)}`);
    if (billingCycle) {
      url.searchParams.set('billingCycle', billingCycle);
    }
    const res = await fetch(url.toString(), {
      credentials: 'include',
    });
    if (!res.ok) return null;
    return (await res.json()) as AgentUsageResponse;
  } catch {
    return null;
  }
}

export async function getDetailedUsage(billingCycle?: string): Promise<DetailedUsageResponse | null> {
  const base = await apiBase();
  try {
    const url = new URL(`${base}/api/v1/usage/runs`);
    if (billingCycle) url.searchParams.set('billingCycle', billingCycle);
    const res = await fetch(url.toString(), { credentials: 'include' });
    if (!res.ok) return null;
    return (await res.json()) as DetailedUsageResponse;
  } catch {
    return null;
  }
}
