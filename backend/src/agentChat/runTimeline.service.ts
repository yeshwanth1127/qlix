import { createHash } from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { readTraceEnvelope, traceLinks } from '../contracts/traceEnvelope.js';

export type RunTimelineSource =
  | 'run'
  | 'message'
  | 'run_event'
  | 'action'
  | 'approval'
  | 'subagent'
  | 'team_event'
  | 'conversation_event'
  | 'usage'
  | 'billing';

export type RunTimelineItem = {
  id: string;
  at: string;
  source: RunTimelineSource;
  kind: string;
  links: Record<string, string>;
  data: unknown;
};

function linksWithTrace(base: Record<string, string>, data: unknown): Record<string, string> {
  const trace = readTraceEnvelope(data);
  return trace ? { ...base, ...traceLinks(trace) } : base;
}

const SECRET_KEY = /secret|token|password|authorization|api[_-]?key|private[_-]?key|cookie/i;
const INLINE_SECRET = /\b(authorization|api[_-]?key|token|password)\s*([:=])\s*(\S+)/gi;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function redactTimelineValue(value: unknown, key = ''): unknown {
  if (SECRET_KEY.test(key)) return '[REDACTED]';
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    const clipped = value.length > 4_000 ? `${value.slice(0, 4_000)}…[truncated]` : value;
    return clipped.replace(INLINE_SECRET, '$1$2[REDACTED]').replace(BEARER, 'Bearer [REDACTED]');
  }
  if (Array.isArray(value)) return value.map((item) => redactTimelineValue(item, key));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([childKey]) => !['reasoning', 'reasoning_content', 'chain_of_thought'].includes(childKey.toLowerCase()))
        .map(([childKey, child]) => [childKey, redactTimelineValue(child, childKey)]),
    );
  }
  return value;
}

export function mergeRunTimeline(items: RunTimelineItem[]): RunTimelineItem[] {
  return [...items].sort((a, b) => {
    const time = Date.parse(a.at) - Date.parse(b.at);
    return time || a.source.localeCompare(b.source) || a.id.localeCompare(b.id);
  });
}

function containsRunId(value: unknown, runId: string): boolean {
  try {
    return JSON.stringify(value).includes(runId);
  } catch {
    return false;
  }
}

function linkedToRun(value: unknown, runId: string, teamRunId?: string | null): boolean {
  return containsRunId(value, runId) || Boolean(teamRunId && containsRunId(value, teamRunId));
}

