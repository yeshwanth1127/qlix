/**
 * Scheduled events — cron / once / interval triggers that enqueue agent runs.
 * Independent of EmployeeSchedule; consumed by qlix-schedule MCP, console API, and AI Brain.
 */
import { prisma } from '../lib/prisma.js';
import { enqueueAgentRun } from '../agentChat/agentRunService.js';
import { cronMatches, nextCronApprox } from '../employees/employeeSchedule.service.js';
import type { Prisma, ScheduledEvent } from '@prisma/client';

export type ScheduleType = 'cron' | 'once' | 'interval';
export type ScheduleSource = 'mcp' | 'console' | 'brain';
export type ScheduleStatus = 'active' | 'paused' | 'cancelled' | 'completed';

export class ScheduleValidationError extends Error {
  readonly code = 'invalid_schedule';
  constructor(message: string) {
    super(message);
  }
}

export class ScheduleNotFoundError extends Error {
  readonly code = 'not_found';
  constructor(message = 'Schedule not found') {
    super(message);
  }
}

export class ScheduleForbiddenError extends Error {
  readonly code = 'forbidden';
  constructor(message = 'Not allowed') {
    super(message);
  }
}

const MIN_INTERVAL_SECONDS = 60;
const MAX_INTERVAL_SECONDS = 60 * 60 * 24 * 30; // 30 days
const MAX_PROMPT = 4000;
const MAX_LABEL = 120;

export interface CreateScheduleInput {
  orgId: string;
  agentId: string;
  createdByAgentId?: string | null;
  createdByUserId?: string | null;
  scheduleType: ScheduleType;
  cronExpression?: string | null;
  onceAt?: Date | string | null;
  intervalSeconds?: number | null;
  label?: string | null;
  prompt: string;
  payloadJson?: Prisma.InputJsonValue | null;
  enabled?: boolean;
  maxRuns?: number | null;
  source?: ScheduleSource;
  /** When true, calling agent may only target itself. */
  restrictToCallerAgent?: boolean;
}

export interface UpdateScheduleInput {
  label?: string | null;
  prompt?: string;
  cronExpression?: string | null;
  onceAt?: Date | string | null;
  intervalSeconds?: number | null;
  enabled?: boolean;
  status?: 'active' | 'paused';
  maxRuns?: number | null;
}

function parseOnceAt(value: Date | string): Date {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new ScheduleValidationError('onceAt must be a valid ISO datetime');
  }
  return d;
}

export function validateCronExpression(expression: string): void {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new ScheduleValidationError('cronExpression must be a 5-field UTC cron (m h dom mon dow)');
  }
  // Smoke-test: next fire must resolve within the scan window.
  const next = nextCronApprox(expression.trim(), new Date());
  if (!(next instanceof Date) || Number.isNaN(next.getTime())) {
    throw new ScheduleValidationError('cronExpression could not be resolved');
  }
}

export function computeNextRunAt(input: {
  scheduleType: ScheduleType;
  cronExpression?: string | null;
  onceAt?: Date | null;
  intervalSeconds?: number | null;
  from?: Date;
}): Date | null {
  const from = input.from ?? new Date();
  switch (input.scheduleType) {
    case 'cron': {
      if (!input.cronExpression) return null;
      return nextCronApprox(input.cronExpression, from);
    }
    case 'once': {
      if (!input.onceAt) return null;
      return input.onceAt > from ? input.onceAt : null;
    }
    case 'interval': {
      const secs = input.intervalSeconds ?? MIN_INTERVAL_SECONDS;
      return new Date(from.getTime() + secs * 1000);
    }
    default:
      return null;
  }
}

