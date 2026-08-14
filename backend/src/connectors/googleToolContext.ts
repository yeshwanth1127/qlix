/**
 * Shared agent-run context, Google token refresh, JIT, and audit for Drive / Calendar / Meet tools.
 */
import crypto from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { ActionsService, JitTokenInvalidError, JitTokenRequiredError } from '../actions/actions.service.js';
import type { PermissionScope } from '../agents/agents.types.js';
import { prisma } from '../lib/prisma.js';
import { loadJwtSecret } from '../middleware/authenticateUser.js';
import { JitService } from '../jit/jit.service.js';
import { ConnectorsRepository } from './connectors.repository.js';
import { refreshGoogleAccessToken } from './googleOAuth.service.js';
import {
  googleServiceConnected,
  type GoogleServiceId,
} from './googleServices.js';
import {
  calendarConnectorNotConnectedMessage,
  docsConnectorNotConnectedMessage,
  driveConnectorNotConnectedMessage,
  formsConnectorNotConnectedMessage,
  meetConnectorNotConnectedMessage,
  sheetsConnectorNotConnectedMessage,
  slidesConnectorNotConnectedMessage,
} from './connectorUserMessages.js';

const repo = new ConnectorsRepository();
const actionsService = new ActionsService();
const jitService = new JitService();

export class GoogleConnectorNotConfiguredError extends Error {
  readonly code = 'connector_not_configured';
  readonly serviceId: GoogleServiceId;
  constructor(serviceId: GoogleServiceId, message: string) {
    super(message);
    this.serviceId = serviceId;
  }
}

export class GoogleScopeDeniedError extends Error {
  readonly code = 'scope_denied';
  constructor(scope: string) {
    super(`Agent lacks effective scope: ${scope}`);
  }
}

export class GoogleToolError extends Error {
  readonly code = 'google_tool_failed';
}

export type GoogleWorkspaceActionType =
  | 'drive.read'
  | 'drive.write'
  | 'docs.read'
  | 'docs.write'
  | 'sheets.read'
  | 'sheets.write'
  | 'slides.read'
  | 'slides.write'
  | 'forms.read'
  | 'forms.write'
  | 'calendar.read'
  | 'calendar.write'
  | 'meet.manage';

export interface GoogleAgentRunContext {
  runSkills: string[];
  teamRunId: string | null;
  userId: string;
  orgId: string | null;
  permissionScopes: string[];
  alwaysScopes: string[];
  jitScopes: string[];
}

export function effectiveGoogleScopes(params: {
  permissionScopes: string[];
  alwaysScopes: string[];
  runSkills: string[];
}): Set<string> {
  const granted = new Set([...params.permissionScopes, ...params.alwaysScopes]);
  if (params.runSkills.length > 0) {
    return new Set([...granted].filter((s) => params.runSkills.includes(s)));
  }
  return granted;
}

export async function loadGoogleAgentRunContext(
  agentId: string,
  runId: string | null,
): Promise<GoogleAgentRunContext> {
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
  if (!agent) throw new GoogleToolError('Agent not found');

  let runSkills: string[] = [];
  let teamRunId: string | null = null;
  if (runId) {
    const run = await prisma.agentRun.findUnique({
      where: { id: runId },
      select: { skills: true, teamRunId: true, agentId: true },
    });
    if (run && run.agentId === agentId) {
      runSkills = run.skills;
      teamRunId = run.teamRunId;
    }
  }

  return {
    runSkills,
    teamRunId,
    userId: agent.userId,
    orgId: agent.orgId ?? agent.user.orgId,
    permissionScopes: agent.permissionScopes as string[],
    alwaysScopes: agent.alwaysScopes as string[],
    jitScopes: agent.jitScopes as string[],
  };
}

function notConnectedMessage(serviceId: GoogleServiceId): string {
  if (serviceId === 'drive') return driveConnectorNotConnectedMessage();
  if (serviceId === 'docs') return docsConnectorNotConnectedMessage();
  if (serviceId === 'sheets') return sheetsConnectorNotConnectedMessage();
  if (serviceId === 'slides') return slidesConnectorNotConnectedMessage();
  if (serviceId === 'forms') return formsConnectorNotConnectedMessage();
  if (serviceId === 'calendar') return calendarConnectorNotConnectedMessage();
  if (serviceId === 'meet') return meetConnectorNotConnectedMessage();
  return 'Google service is not connected for this workspace.';
}