export async function getAgentRunTimeline(runId: string): Promise<{
  run: Record<string, unknown>;
  authority: { actions: 'signed_action_log'; billing: 'successful_events_and_run_usage' };
  items: RunTimelineItem[];
}> {
  const run = await prisma.agentRun.findUnique({
    where: { id: runId },
    select: {
      id: true,
      agentId: true,
      conversationId: true,
      inputMessageId: true,
      outputMessageId: true,
      teamRunId: true,
      parentRunId: true,
      status: true,
      sourceChannel: true,
      inferenceModel: true,
      createdAt: true,
      startedAt: true,
      finishedAt: true,
      userId: true,
      orgId: true,
    },
  });
  if (!run) throw Object.assign(new Error('Run not found'), { code: 'not_found' });

  const end = run.finishedAt ?? new Date();
  const windowStart = new Date(run.createdAt.getTime() - 5_000);
  const windowEnd = new Date(end.getTime() + 5_000);
  const messageIds = [run.inputMessageId, run.outputMessageId].filter((id): id is string => Boolean(id));

  const [events, messages, subagents, teamEvents, actions, usage, billing, conversationEvents] =
    await Promise.all([
      prisma.agentRunEvent.findMany({ where: { runId }, orderBy: { seq: 'asc' } }),
      messageIds.length
        ? prisma.agentMessage.findMany({ where: { id: { in: messageIds } }, orderBy: { createdAt: 'asc' } })
        : prisma.agentMessage.findMany({
            where: { conversationId: run.conversationId, createdAt: { gte: windowStart, lte: windowEnd } },
            orderBy: { createdAt: 'asc' },
          }),
      prisma.subAgentInvocation.findMany({ where: { parentRunId: runId }, orderBy: { createdAt: 'asc' } }),
      run.teamRunId
        ? prisma.teamRunEvent.findMany({ where: { runId: run.teamRunId }, orderBy: { seq: 'asc' } })
        : Promise.resolve([]),
      prisma.actionLog.findMany({
        where: {
          agentId: run.agentId,
          timestampMs: { gte: BigInt(windowStart.getTime()), lte: BigInt(windowEnd.getTime()) },
        },
        include: { approval: true },
        orderBy: { timestampMs: 'asc' },
        take: 1_000,
      }),
      prisma.runUsage.findUnique({ where: { runId } }),
      run.orgId
        ? prisma.successfulEvent.findMany({
            where: { orgId: run.orgId, successfulEventKey: `run:${runId}` },
            orderBy: { occurredAt: 'asc' },
          })
        : Promise.resolve([]),
      run.orgId
        ? prisma.conversationEvent.findMany({
            where: { orgId: run.orgId, occurredAt: { gte: windowStart, lte: windowEnd } },
            orderBy: { occurredAt: 'asc' },
            take: 500,
          })
        : Promise.resolve([]),
    ]);

  const links = {
    runId,
    agentId: run.agentId,
    conversationId: run.conversationId,
    ...(run.teamRunId ? { teamRunId: run.teamRunId } : {}),
  };
  const items: RunTimelineItem[] = [
    {
      id: `run:${runId}:created`,
      at: run.createdAt.toISOString(),
      source: 'run',
      kind: 'run_created',
      links,
      data: { status: run.status, sourceChannel: run.sourceChannel, model: run.inferenceModel },
    },
  ];

  for (const message of messages) {
    items.push({
      id: message.id,
      at: message.createdAt.toISOString(),
      source: 'message',
      kind: `message_${message.role}`,
      links: { ...links, messageId: message.id },
      data: {
        role: message.role,
        chars: message.content.length,
        contentSha256: digest(message.content),
        linkage: messageIds.includes(message.id) ? 'exact' : 'legacy_time_window',
      },
    });
  }
  for (const event of events) {
    items.push({
      id: event.id,
      at: event.createdAt.toISOString(),
      source: 'run_event',
      kind: event.type,
      links: linksWithTrace({ ...links, eventId: event.id, eventSeq: String(event.seq) }, event.data),
      data: redactTimelineValue(event.data),
    });
  }
  for (const invocation of subagents) {
    items.push({
      id: invocation.id,
      at: invocation.createdAt.toISOString(),
      source: 'subagent',
      kind: `subagent_${invocation.status}`,
      links: {
        ...links,
        invocationId: invocation.id,
        ...(invocation.childRunId ? { childRunId: invocation.childRunId } : {}),
      },
      data: redactTimelineValue({ name: invocation.name, status: invocation.status, skills: invocation.skills }),
    });
  }
  for (const event of teamEvents) {
    items.push({
      id: event.id,
      at: new Date(Number(event.timestampMs)).toISOString(),
      source: 'team_event',
      kind: event.eventType,
      links: linksWithTrace({ ...links, teamEventId: event.id, teamEventSeq: String(event.seq) }, event.payload),
      data: redactTimelineValue(event.payload),
    });
  }
  const correlatedActionIds = new Set(
    actions.filter((row) => linkedToRun(row.payload, runId, run.teamRunId)).map((row) => row.id),
  );
  const linkedActions = actions.filter((row) => {
    if (correlatedActionIds.has(row.id)) return true;
    const payload = row.payload as Record<string, unknown> | null;
    return Boolean(payload && correlatedActionIds.has(String(payload.startActionId ?? '')));
  });
  for (const action of linkedActions) {
    const payload = action.payload as Record<string, unknown> | null;
    const startActionId = String(payload?.startActionId ?? action.id);
    items.push({
      id: action.id,
      at: new Date(Number(action.timestampMs)).toISOString(),
      source: 'action',
      kind: action.actionType,
      links: linksWithTrace({ ...links, actionId: action.id, startActionId }, action.payload),
      data: redactTimelineValue({
        status: action.status,
        approvalStatus: action.approvalStatus,
        riskLevel: action.riskLevel,
        payload: action.payload,
      }),
    });
    if (action.approval) {
      items.push({
        id: action.approval.id,
        at: new Date(Number(action.approval.decidedAtMs ?? action.approval.requestedAtMs)).toISOString(),
        source: 'approval',
        kind: `approval_${action.approval.decision}`,
        links: { ...links, actionId: action.id, approvalId: action.approval.id },
        data: { decision: action.approval.decision, ttlSeconds: action.approval.ttlSeconds },
      });
    }
  }
  if (usage) {
    items.push({
      id: usage.id,
      at: usage.createdAt.toISOString(),
      source: 'usage',
      kind: 'model_usage',
      links: { ...links, usageId: usage.id },
      data: {
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: usage.totalTokens,
        totalCostUsd: String(usage.totalCostUsd),
        model: usage.model,
        provider: usage.provider,
      },
    });
  }
  for (const event of billing) {
    items.push({
      id: event.id,
      at: event.occurredAt.toISOString(),
      source: 'billing',
      kind: event.eventType,
      links: { ...links, billingEventId: event.id },
      data: { amountCharged: String(event.amountCharged), billingCycle: event.billingCycle },
    });
  }
  for (const event of conversationEvents.filter((row) => linkedToRun(row.payload, runId, run.teamRunId))) {
    items.push({
      id: event.id,
      at: event.occurredAt.toISOString(),
      source: 'conversation_event',
      kind: event.eventType,
      links: linksWithTrace({ ...links, conversationEventId: event.id, threadId: event.threadId }, event.payload),
      data: redactTimelineValue(event.payload),
    });
  }
  if (run.startedAt) {
    items.push({ id: `run:${runId}:started`, at: run.startedAt.toISOString(), source: 'run', kind: 'run_started', links, data: {} });
  }
  if (run.finishedAt) {
    items.push({ id: `run:${runId}:finished`, at: run.finishedAt.toISOString(), source: 'run', kind: `run_${run.status}`, links, data: {} });
  }

  return {
    run: redactTimelineValue({ ...run, userId: undefined, orgId: undefined }) as Record<string, unknown>,
    authority: {
      actions: 'signed_action_log',
      billing: 'successful_events_and_run_usage',
    },
    items: mergeRunTimeline(items),
  };
}
