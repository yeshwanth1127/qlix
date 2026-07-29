import { ActionsService, JitTokenInvalidError, JitTokenRequiredError } from '../actions/actions.service.js';
import type { PermissionScope } from '../agents/agents.types.js';
import { prisma } from '../lib/prisma.js';
import { JitService } from '../jit/jit.service.js';
import { appendEmailActionLog } from './emailAudit.service.js';
import {
  OrbitApiError,
  type OrbitCredentials,
  orbitAnalytics,
  orbitCreatePosts,
  orbitListIntegrations,
  orbitListPosts,
} from './orbitClient.service.js';
import {
  assertOrbitChannelOwnedByOrg,
  getOrbitCredsForOrg,
} from './orbitProvisioning.service.js';
import { orbitConnectorNotConnectedMessage } from './connectorUserMessages.js';

export class OrbitConnectorNotConfiguredError extends Error {
  readonly code = 'orbit_not_configured';
  constructor(message = orbitConnectorNotConnectedMessage()) {
    super(message);
  }
}

export class SocialScopeDeniedError extends Error {
  readonly code = 'scope_denied';
  constructor(scope: string) {
    super(`Agent lacks effective scope: ${scope}`);
  }
}

export class SocialToolError extends Error {
  readonly code = 'social_tool_failed';
}

const actionsService = new ActionsService();
const jitService = new JitService();

function effectiveScopes(params: {
  permissionScopes: string[];
  alwaysScopes: string[];
  jitScopes: string[];
  runSkills: string[];
}): Set<string> {
  const granted = new Set([...params.permissionScopes, ...params.alwaysScopes]);
  if (params.runSkills.length > 0) {
    return new Set([...granted].filter((s) => params.runSkills.includes(s)));
  }
  return granted;
}

async function loadAgentRunContext(agentId: string, runId: string | null): Promise<{
  runSkills: string[];
  teamRunId: string | null;
  userId: string;
  orgId: string | null;
  permissionScopes: string[];
  alwaysScopes: string[];
  jitScopes: string[];
}> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: {
      userId: true,
      orgId: true,
      permissionScopes: true,
      alwaysScopes: true,
      jitScopes: true,
      user: { select: { orgId: true } },
    },
  });
  if (!agent) throw new SocialToolError('Agent not found');

  let runSkills: string[] = [];
  let teamRunId: string | null = null;
  if (runId) {
    const run = await prisma.agentRun.findFirst({
      where: { id: runId, agentId },
      select: { skills: true, teamRunId: true },
    });
    runSkills = (run?.skills as string[] | null) ?? [];
    teamRunId = run?.teamRunId ?? null;
  }

  return {
    runSkills,
    teamRunId,
    userId: agent.userId,
    orgId: agent.orgId ?? agent.user.orgId,
    permissionScopes: agent.permissionScopes,
    alwaysScopes: agent.alwaysScopes,
    jitScopes: agent.jitScopes,
  };
}

async function requireOrbit(orgId: string | null): Promise<OrbitCredentials & { channelIds: string[] }> {
  if (!orgId) throw new OrbitConnectorNotConfiguredError();
  const creds = await getOrbitCredsForOrg(orgId);
  if (!creds) throw new OrbitConnectorNotConfiguredError();
  return {
    apiKey: creds.apiKey,
    baseUrl: creds.baseUrl,
    channelIds: creds.channelIds ?? [],
  };
}

async function assertScope(
  ctx: Awaited<ReturnType<typeof loadAgentRunContext>>,
  scope: 'social.read' | 'social.publish',
): Promise<void> {
  const scopes = effectiveScopes(ctx);
  if (!scopes.has(scope)) throw new SocialScopeDeniedError(scope);
}

