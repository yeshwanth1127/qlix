import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { authenticateUser } from '../middleware/authenticateUser.js';
import { requireSubscriptionAccess } from '../middleware/requireSubscriptionAccess.js';
import { ephemeralSet } from '../lib/ephemeralGrants.js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Dashboard-facing assessment API (authenticated user, not agent-runner tokens —
 * see assessmentToolRoutes.ts for the runner-authenticated tool proxy). Covers
 * session/framework CRUD, evidence browsing, and the human-reviewer decision on
 * a draft report.
 */

function asyncRoute(
  handler: (request: Request, response: Response) => Promise<void>,
): (request: Request, response: Response, next: NextFunction) => void {
  return (request, response, next) => void handler(request, response).catch(next);
}

function invalid(response: Response, issues: unknown): void {
  response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid request body', issues } });
}

/**
 * Private distribution, not the public VS Code Marketplace (deliberate product
 * decision) — the extension is packaged as a single .vsix and served straight
 * from this backend rather than a separate hosting service, since both repos
 * live in the same checkout on the same server. Picks the newest .vsix so a
 * fresh `npm run package` in vscode-extension/ is immediately what's served,
 * no manual wiring needed.
 */
function latestExtensionVsixPath(): string | null {
  const dir = path.resolve(process.cwd(), '..', 'vscode-extension');
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.vsix'));
  } catch {
    return null;
  }
  if (files.length === 0) return null;
  const withStats = files.map((f) => ({ f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }));
  withStats.sort((a, b) => b.mtime - a.mtime);
  return path.join(dir, withStats[0]!.f);
}

const checklistItem = z.object({
  id: z.string().trim().min(1),
  text: z.string().trim().min(1).max(500),
});

const createSessionBody = z.object({
  recipeId: z.string().trim().min(1).max(160),
  subjectRef: z.string().trim().min(1).max(200),
  subjectUserId: z.string().trim().min(1).optional(),
  teamId: z.string().trim().min(1).optional(),
  frameworkId: z.string().trim().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  // Staff-authored brief — what the student is being asked to build.
  projectDescription: z.string().trim().max(20_000).optional(),
  expectedStack: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
  windowStartsAt: z.coerce.date().optional(),
  windowEndsAt: z.coerce.date().optional(),
  aiUsagePolicy: z.string().trim().max(10_000).optional(),
  checklist: z.array(checklistItem).max(200).optional(),
  requiredDeliverables: z.array(z.string().trim().min(1).max(300)).max(100).optional(),
});

const createFrameworkBody = z.object({
  recipeId: z.string().trim().min(1).max(160),
  name: z.string().trim().min(1).max(200),
  criteria: z
    .array(
      z.object({
        criterion_id: z.string().trim().min(1),
        text: z.string().trim().min(1),
        category: z.string().trim().min(1),
      }),
    )
    .min(1),
});

const decideReportBody = z.object({
  decision: z.enum(['confirmed', 'overridden']),
});