function normalizeCreateFields(input: CreateScheduleInput): {
  scheduleType: ScheduleType;
  cronExpression: string | null;
  onceAt: Date | null;
  intervalSeconds: number | null;
  maxRuns: number | null;
  nextRunAt: Date | null;
  prompt: string;
  label: string | null;
} {
  const scheduleType = input.scheduleType;
  if (!['cron', 'once', 'interval'].includes(scheduleType)) {
    throw new ScheduleValidationError('scheduleType must be cron, once, or interval');
  }

  const prompt = input.prompt.trim();
  if (!prompt || prompt.length > MAX_PROMPT) {
    throw new ScheduleValidationError(`prompt is required (max ${MAX_PROMPT} chars)`);
  }
  const label = input.label?.trim() ? input.label.trim().slice(0, MAX_LABEL) : null;

  let cronExpression: string | null = null;
  let onceAt: Date | null = null;
  let intervalSeconds: number | null = null;
  let maxRuns = input.maxRuns ?? null;

  if (scheduleType === 'cron') {
    const expr = (input.cronExpression ?? '').trim();
    if (!expr) throw new ScheduleValidationError('cronExpression is required for cron schedules');
    validateCronExpression(expr);
    cronExpression = expr;
  } else if (scheduleType === 'once') {
    if (input.onceAt == null) throw new ScheduleValidationError('onceAt is required for once schedules');
    onceAt = parseOnceAt(input.onceAt);
    if (onceAt.getTime() <= Date.now() - 60_000) {
      throw new ScheduleValidationError('onceAt must be in the future');
    }
    maxRuns = 1;
  } else {
    const secs = Number(input.intervalSeconds);
    if (!Number.isFinite(secs) || secs < MIN_INTERVAL_SECONDS || secs > MAX_INTERVAL_SECONDS) {
      throw new ScheduleValidationError(
        `intervalSeconds must be between ${MIN_INTERVAL_SECONDS} and ${MAX_INTERVAL_SECONDS}`,
      );
    }
    intervalSeconds = Math.floor(secs);
  }

  if (maxRuns != null && (!Number.isInteger(maxRuns) || maxRuns < 1 || maxRuns > 10_000)) {
    throw new ScheduleValidationError('maxRuns must be an integer from 1 to 10000');
  }

  const nextRunAt = computeNextRunAt({
    scheduleType,
    cronExpression,
    onceAt,
    intervalSeconds,
  });
  if (!nextRunAt) {
    throw new ScheduleValidationError('Could not compute nextRunAt for this schedule');
  }

  return { scheduleType, cronExpression, onceAt, intervalSeconds, maxRuns, nextRunAt, prompt, label };
}

async function assertAgentInOrg(agentId: string, orgId: string): Promise<{
  id: string;
  userId: string;
  orgId: string | null;
  status: string;
}> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { id: true, userId: true, orgId: true, status: true, user: { select: { orgId: true } } },
  });
  if (!agent) throw new ScheduleNotFoundError('Agent not found');
  const agentOrg = agent.orgId ?? agent.user.orgId;
  if (agentOrg !== orgId) throw new ScheduleForbiddenError('Agent is not in this organization');
  return agent;
}

