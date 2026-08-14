import { type PrismaClient } from '@prisma/client';

export interface RecordRunUsageInput {
  runId: string;
  agentId: string;
  orgId: string | null;
  userId: string;
}

/**
 * Extract token usage data from AgentRunEvent logs and write a RunUsage row.
 * Looks for the last `inference_success` log event in the run and aggregates token data.
 * Idempotent: upserts based on runId.
 * Stores agentKey/agentName snapshots so usage survives agent deletion.
 */
export async function recordRunUsage(
  prisma: PrismaClient,
  input: RecordRunUsageInput,
): Promise<void> {
  // Fetch all 'log' type events for this run, ordered by seq
  const events = await prisma.agentRunEvent.findMany({
    where: { runId: input.runId, type: 'log' },
    orderBy: { seq: 'asc' },
    select: { seq: true, data: true },
  });

  // Find the last inference_success event (which now contains aggregated token counts thanks to Python fix)
  let promptTokens = 0;
  let completionTokens = 0;
  let totalTokens = 0;
  let totalCostUsd = 0;
  let model: string | null = null;
  let provider: string | null = null;
  let openrouterGenId: string | null = null;

  for (const event of events) {
    const data = event.data as Record<string, unknown> | null;
    if (!data || typeof data !== 'object') continue;

    if (data.message === 'inference_success') {
      const usage = data.usage as Record<string, unknown> | null;
      if (usage && typeof usage === 'object') {
        // The runner now SUMS usage across every round of the tool loop (see
        // accumulate_usage in runner_common.py), so these are whole-run totals.
        promptTokens = Number(usage.prompt_tokens) || 0;
        completionTokens = Number(usage.completion_tokens) || 0;
        totalTokens = Number(usage.total_tokens) || 0;
        // OpenRouter reports spend as `cost` under `usage.include`; `total_cost` is
        // the older field name. Accept either.
        totalCostUsd = Number(usage.cost) || Number(usage.total_cost) || 0;
      }
      model = typeof data.model === 'string' ? data.model : null;
      provider = typeof data.provider === 'string' ? data.provider : null;
      openrouterGenId = typeof data.gen_id === 'string' ? data.gen_id : null;
    }
  }

  const agent = await prisma.agent.findUnique({
    where: { id: input.agentId },
    select: { name: true },
  });
  const agentName = agent?.name?.trim() || input.agentId;

  // Upsert the RunUsage row
  await prisma.runUsage.upsert({
    where: { runId: input.runId },
    create: {
      runId: input.runId,
      agentId: input.agentId,
      agentKey: input.agentId,
      agentName,
      orgId: input.orgId,
      userId: input.userId,
      promptTokens,
      completionTokens,
      totalTokens,
      totalCostUsd,
      model,
      provider,
      openrouterGenId,
    },
    update: {
      agentId: input.agentId,
      agentKey: input.agentId,
      agentName,
      promptTokens,
      completionTokens,
      totalTokens,
      totalCostUsd,
      model,
      provider,
      openrouterGenId,
    },
  });
}
