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
  runId: string;
  conversationId: string;
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
