import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma.js';

export interface EnqueueAgentRunInput {
  agentId: string;
  conversationId: string;
  userId: string;
  orgId: string | null;
  prompt: string;
  skills?: string[];
  inferenceModel?: string | null;
  useBrain?: boolean;
  teamRunId?: string | null;
  teamId?: string | null;
  teamRole?: string | null;
}

export interface EnqueueAgentRunResult {
  runId: string;
  messageId: string;
}

/**
 * Upsert a per-user conversation used for team-orchestrated runs (distinct from chat UI threads).
 */
export async function ensureTeamConversation(params: {
  agentId: string;
  userId: string;
  orgId: string | null;
  teamId: string;
}): Promise<string> {
  const existing = await prisma.agentConversation.findFirst({
    where: {
      agentId: params.agentId,
      userId: params.userId,
      orgId: params.orgId,
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  if (existing) return existing.id;

  const conv = await prisma.agentConversation.create({
    data: {
      agentId: params.agentId,
      userId: params.userId,
      orgId: params.orgId,
    },
  });
  return conv.id;
}

export async function enqueueAgentRun(input: EnqueueAgentRunInput): Promise<EnqueueAgentRunResult> {
  const runId = randomUUID();
  const messageId = randomUUID();

  await prisma.$transaction([
    prisma.agentMessage.create({
      data: {
        id: messageId,
        conversationId: input.conversationId,
        role: 'user',
        content: input.prompt,
      },
    }),
    prisma.agentRun.create({
      data: {
        id: runId,
        agentId: input.agentId,
        conversationId: input.conversationId,
        userId: input.userId,
        orgId: input.orgId,
        status: 'queued',
        prompt: input.prompt,
        skills: input.skills ?? [],
        inferenceModel: input.inferenceModel ?? null,
        useBrain: input.useBrain ?? false,
        teamRunId: input.teamRunId ?? null,
        teamId: input.teamId ?? null,
        teamRole: input.teamRole ?? null,
      },
    }),
  ]);

  return { runId, messageId };
}

export type AgentRunTerminalStatus = 'success' | 'failed' | 'canceled';

export async function getAgentRunStatus(runId: string): Promise<{
  status: string;
  result: unknown;
  errorMessage: string | null;
}> {
  const run = await prisma.agentRun.findUnique({
    where: { id: runId },
    select: { status: true, result: true, errorMessage: true },
  });
  if (!run) throw new Error(`AgentRun not found: ${runId}`);
  return run;
}

const TERMINAL = new Set<string>(['success', 'failed', 'canceled']);

export async function terminateAgentRun(
  runId: string,
  errorMessage: string,
): Promise<void> {
  await prisma.agentRun.updateMany({
    where: { id: runId, status: { notIn: ['success', 'failed', 'canceled'] } },
    data: {
      status: 'failed',
      errorMessage,
      finishedAt: new Date(),
    },
  });
}

export async function waitForAgentRunCompletion(
  runId: string,
  timeoutMs: number,
  pollIntervalMs = 500,
): Promise<{ status: AgentRunTerminalStatus; result: unknown; errorMessage: string | null }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = await getAgentRunStatus(runId);
    if (TERMINAL.has(run.status)) {
      return {
        status: run.status as AgentRunTerminalStatus,
        result: run.result,
        errorMessage: run.errorMessage,
      };
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
  const message = `Agent run timed out after ${timeoutMs}ms`;
  await terminateAgentRun(runId, message);
  throw new Error(message);
}

export async function listAgentRunEventsSince(runId: string, afterSeq: number): Promise<
  Array<{ seq: number; type: string; data: unknown }>
> {
  const events = await prisma.agentRunEvent.findMany({
    where: { runId, seq: { gt: afterSeq } },
    orderBy: { seq: 'asc' },
    select: { seq: true, type: true, data: true },
  });
  return events.map((e) => ({ seq: e.seq, type: e.type, data: e.data }));
}

export type ActiveRunSource = 'whatsapp' | 'team' | 'dashboard';

export interface ActiveAgentRunDTO {
  id: string;
  agentId: string;
  agentName: string;
  agentRuntime: string;
  status: string;
  prompt: string;
  useBrain: boolean;
  source: ActiveRunSource;
  teamRole: string | null;
  teamRunId: string | null;
  createdAt: string;
  startedAt: string | null;
}

function resolveRunSource(teamRole: string | null, teamRunId: string | null): ActiveRunSource {
  if (teamRole === 'whatsapp') return 'whatsapp';
  if (teamRunId) return 'team';
  return 'dashboard';
}

function workspaceRunScope(orgId: string | null, userId: string) {
  const agentWhere = orgId ? { orgId } : { userId, orgId: null };
  const scopeFilter = orgId
    ? { OR: [{ agent: agentWhere }, { orgId }] }
    : { agent: agentWhere };
  return scopeFilter;
}

type RunRowBase = {
  id: string;
  agentId: string;
  status: string;
  prompt: string;
  useBrain: boolean;
  teamRole: string | null;
  teamRunId: string | null;
  createdAt: Date;
  startedAt: Date | null;
  agent: { name: string; runtime: string };
};

function mapActiveRunRow(r: RunRowBase): ActiveAgentRunDTO {
  return {
    id: r.id,
    agentId: r.agentId,
    agentName: r.agent.name,
    agentRuntime: r.agent.runtime,
    status: r.status,
    prompt: r.prompt,
    useBrain: r.useBrain,
    source: resolveRunSource(r.teamRole, r.teamRunId),
    teamRole: r.teamRole,
    teamRunId: r.teamRunId,
    createdAt: r.createdAt.toISOString(),
    startedAt: r.startedAt?.toISOString() ?? null,
  };
}

export interface AgentRunHistoryEventDTO {
  seq: number;
  type: string;
  data: unknown;
}

export interface AgentRunHistoryDTO extends ActiveAgentRunDTO {
  finishedAt: string | null;
  errorMessage: string | null;
  events: AgentRunHistoryEventDTO[];
}

/**
 * Queued or running agent executions visible in the current workspace (org registry or personal agents).
 */
export async function listActiveAgentRuns(
  userId: string,
  orgId: string | null,
): Promise<ActiveAgentRunDTO[]> {
  const scopeFilter = workspaceRunScope(orgId, userId);

  const rows = await prisma.agentRun.findMany({
    where: {
      status: { in: ['queued', 'running'] },
      ...scopeFilter,
    },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    take: 40,
    select: {
      id: true,
      agentId: true,
      status: true,
      prompt: true,
      useBrain: true,
      teamRole: true,
      teamRunId: true,
      createdAt: true,
      startedAt: true,
      agent: { select: { name: true, runtime: true } },
    },
  });

  return rows.map((r) => mapActiveRunRow(r));
}

/**
 * Completed / failed / cancelled runs with log events for the Active runs history section.
 */
export async function listAgentRunHistory(
  userId: string,
  orgId: string | null,
  limit = 30,
): Promise<AgentRunHistoryDTO[]> {
  const scopeFilter = workspaceRunScope(orgId, userId);
  const take = Math.min(Math.max(limit, 1), 50);

  const rows = await prisma.agentRun.findMany({
    where: {
      status: { notIn: ['queued', 'running'] },
      ...scopeFilter,
    },
    orderBy: { createdAt: 'desc' },
    take,
    select: {
      id: true,
      agentId: true,
      status: true,
      prompt: true,
      useBrain: true,
      teamRole: true,
      teamRunId: true,
      createdAt: true,
      startedAt: true,
      finishedAt: true,
      errorMessage: true,
      agent: { select: { name: true, runtime: true } },
      events: {
        where: { type: 'log' },
        orderBy: { seq: 'asc' },
        take: 200,
        select: { seq: true, type: true, data: true },
      },
    },
  });

  return rows.map((r) => ({
    ...mapActiveRunRow(r),
    finishedAt: r.finishedAt?.toISOString() ?? null,
    errorMessage: r.errorMessage,
    events: r.events.map((e) => ({
      seq: e.seq,
      type: e.type,
      data: e.data,
    })),
  }));
}