export async function getFreshGoogleAccessToken(
  orgId: string,
  serviceId: GoogleServiceId,
): Promise<string> {
  const tokens = await repo.loadTokens(orgId, 'google');
  if (!tokens || !googleServiceConnected(serviceId, tokens.scopes ?? [])) {
    throw new GoogleConnectorNotConfiguredError(serviceId, notConnectedMessage(serviceId));
  }

  const bufferMs = 60_000;
  if (tokens.expiresAtMs && tokens.expiresAtMs - Date.now() > bufferMs) {
    return tokens.accessToken;
  }

  const refreshed = await refreshGoogleAccessToken(tokens.refreshToken);
  const updated = {
    ...tokens,
    accessToken: refreshed.accessToken,
    expiresAtMs: refreshed.expiresAtMs,
  };
  await repo.saveTokens(orgId, 'google', updated);
  return refreshed.accessToken;
}

/** Enforce JIT for write scopes (drive.write / calendar.write / meet.manage). */
export async function requireGoogleJitIfNeeded(params: {
  agentId: string;
  runId: string | null;
  ctx: GoogleAgentRunContext;
  actionType: GoogleWorkspaceActionType;
  jitToken?: string | null;
}): Promise<void> {
  const jitAutoApprove =
    process.env.QLIX_JIT_AUTO_APPROVE === '1' || process.env.QLIX_JIT_AUTO_APPROVE === 'true';
  const needsJit =
    !jitAutoApprove &&
    (params.ctx.jitScopes as PermissionScope[]).includes(params.actionType as PermissionScope) &&
    !(params.ctx.alwaysScopes as PermissionScope[]).includes(params.actionType as PermissionScope);

  if (!needsJit) return;

  const token = params.jitToken?.trim();
  if (!token) {
    const sessionGranted = await jitService.hasActiveConversationGrantForRun(
      params.runId,
      params.actionType,
    );
    if (!sessionGranted) {
      throw new JitTokenRequiredError(`${params.actionType} requires dashboard approval`);
    }
    await jitService.touchConversationGrantForRun(params.runId, params.actionType);
    return;
  }

  const ok = await actionsService.consumeJitToken({
    agentId: params.agentId,
    actionType: params.actionType,
    token,
  });
  if (!ok) throw new JitTokenInvalidError(`Invalid or already used jitToken for ${params.actionType}`);
}

function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

export async function appendGoogleActionLog(input: {
  agentId: string;
  userId: string;
  actionType: GoogleWorkspaceActionType;
  payload: Record<string, unknown>;
  status: 'success' | 'blocked' | 'failed';
  riskLevel: 'low' | 'medium' | 'high';
  teamRunId?: string | null;
}): Promise<void> {
  const secret = loadJwtSecret();
  const timestampMs = BigInt(Date.now());
  const last = await prisma.actionLog.findFirst({
    where: { agentId: input.agentId },
    orderBy: { timestampMs: 'desc' },
    select: { signature: true },
  });
  const prevHash = last ? sha256Hex(last.signature) : '';
  const signaturePayload = {
    kind: 'google_workspace_tool_event' as const,
    agentId: input.agentId,
    userId: input.userId,
    actionType: input.actionType,
    timestampMs: timestampMs.toString(),
    prevHash,
    payloadSummary: input.payload,
    teamRunId: input.teamRunId ?? null,
  };
  const signature = `qlix:hmac:${crypto
    .createHmac('sha256', secret)
    .update(canonicalJson(signaturePayload))
    .digest('hex')}`;

  await prisma.actionLog.create({
    data: {
      agentId: input.agentId,
      userId: input.userId,
      actionType: input.actionType,
      payload: {
        phase: 'google_workspace_tool',
        ...input.payload,
        teamRunId: input.teamRunId ?? null,
      } as Prisma.InputJsonValue,
      riskLevel: input.riskLevel,
      status: input.status,
      approvalStatus: 'not_required',
      signature,
      prevHash,
      timestampMs,
    },
  });
}
