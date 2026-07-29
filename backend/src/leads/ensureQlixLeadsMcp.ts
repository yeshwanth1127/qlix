/**
 * Ensures the first-party qlix-leads MCP server is registered for every org on boot.
 */
import { prisma } from '../lib/prisma.js';
import type { Prisma } from '@prisma/client';
import { encryptForAgentSecrets } from '../cloudRunners/agentSecrets.js';
import { mcpService } from '../mcp/mcp.service.js';
import { computeDefinitionHash, deriveGovernance, deriveRiskLevel } from '../mcp/mcp.governance.js';
import type { DiscoveredTool } from '../mcp/mcp.types.js';

const QLIX_LEADS_SLUG = 'qlix-leads';

const BUILTIN_TOOLS: DiscoveredTool[] = [
  {
    name: 'gmb_search_leads',
    description:
      'STEP 1 for new leads: scrape Google Maps / GMB. Creates a campaign and saves businesses. ' +
      'Always call this before get_campaign, list_leads, or start_outreach. Returns campaignId.',
    inputSchema: {
      type: 'object',
      properties: {
        searchQuery: { type: 'string', description: 'Business type or keyword to search.' },
        location: { type: 'string', description: 'City, region, or address to search near.' },
        maxResults: { type: 'integer', description: 'Max businesses to extract (1-200).' },
        requireWebsite: {
          type: 'boolean',
          description: 'Only save leads with a business website (default true). Skips GMB listings without a website.',
        },
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
      properties: {
        campaignId: { type: 'string', description: 'Lead campaign id.' },
      },
      required: ['campaignId'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'list_leads',
    description:
      'List leads for a campaign. Defaults to contactable leads (verified emails). Set includeAll=true for every scraped business.',
    inputSchema: {
      type: 'object',
      properties: {
        campaignId: { type: 'string', description: 'Lead campaign id.' },
        includeAll: {
          type: 'boolean',
          description: 'Include businesses without a verified email.',
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
      properties: {
        campaignId: { type: 'string' },
      },
      required: ['campaignId'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'start_outreach',
    description:
      'STEP 5 ONLY: begin outreach after gmb_search_leads, browser enrichment, and user approval. ' +
      'Requires a real campaignId from scrape.',
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
      'Save an email found via agent-browser on the lead website. Domain must match the lead website.',
    inputSchema: {
      type: 'object',
      properties: {
        campaignId: { type: 'string', description: 'Lead campaign id.' },
        leadId: { type: 'string', description: 'Lead id from list_leads.' },
        email: { type: 'string', description: 'Email visible on the business website.' },
      },
      required: ['campaignId', 'leadId', 'email'],
    },
    annotations: { destructiveHint: false },
  },
  {
    name: 'record_lead_enrichment',
    description:
      'After browser_ab_open on a lead website: record no_email_on_site or email_found. Required before outreach.',
    inputSchema: {
      type: 'object',
      properties: {
        campaignId: { type: 'string' },
        leadId: { type: 'string' },
        outcome: { type: 'string', enum: ['email_found', 'no_email_on_site'] },
        email: { type: 'string' },
      },
      required: ['campaignId', 'leadId', 'outcome'],
    },
    annotations: { destructiveHint: false },
  },
];

export async function ensureQlixLeadsMcpForOrg(orgId: string, ownerUserId: string): Promise<void> {
  const endpointUrl =
    process.env.QLIX_MCP_URL?.trim() ||
    process.env.QLIX_MCP_LEADS_URL?.trim() ||
    'http://127.0.0.1:3940/mcp';

  const secret = process.env.QLIX_INTERNAL_SERVICE_SECRET?.trim();
  const secretEnc = secret
    ? encryptForAgentSecrets(JSON.stringify({ headers: { Authorization: `Bearer ${secret}` } }))
    : null;

  const existing = await prisma.mcpServer.findUnique({
    where: { orgId_slug: { orgId, slug: QLIX_LEADS_SLUG } },
    select: { id: true },
  });

  let serverId: string;
  if (existing) {
    await prisma.mcpServer.update({
      where: { id: existing.id },
      data: {
        endpointUrl,
        secretEnc,
        enabled: true,
        status: 'connected',
        lastDiscoveredAt: new Date(),
        lastError: null,
      },
    });
    serverId = existing.id;
  } else {
    const row = await prisma.mcpServer.create({
      data: {
        orgId,
        createdByUserId: ownerUserId,
        slug: QLIX_LEADS_SLUG,
        name: 'Qlix Leads',
        description: 'Google Business Profile lead generation and outreach',
        transport: 'http',
        endpointUrl,
        authType: 'header',
        secretEnc,
        status: 'connected',
        enabled: true,
        lastDiscoveredAt: new Date(),
      },
    });
    serverId = row.id;
  }

  for (const tool of BUILTIN_TOOLS) {
    const risk = deriveRiskLevel(tool.annotations);
    const governance = deriveGovernance(risk);
    const definitionHash = computeDefinitionHash(tool);
    await prisma.mcpServerTool.upsert({
      where: { mcpServerId_name: { mcpServerId: serverId, name: tool.name } },
      create: {
        mcpServerId: serverId,
        name: tool.name,
        description: tool.description,
        inputSchema: (tool.inputSchema ?? undefined) as Prisma.InputJsonValue | undefined,
        annotations: (tool.annotations ?? undefined) as Prisma.InputJsonValue | undefined,
        riskLevel: risk,
        defaultGovernance: governance,
        definitionHash,
        approvedHash: definitionHash,
        approvedDefinition: {
          description: tool.description,
          inputSchema: tool.inputSchema ?? {},
        } as Prisma.InputJsonValue,
      },
      update: {
        description: tool.description,
        inputSchema: (tool.inputSchema ?? undefined) as Prisma.InputJsonValue | undefined,
        annotations: (tool.annotations ?? undefined) as Prisma.InputJsonValue | undefined,
        riskLevel: risk,
        definitionHash,
        // First-party qlix-leads tools: auto-approve current definition on sync so runners
        // are not starved of gmb_search_leads after description/schema updates.
        approvedHash: definitionHash,
        approvedDefinition: {
          description: tool.description,
          inputSchema: tool.inputSchema ?? {},
        } as Prisma.InputJsonValue,
      },
    });
  }

  const bindings = await prisma.agentMcpBinding.findMany({
    where: { mcpServerId: serverId },
    select: { agentId: true },
  });
  for (const b of bindings) {
    await mcpService.syncAgentScopes(b.agentId);
  }
}

export async function ensureQlixLeadsMcpAllOrgs(): Promise<void> {
  const endpointUrl =
    process.env.QLIX_MCP_URL?.trim() ||
    process.env.QLIX_MCP_LEADS_URL?.trim() ||
    'http://127.0.0.1:3940/mcp';

  const orgs = await prisma.organization.findMany({
    select: {
      id: true,
      users: { where: { role: 'owner' }, take: 1, select: { id: true } },
    },
  });

  for (const org of orgs) {
    const ownerId = org.users[0]?.id;
    if (!ownerId) continue;
    try {
      await ensureQlixLeadsMcpForOrg(org.id, ownerId);
    } catch (err) {
      console.error(`[leads-mcp] failed for org ${org.id}`, err);
    }
  }
  console.info(`[leads-mcp] registered qlix-leads for ${orgs.length} org(s)`);
}