export function createAssessmentRoutes(): Router {
  const router = Router();
  router.use(authenticateUser(true), requireSubscriptionAccess);

  router.post('/sessions', asyncRoute(async (request, response) => {
    const parsed = createSessionBody.safeParse(request.body ?? {});
    if (!parsed.success) return invalid(response, parsed.error.issues);
    const session = await prisma.workSession.create({
      data: {
        orgId: request.auth!.orgId,
        recipeId: parsed.data.recipeId,
        subjectRef: parsed.data.subjectRef,
        subjectUserId: parsed.data.subjectUserId ?? null,
        teamId: parsed.data.teamId ?? null,
        frameworkId: parsed.data.frameworkId ?? null,
        metadata: (parsed.data.metadata ?? {}) as Prisma.InputJsonValue,
        projectDescription: parsed.data.projectDescription ?? null,
        expectedStack: parsed.data.expectedStack ?? [],
        windowStartsAt: parsed.data.windowStartsAt ?? null,
        windowEndsAt: parsed.data.windowEndsAt ?? null,
        aiUsagePolicy: parsed.data.aiUsagePolicy ?? null,
        checklist: (parsed.data.checklist ?? []) as Prisma.InputJsonValue,
        requiredDeliverables: parsed.data.requiredDeliverables ?? [],
      },
    });
    response.status(201).json({ session });
  }));

  router.get('/sessions', asyncRoute(async (request, response) => {
    const sessions = await prisma.workSession.findMany({
      where: { orgId: request.auth!.orgId },
      orderBy: { startedAt: 'desc' },
      take: 100,
    });
    response.json({ sessions });
  }));

  router.get('/sessions/:id', asyncRoute(async (request, response) => {
    const session = await prisma.workSession.findFirst({
      where: { id: request.params.id, orgId: request.auth!.orgId },
    });
    if (!session) return void response.status(404).json({ error: { code: 'not_found', message: 'Work session not found' } });
    const deviceGrants = await prisma.deviceGrant.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        deviceLabel: true,
        workspaceRoot: true,
        expiresAt: true,
        revokedAt: true,
        lastSeenAt: true,
        createdAt: true,
      },
    });
    response.json({ session, deviceGrants });
  }));

  // One-time code the student pastes into the VS Code extension — see
  // POST /device/connect in deviceIngest.routes.ts for the exchange.
  router.post('/sessions/:id/device-code', asyncRoute(async (request, response) => {
    const session = await prisma.workSession.findFirst({
      where: { id: request.params.id, orgId: request.auth!.orgId },
      select: { id: true, orgId: true },
    });
    if (!session) return void response.status(404).json({ error: { code: 'not_found', message: 'Work session not found' } });

    // Human-typeable: 8 chars, uppercase, no ambiguous 0/O/1/I.
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const code = Array.from({ length: 8 }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
    const ttlMs = 15 * 60_000;
    await ephemeralSet('device_connect_code', code, { orgId: session.orgId, sessionId: session.id }, ttlMs);

    response.status(201).json({ code, expiresAt: new Date(Date.now() + ttlMs).toISOString() });
  }));

  router.get('/extension/download', asyncRoute(async (request, response) => {
    const vsixPath = latestExtensionVsixPath();
    if (!vsixPath) {
      return void response.status(404).json({ error: { code: 'not_found', message: 'Extension package is not available yet' } });
    }
    response.download(vsixPath, 'qlix-assessment.vsix');
  }));

  router.get('/sessions/:id/evidence', asyncRoute(async (request, response) => {
    const session = await prisma.workSession.findFirst({
      where: { id: request.params.id, orgId: request.auth!.orgId },
      select: { id: true },
    });
    if (!session) return void response.status(404).json({ error: { code: 'not_found', message: 'Work session not found' } });
    const evidence = await prisma.evidenceRecord.findMany({
      where: { sessionId: session.id },
      orderBy: { occurredAt: 'asc' },
    });
    response.json({
      evidence: evidence.map((record) => {
        if (record.kind !== 'artifact_upload' || !record.payload || Array.isArray(record.payload)) return record;
        const payload = record.payload as Record<string, unknown>;
        if (typeof payload.content !== 'string') return record;
        const { content: _content, ...metadata } = payload;
        return { ...record, payload: { ...metadata, contentAvailable: true } };
      }),
    });
  }));

  router.get('/sessions/:sessionId/evidence/:evidenceId/artifact', asyncRoute(async (request, response) => {
    const evidence = await prisma.evidenceRecord.findFirst({
      where: {
        id: request.params.evidenceId,
        sessionId: request.params.sessionId,
        kind: 'artifact_upload',
        session: { orgId: request.auth!.orgId },
      },
    });
    if (!evidence) {
      return void response.status(404).json({ error: { code: 'not_found', message: 'Artifact not found' } });
    }
    response.json({ artifact: evidence });
  }));

  router.get('/sessions/:id/assessment-record', asyncRoute(async (request, response) => {
    const session = await prisma.workSession.findFirst({
      where: { id: request.params.id, orgId: request.auth!.orgId },
      select: { id: true },
    });
    if (!session) return void response.status(404).json({ error: { code: 'not_found', message: 'Work session not found' } });
    const record = await prisma.assessmentRecord.findFirst({
      where: { sessionId: session.id },
      orderBy: { createdAt: 'desc' },
      include: { report: true },
    });
    response.json({ assessmentRecord: record });
  }));

  router.post('/frameworks', asyncRoute(async (request, response) => {
    const parsed = createFrameworkBody.safeParse(request.body ?? {});
    if (!parsed.success) return invalid(response, parsed.error.issues);
    const orgId = request.auth!.orgId;
    const latest = await prisma.evaluationFramework.findFirst({
      where: { orgId, recipeId: parsed.data.recipeId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const framework = await prisma.evaluationFramework.create({
      data: {
        orgId,
        recipeId: parsed.data.recipeId,
        name: parsed.data.name,
        version: (latest?.version ?? 0) + 1,
        criteria: parsed.data.criteria,
        status: 'published',
        createdByUserId: request.auth!.userId,
      },
    });
    response.status(201).json({ framework });
  }));

  router.get('/frameworks/:id', asyncRoute(async (request, response) => {
    const framework = await prisma.evaluationFramework.findFirst({
      where: { id: request.params.id, orgId: request.auth!.orgId },
    });
    if (!framework) return void response.status(404).json({ error: { code: 'not_found', message: 'Evaluation framework not found' } });
    response.json({ framework });
  }));

  // Human reviewer confirms or overrides a draft report. Separate from the JIT
  // gate on assessment.report.create (which authorizes the AGENT to draft a
  // report at all, before its content exists) — this is the post-hoc review of
  // the actual generated summary/findings by a human, not an agent action.
  router.post('/reports/:id/decide', asyncRoute(async (request, response) => {
    const parsed = decideReportBody.safeParse(request.body ?? {});
    if (!parsed.success) return invalid(response, parsed.error.issues);
    const report = await prisma.assessmentReport.findFirst({
      where: { id: request.params.id },
      include: { assessmentRecord: { include: { session: { select: { orgId: true } } } } },
    });
    if (!report || report.assessmentRecord.session.orgId !== request.auth!.orgId) {
      return void response.status(404).json({ error: { code: 'not_found', message: 'Report not found' } });
    }
    const updated = await prisma.assessmentReport.update({
      where: { id: report.id },
      data: {
        humanDecision: parsed.data.decision,
        humanReviewerId: request.auth!.userId,
        confirmedAt: new Date(),
      },
    });
    response.json({ report: updated });
  }));

  return router;
}
