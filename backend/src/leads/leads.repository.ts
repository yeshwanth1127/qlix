import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import type {
  BulkLeadInput,
  CreateLeadCampaignInput,
  LeadCampaignDTO,
  LeadCampaignStats,
  LeadDTO,
  LeadOutreachDTO,
  OutreachConfig,
} from './leads.types.js';
import { isTrustworthyLeadEmail, sanitizeBulkLeads } from './leadEmailTrust.js';

function defaultStats(): LeadCampaignStats {
  return { totalLeads: 0, withEmail: 0, contacted: 0, failed: 0 };
}

function parseStats(raw: unknown): LeadCampaignStats {
  if (!raw || typeof raw !== 'object') return defaultStats();
  const s = raw as Record<string, unknown>;
  return {
    totalLeads: Number(s.totalLeads ?? 0),
    withEmail: Number(s.withEmail ?? 0),
    contacted: Number(s.contacted ?? 0),
    failed: Number(s.failed ?? 0),
  };
}

function toCampaignDto(row: {
  id: string;
  orgId: string;
  createdById: string;
  name: string;
  status: string;
  searchQuery: string;
  location: string | null;
  maxResults: number;
  outreachConfig: unknown;
  agentRunId: string | null;
  scrapeJobId: string | null;
  stats: unknown;
  createdAt: Date;
  updatedAt: Date;
}): LeadCampaignDTO {
  return {
    id: row.id,
    orgId: row.orgId,
    createdById: row.createdById,
    name: row.name,
    status: row.status as LeadCampaignDTO['status'],
    searchQuery: row.searchQuery,
    location: row.location,
    maxResults: row.maxResults,
    outreachConfig: (row.outreachConfig ?? {}) as OutreachConfig,
    agentRunId: row.agentRunId,
    scrapeJobId: row.scrapeJobId,
    stats: parseStats(row.stats),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toLeadDto(row: {
  id: string;
  campaignId: string;
  orgId: string;
  businessName: string;
  address: string | null;
  phone: string | null;
  website: string | null;
  email: string | null;
  categories: string[];
  rating: number | null;
  reviewCount: number | null;
  placeId: string | null;
  lat: number | null;
  lng: number | null;
  socialLinks: unknown;
  raw?: unknown;
  status: string;
  createdAt: Date;
}): LeadDTO {
  const raw = (row.raw ?? {}) as Record<string, unknown>;
  const emailSource = typeof raw.emailSource === 'string' ? raw.emailSource : null;
  const emailVerified = isTrustworthyLeadEmail(row.email, raw, row.website);
  return {
    id: row.id,
    campaignId: row.campaignId,
    orgId: row.orgId,
    businessName: row.businessName,
    address: row.address,
    phone: row.phone,
    website: row.website,
    email: row.email,
    categories: row.categories,
    rating: row.rating,
    reviewCount: row.reviewCount,
    placeId: row.placeId,
    lat: row.lat,
    lng: row.lng,
    socialLinks: (row.socialLinks ?? {}) as Record<string, unknown>,
    status: row.status as LeadDTO['status'],
    emailSource,
    emailVerified,
    createdAt: row.createdAt.toISOString(),
  };
}

export class LeadsRepository {
  async createCampaign(
    orgId: string,
    createdById: string,
    input: CreateLeadCampaignInput,
  ): Promise<LeadCampaignDTO> {
    const row = await prisma.leadCampaign.create({
      data: {
        orgId,
        createdById,
        name: input.name,
        searchQuery: input.searchQuery,
        location: input.location ?? null,
        maxResults: input.maxResults ?? 25,
        outreachConfig: {
          ...(input.outreachConfig ?? {}),
          requireWebsite: input.requireWebsite !== false,
        } as Prisma.InputJsonValue,
        status: 'draft',
        stats: defaultStats() as unknown as Prisma.InputJsonValue,
      },
    });
    return toCampaignDto(row);
  }

  async getCampaign(orgId: string, id: string): Promise<LeadCampaignDTO | null> {
    const row = await prisma.leadCampaign.findFirst({ where: { id, orgId } });
    return row ? toCampaignDto(row) : null;
  }

  async listCampaigns(orgId: string, limit = 50): Promise<LeadCampaignDTO[]> {
    const rows = await prisma.leadCampaign.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map(toCampaignDto);
  }

  /** Latest campaign created during a team run window (fallback when worker JSON omits campaignId). */
  async findLatestCampaignSince(orgId: string, since: Date): Promise<string | null> {
    const row = await prisma.leadCampaign.findFirst({
      where: { orgId, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    return row?.id ?? null;
  }

  async updateCampaign(
    orgId: string,
    id: string,
    patch: Partial<{
      status: string;
      scrapeJobId: string | null;
      agentRunId: string | null;
      stats: LeadCampaignStats;
      outreachConfig: OutreachConfig;
    }>,
  ): Promise<LeadCampaignDTO | null> {
    const existing = await prisma.leadCampaign.findFirst({ where: { id, orgId } });
    if (!existing) return null;
    const row = await prisma.leadCampaign.update({
      where: { id },
      data: {
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.scrapeJobId !== undefined ? { scrapeJobId: patch.scrapeJobId } : {}),
        ...(patch.agentRunId !== undefined ? { agentRunId: patch.agentRunId } : {}),
        ...(patch.stats !== undefined
          ? { stats: patch.stats as unknown as Prisma.InputJsonValue }
          : {}),
        ...(patch.outreachConfig !== undefined
          ? { outreachConfig: patch.outreachConfig as Prisma.InputJsonValue }
          : {}),
      },
    });
    return toCampaignDto(row);
  }

  async bulkInsertLeads(
    campaignId: string,
    orgId: string,
    leads: BulkLeadInput[],
  ): Promise<number> {
    if (leads.length === 0) return 0;
    const clean = sanitizeBulkLeads(leads);
    const result = await prisma.lead.createMany({
      data: clean.map((l) => ({
        campaignId,
        orgId,
        businessName: l.businessName,
        address: l.address ?? null,
        phone: l.phone ?? null,
        website: l.website ?? null,
        email: l.email ?? null,
        categories: l.categories ?? [],
        rating: l.rating ?? null,
        reviewCount: l.reviewCount ?? null,
        placeId: l.placeId ?? null,
        lat: l.lat ?? null,
        lng: l.lng ?? null,
        socialLinks: (l.socialLinks ?? {}) as Prisma.InputJsonValue,
        raw: (l.raw ?? {}) as Prisma.InputJsonValue,
        status: isTrustworthyLeadEmail(l.email, l.raw as Record<string, unknown>)
          ? 'scraped'
          : 'no_email',
      })),
      skipDuplicates: true,
    });
    return result.count;
  }

  async recomputeStats(orgId: string, campaignId: string): Promise<LeadCampaignStats> {
    const rows = await prisma.lead.findMany({
      where: { campaignId, orgId },
      select: { email: true, raw: true },
    });
    const totalLeads = rows.length;
    const withEmail = rows.filter((r) =>
      isTrustworthyLeadEmail(r.email, r.raw as Record<string, unknown>),
    ).length;
    const [contacted, failed] = await Promise.all([
      prisma.leadOutreach.count({ where: { campaignId, status: 'sent' } }),
      prisma.leadOutreach.count({ where: { campaignId, status: 'failed' } }),
    ]);
    const stats: LeadCampaignStats = { totalLeads, withEmail, contacted, failed };
    await prisma.leadCampaign.update({
      where: { id: campaignId },
      data: { stats: stats as unknown as Prisma.InputJsonValue },
    });
    return stats;
  }

  async listLeads(params: {
    orgId: string;
    campaignId: string;
    /** Verified outreach-ready emails only (from business websites). */
    contactableOnly?: boolean;
    /** @deprecated use contactableOnly */
    hasEmail?: boolean;
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ leads: LeadDTO[]; total: number }> {
    const contactableOnly = params.contactableOnly ?? params.hasEmail ?? false;
    const where: Prisma.LeadWhereInput = {
      orgId: params.orgId,
      campaignId: params.campaignId,
      ...(params.status ? { status: params.status } : {}),
      ...(contactableOnly ? { email: { not: null } } : {}),
    };
    const [rows, totalRaw] = await Promise.all([
      prisma.lead.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: contactableOnly ? (params.limit ?? 50) * 3 : (params.limit ?? 50),
        skip: params.offset ?? 0,
      }),
      prisma.lead.count({ where }),
    ]);
    let leads = rows.map(toLeadDto);
    if (contactableOnly) {
      leads = leads.filter((l) => l.emailVerified);
      leads = leads.slice(0, params.limit ?? 50);
    }
    const total = contactableOnly ? leads.length : totalRaw;
    return { leads, total };
  }

  async exportLeadsCsv(orgId: string, campaignId: string): Promise<string> {
    const rows = await prisma.lead.findMany({
      where: { orgId, campaignId },
      orderBy: { createdAt: 'asc' },
    });
    const header =
      'business_name,email,phone,website,address,rating,review_count,place_id,status';
    const lines = rows.map((r) => {
      const esc = (v: string | null | undefined) => {
        const s = String(v ?? '').replace(/"/g, '""');
        return `"${s}"`;
      };
      return [
        esc(r.businessName),
        esc(r.email),
        esc(r.phone),
        esc(r.website),
        esc(r.address),
        r.rating ?? '',
        r.reviewCount ?? '',
        esc(r.placeId),
        esc(r.status),
      ].join(',');
    });
    return [header, ...lines].join('\n');
  }

  /**
   * Look up leads in an org by exact email (case-insensitive). Used to verify that
   * an outreach recipient is a real scraped lead, not an address the agent invented.
   */
  async getLead(orgId: string, campaignId: string, leadId: string): Promise<LeadDTO | null> {
    const row = await prisma.lead.findFirst({
      where: { id: leadId, orgId, campaignId },
    });
    return row ? toLeadDto(row) : null;
  }

  async updateLeadEmail(params: {
    orgId: string;
    campaignId: string;
    leadId: string;
    email: string;
    raw: Record<string, unknown>;
  }): Promise<LeadDTO | null> {
    const existing = await prisma.lead.findFirst({
      where: { id: params.leadId, orgId: params.orgId, campaignId: params.campaignId },
    });
    if (!existing) return null;
    const mergedRaw = { ...(existing.raw as Record<string, unknown>), ...params.raw };
    const status = isTrustworthyLeadEmail(params.email, mergedRaw, existing.website)
      ? 'scraped'
      : 'no_email';
    const row = await prisma.lead.update({
      where: { id: params.leadId },
      data: {
        email: params.email,
        raw: mergedRaw as Prisma.InputJsonValue,
        status,
      },
    });
    return toLeadDto(row);
  }

  /** Leads with a website but no verified email and no browser enrichment attempt yet. */
  async listLeadsNeedingBrowserEnrichment(
    orgId: string,
    campaignId: string,
  ): Promise<LeadDTO[]> {
    const rows = await prisma.lead.findMany({
      where: { orgId, campaignId, website: { not: null } },
      orderBy: { createdAt: 'asc' },
    });
    return rows
      .filter((row) => {
        const raw = (row.raw ?? {}) as Record<string, unknown>;
        if (raw.browserEnrichAttemptedAt) return false;
        return isTrustworthyLeadEmail(row.email, raw, row.website) === false;
      })
      .map(toLeadDto);
  }

  /** Clear browser enrichment flags so agents can revisit websites on retry. */
  async resetBrowserEnrichmentAttempts(orgId: string, campaignId: string): Promise<number> {
    const rows = await prisma.lead.findMany({
      where: { orgId, campaignId, website: { not: null } },
    });
    let reset = 0;
    for (const row of rows) {
      const raw = { ...((row.raw ?? {}) as Record<string, unknown>) };
      if (isTrustworthyLeadEmail(row.email, raw, row.website)) continue;
      delete raw.browserEnrichAttemptedAt;
      delete raw.browserEnrichOutcome;
      await prisma.lead.update({
        where: { id: row.id },
        data: { raw: raw as Prisma.InputJsonValue },
      });
      reset += 1;
    }
    if (reset > 0) {
      await this.recomputeStats(orgId, campaignId);
    }
    return reset;
  }

  async markLeadBrowserEnrichment(params: {
    orgId: string;
    campaignId: string;
    leadId: string;
    outcome: 'email_found' | 'no_email_on_site';
    email?: string | null;
  }): Promise<LeadDTO | null> {
    const existing = await prisma.lead.findFirst({
      where: { id: params.leadId, orgId: params.orgId, campaignId: params.campaignId },
    });
    if (!existing) return null;
    const mergedRaw: Record<string, unknown> = {
      ...(existing.raw as Record<string, unknown>),
      browserEnrichAttemptedAt: new Date().toISOString(),
      browserEnrichOutcome: params.outcome,
    };
    let email = existing.email;
    if (params.outcome === 'email_found' && params.email?.trim()) {
      email = params.email.trim().toLowerCase();
      mergedRaw.emailSource = 'browser_enrich';
      mergedRaw.website = existing.website;
    }
    const status = isTrustworthyLeadEmail(email, mergedRaw, existing.website)
      ? 'scraped'
      : 'no_email';
    const row = await prisma.lead.update({
      where: { id: params.leadId },
      data: {
        email,
        raw: mergedRaw as Prisma.InputJsonValue,
        status,
      },
    });
    return toLeadDto(row);
  }

  async findLeadsByEmail(orgId: string, email: string): Promise<LeadDTO[]> {
    const rows = await prisma.lead.findMany({
      where: { orgId, email: { equals: email.trim(), mode: 'insensitive' } },
    });
    return rows.map(toLeadDto);
  }

  async upsertOutreach(input: {
    campaignId: string;
    leadId: string;
    channel: string;
    provider: string;
    status: string;
    subject?: string | null;
    bodyPreview?: string | null;
    actionLogId?: string | null;
    error?: string | null;
  }): Promise<LeadOutreachDTO> {
    const existing = await prisma.leadOutreach.findFirst({
      where: { campaignId: input.campaignId, leadId: input.leadId, channel: input.channel },
    });
    const row = existing
      ? await prisma.leadOutreach.update({
          where: { id: existing.id },
          data: {
            status: input.status,
            provider: input.provider,
            subject: input.subject ?? null,
            bodyPreview: input.bodyPreview ?? null,
            actionLogId: input.actionLogId ?? null,
            error: input.error ?? null,
            sentAt: input.status === 'sent' ? new Date() : existing.sentAt,
          },
        })
      : await prisma.leadOutreach.create({
          data: {
            campaignId: input.campaignId,
            leadId: input.leadId,
            channel: input.channel,
            provider: input.provider,
            status: input.status,
            subject: input.subject ?? null,
            bodyPreview: input.bodyPreview ?? null,
            actionLogId: input.actionLogId ?? null,
            error: input.error ?? null,
            sentAt: input.status === 'sent' ? new Date() : null,
          },
        });
    return {
      id: row.id,
      campaignId: row.campaignId,
      leadId: row.leadId,
      channel: row.channel,
      provider: row.provider,
      status: row.status,
      subject: row.subject,
      bodyPreview: row.bodyPreview,
      actionLogId: row.actionLogId,
      sentAt: row.sentAt ? row.sentAt.toISOString() : null,
      error: row.error,
    };
  }
}
