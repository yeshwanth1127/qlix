import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  ActionAlreadyCompletedError,
  ActionNotFoundError,
  ActionsService,
  AgentNotFoundError,
  DidMismatchError,
  InvalidSignatureError,
  JitTokenInvalidError,
  JitTokenRequiredError,
  StaleTimestampError,
} from '../actions/actions.service.js';

const riskLevelSchema = z.enum(['low', 'medium', 'high']);

const startBodySchema = z.object({
  signature: z.string().regex(/^[0-9a-fA-F]+$/, 'signature must be hex').min(64),
  signedPayload: z.object({
    did: z.string().min(1),
    actionType: z.string().min(1).max(255),
    timestampMs: z.number().int().positive(),
    riskLevel: riskLevelSchema.optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    nonce: z.string().min(1).max(255).optional(),
    jitToken: z.string().min(8).max(512).optional(),
  }),
});

const completeBodySchema = z.object({
  signature: z.string().regex(/^[0-9a-fA-F]+$/, 'signature must be hex').min(64),
  signedPayload: z.object({
    did: z.string().min(1),
    actionId: z.string().uuid(),
    success: z.boolean(),
    timestampMs: z.number().int().positive(),
    eventType: z.string().min(1).max(120).optional(),
    eventKey: z.string().min(1).max(256).optional(),
    result: z.record(z.string(), z.unknown()).optional(),
    errorMessage: z.string().max(10_000).optional(),
    errorCode: z.string().max(120).optional(),
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
  if (error instanceof ActionNotFoundError) {
    response.status(404).json({ error: { code: error.code, message: error.message } });
    return;
  }
  if (error instanceof ActionAlreadyCompletedError) {
    response.status(409).json({ error: { code: error.code, message: 'Action already has a completion log' } });
    return;
  }
  if (error instanceof DidMismatchError) {
    response.status(403).json({ error: { code: error.code, message: 'DID does not match action owner' } });
    return;
  }
  if (error instanceof JitTokenRequiredError) {
    response.status(403).json({
      error: { code: error.code, message: error.message },
    });
    return;
  }
  if (error instanceof JitTokenInvalidError) {
    response.status(403).json({
      error: { code: error.code, message: error.message },
    });
    return;
  }
  console.error('[actions]', error);
  response.status(500).json({ error: { code: 'internal_error', message: 'Failed to process action' } });
}

export function createActionsRouter(): Router {
  const router = Router();
  const service = new ActionsService();

  router.post('/start', async (request: Request, response: Response) => {
    const parsed = startBodySchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({
        error: { code: 'invalid_body', message: 'Invalid start payload', issues: parsed.error.issues },
      });
      return;
    }
    try {
      const result = await service.start(parsed.data);
      response.status(201).json({
        actionId: result.actionId,
        agentId: result.agentId,
        status: result.status,
        timestampMs: result.timestampMs,
        prevHash: result.prevHash,
      });
    } catch (error) {
      handleError(error, response);
    }
  });

  router.post('/complete', async (request: Request, response: Response) => {
    const parsed = completeBodySchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({
        error: { code: 'invalid_body', message: 'Invalid complete payload', issues: parsed.error.issues },
      });
      return;
    }
    try {
      const result = await service.complete(parsed.data);
      response.status(201).json(result);
    } catch (error) {
      handleError(error, response);
    }
  });

  return router;
}
