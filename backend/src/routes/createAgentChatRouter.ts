import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { enqueueAgentRun } from '../agentChat/agentRunService.js';
import { prisma } from '../lib/prisma.js';
import { authenticateUser } from '../middleware/authenticateUser.js';
import { assertRunnerAuth, RunnerUnauthorizedError } from '../agentChat/runnerAuth.js';
import { drainInjections } from '../teams/runInjectionStore.js';
import { assertModelAllowed, ModelPolicyError, normalizeQlixInferenceModelId } from '../llm/modelPolicy.js';
import { appendAgentRunLogEvent } from '../agentChat/agentRunService.js';
import { BrainQueryService } from '../aiBrain/brainQuery.service.js';
import {
  assertStandardAgentCanQueryBrain,
  BrainNotProvisionedError,
  BrainQueryForbiddenError,
  BrainWrongOrgError,
} from '../aiBrain/agentBrainAccess.js';
import {
  ConnectorNotConfiguredError,
  EmailScopeDeniedError,
  EmailToolError,
  executeEmailRead,
  executeEmailSend,
  N8nNotConfiguredError,
} from '../connectors/emailTool.service.js';
import { JitTokenInvalidError, JitTokenRequiredError } from '../actions/actions.service.js';
import { getWhatsAppConnectorForAgent } from '../connectors/whatsappConnector.service.js';
import {
  getWhatsAppSessionStatus,
  isWhatsAppServiceConfigured,
  sendWhatsAppDocument,
  startWhatsAppSession,
} from '../connectors/whatsappServiceClient.js';
import { recordSuccessfulEvent } from '../billings/lib/recordBillingEvent.js';
import { recordRunUsage } from '../billings/lib/recordRunUsage.js';

const createConversationBody = z.object({});

const postMessageBody = z.object({
  content: z.string().trim().min(1).max(20_000),
  skills: z.array(z.string().trim().min(1).max(120)).default([]),
  /** Canonical proxy model id (`openrouter/...`). Omit to use cloud runner manifest default. */
  model: z.string().trim().min(1).max(200).optional(),
  /** When true, cloud runner retrieves org brain context for this turn (requires `brain.query` on the agent). */
  useBrain: z.boolean().optional().default(false),
});

const runnerBrainQueryBody = z.object({
  question: z.string().trim().min(1).max(4000).optional(),
  contextOnly: z.boolean().optional().default(true),
  collectionIds: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
});

const pollBody = z.object({
  maxWaitMs: z.number().int().min(0).max(30_000).default(0),
});

const runnerLogBody = z.object({
  /** Client hint only; server assigns monotonic seq per run to avoid duplicate (run_id, seq). */
  seq: z.number().int().min(0).optional(),
  type: z.enum(['delta', 'log', 'status']),
  data: z.unknown(),
});

async function appendAgentRunEvent(
  runId: string,
  type: 'delta' | 'log' | 'status',
  data: unknown,
): Promise<number> {
  if (type === 'log' && data && typeof data === 'object' && !Array.isArray(data)) {
    return appendAgentRunLogEvent(runId, data as Record<string, unknown>);
  }
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const agg = await prisma.agentRunEvent.aggregate({
      where: { runId },
      _max: { seq: true },
    });
    const seq = (agg._max.seq ?? -1) + 1;
    try {
      await prisma.agentRunEvent.create({
        data: { runId, seq, type, data: data as any },
      });
      return seq;
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002' &&
        attempt < 3
      ) {
        continue;
      }
      throw err;
    }
  }
  throw new Error('Failed to append run event after retries');
}

const runnerCompleteBody = z.object({
  ok: z.boolean(),
  result: z.unknown().optional(),
  errorMessage: z.string().max(10_000).optional(),
});

const emailReadBody = z.object({
  runId: z.string().trim().min(1).max(80).optional(),
  query: z.string().trim().max(500).optional(),
  maxResults: z.number().int().min(1).max(25).optional(),
  messageId: z.string().trim().max(120).nullable().optional(),
});

const emailSendBody = z.object({
  runId: z.string().trim().min(1).max(80).optional(),
  to: z.array(z.string().email().max(320)).min(1).max(20),
  subject: z.string().trim().min(1).max(500),
  bodyText: z.string().trim().min(1).max(50_000),
  replyToMessageId: z.string().trim().max(120).nullable().optional(),
  jitToken: z.string().trim().min(8).max(512).nullable().optional(),
});