export function toScheduleDto(row: ScheduledEvent) {
  return {
    id: row.id,
    orgId: row.orgId,
    agentId: row.agentId,
    createdByAgentId: row.createdByAgentId,
    createdByUserId: row.createdByUserId,
    scheduleType: row.scheduleType,
    cronExpression: row.cronExpression,
    onceAt: row.onceAt?.toISOString() ?? null,
    intervalSeconds: row.intervalSeconds,
    timezone: row.timezone,
    actionType: row.actionType,
    label: row.label,
    prompt: row.prompt,
    payloadJson: row.payloadJson,
    enabled: row.enabled,
    status: row.status,
    lastEnqueuedAt: row.lastEnqueuedAt?.toISOString() ?? null,
    nextRunAt: row.nextRunAt?.toISOString() ?? null,
    runCount: row.runCount,
    maxRuns: row.maxRuns,
    lastError: row.lastError,
    source: row.source,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class ScheduleService {
  async create(input: CreateScheduleInput) {
    const fields = normalizeCreateFields(input);
    const target = await assertAgentInOrg(input.agentId, input.orgId);

    if (input.restrictToCallerAgent && input.createdByAgentId && input.createdByAgentId !== target.id) {
      throw new ScheduleForbiddenError('Agents may only schedule runs for themselves');
    }

    const row = await prisma.scheduledEvent.create({
      data: {
        orgId: input.orgId,
        agentId: target.id,
        createdByAgentId: input.createdByAgentId ?? null,
        createdByUserId: input.createdByUserId ?? null,
        scheduleType: fields.scheduleType,
        cronExpression: fields.cronExpression,
        onceAt: fields.onceAt,
        intervalSeconds: fields.intervalSeconds,
        label: fields.label,
        prompt: fields.prompt,
        payloadJson: input.payloadJson ?? undefined,
        enabled: input.enabled ?? true,
        status: 'active',
        nextRunAt: fields.nextRunAt,
        maxRuns: fields.maxRuns,
        source: input.source ?? 'mcp',
      },
    });
    return toScheduleDto(row);
  }

  async list(params: {
    orgId: string;
    agentId?: string | null;
    createdByAgentId?: string | null;
    status?: string | null;
    includeCancelled?: boolean;
  }) {
    const rows = await prisma.scheduledEvent.findMany({
      where: {
        orgId: params.orgId,
        ...(params.agentId ? { agentId: params.agentId } : {}),
        ...(params.createdByAgentId ? { createdByAgentId: params.createdByAgentId } : {}),
        ...(params.status
          ? { status: params.status }
          : params.includeCancelled
            ? {}
            : { status: { not: 'cancelled' } }),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map(toScheduleDto);
  }

  async get(orgId: string, id: string) {
    const row = await prisma.scheduledEvent.findFirst({ where: { id, orgId } });
    if (!row) throw new ScheduleNotFoundError();
    return toScheduleDto(row);
  }

  async update(orgId: string, id: string, patch: UpdateScheduleInput, opts?: { callerAgentId?: string }) {
    const existing = await prisma.scheduledEvent.findFirst({ where: { id, orgId } });
    if (!existing) throw new ScheduleNotFoundError();
    if (existing.status === 'cancelled' || existing.status === 'completed') {
      throw new ScheduleValidationError(`Cannot update a ${existing.status} schedule`);
    }
    if (opts?.callerAgentId && existing.createdByAgentId && existing.createdByAgentId !== opts.callerAgentId) {
      // Allow update if the caller is the target agent (self-schedules).
      if (existing.agentId !== opts.callerAgentId) {
        throw new ScheduleForbiddenError('Not allowed to update this schedule');
      }
    }

    let cronExpression = existing.cronExpression;
    let onceAt = existing.onceAt;
    let intervalSeconds = existing.intervalSeconds;
    const scheduleType = existing.scheduleType as ScheduleType;

    if (patch.cronExpression !== undefined) {
      if (scheduleType !== 'cron') throw new ScheduleValidationError('cronExpression only applies to cron schedules');
      const expr = (patch.cronExpression ?? '').trim();
      validateCronExpression(expr);
      cronExpression = expr;
    }
    if (patch.onceAt !== undefined) {
      if (scheduleType !== 'once') throw new ScheduleValidationError('onceAt only applies to once schedules');
      onceAt = patch.onceAt == null ? null : parseOnceAt(patch.onceAt);
    }
    if (patch.intervalSeconds !== undefined) {
      if (scheduleType !== 'interval') {
        throw new ScheduleValidationError('intervalSeconds only applies to interval schedules');
      }
      const secs = Number(patch.intervalSeconds);
      if (!Number.isFinite(secs) || secs < MIN_INTERVAL_SECONDS || secs > MAX_INTERVAL_SECONDS) {
        throw new ScheduleValidationError(
          `intervalSeconds must be between ${MIN_INTERVAL_SECONDS} and ${MAX_INTERVAL_SECONDS}`,
        );
      }
      intervalSeconds = Math.floor(secs);
    }

    let prompt = existing.prompt;
    if (patch.prompt !== undefined) {
      const p = patch.prompt.trim();
      if (!p || p.length > MAX_PROMPT) {
        throw new ScheduleValidationError(`prompt is required (max ${MAX_PROMPT} chars)`);
      }
      prompt = p;
    }

    let status = existing.status;
    let enabled = existing.enabled;
    if (patch.status === 'paused') {
      status = 'paused';
      enabled = false;
    } else if (patch.status === 'active') {
      status = 'active';
      enabled = true;
    }
    if (patch.enabled !== undefined) {
      enabled = patch.enabled;
      if (patch.enabled) status = 'active';
      else if (status === 'active') status = 'paused';
    }

    const nextRunAt = computeNextRunAt({
      scheduleType,
      cronExpression,
      onceAt,
      intervalSeconds,
    });

    const row = await prisma.scheduledEvent.update({
      where: { id: existing.id },
      data: {
        cronExpression,
        onceAt,
        intervalSeconds,
        prompt,
        label:
          patch.label !== undefined
            ? patch.label?.trim()
              ? patch.label.trim().slice(0, MAX_LABEL)
              : null
            : undefined,
        enabled,
        status,
        nextRunAt,
        maxRuns: patch.maxRuns !== undefined ? patch.maxRuns : undefined,
        lastError: null,
      },
    });
    return toScheduleDto(row);
  }

  async cancel(orgId: string, id: string, opts?: { callerAgentId?: string }) {
    const existing = await prisma.scheduledEvent.findFirst({ where: { id, orgId } });
    if (!existing) throw new ScheduleNotFoundError();
    if (opts?.callerAgentId && existing.createdByAgentId && existing.createdByAgentId !== opts.callerAgentId) {
      if (existing.agentId !== opts.callerAgentId) {
        throw new ScheduleForbiddenError('Not allowed to cancel this schedule');
      }
    }
    if (existing.status === 'cancelled') return toScheduleDto(existing);
    const row = await prisma.scheduledEvent.update({
      where: { id: existing.id },
      data: { status: 'cancelled', enabled: false, nextRunAt: null },
    });
    return toScheduleDto(row);
  }

  /** Fire due events (called once per minute by backgroundScheduler). */
  async tick(now: Date = new Date()): Promise<number> {
    const due = await prisma.scheduledEvent.findMany({
      where: {
        enabled: true,
        status: 'active',
        OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }],
      },
      take: 50,
      orderBy: { nextRunAt: 'asc' },
    });

    let fired = 0;
    for (const sched of due) {
      try {
        const didFire = await this.fireOne(sched, now);
        if (didFire) fired += 1;
      } catch (err) {
        console.error('[scheduled-events] fire failed', sched.id, err);
        await prisma.scheduledEvent.update({
          where: { id: sched.id },
          data: {
            lastError: err instanceof Error ? err.message.slice(0, 500) : 'fire failed',
            nextRunAt: computeNextRunAt({
              scheduleType: sched.scheduleType as ScheduleType,
              cronExpression: sched.cronExpression,
              onceAt: sched.onceAt,
              intervalSeconds: sched.intervalSeconds,
              from: now,
            }),
          },
        });
      }
    }
    return fired;
  }

  private async fireOne(sched: ScheduledEvent, now: Date): Promise<boolean> {
    const scheduleType = sched.scheduleType as ScheduleType;

    if (scheduleType === 'cron') {
      const dueByTime = sched.nextRunAt != null && sched.nextRunAt <= now;
      if (!dueByTime && !cronMatches(sched.cronExpression ?? '', now)) {
        await prisma.scheduledEvent.update({
          where: { id: sched.id },
          data: { nextRunAt: nextCronApprox(sched.cronExpression ?? '0 * * * *', now) },
        });
        return false;
      }
    } else if (scheduleType === 'once') {
      if (!sched.onceAt || sched.onceAt > now) {
        await prisma.scheduledEvent.update({
          where: { id: sched.id },
          data: { nextRunAt: sched.onceAt },
        });
        return false;
      }
    } else if (scheduleType === 'interval') {
      if (sched.nextRunAt && sched.nextRunAt > now) return false;
    }

    const agent = await prisma.agent.findUnique({
      where: { id: sched.agentId },
      select: { id: true, userId: true, orgId: true, status: true },
    });
    if (!agent || agent.status !== 'active') {
      await prisma.scheduledEvent.update({
        where: { id: sched.id },
        data: { lastError: 'Target agent missing or inactive', nextRunAt: new Date(now.getTime() + 15 * 60_000) },
      });
      return false;
    }

    const { getOrCreatePrimaryConversation } = await import('../agentChat/conversationService.js');
    const convo = await getOrCreatePrimaryConversation({
      agentId: agent.id,
      userId: agent.userId,
      orgId: agent.orgId,
    });

    let enqueued = false;
    try {
      const { gatewayService } = await import('../gateway/index.js');
      const { buildWebChatInbound } = await import('../gateway/adapters/webChat.adapter.js');
      await gatewayService.handleInbound(
        buildWebChatInbound({
          agentId: agent.id,
          conversationId: convo.id,
          userId: agent.userId,
          orgId: agent.orgId,
          body: sched.prompt,
          agentName: sched.label || 'Scheduled event',
        }),
      );
      enqueued = true;
    } catch {
      try {
        await enqueueAgentRun({
          agentId: agent.id,
          conversationId: convo.id,
          userId: agent.userId,
          orgId: agent.orgId,
          prompt: sched.prompt,
          teamRole: 'cron',
        });
        enqueued = true;
      } catch (inner) {
        throw inner;
      }
    }

    const runCount = sched.runCount + 1;
    const hitMax = sched.maxRuns != null && runCount >= sched.maxRuns;
    const completedOnce = scheduleType === 'once' || hitMax;

    let nextRunAt: Date | null = null;
    let status: ScheduleStatus = 'active';
    let enabled = true;
    if (completedOnce) {
      status = 'completed';
      enabled = false;
      nextRunAt = null;
    } else {
      nextRunAt = computeNextRunAt({
        scheduleType,
        cronExpression: sched.cronExpression,
        onceAt: sched.onceAt,
        intervalSeconds: sched.intervalSeconds,
        from: now,
      });
    }

    await prisma.scheduledEvent.update({
      where: { id: sched.id },
      data: {
        lastEnqueuedAt: now,
        runCount,
        nextRunAt,
        status,
        enabled,
        lastError: null,
      },
    });

    return enqueued;
  }
}

export const scheduleService = new ScheduleService();
