import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import multer from 'multer';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { ephemeralDelete, ephemeralGet } from '../lib/ephemeralGrants.js';
import { assertDeviceGrantAuth, DeviceUnauthorizedError, generateDeviceToken } from './deviceAuth.js';
import { signalConversation } from '../conversations/conversationEngine.service.js';
import { storeAssessmentArchive } from './assessmentFileStorage.js';

/**
 * VS Code extension endpoints — device-token authenticated (assertDeviceGrantAuth),
 * distinct from assessmentToolRoutes.ts (agent-runner tokens) and assessment.routes.ts
 * (dashboard user session). No dashboard auth here by design: the connect-code exchange
 * IS the auth bootstrap, and everything after that authenticates via the minted token.
 */

const DEVICE_CONNECT_CODE_TTL_MS = 15 * 60_000;
const DEVICE_TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days — reconnect requires a fresh code after this
const MAX_EVIDENCE_BATCH = 100;

function asyncRoute(
  handler: (request: Request, response: Response) => Promise<void>,
): (request: Request, response: Response, next: NextFunction) => void {
  return (request, response, next) => void handler(request, response).catch((err) => {
    if (err instanceof DeviceUnauthorizedError) {
      response.status(401).json({ error: { code: 'device_unauthorized', message: err.message } });
      return;
    }
    next(err);
  });
}

const connectBody = z.object({
  code: z.string().trim().min(4).max(32),
  deviceLabel: z.string().trim().min(1).max(200),
  workspaceRoot: z.string().trim().min(1).max(1000),
});

const evidenceKind = z.enum([
  'file_snapshot',
  'git_event',
  'terminal_event',
  'dependency_event',
  'test_result',
  'build_result',
  'lint_result',
  'ai_prompt',
  'artifact_upload',
  'manual_note',
]);

const evidenceEvent = z.object({
  kind: evidenceKind,
  occurredAt: z.coerce.date(),
  payload: z.record(z.string(), z.unknown()).default({}),
  redacted: z.boolean().default(false),
});

const evidenceBatchBody = z.object({
  events: z.array(evidenceEvent).min(1).max(MAX_EVIDENCE_BATCH),
});

const answerBody = z.object({
  threadId: z.string().trim().min(1),
  text: z.string().trim().min(1).max(20_000),
});

const fileHashEntry = z.object({
  path: z.string().trim().min(1).max(1000),
  sha256: z.string().trim().max(64).optional(),
  sizeBytes: z.number().int().nonnegative(),
  skipped: z.boolean().optional(),
});

const snapshotBody = z.object({
  label: z.string().trim().min(1).max(80),
  fileTreeHash: z.string().trim().min(1).max(64),
  fileHashes: z.array(fileHashEntry).max(20_000).default([]),
});

const archiveUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

