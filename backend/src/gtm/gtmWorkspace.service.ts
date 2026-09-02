import { prisma } from '../lib/prisma.js';
import type { ConnectorProvider } from '../connectors/connectors.types.js';
import { ConnectorsRepository } from '../connectors/connectors.repository.js';
import { EmployeesRepository } from '../employees/employees.repository.js';
import { roleCan } from '../lib/orgPermissions.js';
import { appendBrainActionLog } from '../aiBrain/brainAudit.service.js';
import { getDiscoveryFoundation } from './discoveryFoundation.service.js';
import { getLatestDiscoveryPlan, type DiscoveryPlanContentV2 } from './gtmDiscoveryPlan.service.js';
import {
  applyGtmSetupPatch,
  GTM_PLUGIN_ID,
  gtmSetupToJson,
  normalizeGtmSetup,
  type GtmCrmMode,
  type GtmSetupConfig,
} from './gtmSetup.js';
import { recommendGtmAgents } from './gtmAgentRecommendation.service.js';
import { recommendGtmTeam, teamHireProgress, type GtmTeamSlot } from './gtmTeamComposition.service.js';
import type { GtmIdeaPayload } from './discoveryFoundation.service.js';
import type { GtmRoadmapStep } from './gtmSetup.js';

export type GtmWorkspaceNextAction =
  | 'build_team'
  | 'choose_crm'
  | 'connect_zoho'
  | 'review_roadmap'
  | 'start_discovery'
  | 'complete';

export class GtmWorkspaceError extends Error {
  constructor(message: string, readonly code: 'forbidden' | 'not_found' | 'invalid') {
    super(message);
    this.name = 'GtmWorkspaceError';
  }
}

const connectorsRepo = new ConnectorsRepository();
const employeesRepo = new EmployeesRepository();

const RESEARCH_PROVIDERS = new Set<ConnectorProvider>(['google', 'microsoft']);

export function planStepKey(index: number, title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  return `step-${index}-${slug || 'item'}`;
}

export function roadmapStepKey(step: { id?: string; title: string }, index: number): string {
  if (step.id?.trim()) return step.id.trim();
  const slug = step.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  return `step-${index}-${slug || 'item'}`;
}

export function resolveDiscoveryRoadmap(
  customRoadmap: GtmRoadmapStep[] | null,
  planSteps: Array<{ title: string; why: string; effort: 'small' | 'medium' }>,
): GtmRoadmapStep[] {
  if (customRoadmap && customRoadmap.length > 0) return customRoadmap;
  return planSteps.map((step, index) => ({
    id: roadmapStepKey(step, index),
    title: step.title,
    why: step.why,
    effort: step.effort,
  }));
}

export function ensureChecklistKeys(
  checklist: Record<string, 'pending' | 'done'>,
  roadmap: GtmRoadmapStep[],
): Record<string, 'pending' | 'done'> {
  const next = { ...checklist };
  roadmap.forEach((step, index) => {
    const key = roadmapStepKey(step, index);
    if (!next[key]) next[key] = 'pending';
  });
  return next;
}

function isPlanV2(content: unknown): content is DiscoveryPlanContentV2 {
  return Boolean(
    content
    && typeof content === 'object'
    && (content as { schemaVersion?: string }).schemaVersion === 'gtm.discovery_plan.v2',
  );
}