const whatsappSendDocumentBody = z.object({
  runId: z.string().trim().min(1).max(80).optional(),
  file_path: z.string().trim().min(1).max(4096),
  file_name: z.string().trim().min(1).max(255).optional(),
});

async function assertOwnsAgent(request: Request, agentId: string): Promise<{ userId: string; orgId: string }> {
  const auth = request.auth!;
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { id: true, userId: true, orgId: true },
  });
  if (!agent) {
    throw Object.assign(new Error('Agent not found'), { status: 404, code: 'not_found' });
  }
  const owns = agent.userId === auth.userId || (agent.orgId && agent.orgId === auth.orgId);
  if (!owns) {
    throw Object.assign(new Error('Forbidden'), { status: 403, code: 'forbidden' });
  }
  return { userId: auth.userId, orgId: agent.orgId ?? auth.orgId };
}

const STALE_RUNNING_MS = 5 * 60_000;

async function recoverStaleRuns(agentId: string): Promise<void> {
  const staleBefore = new Date(Date.now() - STALE_RUNNING_MS);
  await prisma.agentRun.updateMany({
    where: {
      agentId,
      status: 'running',
      startedAt: { lt: staleBefore },
      finishedAt: null,
    },
    data: {
      status: 'queued',
      startedAt: null,
      errorMessage: null,
    },
  });
}

