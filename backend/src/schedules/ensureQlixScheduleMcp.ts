/**
 * Ensures the first-party qlix-schedule MCP server is registered for every org on boot.
 */
import { prisma } from '../lib/prisma.js';
import type { Prisma } from '@prisma/client';
import { encryptForAgentSecrets } from '../cloudRunners/agentSecrets.js';
import { mcpService } from '../mcp/mcp.service.js';
import { computeDefinitionHash, deriveGovernance, deriveRiskLevel } from '../mcp/mcp.governance.js';
import type { DiscoveredTool } from '../mcp/mcp.types.js';

export const QLIX_SCHEDULE_SLUG = 'qlix-schedule';

const BUILTIN_TOOLS: DiscoveredTool[] = [
  {
    name: 'schedule_create',
    description:
      'Create a scheduled event that will enqueue a prompt to this agent at a future time. Supports cron (5-field UTC), once (ISO datetime), or interval (seconds ≥ 60).',
    inputSchema: {
      type: 'object',
      properties: {
        scheduleType: { type: 'string', enum: ['cron', 'once', 'interval'] },
        cronExpression: {
          type: 'string',
          description: 'Required for cron. 5-field UTC, e.g. "0 9 * * 1-5" (weekdays 09:00 UTC).',
        },
        onceAt: {
          type: 'string',
          description: 'Required for once. ISO-8601 datetime in the future.',
        },
        intervalSeconds: {
          type: 'integer',
          description: 'Required for interval. Seconds between fires (min 60).',
        },
        prompt: {
          type: 'string',
          description: 'Prompt / goal delivered to the agent when the event fires.',
        },
        label: { type: 'string', description: 'Short human label for the schedule.' },
        maxRuns: {
          type: 'integer',
          description: 'Optional cap on how many times the event may fire (once always maxRuns=1).',
        },
        targetAgentId: {
          type: 'string',
          description: 'Optional. Defaults to the calling agent. Only self-targeting is allowed.',
        },
      },
      required: ['scheduleType', 'prompt'],
    },
    annotations: { destructiveHint: false },
  },
  {
    name: 'schedule_list',
    description: 'List scheduled events created by or targeting this agent (excludes cancelled by default).',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['active', 'paused', 'cancelled', 'completed'],
          description: 'Optional status filter.',
        },
        includeCancelled: { type: 'boolean' },
      },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'schedule_get',
    description: 'Get one scheduled event by id.',
    inputSchema: {
      type: 'object',
      properties: {
        scheduleId: { type: 'string' },
      },
      required: ['scheduleId'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'schedule_update',
    description: 'Update, pause, or resume a schedule (change cron/prompt/enabled).',
    inputSchema: {
      type: 'object',
      properties: {
        scheduleId: { type: 'string' },
        label: { type: 'string' },
        prompt: { type: 'string' },
        cronExpression: { type: 'string' },
        onceAt: { type: 'string' },
        intervalSeconds: { type: 'integer' },
        enabled: { type: 'boolean' },
        status: { type: 'string', enum: ['active', 'paused'] },
        maxRuns: { type: 'integer' },
      },
      required: ['scheduleId'],
    },
    annotations: { destructiveHint: false },
  },
  {
    name: 'schedule_cancel',
    description: 'Cancel a scheduled event so it will never fire again.',
    inputSchema: {
      type: 'object',
      properties: {
        scheduleId: { type: 'string' },
      },
      required: ['scheduleId'],
    },
    annotations: { destructiveHint: true },
  },
];

export async function ensureQlixScheduleMcpForOrg(orgId: string, ownerUserId: string): Promise<void> {
  const endpointUrl =
    process.env.QLIX_MCP_SCHEDULE_URL?.trim() ||
    process.env.QLIX_MCP_URL?.trim()?.replace(/\/mcp\/?$/, '/mcp-schedule') ||
    'http://127.0.0.1:3940/mcp-schedule';

  const secret = process.env.QLIX_INTERNAL_SERVICE_SECRET?.trim();
  const secretEnc = secret
    ? encryptForAgentSecrets(JSON.stringify({ headers: { Authorization: `Bearer ${secret}` } }))
    : null;

  const existing = await prisma.mcpServer.findUnique({
    where: { orgId_slug: { orgId, slug: QLIX_SCHEDULE_SLUG } },
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
        slug: QLIX_SCHEDULE_SLUG,
        name: 'Qlix Schedule',
        description: 'Schedule cron / once / interval events that enqueue agent runs',
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

export async function ensureQlixScheduleMcpAllOrgs(): Promise<void> {
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
      await ensureQlixScheduleMcpForOrg(org.id, ownerId);
    } catch (err) {
      console.error(`[schedule-mcp] failed for org ${org.id}`, err);
    }
  }
  console.info(`[schedule-mcp] registered qlix-schedule for ${orgs.length} org(s)`);
}
