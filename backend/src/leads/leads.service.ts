import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { enqueueAgentRun, ensureTeamConversation } from '../agentChat/agentRunService.js';
import { LeadsRepository } from './leads.repository.js';
import { isCampaignOutreachApproved } from './leadOutreachGate.js';
import {
  emailDomainMatchesWebsite,
  isPlaceholderEmail,
} from './leadEmailTrust.js';
import type {
  BulkLeadInput,
  CreateLeadCampaignInput,
  LeadCampaignDTO,
  LeadDTO,
  OutreachConfig,
} from './leads.types.js';

const MCP_LEADS_SCRAPE_URL = () => {
  const explicit = process.env.QLIX_MCP_SCRAPE_URL?.trim() || process.env.QLIX_MCP_LEADS_SCRAPE_URL?.trim();
  if (explicit) return explicit;
  const mcp =
    process.env.QLIX_MCP_URL?.trim()?.replace(/\/mcp\/?$/, '') ||
    process.env.QLIX_MCP_LEADS_URL?.trim()?.replace(/\/mcp\/?$/, '');
  if (mcp) return mcp;
  return 'http://127.0.0.1:3940';
};

async function triggerMcpScrape(campaignId: string, orgId: string): Promise<void> {
  const secret = process.env.QLIX_INTERNAL_SERVICE_SECRET?.trim();
  if (!secret) return;
  const base = MCP_LEADS_SCRAPE_URL();
  try {
    await fetch(`${base}/scrape`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Service-Secret': secret,
      },
      body: JSON.stringify({ campaignId, orgId }),
    });
  } catch (err) {
    console.error('[leads] trigger scrape failed', err);
  }
}

export class LeadCampaignNotFoundError extends Error {
  readonly code = 'not_found';
}

export class LeadNotFoundError extends Error {
  readonly code = 'not_found';
}

export class LeadEmailUpdateError extends Error {
  readonly code = 'invalid_email';
}

export class LeadEnrichmentRequiredError extends Error {
  readonly code = 'enrichment_required';
  constructor(
    public readonly pendingCount: number,
    message?: string,
  ) {
    super(
      message ??
        `Browser enrichment required for ${pendingCount} lead(s) with websites before outreach`,
    );
  }
}

export class LeadOutreachNotReadyError extends Error {
  readonly code = 'outreach_not_ready';
}

export class LeadsService {
  private readonly repo = new LeadsRepository();

  async createCampaign(
    orgId: string,
    userId: string,
    input: CreateLeadCampaignInput,
  ): Promise<LeadCampaignDTO> {
    return this.repo.createCampaign(orgId, userId, input);
  }

  async getCampaign(orgId: string, id: string): Promise<LeadCampaignDTO> {
    const row = await this.repo.getCampaign(orgId, id);
    if (!row) throw new LeadCampaignNotFoundError('Campaign not found');
    return row;
  }

  async listCampaigns(orgId: string): Promise<LeadCampaignDTO[]> {
    return this.repo.listCampaigns(orgId);
  }

  async startScrape(params: {
    orgId: string;
    userId: string;
    campaignId: string;
    scrapeJobId?: string;
  }): Promise<LeadCampaignDTO> {
    const jobId = params.scrapeJobId ?? randomUUID();
    const updated = await this.repo.updateCampaign(params.orgId, params.campaignId, {
      status: 'scraping',
      scrapeJobId: jobId,
    });
    if (!updated) throw new LeadCampaignNotFoundError('Campaign not found');
    void triggerMcpScrape(params.campaignId, params.orgId);
    return updated;
  }

  async completeScrape(params: {
    orgId: string;
    campaignId: string;
    leads: BulkLeadInput[];
    failed?: boolean;
  }): Promise<LeadCampaignDTO> {
    const campaign = await this.repo.getCampaign(params.orgId, params.campaignId);
    if (!campaign) throw new LeadCampaignNotFoundError('Campaign not found');

    if (!params.failed && params.leads.length > 0) {
      const cfg = campaign.outreachConfig as Record<string, unknown> | null;
      const requireWebsite = cfg?.requireWebsite !== false;
      const toInsert = requireWebsite
        ? params.leads.filter((l) => l.website?.trim())
        : params.leads;
      await this.repo.bulkInsertLeads(params.campaignId, params.orgId, toInsert);
    }
    const stats = await this.repo.recomputeStats(params.orgId, params.campaignId);
    const updated = await this.repo.updateCampaign(params.orgId, params.campaignId, {
      status: params.failed ? 'failed' : 'ready',
      stats,
    });
    if (!updated) throw new LeadCampaignNotFoundError('Campaign not found');
    return updated;
  }

