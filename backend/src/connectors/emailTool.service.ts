import { decryptForAgentSecrets } from '../cloudRunners/agentSecrets.js';
import { ActionsService, JitTokenInvalidError, JitTokenRequiredError } from '../actions/actions.service.js';
import type { PermissionScope } from '../agents/agents.types.js';
import { prisma } from '../lib/prisma.js';
import { appendEmailActionLog } from './emailAudit.service.js';
import { ConnectorsRepository } from './connectors.repository.js';
import { refreshGoogleAccessToken } from './googleOAuth.service.js';
import type { EmailReadInput, EmailReadResult, EmailSendInput, EmailSendResult } from './connectors.types.js';

export class ConnectorNotConfiguredError extends Error {
  readonly code = 'connector_not_configured';
}

export class N8nNotConfiguredError extends Error {
  readonly code = 'n8n_not_configured';
}

export class EmailScopeDeniedError extends Error {
  readonly code = 'scope_denied';
  constructor(scope: string) {
    super(`Agent lacks effective scope: ${scope}`);
  }
}

export class EmailToolError extends Error {
  readonly code = 'email_tool_failed';
}

const repo = new ConnectorsRepository();
const actionsService = new ActionsService();

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
    },
  });
  if (!agent) throw new EmailToolError('Agent not found');

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
    orgId: agent.orgId,
    permissionScopes: agent.permissionScopes as string[],
    alwaysScopes: agent.alwaysScopes as string[],
    jitScopes: agent.jitScopes as string[],
  };
}

async function getFreshAccessToken(orgId: string): Promise<string> {
  const tokens = await repo.loadTokens(orgId, 'google');
  if (!tokens) throw new ConnectorNotConfiguredError('Google connector not connected');

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

async function callN8nWebhook(params: {
  orgId: string;
  path: string;
  body: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const settings = await repo.getN8nSettings(params.orgId);
  if (!settings?.n8nBaseUrl || !settings.n8nWebhookSecretEnc) {
    throw new N8nNotConfiguredError('n8n integration not configured for this organization');
  }
  const secret = decryptForAgentSecrets(settings.n8nWebhookSecretEnc);
  const url = `${settings.n8nBaseUrl.replace(/\/$/, '')}${params.path.startsWith('/') ? params.path : `/${params.path}`}`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify(params.body),
  });
  const text = await resp.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    parsed = { raw: text.slice(0, 4000) };
  }
  if (!resp.ok) {
    throw new EmailToolError(`n8n webhook failed (${resp.status}): ${text.slice(0, 500)}`);
  }
  return parsed;
}

function recipientDomains(to: string[]): string[] {
  return [...new Set(to.map((addr) => addr.split('@')[1]?.toLowerCase()).filter(Boolean))];
}

export async function executeEmailRead(params: {
  agentId: string;
  runId: string | null;
  input: EmailReadInput;
}): Promise<EmailReadResult> {
  const ctx = await loadAgentRunContext(params.agentId, params.runId);
  const scopes = effectiveScopes(ctx);
  if (!scopes.has('email.read')) throw new EmailScopeDeniedError('email.read');
  if (!ctx.orgId) throw new ConnectorNotConfiguredError('Agent must belong to an organization');

  const accessToken = await getFreshAccessToken(ctx.orgId);
  const settings = await repo.getN8nSettings(ctx.orgId);
  const path = settings?.n8nEmailReadPath ?? '/webhook/qlix-email-read';

  const n8nBody = {
    accessToken,
    query: params.input.query ?? 'is:unread',
    maxResults: Math.min(Math.max(params.input.maxResults ?? 10, 1), 25),
    messageId: params.input.messageId ?? null,
  };

  try {
    const result = await callN8nWebhook({ orgId: ctx.orgId, path, body: n8nBody });
    const messages = Array.isArray(result.messages) ? result.messages : [];
    await appendEmailActionLog({
      agentId: params.agentId,
      userId: ctx.userId,
      actionType: 'email.read',
      status: 'success',
      riskLevel: 'low',
      teamRunId: ctx.teamRunId,
      payload: {
        query: n8nBody.query,
        messageId: n8nBody.messageId,
        resultCount: messages.length,
      },
    });
    return { messages: messages as EmailReadResult['messages'] };
  } catch (err) {
    await appendEmailActionLog({
      agentId: params.agentId,
      userId: ctx.userId,
      actionType: 'email.read',
      status: 'failed',
      riskLevel: 'low',
      teamRunId: ctx.teamRunId,
      payload: { error: String((err as Error)?.message ?? err) },
    });
    throw err;
  }
}

export async function executeEmailSend(params: {
  agentId: string;
  runId: string | null;
  input: EmailSendInput;
}): Promise<EmailSendResult> {
  const ctx = await loadAgentRunContext(params.agentId, params.runId);
  const scopes = effectiveScopes(ctx);
  if (!scopes.has('email.send')) throw new EmailScopeDeniedError('email.send');
  if (!ctx.orgId) throw new ConnectorNotConfiguredError('Agent must belong to an organization');

  const needsJit =
    (ctx.jitScopes as PermissionScope[]).includes('email.send') &&
    !(ctx.alwaysScopes as PermissionScope[]).includes('email.send');

  if (needsJit) {
    if (!params.input.jitToken?.trim()) {
      throw new JitTokenRequiredError('email.send requires an approved jitToken');
    }
    const ok = await actionsService.consumeJitToken({
      agentId: params.agentId,
      actionType: 'email.send',
      token: params.input.jitToken.trim(),
    });
    if (!ok) throw new JitTokenInvalidError('Invalid or already used jitToken for email.send');
  }

  const accessToken = await getFreshAccessToken(ctx.orgId);
  const settings = await repo.getN8nSettings(ctx.orgId);
  const path = settings?.n8nEmailSendPath ?? '/webhook/qlix-email-send';

  const n8nBody = {
    accessToken,
    to: params.input.to,
    subject: params.input.subject,
    bodyText: params.input.bodyText,
    replyToMessageId: params.input.replyToMessageId ?? null,
  };

  try {
    const result = await callN8nWebhook({ orgId: ctx.orgId, path, body: n8nBody });
    await appendEmailActionLog({
      agentId: params.agentId,
      userId: ctx.userId,
      actionType: 'email.send',
      status: 'success',
      riskLevel: 'high',
      teamRunId: ctx.teamRunId,
      payload: {
        recipientDomains: recipientDomains(params.input.to),
        recipientCount: params.input.to.length,
        subjectPreview: params.input.subject.slice(0, 120),
        messageId: result.messageId ?? null,
      },
    });
    return {
      messageId: String(result.messageId ?? ''),
      threadId: String(result.threadId ?? ''),
      status: String(result.status ?? 'sent'),
    };
  } catch (err) {
    await appendEmailActionLog({
      agentId: params.agentId,
      userId: ctx.userId,
      actionType: 'email.send',
      status: 'failed',
      riskLevel: 'high',
      teamRunId: ctx.teamRunId,
      payload: { error: String((err as Error)?.message ?? err) },
    });
    throw err;
  }
}

export async function hasEmailConnector(orgId: string): Promise<boolean> {
  const account = await repo.findByOrgProvider(orgId, 'google');
  return account?.status === 'connected';
}