export async function executeSocialChannels(params: {
  agentId: string;
  runId: string | null;
}): Promise<unknown> {
  const ctx = await loadAgentRunContext(params.agentId, params.runId);
  await assertScope(ctx, 'social.read');
  const creds = await requireOrbit(ctx.orgId);
  try {
    const result = await orbitListIntegrations(creds);
    const list = Array.isArray(result) ? result : [];
    const mine = new Set(creds.channelIds);
    const filtered = list.filter((row) => {
      const id = String((row as { id?: unknown }).id ?? '');
      return id && mine.has(id);
    });
    await appendEmailActionLog({
      agentId: params.agentId,
      userId: ctx.userId,
      actionType: 'social.read',
      payload: { tool: 'social.channels' },
      status: 'success',
      riskLevel: 'low',
      teamRunId: ctx.teamRunId,
    }).catch(() => {});
    return filtered;
  } catch (err) {
    if (err instanceof OrbitApiError) throw new SocialToolError(err.message);
    throw err;
  }
}

export async function executeSocialPostsList(params: {
  agentId: string;
  runId: string | null;
  startDate?: string;
  endDate?: string;
}): Promise<unknown> {
  const ctx = await loadAgentRunContext(params.agentId, params.runId);
  await assertScope(ctx, 'social.read');
  const creds = await requireOrbit(ctx.orgId);
  try {
    return await orbitListPosts(creds, {
      startDate: params.startDate,
      endDate: params.endDate,
    });
  } catch (err) {
    if (err instanceof OrbitApiError) throw new SocialToolError(err.message);
    throw err;
  }
}

export async function executeSocialAnalytics(params: {
  agentId: string;
  runId: string | null;
  integrationId: string;
}): Promise<unknown> {
  const ctx = await loadAgentRunContext(params.agentId, params.runId);
  await assertScope(ctx, 'social.read');
  if (!ctx.orgId) throw new OrbitConnectorNotConfiguredError();
  await assertOrbitChannelOwnedByOrg(ctx.orgId, params.integrationId);
  const creds = await requireOrbit(ctx.orgId);
  try {
    return await orbitAnalytics(creds, params.integrationId);
  } catch (err) {
    if (err instanceof OrbitApiError) throw new SocialToolError(err.message);
    throw err;
  }
}

export async function executeSocialPublish(params: {
  agentId: string;
  runId: string | null;
  payload: unknown;
  jitToken?: string | null;
}): Promise<unknown> {
  const ctx = await loadAgentRunContext(params.agentId, params.runId);
  await assertScope(ctx, 'social.publish');

  const jitAutoApprove =
    process.env.QLIX_JIT_AUTO_APPROVE === '1' || process.env.QLIX_JIT_AUTO_APPROVE === 'true';
  const needsJit =
    !jitAutoApprove &&
    (ctx.jitScopes as PermissionScope[]).includes('social.publish') &&
    !(ctx.alwaysScopes as PermissionScope[]).includes('social.publish');

  if (needsJit) {
    const token = params.jitToken?.trim();
    if (!token) {
      const sessionGranted = await jitService.hasActiveConversationGrantForRun(
        params.runId,
        'social.publish',
      );
      if (!sessionGranted) {
        throw new JitTokenRequiredError('social.publish requires dashboard approval');
      }
      await jitService.touchConversationGrantForRun(params.runId, 'social.publish');
    } else {
      const ok = await actionsService.consumeJitToken({
        agentId: params.agentId,
        actionType: 'social.publish',
        token,
      });
      if (!ok) throw new JitTokenInvalidError('Invalid or already used jitToken for social.publish');
    }
  }

  const creds = await requireOrbit(ctx.orgId);

  // Enforce channel ownership for every integration id in the publish payload.
  const posts = (params.payload as { posts?: Array<{ integration?: { id?: string } }> })?.posts;
  if (Array.isArray(posts)) {
    for (const post of posts) {
      const id = post?.integration?.id?.trim();
      if (id) await assertOrbitChannelOwnedByOrg(ctx.orgId!, id);
    }
  }

  try {
    const result = await orbitCreatePosts(creds, params.payload);
    await appendEmailActionLog({
      agentId: params.agentId,
      userId: ctx.userId,
      actionType: 'social.publish',
      payload: { tool: 'social.publish' },
      status: 'success',
      riskLevel: 'high',
      teamRunId: ctx.teamRunId,
    }).catch(() => {});
    return result;
  } catch (err) {
    if (err instanceof OrbitApiError) throw new SocialToolError(err.message);
    throw err;
  }
}