  async listLeads(
    orgId: string,
    campaignId: string,
    opts: {
      contactableOnly?: boolean;
      hasEmail?: boolean;
      status?: string;
      limit?: number;
      offset?: number;
    },
  ) {
    await this.getCampaign(orgId, campaignId);
    return this.repo.listLeads({ orgId, campaignId, ...opts });
  }

  /** Verified emails safe for outreach (default for agents). */
  async listContactableLeads(orgId: string, campaignId: string, limit = 100) {
    return this.listLeads(orgId, campaignId, { contactableOnly: true, limit });
  }

  /**
   * Persist an email found by agent-browser enrichment on the lead's website.
   * Domain must match the lead website to prevent hallucinated addresses.
   */
  async updateLeadEmail(params: {
    orgId: string;
    campaignId: string;
    leadId: string;
    email: string;
  }): Promise<LeadDTO> {
    await this.getCampaign(params.orgId, params.campaignId);
    const email = params.email.trim().toLowerCase();
    if (!email || isPlaceholderEmail(email)) {
      throw new LeadEmailUpdateError('Invalid or placeholder email address');
    }
    const lead = await this.repo.getLead(params.orgId, params.campaignId, params.leadId);
    if (!lead) throw new LeadNotFoundError('Lead not found');
    if (!lead.website?.trim()) {
      throw new LeadEmailUpdateError('Lead has no website — cannot verify browser-enriched email');
    }
    if (!emailDomainMatchesWebsite(email, lead.website)) {
      throw new LeadEmailUpdateError('Email domain does not match lead website');
    }
    const updated = await this.repo.updateLeadEmail({
      orgId: params.orgId,
      campaignId: params.campaignId,
      leadId: params.leadId,
      email,
      raw: {
        emailSource: 'browser_enrich',
        website: lead.website,
        browserEnrichAttemptedAt: new Date().toISOString(),
        browserEnrichOutcome: 'email_found',
      },
    });
    if (!updated) throw new LeadNotFoundError('Lead not found');
    await this.repo.recomputeStats(params.orgId, params.campaignId);
    return updated;
  }

  async listLeadsNeedingBrowserEnrichment(orgId: string, campaignId: string): Promise<LeadDTO[]> {
    await this.getCampaign(orgId, campaignId);
    return this.repo.listLeadsNeedingBrowserEnrichment(orgId, campaignId);
  }

  async resolveCampaignIdFromRecipients(orgId: string, recipients: string[]): Promise<string | null> {
    for (const email of recipients) {
      const leads = await this.repo.findLeadsByEmail(orgId, email);
      const withCampaign = leads.find((l) => l.emailVerified);
      if (withCampaign) return withCampaign.campaignId;
      if (leads[0]) return leads[0].campaignId;
    }
    return null;
  }

  async assertBrowserEnrichmentComplete(orgId: string, campaignId: string): Promise<void> {
    const pending = await this.listLeadsNeedingBrowserEnrichment(orgId, campaignId);
    if (pending.length > 0) {
      throw new LeadEnrichmentRequiredError(
        pending.length,
        `Browser enrichment required: ${pending.length} lead(s) with websites still need ` +
          `browser_ab_open + update_lead_email or record_lead_enrichment. ` +
          `Call list_leads with includeAll=true to see needsBrowserEnrichment.`,
      );
    }
  }

  async markLeadBrowserEnrichment(params: {
    orgId: string;
    campaignId: string;
    leadId: string;
    outcome: 'email_found' | 'no_email_on_site';
    email?: string | null;
  }): Promise<LeadDTO> {
    await this.getCampaign(params.orgId, params.campaignId);
    if (params.outcome === 'email_found') {
      const email = params.email?.trim().toLowerCase();
      if (!email || isPlaceholderEmail(email)) {
        throw new LeadEmailUpdateError('Valid email required when outcome is email_found');
      }
      const lead = await this.repo.getLead(params.orgId, params.campaignId, params.leadId);
      if (!lead) throw new LeadNotFoundError('Lead not found');
      if (!lead.website?.trim()) {
        throw new LeadEmailUpdateError('Lead has no website');
      }
      if (!emailDomainMatchesWebsite(email, lead.website)) {
        throw new LeadEmailUpdateError('Email domain does not match lead website');
      }
    }
    const updated = await this.repo.markLeadBrowserEnrichment(params);
    if (!updated) throw new LeadNotFoundError('Lead not found');
    await this.repo.recomputeStats(params.orgId, params.campaignId);
    return updated;
  }

