import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { appendAgentRunLogEvent } from '../agentChat/agentRunService.js';
import { agentAskScopeFor } from './peerAgentScopes.js';

export type SubAgentTaskInput = {
  prompt: string;
  skills?: string[];
  name?: string | null;
  /**
   * V2: name or id of a *different* agent to hand this task to.
   *
   * Omitted keeps V1 behaviour — a nested in-process child of the same agent. Present means a
   * real run on that agent, with its own identity, scopes and audit trail, gated by the caller
   * holding `agent.ask.<targetId>`.
   */
  agent?: string | null;
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

function fail(code: string, message: string): never {
  const err = new Error(message);
  (err as Error & { code: string }).code = code;
  throw err;
}

/** How far back the cycle guard walks before giving up. Chain caps keep chains far shorter. */
const MAX_ANCESTRY_WALK = 16;

/**
 * How many agent-to-agent hops a single chain may contain.
 *
 * `subAgentMaxDepth` bounds *nested in-process* children, but each V2 hop starts a fresh run
 * with its own runner context and its own depth counter — so without this, A→B→C→D… could grow
 * without limit, holding a runner slot at every level while the callers block.
 */
const MAX_PEER_CHAIN = 3;

export class SubAgentService {
  /**
   * Resolve a V2 task's `agent` (id or name) to a real, reachable agent in the same org, and
   * confirm the caller is allowed to hand work to it.
   *
   * Authorization is a scope check — `agent.ask.<targetId>` — so revoking access is the same
   * gesture as revoking any other capability, and it shows up in audit the same way.
   */
  private async resolvePeerTarget(params: {
    callerAgentId: string;
    ref: string;
  }): Promise<{ id: string; name: string }> {
    const caller = await prisma.agent.findUnique({
      where: { id: params.callerAgentId },
      select: { orgId: true, permissionScopes: true },
    });
    if (!caller) fail('not_found', 'Calling agent not found');
    if (!caller.orgId) fail('peer_not_allowed', 'Agent has no workspace to find colleagues in');

    const ref = params.ref.trim();
    const target = await prisma.agent.findFirst({
      where: {
        orgId: caller.orgId,
        status: { not: 'revoked' },
        runtime: { in: ['cloud', 'hybrid'] },
        OR: [{ id: ref }, { name: ref }],
      },
      select: { id: true, name: true },
    });
    if (!target) fail('peer_not_found', `No agent named "${ref}" in this workspace`);

    if (target.id === params.callerAgentId) {
      fail('peer_self', 'An agent cannot hand work to itself — omit `agent` for a nested sub-agent');
    }

    if (!caller.permissionScopes.includes(agentAskScopeFor(target.id))) {
      fail('peer_not_allowed', `Not allowed to hand work to "${target.name}"`);
    }

    return target;
  }

  /**
   * Refuse A → B → A. The existing depth cap bounds how deep nesting goes but says nothing about
   * whether the same agent reappears, and a two-agent ping-pong stays within any depth limit
   * while consuming a runner slot at every hop.
   */
  private async assertNoCycle(parentRunId: string, targetAgentId: string): Promise<void> {
    let cursor: string | null = parentRunId;
    let peerHops = 0;

    for (let hops = 0; cursor && hops < MAX_ANCESTRY_WALK; hops++) {
      const run: { agentId: string; parentRunId: string | null; invocationKind: string | null } | null =
        await prisma.agentRun.findUnique({
          where: { id: cursor },
          select: { agentId: true, parentRunId: true, invocationKind: true },
        });
      if (!run) break;
      if (run.agentId === targetAgentId) {
        fail('peer_cycle', 'That agent is already waiting further up this chain');
      }
      if (run.invocationKind === 'subagent') peerHops += 1;
      cursor = run.parentRunId;
    }

    if (peerHops >= MAX_PEER_CHAIN) {
      fail('peer_chain_too_deep', `Work can only be handed on ${MAX_PEER_CHAIN} times in a row`);
    }
  }

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

    // Resolve and authorize every named target *before* creating anything, so a rejected task
    // never leaves half a batch of invocations behind.
    const targets = new Map<number, { id: string; name: string }>();
    for (const [index, task] of params.tasks.entries()) {
      const ref = task.agent?.trim();
      if (!ref) continue;
      const target = await this.resolvePeerTarget({ callerAgentId: params.agentId, ref });
      await this.assertNoCycle(params.parentRunId, target.id);
      targets.set(index, target);
    }

    const created = await prisma.$transaction(
      params.tasks.map((task, index) =>
        prisma.subAgentInvocation.create({
          data: {
            parentRunId: params.parentRunId,
            parentAgentId: params.agentId,
            childAgentId: targets.get(index)?.id ?? null,
            name: task.name?.trim() || targets.get(index)?.name || null,
            prompt: task.prompt,
            skills: (task.skills ?? []).map((s) => String(s).trim()).filter(Boolean),
            depth,
            status: 'queued',
          },
        }),
      ),
    );

    for (const [index, row] of created.entries()) {
      // V2 tasks become real runs on the target agent. V1 tasks are left alone — the SDK runs
      // those in-process, and enqueuing a same-agent run here would deadlock against the parent.
      const target = targets.get(index);
      if (target) {
        await this.dispatchPeerRun({ invocationId: row.id, callerAgentId: params.agentId, parentRunId: params.parentRunId, target, prompt: row.prompt, skills: row.skills });
      }

      await appendAgentRunLogEvent(params.parentRunId, {
        message: 'subagent_spawned',
        invocationId: row.id,
        name: row.name,
        skills: row.skills,
        depth: row.depth,
        childAgentId: target?.id ?? null,
        childAgentName: target?.name ?? null,
        promptPreview: row.prompt.slice(0, 200),
      });
    }

    const rows = await prisma.subAgentInvocation.findMany({
      where: { id: { in: created.map((r) => r.id) } },
      orderBy: { createdAt: 'asc' },
    });

    return {
      invocations: rows.map(toDto),
      maxParallel: subAgentMaxParallel(),
    };
  }

  /**
   * Start a real run on the target agent for a V2 invocation.
   *
   * The run goes through `gatewayService.handleInbound` like every other entry point — no second
   * execution path — and lands in a conversation belonging to the **target**. Which thread
   * depends on where the work came from: canvas work stays in that canvas's builder thread, and
   * anything else gets the target's "Asked by <caller>" thread. Neither is `kind: 'chat'`, so
   * the target's direct-chat context is untouched either way.
   */
  private async dispatchPeerRun(params: {
    invocationId: string;
    callerAgentId: string;
    parentRunId: string;
    target: { id: string; name: string };
    prompt: string;
    skills: string[];
  }): Promise<void> {
    const [{ gatewayService, buildWebChatInbound }, conversations] = await Promise.all([
      import('../gateway/index.js'),
      import('../agentChat/conversationService.js'),
    ]);

    const parent = await prisma.agentRun.findUnique({
      where: { id: params.parentRunId },
      select: { userId: true, orgId: true, conversation: { select: { sessionKey: true, kind: true } } },
    });
    if (!parent) fail('parent_run_not_found', 'Parent run not found');

    const caller = await prisma.agent.findUnique({
      where: { id: params.callerAgentId },
      select: { name: true },
    });

    const parentSessionKey = parent.conversation?.sessionKey ?? '';
    const canvasId =
      parent.conversation?.kind === 'builder' && parentSessionKey.startsWith('builder:')
        ? parentSessionKey.slice('builder:'.length)
        : null;

    const conversation = canvasId
      ? await conversations.getOrCreateBuilderConversation({
          agentId: params.target.id,
          userId: parent.userId,
          orgId: parent.orgId,
          canvasId,
          title: 'Visual Builder',
        })
      : await conversations.getOrCreatePeerConversation({
          agentId: params.target.id,
          userId: parent.userId,
          orgId: parent.orgId,
          callerAgentId: params.callerAgentId,
          callerName: caller?.name ?? 'another agent',
        });

    const turn = await gatewayService.handleInbound(
      buildWebChatInbound({
        agentId: params.target.id,
        conversationId: conversation.id,
        userId: parent.userId,
        orgId: parent.orgId,
        body: params.prompt,
        skills: params.skills,
        agentName: params.target.name,
      }),
    );

    if (turn.status !== 'accepted') {
      await prisma.subAgentInvocation.update({
        where: { id: params.invocationId },
        data: {
          status: 'failed',
          errorMessage: turn.status === 'rejected' ? turn.reason : turn.status,
          finishedAt: new Date(),
        },
      });
      return;
    }

    await prisma.$transaction([
      prisma.agentRun.update({
        where: { id: turn.runId },
        data: { parentRunId: params.parentRunId, invocationKind: 'subagent' },
      }),
      prisma.subAgentInvocation.update({
        where: { id: params.invocationId },
        data: { childRunId: turn.runId, status: 'running', startedAt: new Date() },
      }),
    ]);
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
