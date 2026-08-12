import { ActionsService, JitTokenInvalidError, JitTokenRequiredError } from '../actions/actions.service.js';
import type { PermissionScope } from '../agents/agents.types.js';
import { prisma } from '../lib/prisma.js';
import { JitService } from '../jit/jit.service.js';
import { WaitTriggerService } from '../teams/waitTrigger.service.js';
import { goalRequestsReplyWait } from '../wait/waitPolicy.js';
import { appendEmailActionLog } from './emailAudit.service.js';
import { getWhatsAppConnectorForAgent } from './whatsappConnector.service.js';
import {
  getWhatsAppChatMessages,
  getWhatsAppSessionStatus,
  isWhatsAppServiceConfigured,
  listWhatsAppContacts,
  sendWhatsAppToRecipient,
  startWhatsAppSession,
} from './whatsappServiceClient.js';

const actionsService = new ActionsService();
const jitService = new JitService();
const waitTriggers = new WaitTriggerService();

async function getTeamReplyWaitContext(runId: string | null): Promise<{
  teamRunId: string;
  orgId: string;
  userId: string;
} | null> {
  if (!runId) return null;
  const agentRun = await prisma.agentRun.findUnique({
    where: { id: runId },
    select: {
      teamRun: {
        select: {
          id: true,
          orgId: true,
          startedByUserId: true,
          status: true,
          goal: true,
          team: { select: { config: true } },
        },
      },
    },
  });
  const teamRun = agentRun?.teamRun;
  if (!teamRun || teamRun.status !== 'running') return null;
  const teamConfig = (teamRun.team?.config ?? {}) as { waitSteps?: unknown[] };
  const waitsConfigured =
    goalRequestsReplyWait(teamRun.goal) ||
    (Array.isArray(teamConfig.waitSteps) && teamConfig.waitSteps.length > 0);
  if (!waitsConfigured) return null;
  return {
    teamRunId: teamRun.id,
    orgId: teamRun.orgId,
    userId: teamRun.startedByUserId,
  };
}

export class WhatsAppScopeDeniedError extends Error {
  readonly code = 'scope_denied';
  constructor(scope: string) {
    super(`Agent is not granted scope: ${scope}`);
  }
}

export class WhatsAppToolError extends Error {
  readonly code = 'whatsapp_tool_error';
  constructor(message: string) {
    super(message);
  }
}

export class WhatsAppNotLinkedError extends Error {
  readonly code = 'whatsapp_not_linked';
  constructor() {
    super('WhatsApp is not linked. Link it in Connectors.');
  }
}

async function loadAgentRunContext(agentId: string) {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: {
      id: true,
      userId: true,
      orgId: true,
      permissionScopes: true,
      jitScopes: true,
      alwaysScopes: true,
    },
  });
  if (!agent) throw new WhatsAppToolError('Agent not found');
  return agent;
}

async function ensureLiveWhatsApp(agentId: string) {
  if (!isWhatsAppServiceConfigured()) {
    throw new WhatsAppToolError('WhatsApp service is not configured on the backend');
  }
  const connector = await getWhatsAppConnectorForAgent(agentId);
  if (!connector) throw new WhatsAppNotLinkedError();

  let session = await getWhatsAppSessionStatus(connector.id);
  if (!session.connected) {
    const restarted = await startWhatsAppSession(connector.id);
    if (restarted.ok) {
      await new Promise((r) => setTimeout(r, 2000));
      session = await getWhatsAppSessionStatus(connector.id);
    }
  }
  if (!session.connected) {
    throw new WhatsAppToolError('WhatsApp session is offline — re-link WhatsApp in Connectors.');
  }
  return connector;
}

