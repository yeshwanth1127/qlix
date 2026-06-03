import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { authenticateUser, loadJwtSecret } from '../middleware/authenticateUser.js';
import { prisma } from '../lib/prisma.js';
import { roleCan } from '../lib/orgPermissions.js';
import { verifyAgentCreateStepUpToken } from '../lib/authTokens.js';
import {
  BrainAgentForbiddenError,
  BrainAgentLocalHostingNotSupportedError,
  BrainAgentService,
} from '../aiBrain/brainAgent.service.js';
import {
  BrainKnowledgeForbiddenError,
  BrainKnowledgeService,
} from '../aiBrain/brainKnowledge.service.js';
import { appendBrainActionLog } from '../aiBrain/brainAudit.service.js';
import {
  AI_BRAIN_CONNECTORS_REQUIRE_L4_SCOPE,
  AI_BRAIN_DEFAULT_SCOPE_L3_L5,
} from '../aiBrain/productScope.js';
import { BrainQueryService } from '../aiBrain/brainQuery.service.js';
import { extractTextFromUpload } from '../aiBrain/brainExtractText.js';
import { normalizeQlixInferenceModelId, assertModelAllowed, ModelPolicyError } from '../llm/modelPolicy.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

export function createAiBrainRouter(): Router {
  const router = Router();
  router.use(authenticateUser(true));

  const brainAgents = new BrainAgentService();
  const knowledge = new BrainKnowledgeService();
  const queryService = new BrainQueryService();

  router.get('/status', async (request: Request, response: Response) => {
    try {
      const orgId = request.auth!.orgId;
      const userId = request.auth!.userId;
      const brain = await brainAgents.normalizeOrgBrain(orgId);

      let collections: Awaited<ReturnType<BrainKnowledgeService['listCollections']>> = [];
      if (brain) {
        collections = await knowledge.listCollections(userId, orgId);
      }

      response.json({
        scope: {
          defaultL3L5: AI_BRAIN_DEFAULT_SCOPE_L3_L5,
          connectorsDeferred: AI_BRAIN_CONNECTORS_REQUIRE_L4_SCOPE,
        },
        brain: brain
          ? {
              id: brain.id,
              didShort: `${brain.did.slice(0, 12)}…${brain.did.slice(-6)}`,
              name: brain.name,
              agentKind: brain.agentKind,
              runtime: brain.runtime,
              status: brain.status,
              cloudProvisioningStatus: brain.cloudProvisioningStatus,
              cloudLastHeartbeatAt: brain.cloudLastHeartbeatAt,
              cloudProvisioningError: brain.cloudProvisioningError ?? null,
              permissionScopes: brain.permissionScopes,
              queryModel: brain.model,
            }
          : null,
        knowledge: { collections },
      });
    } catch (err) {
      console.error('ai-brain/status', err);
      response.status(500).json({ error: { code: 'brain_status_failed', message: 'Failed to load AI brain status' } });
    }
  });

  router.post('/ensure-agent', async (request: Request, response: Response) => {
    try {
      const orgId = request.auth!.orgId;
      const userId = request.auth!.userId;
      const role = request.auth!.role;

      const stepUpHeader = request.headers['x-qlix-device-step-up'];
      const stepUpToken = typeof stepUpHeader === 'string' ? stepUpHeader.trim() : '';
      if (!stepUpToken) {
        response.status(403).json({
          error: {
            code: 'step_up_required',
            message: 'Complete device verification (WebAuthn) immediately before provisioning the brain agent',
          },
        });
        return;
      }
      try {
        verifyAgentCreateStepUpToken(stepUpToken, loadJwtSecret(), userId);
      } catch {
        response.status(403).json({
          error: {
            code: 'step_up_invalid_or_expired',
            message: 'Device step-up token is missing, invalid, or expired; verify again',
          },
        });
        return;
      }

      const bodySchema = z.object({
        hosting: z.enum(['cloud', 'local']).default('cloud'),
      });
      const parsed = bodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({
          error: { code: 'invalid_body', message: 'hosting must be "cloud" or "local"' },
        });
        return;
      }

      const brain = await brainAgents.ensureOrgBrainAgent(userId, orgId, role, request, {
        hosting: parsed.data.hosting,
      });
      response.json({
        brain: {
          id: brain.id,
          did: brain.did,
          name: brain.name,
          agentKind: brain.agentKind,
          runtime: brain.runtime,
        },
      });
    } catch (err: unknown) {
      if (err instanceof BrainAgentLocalHostingNotSupportedError) {
        response.status(501).json({ error: { code: err.code, message: err.message } });
        return;
      }
      if (err instanceof BrainAgentForbiddenError) {
        response.status(403).json({ error: { code: err.code, message: err.message } });
        return;
      }
      console.error('ai-brain/ensure-agent', err);
      response.status(500).json({ error: { code: 'brain_ensure_failed', message: 'Failed to provision brain agent' } });
    }
  });

  router.get('/documents', async (request: Request, response: Response) => {
    try {
      const orgId = request.auth!.orgId;
      const userId = request.auth!.userId;
      const documents = await knowledge.listKnowledgeDocuments(userId, orgId);
      response.json({ documents });
    } catch (err) {
      console.error('ai-brain/documents:get', err);
      response.status(500).json({ error: { code: 'documents_list_failed', message: 'Failed to list knowledge documents' } });
    }
  });

  router.delete('/documents/:documentId', async (request: Request, response: Response) => {
    try {
      const orgId = request.auth!.orgId;
      const userId = request.auth!.userId;
      const role = request.auth!.role;
      const documentId = String(request.params.documentId ?? '');
      const brain = await brainAgents.getOrgBrainAgent(orgId);
      if (!brain) {
        response.status(409).json({ error: { code: 'brain_required', message: 'Provision the org AI brain first.' } });
        return;
      }

      await knowledge.deleteKnowledgeDocument({
        userId,
        orgId,
        role,
        brainAgentId: brain.id,
        documentId,
      });
      response.status(204).send();
    } catch (err: unknown) {
      if (err instanceof BrainKnowledgeForbiddenError) {
        response.status(403).json({ error: { code: err.code, message: err.message } });
        return;
      }
      const message = err instanceof Error ? err.message : 'Delete failed';
      if (message === 'Document not found') {
        response.status(404).json({ error: { code: 'not_found', message } });
        return;
      }
      console.error('ai-brain/documents:delete', err);
      response.status(500).json({ error: { code: 'document_delete_failed', message: 'Failed to delete document' } });
    }
  });

  router.get('/collections', async (request: Request, response: Response) => {
    try {
      const orgId = request.auth!.orgId;
      const userId = request.auth!.userId;
      const brain = await brainAgents.getOrgBrainAgent(orgId);
      if (!brain) {
        response.status(409).json({ error: { code: 'brain_required', message: 'Provision the org AI brain first.' } });
        return;
      }
      const collections = await knowledge.listCollections(userId, orgId);
      response.json({ collections });
    } catch (err) {
      console.error('ai-brain/collections:get', err);
      response.status(500).json({ error: { code: 'collections_failed', message: 'Failed to list collections' } });
    }
  });

  router.post('/collections', async (request: Request, response: Response) => {
    const bodySchema = z.object({
      name: z.string().min(1).max(200),
      description: z.string().max(2000).optional(),
      retentionDays: z.number().int().min(1).max(3650).nullable().optional(),
    });
    try {
      const orgId = request.auth!.orgId;
      const userId = request.auth!.userId;
      const role = request.auth!.role;
      const brain = await brainAgents.getOrgBrainAgent(orgId);
      if (!brain) {
        response.status(409).json({ error: { code: 'brain_required', message: 'Provision the org AI brain first.' } });
        return;
      }
      const parsed = bodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid collection payload' } });
        return;
      }

      const { id } = await knowledge.createCollection({
        userId,
        orgId,
        role,
        brainAgentId: brain.id,
        name: parsed.data.name,
        description: parsed.data.description,
        retentionDays: parsed.data.retentionDays,
      });
      response.status(201).json({ id });
    } catch (err: unknown) {
      if (err instanceof BrainKnowledgeForbiddenError) {
        response.status(403).json({ error: { code: err.code, message: err.message } });
        return;
      }
      console.error('ai-brain/collections:post', err);
      response.status(500).json({ error: { code: 'collection_create_failed', message: 'Failed to create collection' } });
    }
  });

  router.post(
    '/collections/:collectionId/documents/upload',
    (request: Request, response: Response, next: NextFunction) => {
      upload.single('file')(request, response, (err: unknown) => {
        if (err instanceof multer.MulterError) {
          response.status(400).json({
            error: {
              code: 'upload_error',
              message: err.code === 'LIMIT_FILE_SIZE' ? 'File is too large (max 25 MB).' : err.message,
            },
          });
          return;
        }
        if (err) {
          response.status(400).json({ error: { code: 'upload_error', message: 'File upload failed' } });
          return;
        }
        next();
      });
    },
    async (request: Request, response: Response) => {
      try {
        const orgId = request.auth!.orgId;
        const userId = request.auth!.userId;
        const role = request.auth!.role;
        const collectionId = String(request.params.collectionId);
        const brain = await brainAgents.getOrgBrainAgent(orgId);
        if (!brain) {
          response.status(409).json({ error: { code: 'brain_required', message: 'Provision the org AI brain first.' } });
          return;
        }

        const file = request.file;
        if (!file?.buffer) {
          response.status(400).json({ error: { code: 'file_required', message: 'Choose a file to upload.' } });
          return;
        }

        let bodyText: string;
        try {
          bodyText = await extractTextFromUpload(file.buffer, file.originalname || 'upload');
        } catch (extractErr: unknown) {
          const msg = extractErr instanceof Error ? extractErr.message : 'Could not read file';
          response.status(422).json({ error: { code: 'extract_failed', message: msg } });
          return;
        }

        const titleRaw = typeof request.body?.title === 'string' ? request.body.title.trim() : '';
        const title = titleRaw || file.originalname || 'Uploaded document';

        const result = await knowledge.ingestDocument({
          userId,
          orgId,
          role,
          brainAgentId: brain.id,
          collectionId,
          title: title.slice(0, 500),
          bodyText,
          sourceUri: null,
        });

        response.status(201).json(result);
      } catch (err: unknown) {
        if (err instanceof BrainKnowledgeForbiddenError) {
          response.status(403).json({ error: { code: err.code, message: err.message } });
          return;
        }
        const message = err instanceof Error ? err.message : 'Ingest failed';
        if (message === 'Collection not found') {
          response.status(404).json({ error: { code: 'not_found', message } });
          return;
        }
        if (message === 'bodyText is empty') {
          response.status(400).json({ error: { code: 'invalid_body', message } });
          return;
        }
        console.error('ai-brain/documents:upload', err);
        response.status(500).json({ error: { code: 'ingest_failed', message: 'Document ingest failed' } });
      }
    },
  );

  router.post('/collections/:collectionId/documents', async (request: Request, response: Response) => {
    const docSchema = z.object({
      title: z.string().min(1).max(500),
      bodyText: z.string().min(1).max(1_500_000),
      sourceUri: z.string().url().max(2000).optional().nullable(),
    });
    try {
      const orgId = request.auth!.orgId;
      const userId = request.auth!.userId;
      const role = request.auth!.role;
      const collectionId = String(request.params.collectionId);
      const brain = await brainAgents.getOrgBrainAgent(orgId);
      if (!brain) {
        response.status(409).json({ error: { code: 'brain_required', message: 'Provision the org AI brain first.' } });
        return;
      }

      const parsed = docSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid document payload' } });
        return;
      }

      const result = await knowledge.ingestDocument({
        userId,
        orgId,
        role,
        brainAgentId: brain.id,
        collectionId,
        title: parsed.data.title,
        bodyText: parsed.data.bodyText,
        sourceUri: parsed.data.sourceUri,
      });

      response.status(201).json(result);
    } catch (err: unknown) {
      if (err instanceof BrainKnowledgeForbiddenError) {
        response.status(403).json({ error: { code: err.code, message: err.message } });
        return;
      }
      const message = err instanceof Error ? err.message : 'Ingest failed';
      if (message === 'Collection not found') {
        response.status(404).json({ error: { code: 'not_found', message } });
        return;
      }
      if (message === 'bodyText is empty') {
        response.status(400).json({ error: { code: 'invalid_body', message } });
        return;
      }
      console.error('ai-brain/documents:post', err);
      response.status(500).json({ error: { code: 'ingest_failed', message: 'Failed to ingest document' } });
    }
  });

  router.get('/policy-signals', async (request: Request, response: Response) => {
    try {
      const orgId = request.auth!.orgId;
      const brain = await brainAgents.getOrgBrainAgent(orgId);
      if (!brain) {
        response.json({
          violations: [],
          blockedCount: 0,
          auditNote: 'No brain agent yet — policy signals appear after provisioning.',
        });
        return;
      }

      const rows = await prisma.actionLog.findMany({
        where: {
          agentId: brain.id,
          actionType: { startsWith: 'brain.' },
          OR: [{ status: 'blocked' }, { status: 'flagged' }],
        },
        orderBy: { timestampMs: 'desc' },
        take: 12,
      });

      const violations = rows.map((r) => ({
        id: r.id,
        actionType: r.actionType,
        status: r.status,
        timestampMs: Number(r.timestampMs),
        preview:
          typeof (r.payload as Record<string, unknown>)?.description === 'string'
            ? String((r.payload as Record<string, unknown>).description)
            : r.actionType,
      }));

      const blockedCount = rows.filter((r) => r.status === 'blocked').length;

      response.json({
        violations,
        blockedCount,
        auditNote:
          violations.length === 0
            ? 'No brain policy violations in recent history.'
            : 'Recent blocked or flagged brain events (from ledger).',
      });
    } catch (err) {
      console.error('ai-brain/policy-signals', err);
      response.status(500).json({ error: { code: 'policy_signals_failed', message: 'Failed to load policy signals' } });
    }
  });

  const simulateSchema = z.object({
    violation: z.boolean(),
  });

  router.post('/simulate-policy', async (request: Request, response: Response) => {
    try {
      const orgId = request.auth!.orgId;
      const userId = request.auth!.userId;
      const authRole = request.auth!.role;
      if (!roleCan(authRole, 'manage_brain')) {
        response.status(403).json({ error: { code: 'forbidden', message: 'Only owners and admins can simulate policy checks.' } });
        return;
      }

      const brain = await brainAgents.getOrgBrainAgent(orgId);
      if (!brain) {
        response.status(409).json({ error: { code: 'brain_required', message: 'Provision the org AI brain first.' } });
        return;
      }

      const parsed = simulateSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'Expected { violation: boolean }' } });
        return;
      }

      const violation = parsed.data.violation;
      await appendBrainActionLog({
        brainAgentId: brain.id,
        userId,
        actionType: 'brain.policy_check',
        payload: {
          description: violation
            ? 'Simulated policy evaluation: request would be blocked (demo).'
            : 'Simulated policy evaluation: request would be allowed (demo).',
          simulated: true,
        },
        status: violation ? 'blocked' : 'success',
        riskLevel: violation ? 'high' : 'low',
      });

      response.json({ ok: true, status: violation ? 'blocked' : 'success' });
    } catch (err) {
      console.error('ai-brain/simulate-policy', err);
      response.status(500).json({ error: { code: 'simulate_failed', message: 'Failed to record simulation' } });
    }
  });

  const querySchema = z.object({
    question: z.string().trim().min(1).max(4000),
  });

  router.post('/query', async (request: Request, response: Response) => {
    try {
      const orgId = request.auth!.orgId;
      const userId = request.auth!.userId;
      const brain = await brainAgents.getOrgBrainAgent(orgId);
      if (!brain) {
        response.status(409).json({ error: { code: 'brain_required', message: 'Provision the org AI brain first.' } });
        return;
      }

      const parsed = querySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'question is required (1-4000 chars)' } });
        return;
      }

      const result = await queryService.queryBrain({
        userId,
        orgId,
        brainAgentId: brain.id,
        brainModel: brain.model,
        question: parsed.data.question,
      });

      response.json(result);
    } catch (err: unknown) {
      console.error('ai-brain/query', err);
      response.status(500).json({ error: { code: 'query_failed', message: 'Failed to query brain' } });
    }
  });

  const updateModelSchema = z.object({
    model: z.string().trim().min(1).max(200),
  });

  router.patch('/model', async (request: Request, response: Response) => {
    try {
      const orgId = request.auth!.orgId;
      const userId = request.auth!.userId;
      const role = request.auth!.role;

      if (!roleCan(role, 'manage_brain')) {
        response.status(403).json({ error: { code: 'forbidden', message: 'Only owners and admins can update the brain model.' } });
        return;
      }

      const brain = await brainAgents.getOrgBrainAgent(orgId);
      if (!brain) {
        response.status(409).json({ error: { code: 'brain_required', message: 'Provision the org AI brain first.' } });
        return;
      }

      const parsed = updateModelSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'model string is required' } });
        return;
      }

      let normalized: string;
      try {
        normalized = normalizeQlixInferenceModelId(parsed.data.model);
        assertModelAllowed(normalized);
      } catch (err) {
        response.status(400).json({ error: { code: 'model_not_allowed', message: err instanceof Error ? err.message : 'Model not allowed' } });
        return;
      }

      await prisma.agent.update({
        where: { id: brain.id },
        data: { llmModel: normalized },
      });

      await appendBrainActionLog({
        brainAgentId: brain.id,
        userId,
        actionType: 'brain.model_update',
        payload: { description: `Updated brain query model to "${normalized}"`, model: normalized },
        status: 'success',
        riskLevel: 'low',
      });

      response.json({ ok: true, model: normalized });
    } catch (err: unknown) {
      console.error('ai-brain/model:patch', err);
      response.status(500).json({ error: { code: 'model_update_failed', message: 'Failed to update model' } });
    }
  });

  router.post('/telemetry/console-open', async (request: Request, response: Response) => {
    try {
      const orgId = request.auth!.orgId;
      const userId = request.auth!.userId;
      const brain = await brainAgents.getOrgBrainAgent(orgId);
      if (!brain) {
        response.status(204).end();
        return;
      }
      await appendBrainActionLog({
        brainAgentId: brain.id,
        userId,
        actionType: 'brain.console_open',
        payload: { description: 'Opened AI Brain console' },
        status: 'success',
        riskLevel: 'low',
      });
      response.status(204).end();
    } catch (err) {
      console.error('ai-brain/telemetry', err);
      response.status(500).json({ error: { code: 'telemetry_failed', message: 'Failed to record telemetry' } });
    }
  });

  return router;
}
