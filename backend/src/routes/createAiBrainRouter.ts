import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { Prisma } from '@prisma/client';
import multer from 'multer';
import { z } from 'zod';
import { authenticateUser } from '../middleware/authenticateUser.js';
import { requireSubscriptionAccess } from '../middleware/requireSubscriptionAccess.js';
import { prisma } from '../lib/prisma.js';
import { roleCan } from '../lib/orgPermissions.js';
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
import { BrainAgentLoopService } from '../aiBrain/brainAgentLoop.service.js';
import {
  BrainProposalError,
  BrainProposalService,
} from '../aiBrain/brainProposal.service.js';
import { extractTextFromUpload } from '../aiBrain/brainExtractText.js';
import { normalizeQlixInferenceModelId, assertModelAllowed, ModelPolicyError } from '../llm/modelPolicy.js';
import { resolveHybridStarterPlatform } from '../agents/hybridStarterPack.js';

function unwrapBrainMessageCitations(citations: Prisma.JsonValue | null): {
  citations: unknown[];
  proposalId: string | null;
} {
  if (Array.isArray(citations)) {
    return { citations, proposalId: null };
  }
  if (citations && typeof citations === 'object') {
    const obj = citations as { citations?: unknown; proposalId?: unknown };
    return {
      citations: Array.isArray(obj.citations) ? obj.citations : [],
      proposalId: typeof obj.proposalId === 'string' ? obj.proposalId : null,
    };
  }
  return { citations: [], proposalId: null };
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

export function createAiBrainRouter(): Router {
  const router = Router();
  router.use(authenticateUser(true));
  router.use((request, response, next) => {
    if (request.method === 'GET' || request.method === 'HEAD') {
      next();
      return;
    }
    void requireSubscriptionAccess(request, response, next);
  });

  const brainAgents = new BrainAgentService();
  const knowledge = new BrainKnowledgeService();
  const queryService = new BrainQueryService();
  const agentLoop = new BrainAgentLoopService(queryService);
  const proposals = new BrainProposalService();

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

  router.get('/documents/:documentId', async (request: Request, response: Response) => {
    try {
      const document = await knowledge.getKnowledgeDocument(
        request.auth!.userId,
        request.auth!.orgId,
        String(request.params.documentId ?? ''),
      );
      response.json({ document });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load document';
      if (message === 'Document not found') {
        response.status(404).json({ error: { code: 'not_found', message } });
        return;
      }
      console.error('ai-brain/documents:get-one', err);
      response.status(500).json({ error: { code: 'document_load_failed', message: 'Failed to load document' } });
    }
  });

  router.patch('/documents/:documentId', async (request: Request, response: Response) => {
    const documentSchema = z.object({
      title: z.string().trim().min(1).max(500),
      bodyText: z.string().min(1).max(1_500_000),
    });
    try {
      const parsed = documentSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'Title and document text are required.' } });
        return;
      }
      const brain = await brainAgents.getOrgBrainAgent(request.auth!.orgId);
      if (!brain) {
        response.status(409).json({ error: { code: 'brain_required', message: 'Provision the org AI brain first.' } });
        return;
      }
      const result = await knowledge.updateKnowledgeDocument({
        userId: request.auth!.userId,
        orgId: request.auth!.orgId,
        role: request.auth!.role,
        brainAgentId: brain.id,
        documentId: String(request.params.documentId ?? ''),
        title: parsed.data.title,
        bodyText: parsed.data.bodyText,
      });
      response.json(result);
    } catch (err: unknown) {
      if (err instanceof BrainKnowledgeForbiddenError) {
        response.status(403).json({ error: { code: err.code, message: err.message } });
        return;
      }
      const message = err instanceof Error ? err.message : 'Update failed';
      if (message === 'Document not found') {
        response.status(404).json({ error: { code: 'not_found', message } });
        return;
      }
      console.error('ai-brain/documents:patch', err);
      response.status(500).json({ error: { code: 'document_update_failed', message: 'Failed to update document' } });
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
    conversationId: z.string().cuid().optional(),
    /** Optional per-query override (OpenRouter / qlix canonical id). */
    model: z.string().trim().min(1).max(200).optional(),
  });

  router.get('/conversations', async (request: Request, response: Response) => {
    try {
      const conversations = await prisma.brainConversation.findMany({
        where: { userId: request.auth!.userId, orgId: request.auth!.orgId },
        orderBy: { updatedAt: 'desc' },
        take: 50,
        select: {
          id: true,
          title: true,
          createdAt: true,
          updatedAt: true,
          _count: { select: { messages: true } },
        },
      });
      response.json({
        conversations: conversations.map((conversation) => ({
          id: conversation.id,
          title: conversation.title,
          createdAt: conversation.createdAt.toISOString(),
          updatedAt: conversation.updatedAt.toISOString(),
          messageCount: conversation._count.messages,
        })),
      });
    } catch (err) {
      console.error('ai-brain/conversations:get', err);
      response.status(500).json({ error: { code: 'conversations_failed', message: 'Failed to load recent chats' } });
    }
  });

  router.post('/conversations', async (request: Request, response: Response) => {
    try {
      const brain = await brainAgents.getOrgBrainAgent(request.auth!.orgId);
      if (!brain) {
        response.status(409).json({ error: { code: 'brain_required', message: 'Provision the org AI brain first.' } });
        return;
      }
      const conversation = await prisma.brainConversation.create({
        data: {
          brainAgentId: brain.id,
          userId: request.auth!.userId,
          orgId: request.auth!.orgId,
        },
        select: { id: true, title: true, createdAt: true, updatedAt: true },
      });
      response.status(201).json({
        conversation: {
          ...conversation,
          createdAt: conversation.createdAt.toISOString(),
          updatedAt: conversation.updatedAt.toISOString(),
          messageCount: 0,
        },
      });
    } catch (err) {
      console.error('ai-brain/conversations:post', err);
      response.status(500).json({ error: { code: 'conversation_create_failed', message: 'Failed to create chat' } });
    }
  });

  router.get('/conversations/:conversationId/messages', async (request: Request, response: Response) => {
    try {
      const conversation = await prisma.brainConversation.findFirst({
        where: {
          id: String(request.params.conversationId),
          userId: request.auth!.userId,
          orgId: request.auth!.orgId,
        },
        select: { id: true },
      });
      if (!conversation) {
        response.status(404).json({ error: { code: 'not_found', message: 'Conversation not found' } });
        return;
      }
      const messages = await prisma.brainConversationMessage.findMany({
        where: { conversationId: conversation.id },
        orderBy: { createdAt: 'asc' },
        take: 200,
        select: { id: true, role: true, content: true, citations: true, createdAt: true },
      });
      response.json({
        messages: messages.map((message) => {
          const unwrapped = unwrapBrainMessageCitations(message.citations);
          return {
            id: message.id,
            role: message.role,
            content: message.content,
            citations: unwrapped.citations,
            proposalId: unwrapped.proposalId,
            createdAt: message.createdAt.toISOString(),
          };
        }),
      });
    } catch (err) {
      console.error('ai-brain/conversations/messages:get', err);
      response.status(500).json({ error: { code: 'messages_failed', message: 'Failed to load chat messages' } });
    }
  });

  router.get('/proposals/:proposalId', async (request: Request, response: Response) => {
    try {
      const dto = await proposals.getProposal(request.auth!.orgId, String(request.params.proposalId));
      if (!dto) {
        response.status(404).json({ error: { code: 'not_found', message: 'Proposal not found' } });
        return;
      }
      response.json({ proposal: dto });
    } catch (err) {
      console.error('ai-brain/proposals:get', err);
      response.status(500).json({ error: { code: 'proposal_get_failed', message: 'Failed to load proposal' } });
    }
  });

  router.post('/proposals/:proposalId/confirm', async (request: Request, response: Response) => {
    try {
      const orgId = request.auth!.orgId;
      const userId = request.auth!.userId;
      const brain = await brainAgents.getOrgBrainAgent(orgId);
      if (!brain) {
        response.status(409).json({ error: { code: 'brain_required', message: 'Provision the org AI brain first.' } });
        return;
      }
      const bodySchema = z.object({
        clientPlatform: z.enum(['windows', 'macos', 'linux']).optional(),
      });
      const parsed = bodySchema.safeParse(request.body ?? {});
      const clientPlatform = resolveHybridStarterPlatform(
        parsed.success ? parsed.data.clientPlatform : undefined,
        request.headers['user-agent'],
      );
      const dto = await proposals.confirmProposal({
        orgId,
        userId,
        proposalId: String(request.params.proposalId),
        brainAgentId: brain.id,
        request,
        clientPlatform,
      });
      response.json({ proposal: dto });
    } catch (err: unknown) {
      if (err instanceof BrainProposalError) {
        const status =
          err.code === 'not_found' ? 404
          : err.code === 'not_pending' ? 409
          : err.code === 'create_failed' ? 502
          : 400;
        response.status(status).json({ error: { code: err.code, message: err.message } });
        return;
      }
      console.error('ai-brain/proposals:confirm', err);
      response.status(500).json({ error: { code: 'confirm_failed', message: 'Failed to confirm proposal' } });
    }
  });

  router.post('/proposals/:proposalId/reject', async (request: Request, response: Response) => {
    try {
      const orgId = request.auth!.orgId;
      const userId = request.auth!.userId;
      const brain = await brainAgents.getOrgBrainAgent(orgId);
      if (!brain) {
        response.status(409).json({ error: { code: 'brain_required', message: 'Provision the org AI brain first.' } });
        return;
      }
      const dto = await proposals.rejectProposal({
        orgId,
        userId,
        proposalId: String(request.params.proposalId),
        brainAgentId: brain.id,
      });
      response.json({ proposal: dto });
    } catch (err: unknown) {
      if (err instanceof BrainProposalError) {
        const status = err.code === 'not_found' ? 404 : err.code === 'not_pending' ? 409 : 400;
        response.status(status).json({ error: { code: err.code, message: err.message } });
        return;
      }
      console.error('ai-brain/proposals:reject', err);
      response.status(500).json({ error: { code: 'reject_failed', message: 'Failed to reject proposal' } });
    }
  });

  router.delete('/conversations/:conversationId', async (request: Request, response: Response) => {
    try {
      const deleted = await prisma.brainConversation.deleteMany({
        where: {
          id: String(request.params.conversationId),
          userId: request.auth!.userId,
          orgId: request.auth!.orgId,
        },
      });
      if (deleted.count === 0) {
        response.status(404).json({ error: { code: 'not_found', message: 'Conversation not found' } });
        return;
      }
      response.status(204).send();
    } catch (err) {
      console.error('ai-brain/conversations:delete', err);
      response.status(500).json({ error: { code: 'conversation_delete_failed', message: 'Failed to delete chat' } });
    }
  });

  router.post('/query', async (request: Request, response: Response) => {
    try {
      const orgId = request.auth!.orgId;
      const userId = request.auth!.userId;
      // Normalize first so legacy bad model ids (e.g. bare claude-sonnet-4-6) are rewritten.
      const brain = await brainAgents.normalizeOrgBrain(orgId);
      if (!brain) {
        response.status(409).json({ error: { code: 'brain_required', message: 'Provision the org AI brain first.' } });
        return;
      }

      const parsed = querySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'question is required (1-4000 chars)' } });
        return;
      }

      let brainModel = brain.model;
      if (parsed.data.model) {
        try {
          const normalized = normalizeQlixInferenceModelId(parsed.data.model);
          assertModelAllowed(normalized);
          brainModel = normalized;
        } catch (err) {
          response.status(400).json({
            error: {
              code: 'model_not_allowed',
              message: err instanceof Error ? err.message : 'Model not allowed',
            },
          });
          return;
        }
      }

      let conversation: { id: string; title: string } | null = null;
      let history: { role: string; content: string }[] = [];
      if (parsed.data.conversationId) {
        conversation = await prisma.brainConversation.findFirst({
          where: {
            id: parsed.data.conversationId,
            brainAgentId: brain.id,
            userId,
            orgId,
          },
          select: { id: true, title: true },
        });
        if (!conversation) {
          response.status(404).json({ error: { code: 'not_found', message: 'Conversation not found' } });
          return;
        }
        const recent = await prisma.brainConversationMessage.findMany({
          where: { conversationId: conversation.id },
          orderBy: { createdAt: 'desc' },
          take: 12,
          select: { role: true, content: true },
        });
        history = recent.reverse();
        await prisma.brainConversationMessage.create({
          data: { conversationId: conversation.id, role: 'user', content: parsed.data.question },
        });
      }

      const result = await agentLoop.run({
        userId,
        orgId,
        brainAgentId: brain.id,
        brainModel,
        question: parsed.data.question,
        conversationId: conversation?.id ?? null,
        history,
      });

      if (conversation) {
        const nextTitle = conversation.title === 'New chat'
          ? parsed.data.question.replace(/\s+/g, ' ').slice(0, 72)
          : conversation.title;
        const citationPayload = {
          citations: result.citations,
          ...(result.proposal ? { proposalId: result.proposal.id } : {}),
        };
        await prisma.$transaction([
          prisma.brainConversationMessage.create({
            data: {
              conversationId: conversation.id,
              role: 'brain',
              content: result.answer,
              citations: citationPayload as unknown as Prisma.InputJsonValue,
            },
          }),
          prisma.brainConversation.update({
            where: { id: conversation.id },
            data: { title: nextTitle, updatedAt: new Date() },
          }),
        ]);
      }

      response.json({
        answer: result.answer,
        citations: result.citations,
        proposal: result.proposal,
      });
    } catch (err: unknown) {
      if (err instanceof BrainProposalError) {
        response.status(400).json({ error: { code: err.code, message: err.message } });
        return;
      }
      console.error('ai-brain/query', err);
      const message =
        err instanceof Error && err.message.trim().length > 0 && err.message.length < 240
          ? err.message
          : 'Failed to query brain';
      response.status(500).json({ error: { code: 'query_failed', message } });
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