async function assertWhatsAppContactSendJit(params: {
  agentId: string;
  runId: string | null;
  ctx: Awaited<ReturnType<typeof loadAgentRunContext>>;
  jitToken?: string | null;
}): Promise<void> {
  const jitAutoApprove =
    process.env.QLIX_JIT_AUTO_APPROVE === '1' || process.env.QLIX_JIT_AUTO_APPROVE === 'true';
  const needsJit =
    !jitAutoApprove &&
    (params.ctx.jitScopes as PermissionScope[]).includes('whatsapp.contact_send') &&
    !(params.ctx.alwaysScopes as PermissionScope[]).includes('whatsapp.contact_send');

  if (!needsJit) return;

  const token = params.jitToken?.trim();
  if (!token) {
    const sessionGranted = await jitService.hasActiveConversationGrantForRun(
      params.runId,
      'whatsapp.contact_send',
    );
    if (!sessionGranted) {
      throw new JitTokenRequiredError('whatsapp.contact_send requires dashboard approval');
    }
    await jitService.touchConversationGrantForRun(params.runId, 'whatsapp.contact_send');
    return;
  }

  const ok = await actionsService.consumeJitToken({
    agentId: params.agentId,
    actionType: 'whatsapp.contact_send',
    token,
  });
  if (!ok) throw new JitTokenInvalidError('Invalid or already used jitToken for whatsapp.contact_send');
}

export async function executeWhatsAppListContacts(params: {
  agentId: string;
  runId: string | null;
  input: { query?: string; limit?: number };
}): Promise<{ contacts: Array<{ jid: string; phone: string | null; name: string | null }>; totalMatched?: number }> {
  const ctx = await loadAgentRunContext(params.agentId);
  const scopes = new Set([
    ...(ctx.permissionScopes as string[]),
    ...(ctx.alwaysScopes as string[]),
  ]);
  if (!scopes.has('whatsapp.read') && !scopes.has('whatsapp.contact_send')) {
    throw new WhatsAppScopeDeniedError('whatsapp.read');
  }

  const connector = await ensureLiveWhatsApp(params.agentId);
  const result = await listWhatsAppContacts({
    connectorId: connector.id,
    query: params.input.query,
    limit: params.input.limit,
  });
  if (!result.ok) throw new WhatsAppToolError(result.error ?? 'Failed to list contacts');

  await appendEmailActionLog({
    agentId: params.agentId,
    userId: ctx.userId,
    actionType: 'whatsapp.read',
    payload: { tool: 'whatsapp_list_contacts', query: params.input.query ?? null, runId: params.runId },
    status: 'success',
    riskLevel: 'low',
  }).catch(() => {});

  return { contacts: result.contacts ?? [], totalMatched: result.totalMatched };
}

export async function executeWhatsAppReadChat(params: {
  agentId: string;
  runId: string | null;
  input: { recipient: string; limit?: number };
}): Promise<{
  jid?: string;
  name?: string | null;
  phone?: string | null;
  messages: Array<{
    id: string | null;
    fromMe: boolean;
    text: string;
    timestamp: string;
    pushName: string | null;
  }>;
  note?: string;
}> {
  const ctx = await loadAgentRunContext(params.agentId);
  const scopes = new Set([
    ...(ctx.permissionScopes as string[]),
    ...(ctx.alwaysScopes as string[]),
  ]);
  if (!scopes.has('whatsapp.read')) throw new WhatsAppScopeDeniedError('whatsapp.read');

  const connector = await ensureLiveWhatsApp(params.agentId);
  const result = await getWhatsAppChatMessages({
    connectorId: connector.id,
    recipient: params.input.recipient,
    limit: params.input.limit,
  });
  if (!result.ok) {
    if (result.matches?.length) {
      throw new WhatsAppToolError(
        `${result.error ?? 'Ambiguous recipient'}: ${result.matches
          .map((m) => `${m.name ?? 'unknown'} (${m.phone ?? m.jid})`)
          .join(', ')}`,
      );
    }
    throw new WhatsAppToolError(result.error ?? 'Failed to read chat');
  }

  await appendEmailActionLog({
    agentId: params.agentId,
    userId: ctx.userId,
    actionType: 'whatsapp.read',
    payload: {
      tool: 'whatsapp_read_chat',
      recipient: params.input.recipient,
      jid: result.jid ?? null,
      messageCount: result.messages?.length ?? 0,
      runId: params.runId,
    },
    status: 'success',
    riskLevel: 'medium',
  }).catch(() => {});

  return {
    jid: result.jid,
    name: result.name,
    phone: result.phone,
    messages: (result.messages ?? []).map((m) => ({
      id: m.id,
      fromMe: m.from_me,
      text: m.text,
      timestamp: m.timestamp,
      pushName: m.push_name,
    })),
    note: result.note,
  };
}

