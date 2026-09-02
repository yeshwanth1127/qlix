import { prisma } from '../lib/prisma.js';
import { getBuildableScopes } from '../agents/scopeCatalog.js';
import { listRoleManifests } from '../employees/rolePacks.js';
import { BrainQueryService, type BrainQueryCitation, type BrainDocumentRetrievalFilter } from './brainQuery.service.js';
import { BrainProposalService, type BrainProposalDTO } from './brainProposal.service.js';
import {
  ScheduleForbiddenError,
  ScheduleNotFoundError,
  ScheduleValidationError,
  scheduleService,
} from '../schedules/schedule.service.js';

export const GTM_SETUP_BRAIN_TOOL_DEFINITIONS = [
  {
    type: 'function' as const,
    function: {
      name: 'propose_gtm_setup',
      description:
        'Propose structured GTM setup changes (company, ICP, offer, regions, completed steps). Does NOT apply them — the operator must confirm in the GTM workspace.',
      parameters: {
        type: 'object',
        properties: {
          rationale: { type: 'string', description: 'Why these setup changes fit what the operator said' },
          companyDescription: { type: 'string' },
          idealCustomerProfile: { type: 'string' },
          primaryOffer: { type: 'string' },
          targetRegions: { type: 'array', items: { type: 'string' } },
          buyerRolesAndWorkflows: { type: 'string' },
          proofAndCaseStudies: { type: 'string' },
          validityPolicy: { type: 'string' },
          calibrationNotes: { type: 'string' },
          completedSteps: {
            type: 'array',
            items: {
              type: 'string',
              enum: ['company', 'market', 'offer', 'buyers', 'proof', 'connectors', 'validity_policy', 'calibration'],
            },
          },
        },
        required: ['rationale'],
      },
    },
  },
] as const satisfies ReadonlyArray<{
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}>;

