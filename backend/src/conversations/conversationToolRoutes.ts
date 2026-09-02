import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { assertRunnerAuth, RunnerUnauthorizedError } from '../agentChat/runnerAuth.js';
import { hasConversationCapability } from './conversationScope.js';
import {
  closeConversationThread,
  getConversationThreadDetail,
  listConversationThreads,
  sendOnConversationThread,
  startOutreachConversations,
} from './conversationCapability.service.js';
import { getConnectedWhatsAppForOrg } from '../connectors/whatsappConnector.service.js';
import { fallbackPromptFromContent } from './conversationPrompt.js';

class ConversationToolError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function resolveAgentContext(agentId: string, runId: string | null): Promise<{
  orgId: string;
  teamRunId: string | null;
  scopes: Set<string>;
}> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { orgId: true, permissionScopes: true, alwaysScopes: true },
  });
  if (!agent?.orgId) throw new ConversationToolError('agent_missing_org', 'Agent has no organization');
  const scopes = new Set([
    ...(agent.permissionScopes as string[]),
    ...(agent.alwaysScopes as string[]),
  ]);
  if (!hasConversationCapability(scopes)) {
    throw new ConversationToolError('scope_denied', 'Agent is not granted the conversation capability');
  }
  let teamRunId: string | null = null;
  if (runId) {
    const run = await prisma.agentRun.findUnique({
      where: { id: runId },
      select: { agentId: true, teamRunId: true },
    });
    if (run?.agentId === agentId) teamRunId = run.teamRunId;
  }
  return { orgId: agent.orgId, teamRunId, scopes };
}

function asyncRoute(
  handler: (request: Request, response: Response) => Promise<void>,
): (request: Request, response: Response, next: NextFunction) => void {
  return (request, response, next) => void handler(request, response).catch(next);
}

function respondToolError(response: Response, err: unknown): boolean {
  if (err instanceof RunnerUnauthorizedError) {
    response.status(401).json({ error: { code: 'runner_unauthorized', message: err.message } });
    return true;
  }
  if (err instanceof ConversationToolError) {
    const status = err.code === 'scope_denied' ? 403 : err.code === 'not_found' ? 404 : 400;
    response.status(status).json({ error: { code: err.code, message: err.message } });
    return true;
  }
  return false;
}

const startBody = z.object({
  runId: z.string().min(1).optional().nullable(),
  channel: z.string().trim().min(1).max(80).default('whatsapp'),
  recipient: z.string().trim().min(1).optional(),
  recipients: z.array(z.string().trim().min(1)).max(200).optional(),
  content: z.string().max(8000).optional().nullable(),
  processId: z.string().trim().min(1).optional().nullable(),
  connectorId: z.string().trim().min(1).optional().nullable(),
});
const listBody = z.object({
  runId: z.string().min(1).optional().nullable(),
  processId: z.string().trim().min(1).optional().nullable(),
});
const getBody = z.object({
  runId: z.string().min(1).optional().nullable(),
  threadId: z.string().trim().min(1),
});
const sendBody = z.object({
  runId: z.string().min(1).optional().nullable(),
  threadId: z.string().trim().min(1),
  content: z.string().trim().min(1).max(8000),
});
const closeBody = z.object({
  runId: z.string().min(1).optional().nullable(),
  threadId: z.string().trim().min(1),
  reason: z.string().trim().max(2000).optional(),
});

