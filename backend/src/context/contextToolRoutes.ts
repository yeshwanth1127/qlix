import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { assertRunnerAuth, RunnerUnauthorizedError } from '../agentChat/runnerAuth.js';
import { prisma } from '../lib/prisma.js';
import { resolveContextObjects } from './contextPlane.service.js';
import { patchRunState, readRunState } from './runState.service.js';
import { searchScopedContext } from './scopedRetrieval.service.js';

const resolveBody = z.object({
  runId: z.string().trim().min(1),
  refs: z.array(z.string().trim().min(1)).min(1).max(12),
  select: z.array(z.string().trim().min(1)).max(24).optional(),
  maxChars: z.number().int().min(1_000).max(64_000).optional(),
});

const stateReadBody = z.object({
  runId: z.string().trim().min(1),
  select: z.array(z.string().trim().min(1)).max(24).optional(),
});

const statePatchBody = z.object({
  runId: z.string().trim().min(1),
  baseVersion: z.number().int().positive(),
  idempotencyKey: z.string().trim().min(1).max(120).optional(),
  operations: z.array(z.object({
    op: z.enum(['set', 'merge']),
    path: z.string().trim().min(1).max(120),
    value: z.unknown(),
  })).min(1).max(16),
});

const searchBody = z.object({
  runId: z.string().trim().min(1),
  query: z.string().trim().min(1).max(2_000),
  sources: z.array(z.enum(['brain', 'context_object'])).max(4).optional(),
  collectionIds: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
  maxItems: z.number().int().min(1).max(12).optional(),
  maxChars: z.number().int().min(400).max(8_000).optional(),
});

function asyncRoute(handler: (request: Request, response: Response) => Promise<void>) {
  return (request: Request, response: Response): void => {
    void handler(request, response).catch((error) => {
      if (error instanceof RunnerUnauthorizedError) {
        response.status(401).json({ error: { code: 'runner_unauthorized', message: error.message } });
        return;
      }
      const code = (error as { code?: string }).code === 'state_version_conflict'
        ? 'state_version_conflict'
        : 'context_resolve_failed';
      const status = code === 'state_version_conflict' ? 409 : 400;
      const message = error instanceof Error ? error.message : 'Context resolution failed';
      response.status(status).json({ error: { code, message } });
    });
  };
}

async function loadAuthorizedRun(agentId: string, runId: string) {
  const run = await prisma.agentRun.findUnique({
    where: { id: runId },
    select: { agentId: true, orgId: true, skills: true, teamRunId: true, userId: true },
  });
  if (!run || run.agentId !== agentId || !run.orgId) {
    throw new Error('Agent run not found');
  }
  return run;
}

/** Runner-authenticated API for the generic Context Plane. */
export function createContextToolRoutes(): Router {
  const router = Router();
  router.post('/:agentId/tools/context/resolve', asyncRoute(async (request, response) => {
    const agentId = String(request.params.agentId);
    await assertRunnerAuth(agentId, request);
    const parsed = resolveBody.safeParse(request.body ?? {});
    if (!parsed.success) {
      response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid context resolve payload' } });
      return;
    }
    const run = await loadAuthorizedRun(agentId, parsed.data.runId);
    const result = await resolveContextObjects({
      orgId: run.orgId!,
      agentId,
      grantedScopes: run.skills,
      refs: parsed.data.refs,
      select: parsed.data.select,
      maxChars: parsed.data.maxChars,
    });
    response.json(result);
  }));

  router.post('/:agentId/tools/context/state/read', asyncRoute(async (request, response) => {
    const agentId = String(request.params.agentId);
    await assertRunnerAuth(agentId, request);
    const parsed = stateReadBody.safeParse(request.body ?? {});
    if (!parsed.success) {
      response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid state read payload' } });
      return;
    }
    const run = await loadAuthorizedRun(agentId, parsed.data.runId);
    const executionKind = run.teamRunId ? 'team_run' : 'agent_run';
    const executionId = run.teamRunId ?? parsed.data.runId;
    const result = await readRunState({
      orgId: run.orgId!,
      executionId,
      executionKind,
      select: parsed.data.select,
    });
    if (!result) {
      response.status(404).json({ error: { code: 'state_not_found', message: 'Execution state not found' } });
      return;
    }
    response.json(result);
  }));

  router.post('/:agentId/tools/context/state/patch', asyncRoute(async (request, response) => {
    const agentId = String(request.params.agentId);
    await assertRunnerAuth(agentId, request);
    const parsed = statePatchBody.safeParse(request.body ?? {});
    if (!parsed.success) {
      response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid state patch payload' } });
      return;
    }
    const run = await loadAuthorizedRun(agentId, parsed.data.runId);
    const executionKind = run.teamRunId ? 'team_run' : 'agent_run';
    const executionId = run.teamRunId ?? parsed.data.runId;
    const result = await patchRunState({
      orgId: run.orgId!,
      executionId,
      executionKind,
      baseVersion: parsed.data.baseVersion,
      operations: parsed.data.operations,
      idempotencyKey: parsed.data.idempotencyKey,
      allowedPrefixes: ['progress', 'outputs', 'decisions', 'artifacts'],
    });
    response.json(result);
  }));

  router.post('/:agentId/tools/context/search', asyncRoute(async (request, response) => {
    const agentId = String(request.params.agentId);
    await assertRunnerAuth(agentId, request);
    const parsed = searchBody.safeParse(request.body ?? {});
    if (!parsed.success) {
      response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid context search payload' } });
      return;
    }
    const run = await loadAuthorizedRun(agentId, parsed.data.runId);
    const maxChars = parsed.data.maxChars ?? 2_400;
    const result = await searchScopedContext({
      orgId: run.orgId!,
      agentId,
      userId: run.userId,
      grantedScopes: run.skills,
      task: parsed.data.query,
      allowedSources: parsed.data.sources,
      collectionIds: parsed.data.collectionIds,
      maxItems: parsed.data.maxItems,
      maxTokens: Math.max(80, Math.ceil(maxChars / 4)),
    });
    response.json(result);
  }));
  return router;
}
