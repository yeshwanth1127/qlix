import { prisma } from '../lib/prisma.js';
import { enqueueAgentRun } from '../agentChat/agentRunService.js';

/** Very small cron matcher: supports `m h dom mon dow` with `*` and simple lists/ranges. */
export function cronMatches(expression: string, date: Date = new Date()): boolean {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [min, hour, dom, mon, dow] = parts;
  const vals = [
    date.getUTCMinutes(),
    date.getUTCHours(),
    date.getUTCDate(),
    date.getUTCMonth() + 1,
    date.getUTCDay(),
  ];
  const specs = [min, hour, dom, mon, dow];
  return specs.every((spec, i) => fieldMatches(spec!, vals[i]!));
}

function fieldMatches(spec: string, value: number): boolean {
  if (spec === '*') return true;
  return spec.split(',').some((token) => {
    if (token.includes('-')) {
      const [a, b] = token.split('-').map((x) => Number(x));
      return Number.isFinite(a) && Number.isFinite(b) && value >= a! && value <= b!;
    }
    if (token.startsWith('*/')) {
      const step = Number(token.slice(2));
      return Number.isFinite(step) && step > 0 && value % step === 0;
    }
    return Number(token) === value;
  });
}

export function nextCronApprox(expression: string, from: Date = new Date()): Date {
  // Scan up to 7 days ahead, minute granularity (good enough for employee schedules).
  const cursor = new Date(from);
  cursor.setUTCSeconds(0, 0);
  for (let i = 0; i < 60 * 24 * 7; i += 1) {
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
    if (cronMatches(expression, cursor)) return new Date(cursor);
  }
  return new Date(from.getTime() + 60 * 60_000);
}

export async function tickEmployeeSchedules(now: Date = new Date()): Promise<number> {
  const due = await prisma.employeeSchedule.findMany({
    where: {
      enabled: true,
      OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }],
    },
    take: 50,
  });

  let enqueued = 0;
  for (const sched of due) {
    if (!cronMatches(sched.cronExpression, now) && sched.nextRunAt && sched.nextRunAt > now) {
      continue;
    }
    // Only fire when cron matches the current minute (or nextRunAt was explicitly due).
    const dueByTime = sched.nextRunAt != null && sched.nextRunAt <= now;
    if (!dueByTime && !cronMatches(sched.cronExpression, now)) {
      await prisma.employeeSchedule.update({
        where: { id: sched.id },
        data: { nextRunAt: nextCronApprox(sched.cronExpression, now) },
      });
      continue;
    }

    const agent = await prisma.agent.findUnique({
      where: { id: sched.agentId },
      select: { id: true, userId: true, orgId: true, status: true },
    });
    if (!agent || agent.status !== 'active') continue;

    const { getOrCreatePrimaryConversation } = await import('../agentChat/conversationService.js');
    const convo = await getOrCreatePrimaryConversation({
      agentId: agent.id,
      userId: agent.userId,
      orgId: agent.orgId,
    });

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
          agentName: 'Scheduled employee',
        }),
      );
      enqueued += 1;
    } catch (err) {
      // Fallback direct enqueue if gateway rejects
      try {
        await enqueueAgentRun({
          agentId: agent.id,
          conversationId: convo.id,
          userId: agent.userId,
          orgId: agent.orgId,
          prompt: sched.prompt,
          teamRole: 'cron',
        });
        enqueued += 1;
      } catch (inner) {
        console.error('[employee-schedule] enqueue failed', sched.id, inner ?? err);
      }
    }

    await prisma.employeeSchedule.update({
      where: { id: sched.id },
      data: {
        lastEnqueuedAt: now,
        nextRunAt: nextCronApprox(sched.cronExpression, now),
      },
    });
  }
  return enqueued;
}