export function createConversationToolRoutes(): Router {
  const router = Router();

  router.post('/:agentId/tools/conversation/start', asyncRoute(async (request, response) => {
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      const parsed = startBody.safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid conversation start payload' } });
        return;
      }
      const ctx = await resolveAgentContext(agentId, parsed.data.runId ?? null);
      const recipients = [
        ...(parsed.data.recipients ?? []),
        ...(parsed.data.recipient ? [parsed.data.recipient] : []),
      ];
      if (recipients.length === 0) {
        throw new ConversationToolError('invalid_body', 'recipient or recipients is required');
      }
      let connectorId = parsed.data.connectorId ?? null;
      if (parsed.data.channel === 'whatsapp' && !connectorId) {
        const connector = await getConnectedWhatsAppForOrg(ctx.orgId);
        connectorId = connector?.id ?? null;
        if (!connectorId) throw new ConversationToolError('whatsapp_not_linked', 'WhatsApp is not linked');
      }
      const result = await startOutreachConversations({
        orgId: ctx.orgId,
        ownerType: ctx.teamRunId ? 'team' : 'agent',
        ownerId: ctx.teamRunId ?? agentId,
        teamRunId: ctx.teamRunId,
        agentId,
        processId: parsed.data.processId,
        channel: parsed.data.channel,
        openingMessage: parsed.data.content ?? '',
        recipients: recipients.map((address) => ({ address, connectorId })),
      });
      response.json(result);
    } catch (err) {
      if (respondToolError(response, err)) return;
      console.error('conversation/start', err);
      response.status(500).json({
        error: { code: 'conversation_start_failed', message: err instanceof Error ? err.message : 'Conversation start failed' },
      });
    }
  }));

  router.post('/:agentId/tools/conversation/list', asyncRoute(async (request, response) => {
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      const parsed = listBody.safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid conversation list payload' } });
        return;
      }
      const ctx = await resolveAgentContext(agentId, parsed.data.runId ?? null);
      const listed = await listConversationThreads({
        orgId: ctx.orgId,
        processId: parsed.data.processId,
        ownerType: parsed.data.processId ? undefined : (ctx.teamRunId ? 'team' : 'agent'),
        ownerId: parsed.data.processId ? undefined : (ctx.teamRunId ?? agentId),
      });
      response.json(listed);
    } catch (err) {
      if (respondToolError(response, err)) return;
      console.error('conversation/list', err);
      response.status(500).json({ error: { code: 'conversation_list_failed', message: 'Conversation list failed' } });
    }
  }));

  router.post('/:agentId/tools/conversation/get', asyncRoute(async (request, response) => {
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      const parsed = getBody.safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid conversation get payload' } });
        return;
      }
      const ctx = await resolveAgentContext(agentId, parsed.data.runId ?? null);
      const detail = await getConversationThreadDetail({ orgId: ctx.orgId, threadId: parsed.data.threadId });
      if (!detail) throw new ConversationToolError('not_found', 'Conversation thread was not found');
      response.json(detail);
    } catch (err) {
      if (respondToolError(response, err)) return;
      console.error('conversation/get', err);
      response.status(500).json({ error: { code: 'conversation_get_failed', message: 'Conversation get failed' } });
    }
  }));

  router.post('/:agentId/tools/conversation/send', asyncRoute(async (request, response) => {
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      const parsed = sendBody.safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid conversation send payload' } });
        return;
      }
      const ctx = await resolveAgentContext(agentId, parsed.data.runId ?? null);
      const result = await sendOnConversationThread({
        orgId: ctx.orgId,
        threadId: parsed.data.threadId,
        content: parsed.data.content,
        prompt: fallbackPromptFromContent(parsed.data.content, null),
      });
      response.json(result);
    } catch (err) {
      if (respondToolError(response, err)) return;
      console.error('conversation/send', err);
      response.status(500).json({
        error: { code: 'conversation_send_failed', message: err instanceof Error ? err.message : 'Conversation send failed' },
      });
    }
  }));

  router.post('/:agentId/tools/conversation/close', asyncRoute(async (request, response) => {
    const agentId = String(request.params.agentId);
    try {
      await assertRunnerAuth(agentId, request);
      const parsed = closeBody.safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid conversation close payload' } });
        return;
      }
      const ctx = await resolveAgentContext(agentId, parsed.data.runId ?? null);
      const result = await closeConversationThread({
        orgId: ctx.orgId,
        threadId: parsed.data.threadId,
        reason: parsed.data.reason,
      });
      response.json(result);
    } catch (err) {
      if (respondToolError(response, err)) return;
      console.error('conversation/close', err);
      response.status(500).json({ error: { code: 'conversation_close_failed', message: 'Conversation close failed' } });
    }
  }));

  return router;
}
