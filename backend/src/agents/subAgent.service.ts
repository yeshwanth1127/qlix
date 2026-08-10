import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { appendAgentRunLogEvent } from '../agentChat/agentRunService.js';

export type SubAgentTaskInput = {
  prompt: string;
  skills?: string[];
  name?: string | null;
};

export type SubAgentInvocationDTO = {
  id: string;
  parentRunId: string;
  parentAgentId: string;
  childAgentId: string | null;
  childRunId: string | null;
  name: string | null;
  prompt: string;
  skills: string[];
  depth: number;
  status: string;
  result: unknown;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

function toDto(row: {
  id: string;
  parentRunId: string;
  parentAgentId: string;
  childAgentId: string | null;
  childRunId: string | null;
  name: string | null;
  prompt: string;
  skills: string[];
  depth: number;
  status: string;
  result: unknown;
  errorMessage: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}): SubAgentInvocationDTO {
  return {
    id: row.id,
    parentRunId: row.parentRunId,
    parentAgentId: row.parentAgentId,
    childAgentId: row.childAgentId,
    childRunId: row.childRunId,
    name: row.name,
    prompt: row.prompt,
    skills: row.skills,
    depth: row.depth,
    status: row.status,
    result: row.result,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

const MAX_PER_RUN_DEFAULT = 8;
const MAX_PARALLEL_DEFAULT = 3;

export function subAgentMaxPerRun(): number {
  const raw = process.env.QLIX_SUBAGENT_MAX_PER_RUN?.trim();
  const n = raw ? Number(raw) : MAX_PER_RUN_DEFAULT;
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 32) : MAX_PER_RUN_DEFAULT;
}

export function subAgentMaxParallel(): number {
  const raw = process.env.QLIX_SUBAGENT_MAX_PARALLEL?.trim();
  const n = raw ? Number(raw) : MAX_PARALLEL_DEFAULT;
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 16) : MAX_PARALLEL_DEFAULT;
}

export function subAgentMaxDepth(): number {
  const raw = process.env.QLIX_SUBAGENT_MAX_DEPTH?.trim();
  const n = raw ? Number(raw) : 1;
  return Number.isFinite(n) && n >= 0 ? Math.min(Math.floor(n), 4) : 1;
}

export class SubAgentService {
  async assertParentRun(agentId: string, parentRunId: string) {
    const run = await prisma.agentRun.findUnique({
      where: { id: parentRunId },
      select: { id: true, agentId: true, status: true },
    });
    if (!run || run.agentId !== agentId) {
      const err = new Error('Parent run not found');
      (err as Error & { code: string }).code = 'parent_run_not_found';
      throw err;
    }
    if (run.status !== 'running' && run.status !== 'queued') {
      const err = new Error(`Parent run is ${run.status}, not active`);
      (err as Error & { code: string }).code = 'parent_run_not_active';
      throw err;
    }
    return run;
  }

  async createInvocations(params: {
    agentId: string;
    parentRunId: string;
    tasks: SubAgentTaskInput[];
    depth?: number;
  }): Promise<{ invocations: SubAgentInvocationDTO[]; maxParallel: number }> {
    const maxPerRun = subAgentMaxPerRun();
    const maxDepth = subAgentMaxDepth();
    const depth = params.depth ?? 1;

    if (depth > maxDepth) {
      const err = new Error(`Sub-agent depth ${depth} exceeds max ${maxDepth}`);
      (err as Error & { code: string }).code = 'subagent_depth_exceeded';
      throw err;
    }

    await this.assertParentRun(params.agentId, params.parentRunId);

    const existing = await prisma.subAgentInvocation.count({
      where: { parentRunId: params.parentRunId },
    });
    if (existing + params.tasks.length > maxPerRun) {
      const err = new Error(
        `At most ${maxPerRun} sub-agents per parent run (have ${existing}, requested ${params.tasks.length})`,
      );
      (err as Error & { code: string }).code = 'subagent_cap_exceeded';
      throw err;
    }

    const created = await prisma.$transaction(
      params.tasks.map((task) =>
        prisma.subAgentInvocation.create({
          data: {
            parentRunId: params.parentRunId,
            parentAgentId: params.agentId,
            name: task.name?.trim() || null,
            prompt: task.prompt,
            skills: (task.skills ?? []).map((s) => String(s).trim()).filter(Boolean),
            depth,
            status: 'queued',
          },
        }),
      ),
    );

    for (const row of created) {
      await appendAgentRunLogEvent(params.parentRunId, {
        message: 'subagent_spawned',
        invocationId: row.id,
        name: row.name,
        skills: row.skills,
        depth: row.depth,
        promptPreview: row.prompt.slice(0, 200),
      });
    }

    return {
      invocations: created.map(toDto),
      maxParallel: subAgentMaxParallel(),
    };
  }

  async markRunning(invocationId: string, agentId: string): Promise<SubAgentInvocationDTO> {
    const row = await prisma.subAgentInvocation.findUnique({ where: { id: invocationId } });
    if (!row || row.parentAgentId !== agentId) {
      const err = new Error('Sub-agent invocation not found');
      (err as Error & { code: string }).code = 'not_found';
      throw err;
    }
    const updated = await prisma.subAgentInvocation.update({
      where: { id: invocationId },
      data: { status: 'running', startedAt: row.startedAt ?? new Date() },
    });
    return toDto(updated);
  }

  async completeInvocation(params: {
    invocationId: string;
    agentId: string;
    status: 'completed' | 'failed' | 'canceled';
    result?: unknown;
    errorMessage?: string | null;
  }): Promise<SubAgentInvocationDTO> {
    const row = await prisma.subAgentInvocation.findUnique({
      where: { id: params.invocationId },
    });
    if (!row || row.parentAgentId !== params.agentId) {
      const err = new Error('Sub-agent invocation not found');
      (err as Error & { code: string }).code = 'not_found';
      throw err;
    }

    const updated = await prisma.subAgentInvocation.update({
      where: { id: params.invocationId },
      data: {
        status: params.status,
        result:
          params.result === undefined
            ? undefined
            : (params.result as Prisma.InputJsonValue),
        errorMessage: params.errorMessage ?? null,
        finishedAt: new Date(),
        startedAt: row.startedAt ?? new Date(),
      },
    });

    await appendAgentRunLogEvent(row.parentRunId, {
      message: 'subagent_completed',
      invocationId: updated.id,
      name: updated.name,
      status: updated.status,
      errorMessage: updated.errorMessage,
      resultPreview:
        typeof updated.result === 'object' &&
        updated.result &&
        'content' in (updated.result as Record<string, unknown>)
          ? String((updated.result as Record<string, unknown>).content ?? '').slice(0, 300)
          : undefined,
    });

    return toDto(updated);
  }

  async listForParentRun(agentId: string, parentRunId: string): Promise<SubAgentInvocationDTO[]> {
    await this.assertParentRun(agentId, parentRunId);
    const rows = await prisma.subAgentInvocation.findMany({
      where: { parentRunId, parentAgentId: agentId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toDto);
  }

  async getInvocation(agentId: string, invocationId: string): Promise<SubAgentInvocationDTO> {
    const row = await prisma.subAgentInvocation.findUnique({ where: { id: invocationId } });
    if (!row || row.parentAgentId !== agentId) {
      const err = new Error('Sub-agent invocation not found');
      (err as Error & { code: string }).code = 'not_found';
      throw err;
    }
    return toDto(row);
  }
}
