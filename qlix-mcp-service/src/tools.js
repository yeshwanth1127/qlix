import * as qlix from './qlix-client.js';
import { scrapeGmbLeads } from './gmbScraper.js';

function textContent(text) {
  return { content: [{ type: 'text', text: typeof text === 'string' ? text : JSON.stringify(text, null, 2) }] };
}

function scrapeFirstHint() {
  return (
    'No campaign yet. Call gmb_search_leads FIRST with searchQuery, location, and maxResults. ' +
    'Use the campaignId it returns — never invent an id.'
  );
}

function formatLeadToolError(err) {
  const msg = err?.message || String(err);
  if (/campaign not found/i.test(msg)) {
    return scrapeFirstHint();
  }
  return msg;
}

export async function executeTool(name, args, agentId) {
  if (!agentId) {
    return { isError: true, content: [{ type: 'text', text: 'Missing X-Qlix-Agent-Id header' }] };
  }

  let ctx;
  try {
    ctx = await qlix.getAgentContext(agentId);
  } catch (err) {
    return { isError: true, content: [{ type: 'text', text: `Agent context error: ${err.message}` }] };
  }

  const { orgId, userId } = ctx;

  try {
    switch (name) {
      case 'gmb_search_leads': {
        const searchQuery = String(args.searchQuery || args.query || '').trim();
        if (!searchQuery) {
          return { isError: true, content: [{ type: 'text', text: 'searchQuery is required' }] };
        }
        const requireWebsite = args.requireWebsite !== false;
        const created = await qlix.createCampaignFromAgent(agentId, {
          name: args.name,
          searchQuery,
          location: args.location,
          maxResults: args.maxResults,
          requireWebsite,
        });
        const campaign = created.campaign;
        const scrapeResult = await scrapeGmbLeads({
          searchQuery: campaign.searchQuery,
          location: campaign.location,
          maxResults: campaign.maxResults,
          requireWebsite,
        });
        const leads = scrapeResult.leads ?? [];
        const skippedNoWebsite = scrapeResult.skippedNoWebsite ?? 0;
        const completed = await qlix.completeScrape(orgId, campaign.id, leads, false);
        const mockCount = leads.filter((l) => l.raw?.source === 'mock').length;
        const playwrightCount = leads.filter((l) => l.raw?.source === 'playwright').length;
        const needingEnrichment = leads.filter((l) => l.website && !l.email).length;
        const withWebsite = leads.filter((l) => l.website).length;
        return textContent({
          campaignId: completed.campaign.id,
          status: completed.campaign.status,
          stats: completed.campaign.stats,
          contactableLeads: completed.campaign.stats?.withEmail ?? 0,
          withWebsite,
          skippedNoWebsite,
          needsBrowserEnrichment: needingEnrichment,
          dataQuality:
            mockCount > 0
              ? 'MOCK_DATA — scraper was not running real Playwright; do not use for outreach'
              : playwrightCount > 0
                ? 'live_scrape'
                : leads.length === 0
                  ? requireWebsite
                    ? `empty — no businesses with websites found (skipped ${skippedNoWebsite} without website)`
                    : 'empty — scrape returned no businesses (check scraper logs)'
                  : 'unknown',
          requiredNextSteps: [
            '1. list_leads with includeAll=true for this campaignId',
            '2. For EACH lead in needsBrowserEnrichment: browser_ab_open(website) → read /contact → update_lead_email OR record_lead_enrichment(no_email_on_site)',
            '3. list_leads (contactable) then offer outreach only to verified emails',
          ],
          note:
            skippedNoWebsite > 0
              ? `Skipped ${skippedNoWebsite} listings without a valid business website. Only website leads are saved when requireWebsite=true.`
              : 'Homepage scrape emails are unverified until browser enrichment. Do NOT offer outreach until browser_enrich step completes for every website lead.',
          preview: leads.slice(0, 5),
        });
      }

      case 'get_campaign': {
        const campaignId = String(args.campaignId || '').trim();
        if (!campaignId) {
          return { isError: true, content: [{ type: 'text', text: 'campaignId is required' }] };
        }
        const data = await qlix.getCampaign(orgId, campaignId);
        return textContent(data.campaign);
      }

      case 'list_leads': {
        const campaignId = String(args.campaignId || '').trim();
        if (!campaignId) {
          return { isError: true, content: [{ type: 'text', text: 'campaignId is required' }] };
        }
        const includeAll = args.includeAll === true;
        const data = await qlix.listLeads(orgId, campaignId, {
          includeAll,
          limit: args.limit,
          offset: args.offset,
        });
        let needsBrowserEnrichment = [];
        try {
          const pending = await qlix.listLeadsNeedingEnrichment(orgId, campaignId);
          needsBrowserEnrichment = (pending.leads ?? []).map((l) => ({
            leadId: l.id,
            businessName: l.businessName,
            website: l.website,
          }));
        } catch {
          /* ignore */
        }
        const summary = {
          contactableCount: data.leads?.length ?? 0,
          total: data.total ?? 0,
          needsBrowserEnrichment,
          note: includeAll
            ? 'All scraped businesses. Leads in needsBrowserEnrichment MUST be visited with browser_ab_open before outreach.'
            : 'Contactable leads only — verified emails after browser enrichment.',
          leads: data.leads,
        };
        return textContent(summary);
      }

      case 'record_lead_enrichment': {
        const campaignId = String(args.campaignId || '').trim();
        const leadId = String(args.leadId || '').trim();
        const outcome = args.outcome === 'no_email_on_site' ? 'no_email_on_site' : 'email_found';
        const email = args.email ? String(args.email).trim() : undefined;
        if (!campaignId || !leadId) {
          return {
            isError: true,
            content: [{ type: 'text', text: 'campaignId and leadId are required' }],
          };
        }
        if (outcome === 'email_found' && !email) {
          return {
            isError: true,
            content: [{ type: 'text', text: 'email is required when outcome is email_found' }],
          };
        }
        const data = await qlix.recordLeadEnrichment(orgId, campaignId, leadId, outcome, email);
        return textContent({
          lead: data.lead,
          note: 'Browser enrichment recorded for this lead.',
        });
      }

      case 'export_leads': {
        const campaignId = String(args.campaignId || '').trim();
        if (!campaignId) {
          return { isError: true, content: [{ type: 'text', text: 'campaignId is required' }] };
        }
        const data = await qlix.exportLeads(orgId, campaignId);
        return textContent({ csv: data.csv });
      }

      case 'start_outreach': {
        const campaignId = String(args.campaignId || '').trim();
        if (!campaignId) {
          return { isError: true, content: [{ type: 'text', text: 'campaignId is required' }] };
        }
        const data = await qlix.startOutreach(orgId, userId, campaignId, {
          channel: args.channel || 'email',
          provider: args.provider || 'gmail',
          template: {
            subject: args.subject,
            bodyTemplate: args.bodyTemplate,
          },
          dailyLimit: args.dailyLimit,
          agentId,
        });
        return textContent(data);
      }

      case 'update_lead_email': {
        const campaignId = String(args.campaignId || '').trim();
        const leadId = String(args.leadId || '').trim();
        const email = String(args.email || '').trim();
        if (!campaignId || !leadId || !email) {
          return {
            isError: true,
            content: [{ type: 'text', text: 'campaignId, leadId, and email are required' }],
          };
        }
        const data = await qlix.updateLeadEmail(orgId, campaignId, leadId, email);
        return textContent({
          lead: data.lead,
          emailVerified: data.lead?.emailVerified ?? false,
          note: 'Email saved from browser enrichment. Domain must match the lead website.',
        });
      }

      default:
        return { isError: true, content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
    }
  } catch (err) {
    return { isError: true, content: [{ type: 'text', text: formatLeadToolError(err) }] };
  }
}

export const TOOL_CATALOG = [
  {
    name: 'gmb_search_leads',
    description:
      'STEP 1 for new leads: scrape Google Maps / GMB. Creates a campaign and saves businesses. ' +
      'Always call this before get_campaign, list_leads, or start_outreach. ' +
      'Returns campaignId — use it for all follow-up tools.',
    inputSchema: {
      type: 'object',
      properties: {
        searchQuery: { type: 'string', description: 'Business type or keyword to search.' },
        location: { type: 'string', description: 'City, region, or address to search near.' },
        maxResults: { type: 'integer', description: 'Max businesses to extract (1-200).' },
        name: { type: 'string', description: 'Optional campaign name.' },
      },
      required: ['searchQuery'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'get_campaign',
    description:
      'Get campaign status and stats. Requires campaignId from gmb_search_leads — never guess an id.',
    inputSchema: {
      type: 'object',
      properties: { campaignId: { type: 'string' } },
      required: ['campaignId'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'list_leads',
    description:
      'List leads for a campaign. By default returns contactable leads only (verified emails from business websites). Set includeAll=true to include every scraped business.',
    inputSchema: {
      type: 'object',
      properties: {
        campaignId: { type: 'string' },
        includeAll: {
          type: 'boolean',
          description: 'If true, include all scraped businesses even without verified email.',
        },
        limit: { type: 'integer' },
        offset: { type: 'integer' },
      },
      required: ['campaignId'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'export_leads',
    description: 'Export campaign leads as CSV text.',
    inputSchema: {
      type: 'object',
      properties: { campaignId: { type: 'string' } },
      required: ['campaignId'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'start_outreach',
    description:
      'STEP 5 ONLY: begin email outreach after gmb_search_leads, browser enrichment, and user approval. ' +
      'Requires a real campaignId from scrape. Never call on a new lead-gen request before scraping.',
    inputSchema: {
      type: 'object',
      properties: {
        campaignId: { type: 'string' },
        channel: { type: 'string', enum: ['email', 'whatsapp', 'mcp', 'n8n'] },
        provider: { type: 'string' },
        subject: { type: 'string' },
        bodyTemplate: { type: 'string' },
        dailyLimit: { type: 'integer' },
      },
      required: ['campaignId'],
    },
    annotations: { destructiveHint: true },
  },
  {
    name: 'update_lead_email',
    description:
      'Save an email found via browser enrichment on the lead website. Email domain must match the lead website.',
    inputSchema: {
      type: 'object',
      properties: {
        campaignId: { type: 'string', description: 'Lead campaign id.' },
        leadId: { type: 'string', description: 'Lead id from list_leads.' },
        email: { type: 'string', description: 'Email address visible on the business website.' },
      },
      required: ['campaignId', 'leadId', 'email'],
    },
    annotations: { destructiveHint: false },
  },
  {
    name: 'record_lead_enrichment',
    description:
      'Record browser enrichment for a lead after visiting their website. Use outcome=no_email_on_site when no real email exists, or email_found with email when found.',
    inputSchema: {
      type: 'object',
      properties: {
        campaignId: { type: 'string' },
        leadId: { type: 'string' },
        outcome: { type: 'string', enum: ['email_found', 'no_email_on_site'] },
        email: { type: 'string', description: 'Required when outcome is email_found.' },
      },
      required: ['campaignId', 'leadId', 'outcome'],
    },
    annotations: { destructiveHint: false },
  },
];