export function computeWorkspaceReadiness(input: {
  setup: GtmSetupConfig;
  zohoConnected: boolean;
  teamProgress: ReturnType<typeof teamHireProgress>;
  planReady: boolean;
  hasIdea: boolean;
}): {
  milestones: {
    answersSaved: boolean;
    planReady: boolean;
    teamBuilt: boolean;
    discoveryStarted: boolean;
  };
  nextAction: GtmWorkspaceNextAction;
  nextActionLabel: string;
  checklistDoneCount: number;
  checklistTotalCount: number;
} {
  const checklistEntries = Object.values(input.setup.discoveryChecklist);
  const checklistDoneCount = checklistEntries.filter((s) => s === 'done').length;
  const checklistTotalCount = checklistEntries.length;

  const crmReady = input.setup.crmMode === 'qlix_twenty'
    || (input.setup.crmMode === 'external' && (input.setup.crmExternalProvider !== 'zoho' || input.zohoConnected));

  const teamBuilt = input.teamProgress.allHired && crmReady;
  const discoveryStarted = checklistDoneCount > 0;

  let nextAction: GtmWorkspaceNextAction = 'complete';
  let nextActionLabel = 'Continue your discovery roadmap';

  if (input.teamProgress.nextSlot) {
    nextAction = 'build_team';
    nextActionLabel = 'Build team';
  } else if (input.setup.crmMode === 'undecided') {
    nextAction = 'choose_crm';
    nextActionLabel = 'Choose where your pipeline lives';
  } else if (input.setup.crmMode === 'external' && input.setup.crmExternalProvider === 'zoho' && !input.zohoConnected) {
    nextAction = 'connect_zoho';
    nextActionLabel = 'Connect Zoho CRM';
  } else if (checklistDoneCount === 0 && checklistTotalCount > 0) {
    nextAction = 'review_roadmap';
    nextActionLabel = 'Review your discovery roadmap';
  }

  return {
    milestones: {
      answersSaved: input.hasIdea,
      planReady: input.planReady,
      teamBuilt,
      discoveryStarted,
    },
    nextAction,
    nextActionLabel,
    checklistDoneCount,
    checklistTotalCount,
  };
}

async function loadPluginConfig(orgId: string): Promise<GtmSetupConfig> {
  const plugin = await prisma.orgPlugin.findUniqueOrThrow({
    where: { orgId_pluginId: { orgId, pluginId: GTM_PLUGIN_ID } },
    select: { config: true },
  });
  return normalizeGtmSetup(plugin.config);
}

async function savePluginConfig(orgId: string, setup: GtmSetupConfig): Promise<GtmSetupConfig> {
  await prisma.orgPlugin.update({
    where: { orgId_pluginId: { orgId, pluginId: GTM_PLUGIN_ID } },
    data: { config: gtmSetupToJson(setup) },
  });
  return setup;
}

export async function getGtmDiscoveryEntry(orgId: string): Promise<{
  view: 'questions' | 'workspace';
  planStatus: 'generating' | 'ready' | 'failed' | null;
  hasConfirmedIdea: boolean;
  pendingIdeaReview: boolean;
}> {
  const foundation = await getDiscoveryFoundation(orgId);
  const plan = await getLatestDiscoveryPlan(orgId);
  const pendingIdeaReview = foundation.proposals.some(
    (proposal) => proposal.kind === 'idea' && proposal.status === 'pending',
  );
  const hasConfirmedIdea = Boolean(foundation.idea);

  const planStatus = plan?.status === 'generating' || plan?.status === 'ready' || plan?.status === 'failed'
    ? plan.status
    : null;

  if (!hasConfirmedIdea || pendingIdeaReview) {
    return {
      view: 'questions',
      planStatus,
      hasConfirmedIdea,
      pendingIdeaReview,
    };
  }

  return {
    view: 'workspace',
    planStatus,
    hasConfirmedIdea: true,
    pendingIdeaReview: false,
  };
}