async function claimNextQueuedRun(agentId: string): Promise<{
  id: string;
  prompt: string;
  skills: string[];
  conversationId: string;
  userId: string;
  createdAt: Date;
  inferenceModel: string | null;
  useBrain: boolean;
} | null> {
  const claimed = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    WITH next_run AS (
      SELECT id
      FROM agent_runs
      WHERE agent_id = ${agentId}
        AND status = 'queued'
      ORDER BY created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE agent_runs r
    SET status = 'running',
        started_at = NOW()
    FROM next_run
    WHERE r.id = next_run.id
    RETURNING r.id
  `);
  const id = claimed[0]?.id;
  if (!id) return null;
  const row = await prisma.agentRun.findUnique({
    where: { id },
    select: {
      id: true,
      prompt: true,
      skills: true,
      conversationId: true,
      userId: true,
      createdAt: true,
      inferenceModel: true,
      useBrain: true,
    },
  });
  return row;
}

export function createAgentChatRouter(): Router {
  const router = Router({ mergeParams: true });

  // UI: create or get default conversation (per agent + user).
  router.post('/:agentId/conversations', authenticateUser(true), async (request: Request, response: Response) => {
    const parsed = createConversationBody.safeParse(request.body ?? {});
    if (!parsed.success) {
      response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid body' } });
      return;
    }
    try {
      const agentId = String(request.params.agentId);
      await assertOwnsAgent(request, agentId);

      const convo = await prisma.agentConversation.upsert({
        where: { agentId_userId: { agentId, userId: request.auth!.userId } },
        create: {
          agentId,
          userId: request.auth!.userId,
          orgId: request.auth!.orgId,
        },
        update: {},
        select: { id: true, createdAt: true },
      });

      response.json({ conversationId: convo.id, createdAt: convo.createdAt.toISOString() });
    } catch (e: any) {
      response.status(e?.status ?? 500).json({
        error: { code: e?.code ?? 'internal_error', message: e?.message ?? 'Failed to create conversation' },
      });
    }
  });

  // UI: list messages
  router.get(
    '/:agentId/conversations/:conversationId/messages',
    authenticateUser(true),
    async (request: Request, response: Response) => {
      try {
        const agentId = String(request.params.agentId);
        const conversationId = String(request.params.conversationId);
        await assertOwnsAgent(request, agentId);

        const convo = await prisma.agentConversation.findUnique({
          where: { id: conversationId },
          select: { id: true, agentId: true, userId: true },
        });
        if (!convo || convo.agentId !== agentId || convo.userId !== request.auth!.userId) {
          response.status(404).json({ error: { code: 'not_found', message: 'Conversation not found' } });
          return;
        }

        const messages = await prisma.agentMessage.findMany({
          where: { conversationId },
          orderBy: { createdAt: 'asc' },
          take: 200,
          select: { id: true, role: true, content: true, createdAt: true },
        });
        response.json({
          messages: messages.map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            createdAt: m.createdAt.toISOString(),
          })),
        });
      } catch (err) {
        console.error('list messages error', err);
        response.status(500).json({ error: { code: 'messages_list_failed', message: 'Failed to list messages' } });
      }
    },
  );

  // UI: clear all messages for this conversation
  router.delete(
    '/:agentId/conversations/:conversationId/messages',
    authenticateUser(true),
    async (request: Request, response: Response) => {
      try {
        const agentId = String(request.params.agentId);
        const conversationId = String(request.params.conversationId);
        await assertOwnsAgent(request, agentId);

        const convo = await prisma.agentConversation.findUnique({
          where: { id: conversationId },
          select: { id: true, agentId: true, userId: true },
        });
        if (!convo || convo.agentId !== agentId || convo.userId !== request.auth!.userId) {
          response.status(404).json({ error: { code: 'not_found', message: 'Conversation not found' } });
          return;
        }

        await prisma.$transaction(async (tx) => {
          await tx.agentRunEvent.deleteMany({
            where: {
              run: {
                conversationId,
              },
            },
          });
          await tx.agentRun.deleteMany({ where: { conversationId } });
          await tx.agentMessage.deleteMany({ where: { conversationId } });
        });

        response.json({ ok: true });
      } catch (err) {
        console.error('clear messages error', err);
        response.status(500).json({ error: { code: 'messages_clear_failed', message: 'Failed to clear messages' } });
      }
    },
  );

  // UI: post a user message -> enqueue run
  router.post(
    '/:agentId/conversations/:conversationId/messages',
    authenticateUser(true),
    async (request: Request, response: Response) => {
      const parsed = postMessageBody.safeParse(request.body);
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid message payload' } });
        return;
      }
      try {
        const agentId = String(request.params.agentId);
        const conversationId = String(request.params.conversationId);
        await assertOwnsAgent(request, agentId);

        const convo = await prisma.agentConversation.findUnique({
          where: { id: conversationId },
          select: { id: true, agentId: true, userId: true, orgId: true },
        });
        if (!convo || convo.agentId !== agentId || convo.userId !== request.auth!.userId) {
          response.status(404).json({ error: { code: 'not_found', message: 'Conversation not found' } });
          return;
        }

        let inferenceModel: string | null = null;
        if (parsed.data.model != null && parsed.data.model.length > 0) {
          inferenceModel = normalizeQlixInferenceModelId(parsed.data.model);
          assertModelAllowed(inferenceModel);
        }

        const { runId, messageId } = await enqueueAgentRun({
          agentId,
          conversationId,
          userId: request.auth!.userId,
          orgId: convo.orgId,
          email: request.auth!.email,
          prompt: parsed.data.content,
          skills: parsed.data.skills,
          inferenceModel,
          useBrain: parsed.data.useBrain,
        });

        response.status(201).json({ messageId, runId });
      } catch (err) {
        if (err instanceof ModelPolicyError) {
          response.status(400).json({ error: { code: 'model_not_allowed', message: err.message } });
          return;
        }
        if ((err as any)?.code === 'insufficient_balance') {
          response.status(402).json({ error: { code: 'insufficient_balance', message: (err as Error).message } });
          return;
        }
        console.error('post message error', err);
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2028') {
          response.status(503).json({
            error: {
              code: 'message_enqueue_timeout',
              message: 'Backend queue is busy. Please retry sending the message.',
            },
          });
          return;
        }
        response.status(500).json({ error: { code: 'message_post_failed', message: 'Failed to post message' } });
      }
    },
  );

  // Runner: org brain query (retrieval or full RAG) — auditable via run ownership + runner token.
  router.post('/:agentId/runs/:runId/brain/query', async (request: Request, response: Response) => {
    const parsed = runnerBrainQueryBody.safeParse(request.body ?? {});
    if (!parsed.success) {
      response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid brain query body' } });
      return;
    }
    const agentId = String(request.params.agentId);
    const runId = String(request.params.runId);
    try {
      await assertRunnerAuth(agentId, request);
      const run = await prisma.agentRun.findUnique({
        where: { id: runId },
        select: { id: true, agentId: true, userId: true, orgId: true, prompt: true },
      });
      if (!run || run.agentId !== agentId) {
        response.status(404).json({ error: { code: 'not_found', message: 'Run not found' } });
        return;
      }
      const worker = await prisma.agent.findUnique({
        where: { id: agentId },
        select: { orgId: true },
      });
      const orgId = worker?.orgId ?? run.orgId;
      if (!orgId) {
        response.status(409).json({
          error: { code: 'brain_org_required', message: 'Agent must belong to an organization to use AI brain' },
        });
        return;
      }
      const access = await assertStandardAgentCanQueryBrain(agentId, orgId);
      const question = (parsed.data.question?.trim() || run.prompt).trim();
      if (!question) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'No question text (empty run prompt)' } });
        return;
      }
      const queryService = new BrainQueryService();
      const result = await queryService.queryBrain({
        userId: run.userId,
        orgId,
        brainAgentId: access.brainAgentId,
        brainModel: access.brainModel,
        question,
        collectionIds: parsed.data.collectionIds,
        auditSurface: 'agent_tool',
        callingAgentId: agentId,
        contextOnly: parsed.data.contextOnly,
        writeAudit: true,
      });
      response.json(result);
    } catch (e: unknown) {
      if (e instanceof RunnerUnauthorizedError) {
        response.status(401).json({ error: { code: 'runner_unauthorized', message: e.message } });
        return;
      }
      if (e instanceof BrainQueryForbiddenError) {
        response.status(403).json({ error: { code: e.code, message: e.message } });
        return;
      }
      if (e instanceof BrainNotProvisionedError) {
        response.status(409).json({ error: { code: e.code, message: e.message } });
        return;
      }
      if (e instanceof BrainWrongOrgError) {
        response.status(403).json({ error: { code: e.code, message: e.message } });
        return;
      }
      console.error('runner brain/query', e);
      response.status(500).json({ error: { code: 'brain_query_failed', message: 'Brain query failed' } });
    }
  });

  // Runner: poll for queued runs (authenticated by runner token)
  router.post('/:agentId/runs/poll', async (request: Request, response: Response) => {
    const parsed = pollBody.safeParse(request.body ?? {});
    if (!parsed.success) {
      response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid poll body' } });
      return;
    }
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      await recoverStaleRuns(agentId);
      const run = await claimNextQueuedRun(agentId);
      if (!run) {
        // Mark idle polls so middleware can suppress noisy logs.
        response.locals.logHint = 'skip';
        response.json({ run: null });
        return;
      }
      const [agentRow, waConnector] = await Promise.all([
        prisma.agent.findUnique({
          where: { id: agentId },
          select: { description: true, orgId: true, llmModel: true },
        }),
        prisma.connectorAccount.findFirst({
          where: { whatsappDefaultAgentId: agentId },
          select: { id: true },
        }),
      ]);
      // Fall back to org-wide connector if no agent-specific one found
      const waConnectorResolved = waConnector ?? (
        agentRow?.orgId
          ? await prisma.connectorAccount.findFirst({
              where: { orgId: agentRow.orgId, provider: 'whatsapp_baileys' },
              select: { id: true },
            })
          : null
      );
      response.json({
        run: {
          id: run.id,
          prompt: run.prompt,
          skills: run.skills,
          // Fall back to the agent's configured model when the run didn't specify one,
          // so runs use the agent's chosen model instead of the runner's weak default.
          inferenceModel:
            run.inferenceModel ??
            (agentRow?.llmModel ? normalizeQlixInferenceModelId(agentRow.llmModel) : null),
          conversationId: run.conversationId,
          userId: run.userId,
          createdAt: run.createdAt.toISOString(),
          useBrain: run.useBrain,
          agentDescription: agentRow?.description ?? null,
          waConnectorId: waConnectorResolved?.id ?? null,
        },
      });
    } catch (e: any) {
      response.status(401).json({ error: { code: 'runner_unauthorized', message: e?.message ?? 'Unauthorized' } });
    }
  });

  // Runner: drain user-injected messages for mid-run guidance
  router.get('/:agentId/runs/:runId/injections', async (request: Request, response: Response) => {
    const agentId = String(request.params.agentId);
    const runId = String(request.params.runId);
    try {
      await assertRunnerAuth(agentId, request);
      const messages = await drainInjections(runId);
      response.json({ messages });
    } catch (e: any) {
      response.status(401).json({ error: { code: 'runner_unauthorized', message: e?.message ?? 'Unauthorized' } });
    }
  });

  // Runner: append run event (delta/log/status)
  router.post('/:agentId/runs/:runId/event', async (request: Request, response: Response) => {
    const parsed = runnerLogBody.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid event body' } });
      return;
    }
    const agentId = String(request.params.agentId);
    const runId = String(request.params.runId);
    try {
      await assertRunnerAuth(agentId, request);
      const run = await prisma.agentRun.findUnique({ where: { id: runId }, select: { agentId: true } });
      if (!run || run.agentId !== agentId) {
        response.status(404).json({ error: { code: 'not_found', message: 'Run not found' } });
        return;
      }
      const seq = await appendAgentRunEvent(runId, parsed.data.type, parsed.data.data);
      response.json({ ok: true, seq });
    } catch (e: any) {
      if (e instanceof RunnerUnauthorizedError) {
        response.status(401).json({ error: { code: 'runner_unauthorized', message: e.message } });
        return;
      }
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        response.status(409).json({
          error: { code: 'event_seq_conflict', message: 'Run event sequence conflict; retry the event.' },
        });
        return;
      }
      console.error('[agent-run-event]', e);
      response.status(500).json({ error: { code: 'event_failed', message: 'Failed to record run event' } });
    }
  });

  // Runner: complete run
  router.post('/:agentId/runs/:runId/complete', async (request: Request, response: Response) => {
    const parsed = runnerCompleteBody.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid complete body' } });
      return;
    }
    const agentId = String(request.params.agentId);
    const runId = String(request.params.runId);
    try {
      await assertRunnerAuth(agentId, request);
      const run = await prisma.agentRun.findUnique({
        where: { id: runId },
        select: { agentId: true, conversationId: true, userId: true, orgId: true },
      });
      if (!run || run.agentId !== agentId) {
        response.status(404).json({ error: { code: 'not_found', message: 'Run not found' } });
        return;
      }

      // Fetch user email for billing exempt check
      const user = await prisma.user.findUnique({
        where: { id: run.userId },
        select: { email: true },
      });

      const finishedAt = new Date();
      await prisma.$transaction(async (tx) => {
        await tx.agentRun.update({
          where: { id: runId },
          data: {
            status: parsed.data.ok ? 'success' : 'failed',
            finishedAt,
            result: parsed.data.result as any,
            errorMessage: parsed.data.errorMessage ?? null,
          },
        });
        if (parsed.data.ok) {
          const content =
            typeof parsed.data.result === 'string'
              ? parsed.data.result
              : JSON.stringify(parsed.data.result ?? {}, null, 2);
          await tx.agentMessage.create({
            data: { conversationId: run.conversationId, role: 'agent', content },
          });
        } else {
          await tx.agentMessage.create({
            data: {
              conversationId: run.conversationId,
              role: 'system',
              content: `Run failed: ${parsed.data.errorMessage ?? 'unknown error'}`,
            },
          });
        }
      });
      if (!parsed.data.ok) {
        console.warn(
          `[agent-run] failed runId=${runId} agentId=${agentId} error=${String(parsed.data.errorMessage ?? '').slice(0, 500)}`,
        );
      }

      const { notifyWhatsappRunComplete } = await import('../whatsapp/whatsappChannel.service.js');
      void notifyWhatsappRunComplete(runId);

      // Fire-and-forget: record run usage and post-execution billing
      if (parsed.data.ok && user?.email) {
        void recordRunUsage(prisma, { runId, agentId, orgId: run.orgId, userId: run.userId }).catch((err) => {
          console.error('[record-run-usage]', err);
        });

        void recordSuccessfulEvent(prisma, {
          orgId: run.orgId,
          userId: run.userId,
          email: user.email,
          agentId,
          eventType: 'agent_run',
          eventKey: `run:${runId}`,
        }).catch((err) => {
          console.error('[record-billing-event]', err);
        });
      }

      response.json({ ok: true });
    } catch (e: any) {
      response.status(401).json({ error: { code: 'runner_unauthorized', message: e?.message ?? 'Unauthorized' } });
    }
  });

  // UI: SSE stream for a run (polls AgentRunEvent rows)
  router.get(
    '/:agentId/runs/:runId/stream',
    authenticateUser(true),
    async (request: Request, response: Response) => {
      try {
        const agentId = String(request.params.agentId);
        const runId = String(request.params.runId);
        await assertOwnsAgent(request, agentId);

        const run = await prisma.agentRun.findUnique({
          where: { id: runId },
          select: { id: true, agentId: true, status: true, conversationId: true },
        });
        if (!run || run.agentId !== agentId) {
          response.status(404).json({ error: { code: 'not_found', message: 'Run not found' } });
          return;
        }

        response.status(200);
        response.setHeader('Content-Type', 'text/event-stream');
        response.setHeader('Cache-Control', 'no-cache, no-transform');
        response.setHeader('Connection', 'keep-alive');
        response.flushHeaders?.();

        let lastSeq = -1;
        const start = Date.now();
        // Browser runs (navigate + tools + model) often exceed 60s.
        const maxMs = 600_000;

        const writeEvent = (event: string, data: unknown) => {
          response.write(`event: ${event}\n`);
          response.write(`data: ${JSON.stringify(data)}\n\n`);
        };

        const interval = setInterval(async () => {
          try {
            const events = await prisma.agentRunEvent.findMany({
              where: { runId, seq: { gt: lastSeq } },
              orderBy: { seq: 'asc' },
              take: 200,
              select: { seq: true, type: true, data: true, createdAt: true },
            });
            for (const e of events) {
              lastSeq = Math.max(lastSeq, e.seq);
              writeEvent(e.type, { seq: e.seq, data: e.data, createdAt: e.createdAt.toISOString() });
            }

            const r = await prisma.agentRun.findUnique({
              where: { id: runId },
              select: { status: true, conversationId: true },
            });
            const timedOut = Date.now() - start > maxMs;
            let readyToClose = r?.status === 'failed' || timedOut;
            if (r?.status === 'success' && run.conversationId) {
              const agentMsg = await prisma.agentMessage.findFirst({
                where: { conversationId: run.conversationId, role: 'agent' },
                orderBy: { createdAt: 'desc' },
                select: { content: true },
              });
              readyToClose = Boolean(agentMsg?.content?.trim());
            } else if (r?.status === 'success') {
              readyToClose = true;
            }
            if (readyToClose) {
              writeEvent('done', { status: r?.status ?? (timedOut ? 'timeout' : 'unknown') });
              clearInterval(interval);
              response.end();
            }
          } catch (err) {
            writeEvent('log', { level: 'error', message: 'stream_error' });
            clearInterval(interval);
            response.end();
          }
        }, 500);

        request.on('close', () => {
          clearInterval(interval);
        });
      } catch (err) {
        console.error('stream error', err);
        response.status(500).json({ error: { code: 'stream_failed', message: 'Failed to stream run' } });
      }
    },
  );

  // UI: Stop a running execution
  router.post(
    '/:agentId/runs/:runId/stop',
    authenticateUser(true),
    async (request: Request, response: Response) => {
      try {
        const agentId = String(request.params.agentId);
        const runId = String(request.params.runId);
        await assertOwnsAgent(request, agentId);

        const run = await prisma.agentRun.findUnique({
          where: { id: runId },
          select: { id: true, agentId: true, status: true },
        });
        if (!run || run.agentId !== agentId) {
          response.status(404).json({ error: { code: 'not_found', message: 'Run not found' } });
          return;
        }

        // Mark run as cancelled if not already completed
        if (run.status !== 'success' && run.status !== 'failed') {
          await prisma.agentRun.update({
            where: { id: runId },
            data: { status: 'cancelled' },
          });
        }

        response.json({ ok: true, message: 'Run stopped' });
      } catch (err) {
        console.error('stop run error', err);
        response.status(500).json({ error: { code: 'stop_failed', message: 'Failed to stop run' } });
      }
    },
  );

  // Runner: email.read tool proxy (scoped + audited, forwards to n8n)
  router.post('/:agentId/tools/email/read', async (request: Request, response: Response) => {
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      const parsed = emailReadBody.safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid email read payload' } });
        return;
      }
      const result = await executeEmailRead({
        agentId,
        runId: parsed.data.runId ?? null,
        input: parsed.data,
      });
      response.json(result);
    } catch (err) {
      if (err instanceof RunnerUnauthorizedError) {
        response.status(401).json({ error: { code: 'runner_unauthorized', message: err.message } });
        return;
      }
      if (err instanceof EmailScopeDeniedError) {
        response.status(403).json({ error: { code: err.code, message: err.message } });
        return;
      }
      if (err instanceof ConnectorNotConfiguredError || err instanceof N8nNotConfiguredError) {
        response.status(409).json({ error: { code: (err as Error & { code: string }).code, message: err.message } });
        return;
      }
      console.error('email/read', err);
      response.status(500).json({
        error: { code: 'email_read_failed', message: err instanceof EmailToolError ? err.message : 'Email read failed' },
      });
    }
  });

  // Runner: email.send tool proxy (JIT + audited, forwards to n8n)
  router.post('/:agentId/tools/email/send', async (request: Request, response: Response) => {
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      const parsed = emailSendBody.safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid email send payload' } });
        return;
      }
      const result = await executeEmailSend({
        agentId,
        runId: parsed.data.runId ?? null,
        input: parsed.data,
      });
      response.json(result);
    } catch (err) {
      if (err instanceof RunnerUnauthorizedError) {
        response.status(401).json({ error: { code: 'runner_unauthorized', message: err.message } });
        return;
      }
      if (err instanceof EmailScopeDeniedError) {
        response.status(403).json({ error: { code: err.code, message: err.message } });
        return;
      }
      if (err instanceof JitTokenRequiredError || err instanceof JitTokenInvalidError) {
        response.status(403).json({ error: { code: (err as Error & { code: string }).code, message: err.message } });
        return;
      }
      if (err instanceof ConnectorNotConfiguredError || err instanceof N8nNotConfiguredError) {
        response.status(409).json({ error: { code: (err as Error & { code: string }).code, message: err.message } });
        return;
      }
      console.error('email/send', err);
      response.status(500).json({
        error: { code: 'email_send_failed', message: err instanceof EmailToolError ? err.message : 'Email send failed' },
      });
    }
  });

  // Runner: send a local document (e.g. a generated PDF) to the agent's linked WhatsApp.
  router.post('/:agentId/tools/whatsapp/send-document', async (request: Request, response: Response) => {
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      const parsed = whatsappSendDocumentBody.safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'file_path is required' } });
        return;
      }
      if (!isWhatsAppServiceConfigured()) {
        response.status(409).json({
          error: { code: 'whatsapp_not_configured', message: 'WhatsApp service is not configured on the backend' },
        });
        return;
      }
      const connector = await getWhatsAppConnectorForAgent(agentId);
      if (!connector) {
        response.status(409).json({
          error: { code: 'whatsapp_not_linked', message: 'WhatsApp is not linked for this agent. Link it in Connectors.' },
        });
        return;
      }

      let session = await getWhatsAppSessionStatus(connector.id);
      if (!session.connected) {
        const restarted = await startWhatsAppSession(connector.id);
        if (restarted.ok) {
          await new Promise((r) => setTimeout(r, 2000));
          session = await getWhatsAppSessionStatus(connector.id);
        }
      }
      if (!session.connected) {
        response.status(503).json({
          error: { code: 'whatsapp_offline', message: 'WhatsApp session is offline — re-link WhatsApp in Connectors.' },
        });
        return;
      }

      const sent = await sendWhatsAppDocument({
        connectorId: connector.id,
        filePath: parsed.data.file_path,
        fileName: parsed.data.file_name,
      });
      if (!sent.ok) {
        response.status(503).json({ error: { code: 'whatsapp_send_failed', message: sent.error ?? 'Document send failed' } });
        return;
      }
      response.json({ ok: true, fileName: parsed.data.file_name ?? null });
    } catch (err) {
      if (err instanceof RunnerUnauthorizedError) {
        response.status(401).json({ error: { code: 'runner_unauthorized', message: err.message } });
        return;
      }
      console.error('whatsapp/send-document', err);
      response.status(500).json({
        error: { code: 'whatsapp_send_failed', message: 'WhatsApp document send failed' },
      });
    }
  });

  return router;
}