export async function executeWhatsAppContactSend(params: {
  agentId: string;
  runId: string | null;
  input: {
    recipient: string;
    message: string;
    jitToken?: string | null;
    replyInstructions?: string | null;
  };
}): Promise<{
  jid?: string;
  phone?: string | null;
  name?: string | null;
  autoReplyArmed?: boolean;
  teamWaitArmed?: boolean;
  replyInstructionsSet?: boolean;
}> {
  const ctx = await loadAgentRunContext(params.agentId);
  const scopes = new Set([
    ...(ctx.permissionScopes as string[]),
    ...(ctx.alwaysScopes as string[]),
  ]);
  if (!scopes.has('whatsapp.contact_send')) {
    throw new WhatsAppScopeDeniedError('whatsapp.contact_send');
  }

  await assertWhatsAppContactSendJit({
    agentId: params.agentId,
    runId: params.runId,
    ctx,
    jitToken: params.input.jitToken,
  });

  const connector = await ensureLiveWhatsApp(params.agentId);
  const result = await sendWhatsAppToRecipient({
    connectorId: connector.id,
    recipient: params.input.recipient,
    message: params.input.message,
  });
  if (!result.ok) {
    if (result.matches?.length) {
      throw new WhatsAppToolError(
        `${result.error ?? 'Ambiguous recipient'}: ${result.matches
          .map((m) => `${m.name ?? 'unknown'} (${m.phone ?? m.jid})`)
          .join(', ')}`,
      );
    }
    throw new WhatsAppToolError(result.error ?? 'Failed to send WhatsApp message');
  }

  await appendEmailActionLog({
    agentId: params.agentId,
    userId: ctx.userId,
    actionType: 'whatsapp.contact_send',
    payload: {
      tool: 'whatsapp_send_message',
      recipient: params.input.recipient,
      jid: result.jid ?? null,
      name: result.name ?? null,
      messagePreview: params.input.message.slice(0, 200),
      runId: params.runId,
    },
    status: 'success',
    riskLevel: 'high',
  }).catch(() => {});

  let autoReplyArmed = false;
  let teamWaitArmed = false;
  let replyInstructionsSet = false;
  if (scopes.has('whatsapp.auto_reply') && result.jid) {
    try {
      const { armAutoReplySession, normalizeReplyInstructions } = await import(
        '../whatsapp/whatsappAutoReply.service.js'
      );
      const instructions = normalizeReplyInstructions(params.input.replyInstructions);
      const teamWait = await getTeamReplyWaitContext(params.runId);
      if (teamWait) {
        await waitTriggers.armTeamWhatsAppWait({
          teamRunId: teamWait.teamRunId,
          orgId: teamWait.orgId,
          userId: teamWait.userId,
          agentId: params.agentId,
          connectorId: connector.id,
          contactJid: result.jid,
          replyInstructions: instructions,
        });
        teamWaitArmed = true;
      } else {
        await armAutoReplySession({
          connectorId: connector.id,
          agentId: params.agentId,
          contactJid: result.jid,
          contactName: result.name ?? null,
          contactPhone: result.phone ?? null,
          replyInstructions: instructions,
          userId: ctx.userId,
        });
        autoReplyArmed = true;
      }
      replyInstructionsSet = Boolean(instructions);
    } catch (err) {
      console.warn(
        '[whatsapp-auto-reply] arm failed:',
        err instanceof Error ? err.message : err,
      );
    }
  }

  return {
    jid: result.jid,
    phone: result.phone,
    name: result.name,
    autoReplyArmed,
    teamWaitArmed,
    replyInstructionsSet,
  };
}