  /**
   * True when `email` belongs to a real, verified lead in this org — i.e. it was
   * scraped from a business (not invented by the agent). Used to gate outreach sends.
   */
  async isVerifiedLeadRecipient(orgId: string, email: string): Promise<boolean> {
    const leads = await this.repo.findLeadsByEmail(orgId, email);
    return leads.some((l) => l.emailVerified);
  }

  async exportCsv(orgId: string, campaignId: string): Promise<string> {
    await this.getCampaign(orgId, campaignId);
    return this.repo.exportLeadsCsv(orgId, campaignId);
  }

  async startOutreach(params: {
    orgId: string;
    userId: string;
    campaignId: string;
    outreachConfig: OutreachConfig;
    agentId?: string;
  }): Promise<{ campaign: LeadCampaignDTO; runId: string | null }> {
    const campaign = await this.getCampaign(params.orgId, params.campaignId);
    if (campaign.stats.totalLeads === 0) {
      throw new LeadOutreachNotReadyError(
        'No leads in this campaign. Call gmb_search_leads first with searchQuery, location, and maxResults.',
      );
    }
    // User approval in the Team Run UI supersedes the enrichment-complete requirement —
    // the user reviewed the lead table (incl. "needs enrichment" rows) and chose to proceed.
    if (!(await isCampaignOutreachApproved(params.campaignId))) {
      await this.assertBrowserEnrichmentComplete(params.orgId, params.campaignId);
    }
    const mergedConfig: OutreachConfig = {
      ...campaign.outreachConfig,
      ...params.outreachConfig,
    };

    let runId: string | null = null;
    const agentId = params.agentId ?? mergedConfig.agentId;

    if (agentId) {
      const agent = await prisma.agent.findFirst({
        where: { id: agentId, orgId: params.orgId },
        select: { id: true, userId: true, orgId: true },
      });
      if (agent) {
        const conversationId = await ensureTeamConversation({
          agentId: agent.id,
          userId: params.userId,
          orgId: params.orgId,
          teamId: `leads-${params.campaignId}`,
        });
        const channel = mergedConfig.channel ?? 'email';
        const provider = mergedConfig.provider ?? 'gmail';
        const contactable = await this.listContactableLeads(
          params.orgId,
          params.campaignId,
          mergedConfig.dailyLimit ?? 50,
        );
        const leadLines =
          contactable.leads.length > 0
            ? contactable.leads
                .map(
                  (l) =>
                    `- leadId=${l.id} | ${l.businessName} | ${l.email} | ${l.website ?? 'no website'}`,
                )
                .join('\n')
            : '(none — no verified emails found on business websites yet)';

        const prompt = [
          `You are running outreach for lead campaign "${campaign.name}" (id: ${campaign.id}).`,
          `Channel: ${channel}, provider: ${provider}.`,
          `Use ONLY the contactable leads below. Never invent or guess email addresses.`,
          `Contactable leads:\n${leadLines}`,
          `To refresh the list, call mcp.qlix-leads.list_leads with campaignId "${campaign.id}" (contactable leads are returned by default).`,
          `Personalize each message using business name and details.`,
          channel === 'email'
            ? 'Send via email_send for each lead listed above. Include metadata campaignId and leadId on every send.'
            : `Use the configured ${provider} integration.`,
          mergedConfig.template?.subject
            ? `Subject template: ${mergedConfig.template.subject}`
            : '',
          mergedConfig.template?.bodyTemplate
            ? `Body template: ${mergedConfig.template.bodyTemplate}`
            : '',
          `Daily limit: ${mergedConfig.dailyLimit ?? 50}. Skip leads without email if skipWithoutEmail is true.`,
        ]
          .filter(Boolean)
          .join('\n');

        const enqueued = await enqueueAgentRun({
          agentId: agent.id,
          conversationId,
          userId: params.userId,
          orgId: params.orgId,
          prompt,
        });
        runId = enqueued.runId;
      }
    }

    const updated = await this.repo.updateCampaign(params.orgId, params.campaignId, {
      status: 'outreach',
      outreachConfig: mergedConfig,
      agentRunId: runId,
    });
    if (!updated) throw new LeadCampaignNotFoundError('Campaign not found');
    return { campaign: updated, runId };
  }

  async recordOutreachFromEmail(params: {
    campaignId: string;
    leadId: string;
    channel: string;
    provider: string;
    status: string;
    subject?: string;
    bodyPreview?: string;
    actionLogId?: string;
    error?: string;
  }) {
    return this.repo.upsertOutreach(params);
  }
}
