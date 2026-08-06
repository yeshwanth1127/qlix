import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  AgentNotFoundError,
  InvalidSignatureError,
  JitForbiddenError,
  JitPollUnauthorizedError,
  JitRequestNotFoundError,
  JitService,
  NotJitScopeError,
  StaleTimestampError,
} from '../jit/jit.service.js';
import { recordApiKeySensitiveUse } from '../lib/apiKeyAudit.js';
import { assertInternalServiceSecret } from '../middleware/assertInternalServiceSecret.js';
import { authenticateUser } from '../middleware/authenticateUser.js';

const resolveBodySchema = z.object({
  action_id: z.string().uuid(),
  approved: z.boolean(),
  reason: z.string().max(500).nullable().optional(),
});

const requestBodySchema = z.object({
  signature: z.string().regex(/^[0-9a-fA-F]+$/, 'signature must be hex').min(64),
  signedPayload: z.object({
    did: z.string().min(1),
    actionType: z.string().min(1).max(255),
    payload: z.record(z.string(), z.unknown()),
    timestampMs: z.number().int().positive(),
  }),
});

function handleError(error: unknown, response: Response): void {
  if (error instanceof AgentNotFoundError) {
    response.status(404).json({ error: { code: error.code, message: error.message } });
    return;
  }
  if (error instanceof InvalidSignatureError) {
    response.status(401).json({ error: { code: error.code, message: 'Signature did not verify' } });
    return;
  }
  if (error instanceof StaleTimestampError) {
    response.status(400).json({ error: { code: error.code, message: error.message } });
    return;
  }
  if (error instanceof NotJitScopeError) {
    response.status(403).json({ error: { code: error.code, message: error.message } });
    return;
  }
  if (error instanceof JitRequestNotFoundError) {
    response.status(404).json({ error: { code: error.code, message: 'JIT request not found' } });
    return;
  }
  if (error instanceof JitForbiddenError) {
    response.status(403).json({ error: { code: error.code, message: 'Cannot decide this request' } });
    return;
  }
  if (error instanceof JitPollUnauthorizedError) {
    response.status(401).json({ error: { code: error.code, message: 'Not authorized to poll this request' } });
    return;
  }
  console.error('[jit]', error);
  response.status(500).json({ error: { code: 'internal_error', message: 'Failed to process JIT request' } });
}

export function createJitRouter(): Router {
  const router = Router();
  const service = new JitService();

  router.post('/request', async (request: Request, response: Response) => {
    const parsed = requestBodySchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({
        error: { code: 'invalid_body', message: 'Invalid JIT request', issues: parsed.error.issues },
      });
      return;
    }
    try {
      const result = await service.request(parsed.data);
      response.status(201).json(result);
    } catch (error) {
      handleError(error, response);
    }
  });

  router.post('/resolve', assertInternalServiceSecret, async (request: Request, response: Response) => {
    const parsed = resolveBodySchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({
        error: { code: 'invalid_body', message: 'Invalid resolve body', issues: parsed.error.issues },
      });
      return;
    }
    try {
      const result = await service.decide({
        jitRequestId: parsed.data.action_id,
        approved: parsed.data.approved,
        reason: parsed.data.reason ?? null,
      });
      response.status(200).json({ ok: true, status: result.status });
    } catch (error) {
      handleError(error, response);
    }
  });

  const decideBodySchema = z.object({
    jitRequestId: z.string().uuid(),
    approved: z.boolean(),
  });

  // User-facing dashboard approval (Approve/Deny buttons in the chat UI).
  router.post('/decide', authenticateUser(true), async (request: Request, response: Response) => {
    const parsed = decideBodySchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({
        error: { code: 'invalid_body', message: 'Invalid decide body', issues: parsed.error.issues },
      });
      return;
    }
    try {
      const auth = request.auth!;
      const result = await service.decideAsUser({
        jitRequestId: parsed.data.jitRequestId,
        userId: auth.userId,
        orgId: auth.orgId ?? null,
        approved: parsed.data.approved,
      });
      recordApiKeySensitiveUse(request, 'api_key.jit_decided', {
        jitRequestId: parsed.data.jitRequestId,
        approved: parsed.data.approved,
        status: result.status,
      });
      response.status(200).json({ ok: true, status: result.status });
    } catch (error) {
      handleError(error, response);
    }
  });

  // List active session grants (e.g. "email.send approved for this conversation") for the user's agents.
  router.get('/grants', authenticateUser(true), async (request: Request, response: Response) => {
    try {
      const auth = request.auth!;
      const grants = await service.listGrantsForUser({ userId: auth.userId, orgId: auth.orgId ?? null });
      response.status(200).json({ grants });
    } catch (error) {
      handleError(error, response);
    }
  });

  // Pending JIT approvals for a dashboard chat (fallback when SSE missed the approval card).
  router.get('/pending', authenticateUser(true), async (request: Request, response: Response) => {
    const conversationId = String(request.query.conversationId ?? '').trim();
    const agentId = String(request.query.agentId ?? '').trim();
    if (!conversationId || !agentId) {
      response.status(400).json({
        error: { code: 'invalid_query', message: 'conversationId and agentId are required' },
      });
      return;
    }
    try {
      const auth = request.auth!;
      const pending = await service.listPendingForConversation({
        userId: auth.userId,
        conversationId,
        agentId,
      });
      response.status(200).json({ pending });
    } catch (error) {
      handleError(error, response);
    }
  });

  // Revoke a session grant (the "until revoked" escape hatch).
  router.delete('/grants/:grantId', authenticateUser(true), async (request: Request, response: Response) => {
    const grantId = request.params.grantId;
    if (!grantId || !/^[0-9a-fA-F-]{36}$/i.test(grantId)) {
      response.status(400).json({ error: { code: 'invalid_id', message: 'grantId must be a UUID' } });
      return;
    }
    try {
      const auth = request.auth!;
      await service.revokeGrant({ grantId, userId: auth.userId, orgId: auth.orgId ?? null });
      response.status(200).json({ ok: true });
    } catch (error) {
      handleError(error, response);
    }
  });

  router.get('/poll/:jitRequestId', async (request: Request, response: Response) => {
    const id = request.params.jitRequestId;
    if (!id || !/^[0-9a-fA-F-]{36}$/i.test(id)) {
      response.status(400).json({ error: { code: 'invalid_id', message: 'jitRequestId must be a UUID' } });
      return;
    }
    const header = request.header('x-qlix-jit-poll-token');
    const pollToken = (typeof header === 'string' && header.trim()) || String(request.query.pollToken ?? '').trim();
    try {
      const result = await service.poll(id, pollToken);
      response.status(200).json(result);
    } catch (error) {
      handleError(error, response);
    }
  });

  return router;
}
