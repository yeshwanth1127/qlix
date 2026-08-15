import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { authenticateUser } from '../middleware/authenticateUser.js';
import { requireSubscriptionAccess } from '../middleware/requireSubscriptionAccess.js';
import { prisma } from '../lib/prisma.js';
import {
  correlateInboundConversation,
  createConversationProcess,
  getConversationProcess,
  publishConversationWorkflow,
  signalConversation,
  startConversation,
} from '../conversations/index.js';
import { listPublishedConversationWorkflows } from '../conversations/conversationWorkflow.service.js';
import type { ConversationSignal } from '../conversations/conversation.types.js';
import type { ConversationWorkflow } from '../conversations/workflow.types.js';

const ownerType = z.enum(['workflow', 'team', 'agent', 'human', 'api', 'schedule']);
const workflowBody = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).optional().nullable(),
  workflow: z.object({
    key: z.string().trim().min(1).max(160),
    version: z.number().int().positive().default(1),
    entryNodeId: z.string().trim().min(1),
    nodes: z.array(z.record(z.string(), z.unknown())).min(1).max(500),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
});
const processBody = z.object({
  ownerType,
  ownerId: z.string().trim().min(1).optional().nullable(),
  externalRefType: z.string().trim().min(1).max(120).optional().nullable(),
  externalRefId: z.string().trim().min(1).max(240).optional().nullable(),
  completionMode: z.enum(['all_terminal', 'all_terminal_or_timeout', 'first_success', 'manual', 'continuous']).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
const threadBody = z.object({
  processId: z.string().trim().min(1).optional().nullable(),
  parentThreadId: z.string().trim().min(1).optional().nullable(),
  ownerType,
  ownerId: z.string().trim().min(1).optional().nullable(),
  channel: z.string().trim().min(1).max(80).optional().nullable(),
  workflowVersionId: z.string().trim().min(1).optional(),
  workflowKey: z.string().trim().min(1).optional(),
  variables: z.record(z.string(), z.unknown()).optional(),
  participants: z.array(z.object({
    role: z.string().trim().min(1),
    channel: z.string().trim().min(1).optional().nullable(),
    address: z.string().trim().min(1).optional().nullable(),
    displayName: z.string().trim().min(1).optional().nullable(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })).max(50).optional(),
  bindings: z.array(z.object({
    channel: z.string().trim().min(1),
    connectorId: z.string().trim().min(1).optional().nullable(),
    keyType: z.string().trim().min(1),
    keyValue: z.string().trim().min(1),
    priority: z.number().int().optional(),
    expiresAt: z.coerce.date().optional().nullable(),
  })).max(50).optional(),
}).refine((value) => Boolean(value.workflowVersionId || value.workflowKey), {
  message: 'workflowVersionId or workflowKey is required',
});
const conversationSignal = z.discriminatedUnion('type', [
  z.object({ type: z.literal('start'), payload: z.record(z.string(), z.unknown()).optional() }),
  z.object({ type: z.literal('inbound'), text: z.string().max(20_000), payload: z.record(z.string(), z.unknown()).optional() }),
  z.object({ type: z.literal('action_result'), actionId: z.string().min(1), ok: z.boolean(), result: z.unknown().optional(), error: z.string().optional() }),
  z.object({ type: z.literal('timer_fired'), timerId: z.string().optional(), payload: z.record(z.string(), z.unknown()).optional() }),
  z.object({ type: z.literal('approval_result'), approved: z.boolean(), payload: z.record(z.string(), z.unknown()).optional() }),
  z.object({ type: z.literal('subflow_result'), ok: z.boolean(), result: z.unknown().optional(), error: z.string().optional() }),
  z.object({ type: z.literal('cancel'), reason: z.string().max(2000).optional() }),
]);
const signalBody = z.object({
  signal: conversationSignal,
  idempotencyKey: z.string().trim().min(1).max(300),
  providerEventId: z.string().trim().min(1).max(300).optional().nullable(),
  occurredAt: z.coerce.date().optional(),
});
const correlateBody = z.object({
  channel: z.string().trim().min(1),
  connectorId: z.string().trim().min(1).optional().nullable(),
  replyToProviderMessageId: z.string().trim().min(1).optional().nullable(),
  externalThreadId: z.string().trim().min(1).optional().nullable(),
  participantAddress: z.string().trim().min(1).optional().nullable(),
  workflowKey: z.string().trim().min(1).optional().nullable(),
});

function invalid(res: Response, issues: unknown): void {
  res.status(400).json({ error: { code: 'invalid_body', message: 'Invalid conversation payload', issues } });
}

function asyncRoute(
  handler: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => void handler(req, res).catch(next);
}

export function createConversationsRouter(): Router {
  const router = Router();
  router.use(authenticateUser(true), requireSubscriptionAccess);

  router.get('/workflows', asyncRoute(async (req: Request, res: Response) => {
    const workflows = await listPublishedConversationWorkflows(req.auth!.orgId);
    res.json({ workflows });
  }));

  router.post('/workflows', asyncRoute(async (req: Request, res: Response) => {
    const parsed = workflowBody.safeParse(req.body);
    if (!parsed.success) return invalid(res, parsed.error.issues);
    try {
      const result = await publishConversationWorkflow({
        orgId: req.auth!.orgId,
        name: parsed.data.name,
        description: parsed.data.description,
        workflow: parsed.data.workflow as unknown as ConversationWorkflow,
      });
      res.status(201).json(result);
    } catch (error) {
      res.status(400).json({ error: { code: 'workflow_invalid', message: error instanceof Error ? error.message : 'Workflow is invalid' } });
    }
  }));

  router.post('/processes', asyncRoute(async (req: Request, res: Response) => {
    const parsed = processBody.safeParse(req.body);
    if (!parsed.success) return invalid(res, parsed.error.issues);
    const process = await createConversationProcess({ orgId: req.auth!.orgId, ...parsed.data });
    res.status(201).json({ process });
  }));

  router.get('/processes/:processId', asyncRoute(async (req: Request, res: Response) => {
    const owned = await prisma.conversationProcess.findFirst({ where: { id: req.params.processId, orgId: req.auth!.orgId }, select: { id: true } });
    if (!owned) return void res.status(404).json({ error: { code: 'not_found', message: 'Conversation process not found' } });
    res.json({ process: await getConversationProcess(owned.id) });
  }));

  router.post('/threads', asyncRoute(async (req: Request, res: Response) => {
    const parsed = threadBody.safeParse(req.body);
    if (!parsed.success) return invalid(res, parsed.error.issues);
    if (parsed.data.processId) {
      const process = await prisma.conversationProcess.findFirst({ where: { id: parsed.data.processId, orgId: req.auth!.orgId }, select: { id: true } });
      if (!process) return void res.status(404).json({ error: { code: 'not_found', message: 'Conversation process not found' } });
    }
    if (parsed.data.parentThreadId) {
      const parent = await prisma.conversationThread.findFirst({ where: { id: parsed.data.parentThreadId, orgId: req.auth!.orgId }, select: { id: true } });
      if (!parent) return void res.status(404).json({ error: { code: 'not_found', message: 'Parent conversation thread not found' } });
    }
    const result = await startConversation({ orgId: req.auth!.orgId, ...parsed.data });
    res.status(201).json(result);
  }));

  router.get('/threads/:threadId', asyncRoute(async (req: Request, res: Response) => {
    const thread = await prisma.conversationThread.findFirst({
      where: { id: req.params.threadId, orgId: req.auth!.orgId },
    });
    if (!thread) return void res.status(404).json({ error: { code: 'not_found', message: 'Conversation thread not found' } });
    const events = await prisma.conversationEvent.findMany({ where: { threadId: thread.id }, orderBy: { seq: 'asc' } });
    res.json({ thread, events });
  }));

  router.post('/threads/:threadId/signals', asyncRoute(async (req: Request, res: Response) => {
    const parsed = signalBody.safeParse(req.body);
    if (!parsed.success) return invalid(res, parsed.error.issues);
    const thread = await prisma.conversationThread.findFirst({ where: { id: req.params.threadId, orgId: req.auth!.orgId }, select: { id: true } });
    if (!thread) return void res.status(404).json({ error: { code: 'not_found', message: 'Conversation thread not found' } });
    try {
      const result = await signalConversation({
        threadId: thread.id,
        signal: parsed.data.signal as ConversationSignal,
        idempotencyKey: parsed.data.idempotencyKey,
        providerEventId: parsed.data.providerEventId,
        occurredAt: parsed.data.occurredAt,
      });
      res.json(result);
    } catch (error) {
      res.status(409).json({ error: { code: 'signal_rejected', message: error instanceof Error ? error.message : 'Signal rejected' } });
    }
  }));

  router.post('/correlate', asyncRoute(async (req: Request, res: Response) => {
    const parsed = correlateBody.safeParse(req.body);
    if (!parsed.success) return invalid(res, parsed.error.issues);
    res.json(await correlateInboundConversation({ orgId: req.auth!.orgId, ...parsed.data }));
  }));

  return router;
}