export const GTM_DISCOVERY_BRAIN_TOOL_DEFINITIONS = [
  {
    type: 'function' as const,
    function: {
      name: 'propose_gtm_idea',
      description: 'Propose the founder starting idea and known constraints. Unknown fields may be blank. The operator must confirm before it becomes discovery truth.',
      parameters: {
        type: 'object',
        properties: {
          rationale: { type: 'string' },
          idea: { type: 'string' },
          problem: { type: 'string' },
          solution: { type: 'string' },
          audience: { type: 'string' },
          outcome: { type: 'string' },
          constraints: { type: 'string' },
        },
        required: ['rationale', 'idea'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'propose_gtm_hypothesis',
      description: 'Propose one testable GTM assumption with an explicit evidence class. The operator must confirm it.',
      parameters: {
        type: 'object',
        properties: {
          rationale: { type: 'string' },
          kind: { type: 'string', enum: ['problem', 'segment', 'trigger', 'user', 'champion', 'buyer', 'value', 'offer', 'channel', 'price'] },
          statement: { type: 'string' },
          evidenceClass: { type: 'string', enum: ['founder_provided', 'externally_verified', 'inferred', 'prospect_reported', 'experiment_observed', 'unknown'] },
        },
        required: ['rationale', 'kind', 'statement', 'evidenceClass'],
      },
    },
  },
] as const satisfies ReadonlyArray<{
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}>;

export const GTM_DISCOVERY_PLAN_BRAIN_TOOL_DEFINITIONS = [
  {
    type: 'function' as const,
    function: {
      name: 'propose_gtm_discovery_plan',
      description:
        'Return the complete personalized GTM starter dashboard as structured JSON. Call exactly once when drafting a discovery plan from founder answers.',
      parameters: {
        type: 'object',
        properties: {
          schemaVersion: { type: 'string', enum: ['gtm.discovery_plan.v1', 'gtm.discovery_plan.v2'] },
          summary: { type: 'string' },
          focus: {
            type: 'object',
            properties: {
              audience: { type: 'string' },
              reasons: { type: 'array', items: { type: 'string' } },
              openQuestions: { type: 'array', items: { type: 'string' } },
            },
            required: ['audience', 'reasons', 'openQuestions'],
          },
          suggestedAgents: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                roleSlug: { type: 'string' },
                label: { type: 'string' },
                reason: { type: 'string' },
              },
              required: ['roleSlug', 'label', 'reason'],
            },
          },
          tools: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                capabilityId: { type: 'string', enum: ['research', 'crm', 'email'] },
                priority: { type: 'string', enum: ['now', 'later', 'optional'] },
                reason: { type: 'string' },
              },
              required: ['capabilityId', 'priority', 'reason'],
            },
          },
          planSteps: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                why: { type: 'string' },
                effort: { type: 'string', enum: ['small', 'medium'] },
              },
              required: ['title', 'why', 'effort'],
            },
          },
          hypotheses: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                kind: { type: 'string' },
                statement: { type: 'string' },
              },
              required: ['kind', 'statement'],
            },
          },
        },
        required: ['summary', 'focus', 'suggestedAgents', 'tools', 'planSteps', 'hypotheses'],
      },
    },
  },
] as const satisfies ReadonlyArray<{
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}>;

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
  retrievalFilter?: BrainDocumentRetrievalFilter;
  proposeGtmSetup?: (input: {
    patch: Record<string, unknown>;
    rationale: string;
  }) => Promise<{ proposalId: string }>;
  proposeGtmDiscovery?: (input: {
    kind: 'idea' | 'hypothesis';
    payload: Record<string, unknown>;
    rationale: string;
  }) => Promise<{ proposalId: string }>;
  proposeGtmDiscoveryPlan?: (plan: Record<string, unknown>) => Promise<{ ok: true }>;
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
        retrievalFilter: ctx.retrievalFilter,
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
    case 'propose_gtm_setup': {
      if (!ctx.proposeGtmSetup) {
        return { content: JSON.stringify({ error: 'GTM setup proposals are not enabled in this context.' }) };
      }
      const rationale = String(args.rationale ?? '').trim();
      if (!rationale) return { content: JSON.stringify({ error: 'rationale is required' }) };
      const patch: Record<string, unknown> = {};
      if (typeof args.companyDescription === 'string') patch.companyDescription = args.companyDescription;
      if (typeof args.idealCustomerProfile === 'string') patch.idealCustomerProfile = args.idealCustomerProfile;
      if (typeof args.primaryOffer === 'string') patch.primaryOffer = args.primaryOffer;
      if (Array.isArray(args.targetRegions)) patch.targetRegions = args.targetRegions;
      if (typeof args.buyerRolesAndWorkflows === 'string') patch.buyerRolesAndWorkflows = args.buyerRolesAndWorkflows;
      if (typeof args.proofAndCaseStudies === 'string') patch.proofAndCaseStudies = args.proofAndCaseStudies;
      if (typeof args.validityPolicy === 'string') patch.validityPolicy = args.validityPolicy;
      if (typeof args.calibrationNotes === 'string') patch.calibrationNotes = args.calibrationNotes;
      if (Array.isArray(args.completedSteps)) patch.completedSteps = args.completedSteps;
      if (Object.keys(patch).length === 0) {
        return { content: JSON.stringify({ error: 'At least one setup field must be proposed.' }) };
      }
      try {
        const created = await ctx.proposeGtmSetup({ patch, rationale });
        return {
          content: JSON.stringify({
            ok: true,
            proposalId: created.proposalId,
            message: 'Proposal saved. The operator must review the structured diff and confirm in the GTM workspace.',
          }),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to save proposal';
        return { content: JSON.stringify({ error: message }) };
      }
    }
    case 'propose_gtm_idea': {
      if (!ctx.proposeGtmDiscovery) return { content: JSON.stringify({ error: 'GTM discovery proposals are not enabled.' }) };
      const rationale = String(args.rationale ?? '').trim();
      const idea = String(args.idea ?? '').trim();
      if (!rationale || !idea) return { content: JSON.stringify({ error: 'rationale and idea are required' }) };
      try {
        const created = await ctx.proposeGtmDiscovery({
          kind: 'idea', rationale,
          payload: {
            idea,
            problem: String(args.problem ?? '').trim(),
            solution: String(args.solution ?? '').trim(),
            audience: String(args.audience ?? '').trim(),
            outcome: String(args.outcome ?? '').trim(),
            constraints: String(args.constraints ?? '').trim(),
          },
        });
        return { content: JSON.stringify({ ok: true, proposalId: created.proposalId, message: 'Idea proposal ready for operator review.' }) };
      } catch (err) {
        return { content: JSON.stringify({ error: err instanceof Error ? err.message : 'Failed to save idea proposal' }) };
      }
    }
    case 'propose_gtm_hypothesis': {
      if (!ctx.proposeGtmDiscovery) return { content: JSON.stringify({ error: 'GTM discovery proposals are not enabled.' }) };
      const rationale = String(args.rationale ?? '').trim();
      const kind = String(args.kind ?? '').trim();
      const statement = String(args.statement ?? '').trim();
      const evidenceClass = String(args.evidenceClass ?? '').trim();
      if (!rationale || !kind || !statement || !evidenceClass) {
        return { content: JSON.stringify({ error: 'rationale, kind, statement, and evidenceClass are required' }) };
      }
      try {
        const created = await ctx.proposeGtmDiscovery({
          kind: 'hypothesis', rationale,
          payload: { kind, statement, evidenceClass, details: {} },
        });
        return { content: JSON.stringify({ ok: true, proposalId: created.proposalId, message: 'Hypothesis proposal ready for operator review.' }) };
      } catch (err) {
        return { content: JSON.stringify({ error: err instanceof Error ? err.message : 'Failed to save hypothesis proposal' }) };
      }
    }
    case 'propose_gtm_discovery_plan': {
      if (!ctx.proposeGtmDiscoveryPlan) {
        return { content: JSON.stringify({ error: 'GTM discovery plan drafting is not enabled in this context.' }) };
      }
      try {
        await ctx.proposeGtmDiscoveryPlan(args);
        return { content: JSON.stringify({ ok: true, message: 'Discovery plan captured.' }) };
      } catch (err) {
        return { content: JSON.stringify({ error: err instanceof Error ? err.message : 'Failed to save discovery plan' }) };
      }
    }
    default:
      return { content: JSON.stringify({ error: `Unknown tool: ${name}` }) };
  }
}
