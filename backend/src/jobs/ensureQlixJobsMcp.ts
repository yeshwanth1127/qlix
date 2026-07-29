/**
 * Ensures the first-party qlix-jobs MCP server is registered for every org on boot.
 */
import { prisma } from '../lib/prisma.js';
import type { Prisma } from '@prisma/client';
import { encryptForAgentSecrets } from '../cloudRunners/agentSecrets.js';
import { mcpService } from '../mcp/mcp.service.js';
import { computeDefinitionHash, deriveGovernance, deriveRiskLevel } from '../mcp/mcp.governance.js';
import type { DiscoveredTool } from '../mcp/mcp.types.js';

const QLIX_JOBS_SLUG = 'qlix-jobs';

const BUILTIN_TOOLS: DiscoveredTool[] = [
  {
    name: 'upsert_candidate_profile',
    description:
      'Update the candidate profile fields (name, email, answer bank, etc). Use stage_resume for the resume file.',
    inputSchema: {
      type: 'object',
      properties: {
        fullName: { type: 'string' },
        email: { type: 'string' },
        phone: { type: 'string' },
        location: { type: 'string' },
        linkedinUrl: { type: 'string' },
        githubUrl: { type: 'string' },
        portfolioUrl: { type: 'string' },
        workAuth: { type: 'string' },
        salaryBand: { type: 'string' },
        summary: { type: 'string' },
        skills: { type: 'array', items: { type: 'string' } },
        answerBank: {
          type: 'array',
          items: {
            type: 'object',
            properties: { question: { type: 'string' }, answer: { type: 'string' } },
          },
        },
      },
    },
    annotations: { destructiveHint: false },
  },
  {
    name: 'stage_resume',
    description:
      'Stage the candidate resume for browser upload. Pass plain text (preferred) or base64 file bytes. Call before queue_applications.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Resume as plain text (converted to .txt for upload).' },
        base64: { type: 'string', description: 'Resume file bytes as base64 (PDF/DOCX).' },
        fileName: { type: 'string', description: 'Original file name, e.g. resume.pdf' },
      },
    },
    annotations: { destructiveHint: false },
  },
  {
    name: 'search_jobs',
    description:
      'Search a Greenhouse, Lever, or Ashby company job board (public ATS API — no browser). Returns apply URLs.',
    inputSchema: {
      type: 'object',
      properties: {
        ats: { type: 'string', enum: ['greenhouse', 'lever', 'ashby'] },
        board: { type: 'string', description: 'Board token / company slug (e.g. stripe).' },
        query: { type: 'string', description: 'Optional title/keyword filter.' },
      },
      required: ['ats', 'board'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'queue_applications',
    description:
      'Create a campaign and queue Greenhouse/Lever/Ashby apply URLs (or search boards). LinkedIn/Indeed URLs are rejected.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        searchQuery: { type: 'string' },
        boards: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              ats: { type: 'string', enum: ['greenhouse', 'lever', 'ashby'] },
              board: { type: 'string' },
            },
            required: ['ats', 'board'],
          },
        },
        applyUrls: { type: 'array', items: { type: 'string' } },
        campaignId: { type: 'string', description: 'If set, append URLs to an existing campaign.' },
      },
    },
    annotations: { destructiveHint: false },
  },
  {
    name: 'list_applications',
    description: 'List applications in a campaign (optionally filter by status).',
    inputSchema: {
      type: 'object',
      properties: {
        campaignId: { type: 'string' },
        status: {
          type: 'string',
          enum: ['queued', 'filling', 'awaiting_jit', 'submitted', 'blocked', 'failed', 'skipped'],
        },
      },
      required: ['campaignId'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'get_apply_brief',
    description:
      'STEP before browser apply: returns profile, resume URL, apply URL, ATS playbook. Marks application as filling.',
    inputSchema: {
      type: 'object',
      properties: {
        applicationId: { type: 'string' },
      },
      required: ['applicationId'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'record_application_result',
    description:
      'Record outcome after an apply attempt. Use awaiting_jit before submit; submitted/blocked/failed after.',
    inputSchema: {
      type: 'object',
      properties: {
        applicationId: { type: 'string' },
        outcome: {
          type: 'string',
          enum: ['submitted', 'blocked', 'failed', 'skipped', 'awaiting_jit'],
        },
        note: { type: 'string' },
        confirmationUrl: { type: 'string' },
        agentRunId: { type: 'string' },
      },
      required: ['applicationId', 'outcome'],
    },
    annotations: { destructiveHint: false },
  },
];

export async function ensureQlixJobsMcpForOrg(orgId: string, ownerUserId: string): Promise<void> {
  const endpointUrl =
    process.env.QLIX_MCP_JOBS_URL?.trim() ||
    process.env.QLIX_MCP_URL?.trim()?.replace(/\/mcp\/?$/, '/mcp-jobs') ||
    'http://127.0.0.1:3940/mcp-jobs';

  const secret = process.env.QLIX_INTERNAL_SERVICE_SECRET?.trim();
  const secretEnc = secret
    ? encryptForAgentSecrets(JSON.stringify({ headers: { Authorization: `Bearer ${secret}` } }))
    : null;

  const existing = await prisma.mcpServer.findUnique({
    where: { orgId_slug: { orgId, slug: QLIX_JOBS_SLUG } },
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
        slug: QLIX_JOBS_SLUG,
        name: 'Qlix Jobs',
        description: 'Job Apply Copilot — Greenhouse / Lever / Ashby career applications',
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

export async function ensureQlixJobsMcpAllOrgs(): Promise<void> {
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
      await ensureQlixJobsMcpForOrg(org.id, ownerId);
    } catch (err) {
      console.error(`[jobs-mcp] failed for org ${org.id}`, err);
    }
  }
  console.info(`[jobs-mcp] registered qlix-jobs for ${orgs.length} org(s)`);
}
