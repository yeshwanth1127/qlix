import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { assertInternalServiceSecret } from '../middleware/assertInternalServiceSecret.js';
import { prisma } from '../lib/prisma.js';
import {
  LeadsService,
  LeadCampaignNotFoundError,
  LeadEmailUpdateError,
  LeadEnrichmentRequiredError,
  LeadNotFoundError,
  LeadOutreachNotReadyError,
} from '../leads/leads.service.js';

const service = new LeadsService();

const bulkLeadSchema = z.object({
  businessName: z.string().min(1),
  address: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  website: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  categories: z.array(z.string()).optional(),
  rating: z.number().nullable().optional(),
  reviewCount: z.number().int().nullable().optional(),
  placeId: z.string().nullable().optional(),
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
  socialLinks: z.record(z.string(), z.unknown()).optional(),
  raw: z.record(z.string(), z.unknown()).optional(),
});

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

export function createInternalLeadsRouter(): Router {
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

  router.post('/campaigns', async (request: Request, response: Response) => {
    const parsed = z
      .object({
        orgId: z.string().uuid(),
        userId: z.string().uuid(),
        name: z.string().min(1).max(120),
        searchQuery: z.string().min(1).max(500),
        location: z.string().max(200).optional(),
        maxResults: z.number().int().min(1).max(200).optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid body' } });
      return;
    }
    try {
      const campaign = await service.createCampaign(parsed.data.orgId, parsed.data.userId, parsed.data);
      response.status(201).json({ campaign });
    } catch (err) {
      console.error('[internal/leads] create', err);
      response.status(500).json({ error: { code: 'create_failed', message: 'Failed to create campaign' } });
    }
  });

  router.post('/campaigns/from-agent', async (request: Request, response: Response) => {
    const parsed = z
      .object({
        agentId: z.string().min(1),
        name: z.string().min(1).max(120).optional(),
        searchQuery: z.string().min(1).max(500),
        location: z.string().max(200).optional(),
        maxResults: z.number().int().min(1).max(200).optional(),
        requireWebsite: z.boolean().optional(),
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
      const campaign = await service.createCampaign(ctx.orgId, ctx.userId, {
        name: parsed.data.name ?? `GMB: ${parsed.data.searchQuery.slice(0, 60)}`,
        searchQuery: parsed.data.searchQuery,
        location: parsed.data.location,
        maxResults: parsed.data.maxResults,
        requireWebsite: parsed.data.requireWebsite,
      });
      response.status(201).json({ campaign });
    } catch (err) {
      console.error('[internal/leads] from-agent', err);
      response.status(500).json({ error: { code: 'create_failed', message: 'Failed to create campaign' } });
    }
  });

  router.post('/campaigns/:id/scrape/start', async (request: Request, response: Response) => {
    const parsed = z.object({ orgId: z.string().uuid() }).safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: { code: 'invalid_body', message: 'orgId required' } });
      return;
    }
    try {
      const existing = await service.getCampaign(parsed.data.orgId, request.params.id);
      const campaign = await service.startScrape({
        orgId: parsed.data.orgId,
        userId: existing.createdById,
        campaignId: request.params.id,
      });
      response.json({ campaign });
    } catch (err) {
      if (err instanceof LeadCampaignNotFoundError) {
        response.status(404).json({ error: { code: 'not_found', message: err.message } });
        return;
      }
      response.status(500).json({ error: { code: 'scrape_start_failed', message: 'Failed to start scrape' } });
    }
  });

  router.post('/campaigns/:id/scrape/complete', async (request: Request, response: Response) => {
    const parsed = z
      .object({
        orgId: z.string().uuid(),
        leads: z.array(bulkLeadSchema),
        failed: z.boolean().optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid body' } });
      return;
    }
    try {
      const campaign = await service.completeScrape({
        orgId: parsed.data.orgId,
        campaignId: request.params.id,
        leads: parsed.data.leads,
        failed: parsed.data.failed,
      });
      response.json({ campaign });
    } catch (err) {
      if (err instanceof LeadCampaignNotFoundError) {
        response.status(404).json({ error: { code: 'not_found', message: err.message } });
        return;
      }
      console.error('[internal/leads] complete scrape', err);
      response.status(500).json({ error: { code: 'complete_failed', message: 'Failed to complete scrape' } });
    }
  });

  router.get('/campaigns/:id', async (request: Request, response: Response) => {
    const orgId = typeof request.query.orgId === 'string' ? request.query.orgId : '';
    if (!orgId) {
      response.status(400).json({ error: { code: 'invalid_query', message: 'orgId required' } });
      return;
    }
    try {
      const campaign = await service.getCampaign(orgId, request.params.id);
      response.json({ campaign });
    } catch (err) {
      if (err instanceof LeadCampaignNotFoundError) {
        response.status(404).json({ error: { code: 'not_found', message: err.message } });
        return;
      }
      response.status(500).json({ error: { code: 'get_failed', message: 'Failed to get campaign' } });
    }
  });

  router.get('/campaigns/:id/leads', async (request: Request, response: Response) => {
    const orgId = typeof request.query.orgId === 'string' ? request.query.orgId : '';
    if (!orgId) {
      response.status(400).json({ error: { code: 'invalid_query', message: 'orgId required' } });
      return;
    }
    const includeAll = request.query.include_all === 'true';
    const contactableOnly = !includeAll;
    try {
      const result = await service.listLeads(orgId, request.params.id, {
        contactableOnly,
        limit: Number(request.query.limit) || 100,
        offset: Number(request.query.offset) || 0,
      });
      response.json(result);
    } catch (err) {
      if (err instanceof LeadCampaignNotFoundError) {
        response.status(404).json({ error: { code: 'not_found', message: err.message } });
        return;
      }
      response.status(500).json({ error: { code: 'list_failed', message: 'Failed to list leads' } });
    }
  });

  router.patch('/campaigns/:campaignId/leads/:leadId/email', async (request: Request, response: Response) => {
    const parsed = z
      .object({
        orgId: z.string().uuid(),
        email: z.string().email().max(320),
      })
      .safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: { code: 'invalid_body', message: 'orgId and email required' } });
      return;
    }
    try {
      const lead = await service.updateLeadEmail({
        orgId: parsed.data.orgId,
        campaignId: request.params.campaignId,
        leadId: request.params.leadId,
        email: parsed.data.email,
      });
      response.json({ lead });
    } catch (err) {
      if (err instanceof LeadNotFoundError) {
        response.status(404).json({ error: { code: 'not_found', message: err.message } });
        return;
      }
      if (err instanceof LeadEmailUpdateError) {
        response.status(400).json({ error: { code: err.code, message: err.message } });
        return;
      }
      if (err instanceof LeadCampaignNotFoundError) {
        response.status(404).json({ error: { code: 'not_found', message: err.message } });
        return;
      }
      console.error('[internal/leads] update email', err);
      response.status(500).json({ error: { code: 'update_failed', message: 'Failed to update lead email' } });
    }
  });

  router.patch('/campaigns/:campaignId/leads/:leadId/enrichment', async (request: Request, response: Response) => {
    const parsed = z
      .object({
        orgId: z.string().uuid(),
        outcome: z.enum(['email_found', 'no_email_on_site']),
        email: z.string().email().max(320).optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid enrichment body' } });
      return;
    }
    try {
      const lead = await service.markLeadBrowserEnrichment({
        orgId: parsed.data.orgId,
        campaignId: request.params.campaignId,
        leadId: request.params.leadId,
        outcome: parsed.data.outcome,
        email: parsed.data.email,
      });
      response.json({ lead });
    } catch (err) {
      if (err instanceof LeadNotFoundError) {
        response.status(404).json({ error: { code: 'not_found', message: err.message } });
        return;
      }
      if (err instanceof LeadEmailUpdateError) {
        response.status(400).json({ error: { code: err.code, message: err.message } });
        return;
      }
      if (err instanceof LeadCampaignNotFoundError) {
        response.status(404).json({ error: { code: 'not_found', message: err.message } });
        return;
      }
      console.error('[internal/leads] record enrichment', err);
      response.status(500).json({ error: { code: 'enrichment_failed', message: 'Failed to record enrichment' } });
    }
  });

  router.get('/campaigns/:id/leads/needing-enrichment', async (request: Request, response: Response) => {
    const orgId = typeof request.query.orgId === 'string' ? request.query.orgId : '';
    if (!orgId) {
      response.status(400).json({ error: { code: 'invalid_query', message: 'orgId required' } });
      return;
    }
    try {
      const leads = await service.listLeadsNeedingBrowserEnrichment(orgId, request.params.id);
      response.json({ leads, count: leads.length });
    } catch (err) {
      if (err instanceof LeadCampaignNotFoundError) {
        response.status(404).json({ error: { code: 'not_found', message: err.message } });
        return;
      }
      response.status(500).json({ error: { code: 'list_failed', message: 'Failed to list leads' } });
    }
  });

  router.get('/campaigns/:id/export', async (request: Request, response: Response) => {
    const orgId = typeof request.query.orgId === 'string' ? request.query.orgId : '';
    if (!orgId) {
      response.status(400).json({ error: { code: 'invalid_query', message: 'orgId required' } });
      return;
    }
    try {
      const csv = await service.exportCsv(orgId, request.params.id);
      response.json({ csv });
    } catch (err) {
      if (err instanceof LeadCampaignNotFoundError) {
        response.status(404).json({ error: { code: 'not_found', message: err.message } });
        return;
      }
      response.status(500).json({ error: { code: 'export_failed', message: 'Failed to export' } });
    }
  });

  router.post('/campaigns/:id/outreach', async (request: Request, response: Response) => {
    const parsed = z
      .object({
        orgId: z.string().uuid(),
        userId: z.string().uuid(),
        channel: z.enum(['email', 'whatsapp', 'mcp', 'n8n']).optional(),
        provider: z.string().optional(),
        template: z
          .object({
            subject: z.string().optional(),
            bodyTemplate: z.string().optional(),
          })
          .optional(),
        agentId: z.string().optional(),
        dailyLimit: z.number().int().optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid body' } });
      return;
    }
    try {
      const result = await service.startOutreach({
        orgId: parsed.data.orgId,
        userId: parsed.data.userId,
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
      if (err instanceof LeadOutreachNotReadyError) {
        response.status(400).json({ error: { code: err.code, message: err.message } });
        return;
      }
      if (err instanceof LeadEnrichmentRequiredError) {
        response.status(400).json({ error: { code: err.code, message: err.message } });
        return;
      }
      response.status(500).json({ error: { code: 'outreach_failed', message: 'Failed to start outreach' } });
    }
  });

  return router;
}