export async function executeWhatsAppAutoReplyStatus(params: {
  agentId: string;
  runId: string | null;
}): Promise<{ sessions: unknown[]; note?: string }> {
  const ctx = await loadAgentRunContext(params.agentId);
  const scopes = new Set([
    ...(ctx.permissionScopes as string[]),
    ...(ctx.alwaysScopes as string[]),
  ]);
  if (!scopes.has('whatsapp.auto_reply')) {
    throw new WhatsAppScopeDeniedError('whatsapp.auto_reply');
  }

  const connector = await getWhatsAppConnectorForAgent(params.agentId);
  const { listAutoReplySessions } = await import('../whatsapp/whatsappAutoReply.service.js');
  const sessions = await listAutoReplySessions({
    agentId: params.agentId,
    connectorId: connector?.id ?? null,
  });
  return {
    sessions,
    note:
      sessions.length === 0
        ? 'No active auto-reply listeners. Send a message with whatsapp_send_message to arm one.'
        : undefined,
  };
}

export async function executeWhatsAppAutoReplyStop(params: {
  agentId: string;
  runId: string | null;
  input: { recipient?: string | null };
}): Promise<{ stopped: number }> {
  const ctx = await loadAgentRunContext(params.agentId);
  const scopes = new Set([
    ...(ctx.permissionScopes as string[]),
    ...(ctx.alwaysScopes as string[]),
  ]);
  if (!scopes.has('whatsapp.auto_reply')) {
    throw new WhatsAppScopeDeniedError('whatsapp.auto_reply');
  }

  const connector = await getWhatsAppConnectorForAgent(params.agentId);
  const { stopAutoReplySessions } = await import('../whatsapp/whatsappAutoReply.service.js');
  return stopAutoReplySessions({
    agentId: params.agentId,
    recipient: params.input.recipient,
    connectorId: connector?.id ?? null,
    userId: ctx.userId,
  });
}

export async function executeWhatsAppAutoReplySetInstructions(params: {
  agentId: string;
  runId: string | null;
  input: { recipient: string; instructions: string };
}): Promise<{
  session: unknown;
  note: string;
}> {
  const ctx = await loadAgentRunContext(params.agentId);
  const scopes = new Set([
    ...(ctx.permissionScopes as string[]),
    ...(ctx.alwaysScopes as string[]),
  ]);
  if (!scopes.has('whatsapp.auto_reply')) {
    throw new WhatsAppScopeDeniedError('whatsapp.auto_reply');
  }

  const instructions = params.input.instructions.trim();
  if (!instructions) {
    throw new WhatsAppToolError('instructions are required');
  }

  const connector = await ensureLiveWhatsApp(params.agentId);
  const {
    findOrMatchSessionForInstructions,
    setAutoReplyInstructions,
  } = await import('../whatsapp/whatsappAutoReply.service.js');

  const existing = await findOrMatchSessionForInstructions({
    agentId: params.agentId,
    connectorId: connector.id,
    recipient: params.input.recipient,
  });

  let contactJid = existing?.contactJid ?? null;
  let contactName = existing?.contactName ?? null;
  let contactPhone = existing?.contactPhone ?? null;

  if (!contactJid) {
    // Resolve via chat lookup (same recipient resolver as read-chat).
    const resolved = await getWhatsAppChatMessages({
      connectorId: connector.id,
      recipient: params.input.recipient,
      limit: 1,
    });
    if (!resolved.ok || !resolved.jid) {
      if (resolved.matches?.length) {
        throw new WhatsAppToolError(
          `${resolved.error ?? 'Ambiguous recipient'}: ${resolved.matches
            .map((m) => `${m.name ?? 'unknown'} (${m.phone ?? m.jid})`)
            .join(', ')}`,
        );
      }
      throw new WhatsAppToolError(
        resolved.error ??
          `Could not resolve recipient "${params.input.recipient}". Send them a message first, or pass a phone/jid.`,
      );
    }
    contactJid = resolved.jid;
    contactName = resolved.name ?? null;
    contactPhone = resolved.phone ?? null;
  }

  const session = await setAutoReplyInstructions({
    connectorId: connector.id,
    agentId: params.agentId,
    contactJid,
    contactName,
    contactPhone,
    instructions,
    userId: ctx.userId,
  });

  return {
    session,
    note: `When ${session.contactName || session.contactPhone || session.contactJid} replies, this agent will run with your instructions.`,
  };
}