export async function getGtmDiscoveryWorkspace(orgId: string) {
  const [setup, foundation, plan, connectors, engagements] = await Promise.all([
    loadPluginConfig(orgId),
    getDiscoveryFoundation(orgId),
    getLatestDiscoveryPlan(orgId),
    connectorsRepo.listForOrg(orgId),
    employeesRepo.listForWorkspace(orgId),
  ]);

  const connectedProviders = new Set(
    connectors.filter((c) => c.status === 'connected').map((c) => c.provider),
  );
  const researchConnected = [...RESEARCH_PROVIDERS].some((p) => connectedProviders.has(p));
  const zohoConnected = connectedProviders.has('zoho');

  const ideaContent = foundation.idea?.content as GtmIdeaPayload | undefined;
  const agentRecommendations = ideaContent
    ? recommendGtmAgents({ content: ideaContent, crmMode: setup.crmMode })
    : [];

  const planSteps = isPlanV2(plan?.content)
    ? plan.content.planSteps
    : plan?.content && typeof plan.content === 'object'
      ? (plan.content as { planSteps?: Array<{ title: string; why: string; effort: 'small' | 'medium' }> }).planSteps ?? []
      : [];

  const planTools = isPlanV2(plan?.content)
    ? plan.content.tools
    : plan?.content && typeof plan.content === 'object'
      ? (plan.content as { tools?: Array<{ capabilityId: string; priority: string }> }).tools ?? []
      : [];

  const suggestedTeam: GtmTeamSlot[] = ideaContent
    ? recommendGtmTeam({ content: ideaContent, crmMode: setup.crmMode, planTools })
    : [];

  const hiredRoleSlugs = engagements.map((e) => e.roleSlug);
  const teamProgress = teamHireProgress(suggestedTeam, hiredRoleSlugs);

  const roadmap = resolveDiscoveryRoadmap(setup.discoveryRoadmap, planSteps);
  const discoveryChecklist = ensureChecklistKeys(setup.discoveryChecklist, roadmap);
  const setupWithChecklist = { ...setup, discoveryChecklist };

  const readiness = computeWorkspaceReadiness({
    setup: setupWithChecklist,
    zohoConnected,
    teamProgress,
    planReady: plan?.status === 'ready',
    hasIdea: Boolean(foundation.idea),
  });

  return {
    setup: setupWithChecklist,
    plan,
    idea: foundation.idea,
    connectors: {
      researchConnected,
      zohoConnected,
      connectedProviders: [...connectedProviders],
    },
    agentRecommendations,
    suggestedTeam,
    teamProgress,
    roadmap,
    hiredRoleSlugs,
    readiness,
  };
}

export async function patchGtmDiscoveryWorkspace(input: {
  orgId: string;
  userId: string;
  role: string;
  brainAgentId?: string;
  body: unknown;
}) {
  if (!roleCan(input.role, 'manage_brain')) {
    throw new GtmWorkspaceError('Only organization owners and admins can update the GTM workspace.', 'forbidden');
  }

  const body = input.body && typeof input.body === 'object' && !Array.isArray(input.body)
    ? input.body as Record<string, unknown>
    : {};

  const patch: Record<string, unknown> = {};
  if (body.crmMode !== undefined) patch.crmMode = body.crmMode;
  if (body.crmExternalProvider !== undefined) patch.crmExternalProvider = body.crmExternalProvider;
  if (body.discoveryRoadmap !== undefined) patch.discoveryRoadmap = body.discoveryRoadmap;

  if (body.checklistStepKey !== undefined && body.checklistStatus !== undefined) {
    const current = await loadPluginConfig(input.orgId);
    const key = String(body.checklistStepKey);
    const status = body.checklistStatus === 'done' ? 'done' : 'pending';
    patch.discoveryChecklist = { ...current.discoveryChecklist, [key]: status };
  }

  if (Object.keys(patch).length === 0) {
    throw new GtmWorkspaceError('No valid workspace fields to update.', 'invalid');
  }

  const current = await loadPluginConfig(input.orgId);
  const next = applyGtmSetupPatch(current, patch);
  await savePluginConfig(input.orgId, next);

  if (input.brainAgentId && body.checklistStepKey) {
    await appendBrainActionLog({
      brainAgentId: input.brainAgentId,
      userId: input.userId,
      actionType: 'gtm.discovery_checklist_update',
      payload: {
        description: `Updated discovery checklist ${String(body.checklistStepKey)}`,
        status: body.checklistStatus,
      },
      status: 'success',
      riskLevel: 'low',
    });
  }

  return getGtmDiscoveryWorkspace(input.orgId);
}

export async function requestQlixCrm(input: {
  orgId: string;
  userId: string;
  role: string;
  brainAgentId: string;
}) {
  if (!roleCan(input.role, 'manage_brain')) {
    throw new GtmWorkspaceError('Only organization owners and admins can request Qlix CRM.', 'forbidden');
  }

  const current = await loadPluginConfig(input.orgId);
  const next = applyGtmSetupPatch(current, {
    crmMode: 'qlix_twenty',
    crmExternalProvider: null,
    qlixCrmRequestedAt: new Date().toISOString(),
  });
  await savePluginConfig(input.orgId, next);

  await appendBrainActionLog({
    brainAgentId: input.brainAgentId,
    userId: input.userId,
    actionType: 'gtm.qlix_crm_request',
    payload: { description: 'Requested Qlix CRM (Twenty) waitlist' },
    status: 'success',
    riskLevel: 'low',
  });

  return getGtmDiscoveryWorkspace(input.orgId);
}