export function createDeviceIngestRoutes(): Router {
  const router = Router();

  // Exchanges a one-time connect code (minted by the dashboard, see
  // POST /sessions/:id/device-code in assessment.routes.ts) for a device token.
  // One-shot: the ephemeral grant is deleted on first successful exchange.
  router.post('/connect', asyncRoute(async (request, response) => {
    const parsed = connectBody.safeParse(request.body ?? {});
    if (!parsed.success) return void response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid connect payload' } });

    const grantInfo = await ephemeralGet<{ orgId: string; sessionId: string }>(
      'device_connect_code',
      parsed.data.code,
    );
    if (!grantInfo) {
      return void response.status(410).json({ error: { code: 'code_expired', message: 'Connect code is invalid or has expired' } });
    }
    await ephemeralDelete('device_connect_code', parsed.data.code);

    const session = await prisma.workSession.findFirst({
      where: { id: grantInfo.sessionId, orgId: grantInfo.orgId },
      select: { id: true, orgId: true, subjectUserId: true },
    });
    if (!session) return void response.status(404).json({ error: { code: 'not_found', message: 'Work session no longer exists' } });

    const { token, hash } = generateDeviceToken();
    const expiresAt = new Date(Date.now() + DEVICE_TOKEN_TTL_MS);
    await prisma.deviceGrant.create({
      data: {
        orgId: session.orgId,
        sessionId: session.id,
        subjectUserId: session.subjectUserId,
        deviceLabel: parsed.data.deviceLabel,
        workspaceRoot: parsed.data.workspaceRoot,
        tokenHash: hash,
        expiresAt,
      },
    });

    response.status(201).json({
      token,
      sessionId: session.id,
      orgId: session.orgId,
      workspaceRoot: parsed.data.workspaceRoot,
      expiresAt: expiresAt.toISOString(),
    });
  }));

  router.post('/evidence/batch', asyncRoute(async (request, response) => {
    const grant = await assertDeviceGrantAuth(request, { requireAction: 'evidence.ingest' });
    const parsed = evidenceBatchBody.safeParse(request.body ?? {});
    if (!parsed.success) return void response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid evidence batch' } });

    await prisma.evidenceRecord.createMany({
      data: parsed.data.events.map((event) => ({
        sessionId: grant.sessionId,
        kind: event.kind,
        source: 'vscode_extension',
        occurredAt: event.occurredAt,
        payload: event.payload as Prisma.InputJsonValue,
        redacted: event.redacted,
      })),
    });

    response.json({ accepted: parsed.data.events.length });
  }));

  // Fills the ProjectSnapshot model — a point-in-time structural fingerprint
  // (file tree + per-file hashes), distinct from the routine evidence stream.
  // Fired once when monitoring starts and once at submit time.
  router.post('/snapshot', asyncRoute(async (request, response) => {
    const grant = await assertDeviceGrantAuth(request, { requireAction: 'evidence.ingest' });
    const parsed = snapshotBody.safeParse(request.body ?? {});
    if (!parsed.success) return void response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid snapshot payload' } });

    const snapshot = await prisma.projectSnapshot.create({
      data: {
        sessionId: grant.sessionId,
        label: parsed.data.label,
        fileTreeHash: parsed.data.fileTreeHash,
        fileHashes: parsed.data.fileHashes as unknown as Prisma.InputJsonValue,
      },
    });
    response.status(201).json({ snapshotId: snapshot.id });
  }));

  // Attaches the final source-code archive to a snapshot already created via
  // POST /snapshot — kept as two steps so the (cheap) structural record is
  // saved even if the (larger) archive upload fails partway.
  router.post('/archive', archiveUpload.single('file'), asyncRoute(async (request, response) => {
    const grant = await assertDeviceGrantAuth(request, { requireAction: 'evidence.ingest' });
    const snapshotId = typeof request.body?.snapshotId === 'string' ? request.body.snapshotId.trim() : '';
    const file = (request as Request & { file?: Express.Multer.File }).file;
    if (!snapshotId || !file) {
      return void response.status(400).json({ error: { code: 'invalid_body', message: 'snapshotId and file are required' } });
    }
    const snapshot = await prisma.projectSnapshot.findFirst({
      where: { id: snapshotId, sessionId: grant.sessionId },
      select: { id: true, label: true },
    });
    if (!snapshot) return void response.status(404).json({ error: { code: 'not_found', message: 'Snapshot not found for this session' } });

    const { storageKey } = await storeAssessmentArchive({
      orgId: grant.orgId,
      sessionId: grant.sessionId,
      label: snapshot.label,
      bytes: file.buffer,
    });
    await prisma.projectSnapshot.update({ where: { id: snapshot.id }, data: { contentRef: storageKey } });
    response.status(201).json({ ok: true });
  }));

  router.post('/submit', asyncRoute(async (request, response) => {
    const grant = await assertDeviceGrantAuth(request);
    await prisma.workSession.update({
      where: { id: grant.sessionId },
      data: { status: 'submitted', submittedAt: new Date() },
    });
    response.json({ status: 'submitted' });
  }));

  // Lets the extension surface "the evaluator is waiting on you" inside the editor,
  // not just on the dashboard — polls the session status and any open review question.
  router.get('/status', asyncRoute(async (request, response) => {
    const grant = await assertDeviceGrantAuth(request);
    const session = await prisma.workSession.findUnique({
      where: { id: grant.sessionId },
      select: { id: true, status: true, reviewProcessId: true },
    });
    if (!session) return void response.status(404).json({ error: { code: 'not_found', message: 'Work session not found' } });

    let openQuestion: { threadId: string; questionText: string } | null = null;
    if (session.reviewProcessId) {
      const thread = await prisma.conversationThread.findFirst({
        where: { processId: session.reviewProcessId, status: 'waiting_input' },
        orderBy: { createdAt: 'desc' },
        select: { id: true, stateJson: true },
      });
      if (thread) {
        const variables = (thread.stateJson as { variables?: Record<string, unknown> } | null)?.variables;
        const questionText = typeof variables?.questionText === 'string' ? variables.questionText : null;
        if (questionText) openQuestion = { threadId: thread.id, questionText };
      }
    }

    response.json({ session, openQuestion });
  }));

  // Answer an open defense-interview question from inside the editor. Verifies the
  // thread belongs to this device's own session before signaling — a device grant for
  // session A can never answer a question on session B's review thread.
  router.post('/answer', asyncRoute(async (request, response) => {
    const grant = await assertDeviceGrantAuth(request);
    const parsed = answerBody.safeParse(request.body ?? {});
    if (!parsed.success) return void response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid answer payload' } });

    const thread = await prisma.conversationThread.findUnique({
      where: { id: parsed.data.threadId },
      select: { id: true, processId: true, orgId: true },
    });
    const session = await prisma.workSession.findUnique({ where: { id: grant.sessionId }, select: { reviewProcessId: true } });
    if (!thread || !session?.reviewProcessId || thread.processId !== session.reviewProcessId) {
      return void response.status(404).json({ error: { code: 'not_found', message: 'Review thread not found for this session' } });
    }

    const result = await signalConversation({
      threadId: thread.id,
      signal: { type: 'inbound', text: parsed.data.text },
      idempotencyKey: `device:${grant.id}:${thread.id}:${Date.now()}`,
    });
    response.json({ status: result.status });
  }));

  return router;
}
