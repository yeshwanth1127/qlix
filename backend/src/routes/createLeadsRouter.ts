import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { authenticateUser } from '../middleware/authenticateUser.js';
import { requireSubscriptionAccess } from '../middleware/requireSubscriptionAccess.js';
import { roleCan } from '../lib/orgPermissions.js';
import { LeadsService, LeadCampaignNotFoundError } from '../leads/leads.service.js';
import { createLeadGenPipelineTeam } from '../leads/leadGenTeamTemplate.js';
import { resolveDockerBackendUrl } from '../agents/sdkAgentFile.js';

const service = new LeadsService();

const createCampaignSchema = z.object({
  name: z.string().trim().min(1).max(120),
  searchQuery: z.string().trim().min(1).max(500),
  location: z.string().trim().max(200).optional(),
  maxResults: z.number().int().min(1).max(200).optional(),
  outreachConfig: z
    .object({
      channel: z.enum(['email', 'whatsapp', 'mcp', 'n8n']).optional(),
      provider: z.string().max(80).optional(),
      template: z
        .object({
          subject: z.string().max(500).optional(),
          bodyTemplate: z.string().max(8000).optional(),
        })
        .optional(),
      skipWithoutEmail: z.boolean().optional(),
      dailyLimit: z.number().int().min(1).max(500).optional(),
      agentId: z.string().optional(),
    })
    .optional(),
  startScrape: z.boolean().optional(),
});

const outreachSchema = z.object({
  channel: z.enum(['email', 'whatsapp', 'mcp', 'n8n']).optional(),
  provider: z.string().max(80).optional(),
  template: z
    .object({
      subject: z.string().max(500).optional(),
      bodyTemplate: z.string().max(8000).optional(),
    })
    .optional(),
  skipWithoutEmail: z.boolean().optional(),
  dailyLimit: z.number().int().min(1).max(500).optional(),
  agentId: z.string().optional(),
});

function canStartOutreach(request: Request): boolean {
  const auth = request.auth!;
  if (auth.role === 'owner' || auth.role === 'admin') return true;
  return roleCan(auth.role, 'org_settings') || roleCan(auth.role, 'manage_brain');
}

export function createLeadsRouter(): Router {
  const router = Router();
  router.use(authenticateUser(true));
  // Mutating lead ops require an active trial/subscription.
  router.use((request, response, next) => {
    if (request.method === 'GET' || request.method === 'HEAD') {
      next();
      return;
    }
    void requireSubscriptionAccess(request, response, next);
  });

  router.get('/campaigns', async (request: Request, response: Response) => {
    try {
      const campaigns = await service.listCampaigns(request.auth!.orgId);
      response.json({ campaigns });
    } catch (err) {
      console.error('[leads] list campaigns', err);
      response.status(500).json({ error: { code: 'leads_list_failed', message: 'Failed to list campaigns' } });
    }
  });

  router.post('/campaigns', async (request: Request, response: Response) => {
    const parsed = createCampaignSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid campaign body' } });
      return;
    }
    try {
      const campaign = await service.createCampaign(
        request.auth!.orgId,
        request.auth!.userId,
        parsed.data,
      );
      let result = campaign;
      if (parsed.data.startScrape) {
        result = await service.startScrape({
          orgId: request.auth!.orgId,
          userId: request.auth!.userId,
          campaignId: campaign.id,
        });
      }
      response.status(201).json({ campaign: result });
    } catch (err) {
      console.error('[leads] create campaign', err);
      response.status(500).json({ error: { code: 'leads_create_failed', message: 'Failed to create campaign' } });
    }
  });

  router.get('/campaigns/:id', async (request: Request, response: Response) => {
    try {
      const campaign = await service.getCampaign(request.auth!.orgId, request.params.id);
      response.json({ campaign });
    } catch (err) {
      if (err instanceof LeadCampaignNotFoundError) {
        response.status(404).json({ error: { code: 'not_found', message: err.message } });
        return;
      }
      console.error('[leads] get campaign', err);
      response.status(500).json({ error: { code: 'leads_get_failed', message: 'Failed to get campaign' } });
    }
  });

  router.get('/campaigns/:id/leads', async (request: Request, response: Response) => {
    const includeAll = request.query.include_all === 'true';
    const legacyHasEmail =
      request.query.has_email === 'true' || request.query.hasEmail === 'true';
    const contactableOnly = !includeAll && (legacyHasEmail || request.query.contactable_only === 'true');
    const status = typeof request.query.status === 'string' ? request.query.status : undefined;
    const limit = request.query.limit ? Number(request.query.limit) : 50;
    const offset = request.query.offset ? Number(request.query.offset) : 0;
    try {
      const result = await service.listLeads(request.auth!.orgId, request.params.id, {
        contactableOnly: contactableOnly || undefined,
        status,
        limit: Number.isFinite(limit) ? limit : 50,
        offset: Number.isFinite(offset) ? offset : 0,
      });
      response.json(result);
    } catch (err) {
      if (err instanceof LeadCampaignNotFoundError) {
        response.status(404).json({ error: { code: 'not_found', message: err.message } });
        return;
      }
      console.error('[leads] list leads', err);
      response.status(500).json({ error: { code: 'leads_list_failed', message: 'Failed to list leads' } });
    }
  });

  router.get('/campaigns/:id/export', async (request: Request, response: Response) => {
    try {
      const csv = await service.exportCsv(request.auth!.orgId, request.params.id);
      response.setHeader('Content-Type', 'text/csv; charset=utf-8');
      response.setHeader('Content-Disposition', `attachment; filename="leads-${request.params.id}.csv"`);
      response.send(csv);
    } catch (err) {
      if (err instanceof LeadCampaignNotFoundError) {
        response.status(404).json({ error: { code: 'not_found', message: err.message } });
        return;
      }
      console.error('[leads] export', err);
      response.status(500).json({ error: { code: 'leads_export_failed', message: 'Failed to export leads' } });
    }
  });

  router.post('/campaigns/:id/outreach', async (request: Request, response: Response) => {
    if (!canStartOutreach(request)) {
      response.status(403).json({ error: { code: 'forbidden', message: 'Not allowed to start outreach' } });
      return;
    }
    const parsed = outreachSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid outreach config' } });
      return;
    }
    try {
      const result = await service.startOutreach({
        orgId: request.auth!.orgId,
        userId: request.auth!.userId,
        campaignId: request.params.id,
        outreachConfig: parsed.data,
        agentId: parsed.data.agentId,
      });
      response.json(result);
    } catch (err) {
      if (err instanceof LeadCampaignNotFoundError) {
        response.status(404).json({ error: { code: 'not_found', message: err.message } });
        return;
      }
      console.error('[leads] outreach', err);
      response.status(500).json({ error: { code: 'outreach_failed', message: 'Failed to start outreach' } });
    }
  });

  router.post('/team-template', async (request: Request, response: Response) => {
    if (!canStartOutreach(request)) {
      response.status(403).json({ error: { code: 'forbidden', message: 'Not allowed to create team template' } });
      return;
    }
    try {
      const team = await createLeadGenPipelineTeam({
        orgId: request.auth!.orgId,
        userId: request.auth!.userId,
        backendBaseUrl: resolveDockerBackendUrl(request),
      });
      response.status(201).json({ team });
    } catch (err) {
      console.error('[leads] team template', err);
      response.status(500).json({
        error: { code: 'team_template_failed', message: err instanceof Error ? err.message : 'Failed to create team' },
      });
    }
  });

  return router;
}
