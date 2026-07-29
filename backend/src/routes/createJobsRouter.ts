import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { authenticateUser } from '../middleware/authenticateUser.js';
import { requireSubscriptionAccess } from '../middleware/requireSubscriptionAccess.js';
import {
  JobApplyBlockedError,
  JobApplicationNotFoundError,
  JobCampaignNotFoundError,
  JobProfileNotFoundError,
  jobsService,
} from '../jobs/jobs.service.js';
import { createJobApplyAgent } from '../jobs/jobApplyAgentTemplate.js';
import { ensureQlixJobsMcpForOrg } from '../jobs/ensureQlixJobsMcp.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const profileSchema = z.object({
  fullName: z.string().max(200).nullable().optional(),
  email: z.string().email().nullable().optional().or(z.literal('')),
  phone: z.string().max(40).nullable().optional(),
  location: z.string().max(200).nullable().optional(),
  linkedinUrl: z.string().max(500).nullable().optional(),
  githubUrl: z.string().max(500).nullable().optional(),
  portfolioUrl: z.string().max(500).nullable().optional(),
  workAuth: z.string().max(500).nullable().optional(),
  salaryBand: z.string().max(120).nullable().optional(),
  summary: z.string().max(4000).nullable().optional(),
  skills: z.array(z.string().max(80)).max(80).optional(),
  answerBank: z
    .array(z.object({ question: z.string().max(500), answer: z.string().max(4000) }))
    .max(50)
    .optional(),
});

const createCampaignSchema = z.object({
  name: z.string().trim().min(1).max(120),
  searchQuery: z.string().trim().max(200).optional(),
  boards: z
    .array(
      z.object({
        ats: z.enum(['greenhouse', 'lever', 'ashby']),
        board: z.string().trim().min(1).max(80),
      }),
    )
    .max(20)
    .optional(),
  applyUrls: z.array(z.string().url().max(2000)).max(50).optional(),
  agentId: z.string().optional(),
});

const queueSchema = z.object({
  applyUrls: z.array(z.string().url().max(2000)).min(1).max(50),
});

const searchSchema = z.object({
  ats: z.enum(['greenhouse', 'lever', 'ashby']),
  board: z.string().trim().min(1).max(80),
  query: z.string().trim().max(200).optional(),
});

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

export function createJobsRouter(): Router {
  const router = Router();
  router.use(authenticateUser(true));
  router.use((request, response, next) => {
    if (request.method === 'GET' || request.method === 'HEAD') {
      next();
      return;
    }
    void requireSubscriptionAccess(request, response, next);
  });

  router.get('/profile', async (request: Request, response: Response) => {
    try {
      const profile = await jobsService.getProfile(request.auth!.orgId, request.auth!.userId);
      response.json({ profile });
    } catch (err) {
      console.error('[jobs] get profile', err);
      response.status(500).json({ error: { code: 'profile_failed', message: 'Failed to load profile' } });
    }
  });

  router.put('/profile', async (request: Request, response: Response) => {
    const parsed = profileSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid profile body' } });
      return;
    }
    try {
      const fields = { ...parsed.data };
      if (fields.email === '') fields.email = null;
      const profile = await jobsService.upsertProfileFields(
        request.auth!.orgId,
        request.auth!.userId,
        fields,
      );
      response.json({ profile });
    } catch (err) {
      console.error('[jobs] upsert profile', err);
      response.status(500).json({ error: { code: 'profile_save_failed', message: 'Failed to save profile' } });
    }
  });

  router.post('/profile/resume', upload.single('file'), async (request: Request, response: Response) => {
    const file = request.file;
    if (!file) {
      response.status(400).json({ error: { code: 'missing_file', message: 'file is required' } });
      return;
    }
    try {
      const profile = await jobsService.uploadResume(request.auth!.orgId, request.auth!.userId, {
        buffer: file.buffer,
        originalname: file.originalname,
        mimetype: file.mimetype,
      });
      response.json({ profile });
    } catch (err) {
      console.error('[jobs] resume upload', err);
      response.status(500).json({
        error: {
          code: 'resume_upload_failed',
          message: err instanceof Error ? err.message : 'Failed to upload resume',
        },
      });
    }
  });

  router.get('/campaigns', async (request: Request, response: Response) => {
    try {
      const campaigns = await jobsService.listCampaigns(request.auth!.orgId);
      response.json({ campaigns });
    } catch (err) {
      console.error('[jobs] list campaigns', err);
      response.status(500).json({ error: { code: 'list_failed', message: 'Failed to list campaigns' } });
    }
  });

  router.post('/campaigns', async (request: Request, response: Response) => {
    const parsed = createCampaignSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid campaign body' } });
      return;
    }
    try {
      const result = await jobsService.createCampaign(
        request.auth!.orgId,
        request.auth!.userId,
        parsed.data,
      );
      response.status(201).json(result);
    } catch (err) {
      if (mapError(err, response)) return;
      console.error('[jobs] create campaign', err);
      response.status(500).json({ error: { code: 'create_failed', message: 'Failed to create campaign' } });
    }
  });

  router.get('/campaigns/:id', async (request: Request, response: Response) => {
    try {
      const campaign = await jobsService.getCampaign(request.auth!.orgId, request.params.id);
      const applications = await jobsService.listApplications(request.auth!.orgId, request.params.id);
      response.json({ campaign, applications });
    } catch (err) {
      if (mapError(err, response)) return;
      response.status(500).json({ error: { code: 'get_failed', message: 'Failed to load campaign' } });
    }
  });

  router.post('/campaigns/:id/queue', async (request: Request, response: Response) => {
    const parsed = queueSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: { code: 'invalid_body', message: 'applyUrls required' } });
      return;
    }
    try {
      const result = await jobsService.queueApplyUrls(
        request.auth!.orgId,
        request.auth!.userId,
        request.params.id,
        parsed.data.applyUrls,
      );
      response.json(result);
    } catch (err) {
      if (mapError(err, response)) return;
      response.status(500).json({ error: { code: 'queue_failed', message: 'Failed to queue applications' } });
    }
  });

  router.post('/search', async (request: Request, response: Response) => {
    const parsed = searchSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: { code: 'invalid_body', message: 'ats and board required' } });
      return;
    }
    try {
      const jobs = await jobsService.searchJobs(parsed.data);
      response.json({ jobs });
    } catch (err) {
      console.error('[jobs] search', err);
      response.status(502).json({
        error: {
          code: 'search_failed',
          message: err instanceof Error ? err.message : 'ATS search failed',
        },
      });
    }
  });

  router.post('/agent-template', async (request: Request, response: Response) => {
    try {
      await ensureQlixJobsMcpForOrg(request.auth!.orgId, request.auth!.userId);
      const agent = await createJobApplyAgent({
        orgId: request.auth!.orgId,
        userId: request.auth!.userId,
        name: typeof request.body?.name === 'string' ? request.body.name : undefined,
      });
      response.status(201).json(agent);
    } catch (err) {
      console.error('[jobs] agent template', err);
      response.status(500).json({
        error: {
          code: 'agent_create_failed',
          message: err instanceof Error ? err.message : 'Failed to create apply agent',
        },
      });
    }
  });

  return router;
}
