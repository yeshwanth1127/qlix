import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { assertInternalServiceSecret } from '../middleware/assertInternalServiceSecret.js';
import { prisma } from '../lib/prisma.js';
import {
  JobApplicationNotFoundError,
  JobApplyBlockedError,
  JobCampaignNotFoundError,
  JobProfileNotFoundError,
  jobsService,
} from '../jobs/jobs.service.js';

async function resolveAgentContext(agentId: string): Promise<{
  orgId: string;
  userId: string;
} | null> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { userId: true, orgId: true, user: { select: { orgId: true } } },
  });
  if (!agent) return null;
  const orgId = agent.orgId ?? agent.user.orgId;
  return { orgId, userId: agent.userId };
}

function mapError(err: unknown, response: Response): boolean {
  if (err instanceof JobProfileNotFoundError) {
    response.status(404).json({ error: { code: 'profile_required', message: err.message } });
    return true;
  }
  if (err instanceof JobCampaignNotFoundError || err instanceof JobApplicationNotFoundError) {
    response.status(404).json({ error: { code: 'not_found', message: err.message } });
    return true;
  }
  if (err instanceof JobApplyBlockedError) {
    response.status(400).json({ error: { code: 'blocked', message: err.message } });
    return true;
  }
  return false;
}

export function createInternalJobsRouter(): Router {
  const router = Router();
  router.use(assertInternalServiceSecret);

  router.get('/agent/:agentId/context', async (request: Request, response: Response) => {
    const ctx = await resolveAgentContext(request.params.agentId);
    if (!ctx) {
      response.status(404).json({ error: { code: 'not_found', message: 'Agent not found' } });
      return;
    }
    response.json(ctx);
  });

  router.post('/profile/upsert', async (request: Request, response: Response) => {
    const parsed = z
      .object({
        agentId: z.string().min(1),
        fullName: z.string().optional(),
        email: z.string().optional(),
        phone: z.string().optional(),
        location: z.string().optional(),
        linkedinUrl: z.string().optional(),
        githubUrl: z.string().optional(),
        portfolioUrl: z.string().optional(),
        workAuth: z.string().optional(),
        salaryBand: z.string().optional(),
        summary: z.string().optional(),
        skills: z.array(z.string()).optional(),
        answerBank: z.array(z.object({ question: z.string(), answer: z.string() })).optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid body' } });
      return;
    }
    const ctx = await resolveAgentContext(parsed.data.agentId);
    if (!ctx) {
      response.status(404).json({ error: { code: 'not_found', message: 'Agent not found' } });
      return;
    }
    const { agentId: _a, ...fields } = parsed.data;
    const profile = await jobsService.upsertProfileFields(ctx.orgId, ctx.userId, fields);
    response.json({ profile });
  });

  router.post('/profile/stage-resume', async (request: Request, response: Response) => {
    const parsed = z
      .object({
        agentId: z.string().min(1),
        text: z.string().max(200_000).optional(),
        base64: z.string().max(14_000_000).optional(),
        fileName: z.string().max(200).optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid body' } });
      return;
    }
    const ctx = await resolveAgentContext(parsed.data.agentId);
    if (!ctx) {
      response.status(404).json({ error: { code: 'not_found', message: 'Agent not found' } });
      return;
    }
    try {
      const profile = await jobsService.stageResumeFromAgent(ctx.orgId, ctx.userId, parsed.data);
      response.json({ profile });
    } catch (err) {
      if (mapError(err, response)) return;
      response.status(500).json({
        error: { code: 'stage_failed', message: err instanceof Error ? err.message : 'stage failed' },
      });
    }
  });

  router.post('/search', async (request: Request, response: Response) => {
    const parsed = z
      .object({
        ats: z.enum(['greenhouse', 'lever', 'ashby']),
        board: z.string().min(1),
        query: z.string().optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid body' } });
      return;
    }
    try {
      const jobs = await jobsService.searchJobs(parsed.data);
      response.json({ jobs });
    } catch (err) {
      response.status(502).json({
        error: { code: 'search_failed', message: err instanceof Error ? err.message : 'search failed' },
      });
    }
  });

  router.post('/campaigns', async (request: Request, response: Response) => {
    const parsed = z
      .object({
        agentId: z.string().min(1),
        name: z.string().min(1).max(120).optional(),
        searchQuery: z.string().optional(),
        boards: z
          .array(z.object({ ats: z.enum(['greenhouse', 'lever', 'ashby']), board: z.string() }))
          .optional(),
        applyUrls: z.array(z.string()).optional(),
        campaignId: z.string().optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid body' } });
      return;
    }
    const ctx = await resolveAgentContext(parsed.data.agentId);
    if (!ctx) {
      response.status(404).json({ error: { code: 'not_found', message: 'Agent not found' } });
      return;
    }
    try {
      if (parsed.data.campaignId && parsed.data.applyUrls?.length) {
        const result = await jobsService.queueApplyUrls(
          ctx.orgId,
          ctx.userId,
          parsed.data.campaignId,
          parsed.data.applyUrls,
        );
        response.json({ campaignId: parsed.data.campaignId, ...result });
        return;
      }
      const result = await jobsService.createCampaign(ctx.orgId, ctx.userId, {
        name: parsed.data.name ?? `Jobs: ${(parsed.data.searchQuery || 'queue').slice(0, 40)}`,
        searchQuery: parsed.data.searchQuery,
        boards: parsed.data.boards,
        applyUrls: parsed.data.applyUrls,
        agentId: parsed.data.agentId,
      });
      response.status(201).json(result);
    } catch (err) {
      if (mapError(err, response)) return;
      console.error('[internal/jobs] campaign', err);
      response.status(500).json({ error: { code: 'create_failed', message: 'Failed to queue' } });
    }
  });

  router.get('/campaigns/:id/applications', async (request: Request, response: Response) => {
    const orgId = String(request.query.orgId || '');
    if (!orgId) {
      response.status(400).json({ error: { code: 'invalid_query', message: 'orgId required' } });
      return;
    }
    try {
      const status = typeof request.query.status === 'string' ? request.query.status : undefined;
      const applications = await jobsService.listApplications(orgId, request.params.id, { status });
      response.json({ applications });
    } catch (err) {
      if (mapError(err, response)) return;
      response.status(500).json({ error: { code: 'list_failed', message: 'Failed to list' } });
    }
  });

  router.get('/applications/:id/brief', async (request: Request, response: Response) => {
    const orgId = String(request.query.orgId || '');
    if (!orgId) {
      response.status(400).json({ error: { code: 'invalid_query', message: 'orgId required' } });
      return;
    }
    try {
      const brief = await jobsService.getApplyBrief(orgId, request.params.id);
      response.json(brief);
    } catch (err) {
      if (mapError(err, response)) return;
      response.status(500).json({ error: { code: 'brief_failed', message: 'Failed to get brief' } });
    }
  });

  router.post('/applications/:id/result', async (request: Request, response: Response) => {
    const parsed = z
      .object({
        orgId: z.string().uuid(),
        outcome: z.enum(['submitted', 'blocked', 'failed', 'skipped', 'awaiting_jit']),
        note: z.string().optional(),
        confirmationUrl: z.string().optional(),
        agentRunId: z.string().optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid body' } });
      return;
    }
    try {
      const application = await jobsService.recordResult(
        parsed.data.orgId,
        request.params.id,
        parsed.data,
      );
      response.json({ application });
    } catch (err) {
      if (mapError(err, response)) return;
      response.status(500).json({ error: { code: 'result_failed', message: 'Failed to record result' } });
    }
  });

  return router;
}
