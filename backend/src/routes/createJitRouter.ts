import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  AgentNotFoundError,
  InvalidSignatureError,
  JitRequestNotFoundError,
  JitService,
  NotJitScopeError,
  StaleTimestampError,
} from '../jit/jit.service.js';
import { assertInternalServiceSecret } from '../middleware/assertInternalServiceSecret.js';

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

  router.get('/poll/:jitRequestId', async (request: Request, response: Response) => {
    const id = request.params.jitRequestId;
    if (!id || !/^[0-9a-fA-F-]{36}$/i.test(id)) {
      response.status(400).json({ error: { code: 'invalid_id', message: 'jitRequestId must be a UUID' } });
      return;
    }
    try {
      const result = await service.poll(id);
      response.status(200).json(result);
    } catch (error) {
      handleError(error, response);
    }
  });

  return router;
}
