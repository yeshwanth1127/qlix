import { prisma } from '../lib/prisma.js';
import { getBuildableScopes } from '../agents/scopeCatalog.js';
import { listRoleManifests } from '../employees/rolePacks.js';
import { BrainQueryService, type BrainQueryCitation } from './brainQuery.service.js';
import { BrainProposalService, type BrainProposalDTO } from './brainProposal.service.js';
import {
  ScheduleForbiddenError,
  ScheduleNotFoundError,
  ScheduleValidationError,
  scheduleService,
} from '../schedules/schedule.service.js';

export const BRAIN_TOOL_DEFINITIONS = [
  {
    type: 'function' as const,
    function: {
      name: 'knowledge_search',
      description:
        'Search the organization knowledge base (indexed uploaded documents). ALWAYS call this before answering questions about company docs, policies, FAQs, uploaded files, or "my doc(s)". This is how you read ingested knowledge — you do have access.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query (topic, title keywords, or the user question)' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_knowledge',
      description:
        'List ingested knowledge documents (titles, collections, chunk counts). Use when the user asks what docs exist, what was uploaded, or for a summary inventory of the knowledge base.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', description: 'Max documents to return (default 40)' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_org_agents',
      description: 'List existing standard agents in this organization (not the brain itself).',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_capabilities',
      description: 'List buildable permission scopes and AI Employee role packs available for new agents.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'propose_plan',
      description:
        'Propose creating a single agent or a supervisor+workers team. Does NOT create agents — the user must confirm in the UI. Prefer hybrid runtime for personal-assistant / desktop intents; prefer team for multi-role fleets.',
      parameters: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['single', 'team'] },
          rationale: { type: 'string', description: 'Why this plan fits the user request' },
          agent: {
            type: 'object',
            description: 'Required when kind=single',
            properties: {
              name: { type: 'string' },
              description: { type: 'string' },
              permissionScopes: { type: 'array', items: { type: 'string' } },
              jitScopes: { type: 'array', items: { type: 'string' } },
              runtime: { type: 'string', enum: ['cloud', 'hybrid', 'local'] },
              model: { type: 'string' },
              rationale: { type: 'string' },
            },
            required: ['name', 'permissionScopes', 'runtime'],
          },
          team: {
            type: 'object',
            description: 'Required when kind=team',
            properties: {
              name: { type: 'string' },
              description: { type: 'string' },
              supervisor: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  description: { type: 'string' },
                  permissionScopes: { type: 'array', items: { type: 'string' } },
                  jitScopes: { type: 'array', items: { type: 'string' } },
                  runtime: { type: 'string', enum: ['cloud', 'hybrid', 'local'] },
                  model: { type: 'string' },
                  rationale: { type: 'string' },
                },
                required: ['name', 'permissionScopes', 'runtime'],
              },
              workers: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    description: { type: 'string' },
                    role: { type: 'string' },
                    permissionScopes: { type: 'array', items: { type: 'string' } },
                    jitScopes: { type: 'array', items: { type: 'string' } },
                    runtime: { type: 'string', enum: ['cloud', 'hybrid', 'local'] },
                    model: { type: 'string' },
                    rationale: { type: 'string' },
                    stageOrder: { type: 'number' },
                  },
                  required: ['name', 'permissionScopes', 'runtime'],
                },
              },
              config: {
                type: 'object',
                properties: {
                  maxParallelWorkers: { type: 'number' },
                  subtaskTimeoutMs: { type: 'number' },
                  retryPolicy: { type: 'string', enum: ['none', 'once', 'twice'] },
                },
              },
            },
            required: ['name', 'supervisor', 'workers'],
          },
        },
        required: ['kind', 'rationale'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_proposal',
      description: 'Reload a previously proposed plan by id.',
      parameters: {
        type: 'object',
        properties: {
          proposalId: { type: 'string' },
        },
        required: ['proposalId'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'schedule_create',
      description:
        'Create a scheduled job (cron / once / interval) that runs on YOU (exa) by default when due. Only pass targetAgentId when the user explicitly names another agent to receive the run.',
      parameters: {
        type: 'object',
        properties: {
          scheduleType: { type: 'string', enum: ['cron', 'once', 'interval'] },
          cronExpression: {
            type: 'string',
            description: '5-field UTC cron for scheduleType=cron, e.g. "0 9 * * 1-5"',
          },
          onceAt: { type: 'string', description: 'ISO-8601 datetime for scheduleType=once' },
          intervalSeconds: {
            type: 'integer',
            description: 'Seconds between fires for scheduleType=interval (min 60)',
          },
          prompt: {
            type: 'string',
            description: 'Prompt / instructions delivered when the event fires (to you, or to targetAgentId if set)',
          },
          label: { type: 'string' },
          maxRuns: { type: 'integer' },
          targetAgentId: {
            type: 'string',
            description:
              'ONLY when the user explicitly asked to schedule work onto another agent. Omit to schedule on yourself (exa).',
          },
          userExplicitlyNamedTargetAgent: {
            type: 'boolean',
            description:
              'Must be true if targetAgentId is set. Confirms the user named that agent; never invent this.',
          },
        },
        required: ['scheduleType', 'prompt'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'schedule_list',
      description:
        'List scheduled events. Defaults to YOUR (exa) schedules. Pass agentId only to inspect another agent; pass includeAllAgents=true for the whole org.',
      parameters: {
        type: 'object',
        properties: {
          agentId: { type: 'string' },
          includeAllAgents: { type: 'boolean' },
          status: { type: 'string', enum: ['active', 'paused', 'cancelled', 'completed'] },
          includeCancelled: { type: 'boolean' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'schedule_cancel',
      description: 'Cancel a scheduled event so it will not fire again.',
      parameters: {
        type: 'object',
        properties: {
          scheduleId: { type: 'string' },
        },
        required: ['scheduleId'],
      },
    },
  },
];

export const BRAIN_COGNITIVE_SYSTEM_PROMPT = [
  'You are exa — this organization\'s private cognitive control plane on Qlix/Exora.',
  'You help operators understand their knowledge, recommend what to focus on, and design agent fleets. You do NOT run email, browser, or desktop tools yourself.',
  'You CAN read the org knowledge base. Never say you cannot access documents or need the user to paste content.',
  'How to use knowledge:',
  '- A "Retrieved knowledge" block may already be attached for this turn — ground answers in it and cite with [1], [2].',
  '- Call knowledge_search for additional / more specific fact lookup.',
  '- Call list_knowledge when asked what documents exist or what was uploaded.',
  'If retrieval returns nothing relevant, say the knowledge base has no matching indexed content (suggest ingesting under Knowledge) — do not claim you lack access.',
  'You may recommend agents, operating focus, and scaling moves from knowledge + list_org_agents + list_capabilities.',
  'Personal-assistant / Jarvis-like asks: prefer a single hybrid agent (desktop/files/GUI when justified) with brain.query so it can use org knowledge; research/comms scopes as needed.',
  'Multi-role / ticket / EDITH-like fleets: propose a team (supervisor + narrow-scoped workers), not one mega-agent with every scope.',
  'To stand up agents: call propose_plan, explain why, and tell the user to Confirm in the UI. Never claim agents already exist. Never invent scopes outside list_capabilities.',
  'Timed work: use schedule_create / schedule_list / schedule_cancel yourself. By default schedule jobs ON YOU (exa) — do not assign them to another agent unless the user explicitly names that agent. Prefer scheduling over claiming you will remember later.',
  'Keep answers concise and conversational. Cite knowledge chunks with [1], [2] when you used knowledge.',
].join('\n');

export interface BrainToolContext {
  userId: string;
  orgId: string;
  brainAgentId: string;
  conversationId?: string | null;
  queryService: BrainQueryService;
  proposals: BrainProposalService;
}

export async function executeBrainTool(
  name: string,
  argsJson: string,
  ctx: BrainToolContext,
): Promise<{ content: string; citations?: BrainQueryCitation[]; proposal?: BrainProposalDTO }> {
  let args: Record<string, unknown> = {};
  try {
    args = argsJson.trim() ? (JSON.parse(argsJson) as Record<string, unknown>) : {};
  } catch {
    return { content: JSON.stringify({ error: 'Invalid tool arguments JSON' }) };
  }

  switch (name) {
    case 'knowledge_search': {
      const query = String(args.query ?? '').trim();
      if (!query) return { content: JSON.stringify({ error: 'query is required' }) };
      const result = await ctx.queryService.queryBrain({
        userId: ctx.userId,
        orgId: ctx.orgId,
        brainAgentId: ctx.brainAgentId,
        brainModel: 'openrouter/openai/gpt-4o-mini',
        question: query,
        contextOnly: true,
        agentContextBudget: false,
        writeAudit: false,
      });
      return {
        content: JSON.stringify({
          contextBlock: result.contextBlock || result.answer,
          citationCount: result.citations.length,
          citations: result.citations.map((c, i) => ({
            n: i + 1,
            documentTitle: c.documentTitle,
            collectionName: c.collectionName,
            excerpt: c.excerpt.slice(0, 280),
          })),
        }),
        citations: result.citations,
      };
    }
    case 'list_knowledge': {
      const limitRaw = typeof args.limit === 'number' ? args.limit : Number(args.limit);
      const limit = Number.isFinite(limitRaw) ? Math.min(100, Math.max(1, Math.floor(limitRaw))) : 40;
      const docs = await prisma.brainKnowledgeDocument.findMany({
        where: { orgId: ctx.orgId },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: {
          id: true,
          title: true,
          ingestStatus: true,
          createdAt: true,
          sourceUri: true,
          collection: { select: { id: true, name: true } },
          _count: { select: { chunks: true } },
        },
      });
      const total = await prisma.brainKnowledgeDocument.count({ where: { orgId: ctx.orgId } });
      return {
        content: JSON.stringify({
          total,
          returned: docs.length,
          documents: docs.map((d) => ({
            id: d.id,
            title: d.title,
            collectionId: d.collection.id,
            collectionName: d.collection.name,
            ingestStatus: d.ingestStatus,
            chunkCount: d._count.chunks,
            sourceUri: d.sourceUri,
            createdAt: d.createdAt.toISOString(),
          })),
          hint:
            docs.length === 0
              ? 'No documents ingested yet. Ask the operator to upload under Knowledge / AI Brain.'
              : 'Use knowledge_search with a topic or document title to read content.',
        }),
      };
    }
    case 'list_org_agents': {
      const agents = await prisma.agent.findMany({
        where: { orgId: ctx.orgId, agentKind: 'standard' },
        orderBy: { createdAt: 'desc' },
        take: 40,
        select: {
          id: true,
          name: true,
          status: true,
          runtime: true,
          permissionScopes: true,
          description: true,
          cloudProvisioningStatus: true,
        },
      });
      return {
        content: JSON.stringify({
          count: agents.length,
          agents: agents.map((a) => ({
            id: a.id,
            name: a.name,
            status: a.status,
            runtime: a.runtime,
            permissionScopes: a.permissionScopes,
            description: a.description?.slice(0, 200) ?? null,
            cloudProvisioningStatus: a.cloudProvisioningStatus,
          })),
        }),
      };
    }
    case 'list_capabilities': {
      const scopes = await getBuildableScopes(ctx.orgId);
      const packs = listRoleManifests();
      return {
        content: JSON.stringify({
          scopes: scopes.map((s) => ({
            id: s.id,
            label: s.label,
            runtimes: s.runtimes,
            forceJit: s.forceJit,
          })),
          rolePacks: packs.map((p) => ({
            slug: p.slug,
            label: p.label,
            mission: p.mission,
            defaultRuntime: p.runtime,
          })),
        }),
      };
    }
    case 'propose_plan': {
      const proposal = await ctx.proposals.createProposal({
        orgId: ctx.orgId,
        brainAgentId: ctx.brainAgentId,
        userId: ctx.userId,
        conversationId: ctx.conversationId,
        rawPlan: args,
      });
      return {
        content: JSON.stringify({
          ok: true,
          proposalId: proposal.id,
          kind: proposal.kind,
          status: proposal.status,
          rationale: proposal.rationale,
          agents: proposal.agents,
          message: 'Proposal saved as pending. Ask the user to Confirm create in the UI — do not claim agents exist yet.',
        }),
        proposal,
      };
    }
    case 'get_proposal': {
      const proposalId = String(args.proposalId ?? '').trim();
      if (!proposalId) return { content: JSON.stringify({ error: 'proposalId is required' }) };
      const proposal = await ctx.proposals.getProposal(ctx.orgId, proposalId);
      if (!proposal) return { content: JSON.stringify({ error: 'Proposal not found' }) };
      return { content: JSON.stringify(proposal), proposal };
    }
    case 'schedule_create': {
      const scheduleType = String(args.scheduleType ?? '').trim() as 'cron' | 'once' | 'interval';
      const prompt = String(args.prompt ?? '').trim();
      if (!scheduleType || !prompt) {
        return { content: JSON.stringify({ error: 'scheduleType and prompt are required' }) };
      }

      const requestedTarget = String(args.targetAgentId ?? args.agentId ?? '').trim();
      const userExplicit =
        args.userExplicitlyNamedTargetAgent === true || args.userExplicitlyNamedTargetAgent === 'true';
      // Default: schedule on the brain itself. Other agents only when explicitly flagged.
      let agentId = ctx.brainAgentId;
      let delegated = false;
      if (requestedTarget && requestedTarget !== ctx.brainAgentId) {
        if (!userExplicit) {
          return {
            content: JSON.stringify({
              error:
                'Refused to schedule onto another agent. Omit targetAgentId to schedule on yourself (exa), or set userExplicitlyNamedTargetAgent=true only when the user named that agent.',
            }),
          };
        }
        agentId = requestedTarget;
        delegated = true;
      }

      try {
        const schedule = await scheduleService.create({
          orgId: ctx.orgId,
          agentId,
          createdByAgentId: ctx.brainAgentId,
          createdByUserId: ctx.userId,
          scheduleType,
          cronExpression: typeof args.cronExpression === 'string' ? args.cronExpression : undefined,
          onceAt: typeof args.onceAt === 'string' ? args.onceAt : undefined,
          intervalSeconds: typeof args.intervalSeconds === 'number' ? args.intervalSeconds : undefined,
          prompt,
          label: typeof args.label === 'string' ? args.label : undefined,
          maxRuns: typeof args.maxRuns === 'number' ? args.maxRuns : undefined,
          source: 'brain',
        });
        return {
          content: JSON.stringify({
            ok: true,
            schedule,
            target: delegated ? 'delegated_agent' : 'self_exa',
            message: delegated
              ? 'Schedule created on the named agent. It will receive the prompt when nextRunAt is due.'
              : 'Schedule created on you (exa). You will receive the prompt as a run when nextRunAt is due.',
          }),
        };
      } catch (err) {
        const message =
          err instanceof ScheduleValidationError ||
          err instanceof ScheduleNotFoundError ||
          err instanceof ScheduleForbiddenError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'schedule_create failed';
        return { content: JSON.stringify({ error: message }) };
      }
    }
    case 'schedule_list': {
      const includeAll = args.includeAllAgents === true || args.includeAllAgents === 'true';
      const explicitAgent = typeof args.agentId === 'string' ? args.agentId.trim() : '';
      const agentFilter = includeAll ? undefined : explicitAgent || ctx.brainAgentId;
      const schedules = await scheduleService.list({
        orgId: ctx.orgId,
        agentId: agentFilter,
        status: typeof args.status === 'string' ? args.status : undefined,
        includeCancelled: args.includeCancelled === true,
      });
      return {
        content: JSON.stringify({
          count: schedules.length,
          scope: includeAll ? 'org' : agentFilter === ctx.brainAgentId ? 'self_exa' : 'agent',
          schedules,
        }),
      };
    }
    case 'schedule_cancel': {
      const scheduleId = String(args.scheduleId ?? '').trim();
      if (!scheduleId) return { content: JSON.stringify({ error: 'scheduleId is required' }) };
      try {
        const schedule = await scheduleService.cancel(ctx.orgId, scheduleId);
        return { content: JSON.stringify({ ok: true, schedule }) };
      } catch (err) {
        const message =
          err instanceof ScheduleNotFoundError || err instanceof ScheduleForbiddenError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'schedule_cancel failed';
        return { content: JSON.stringify({ error: message }) };
      }
    }
    default:
      return { content: JSON.stringify({ error: `Unknown tool: ${name}` }) };
  }
}
