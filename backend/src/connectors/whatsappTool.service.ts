import { ActionsService, JitTokenInvalidError, JitTokenRequiredError } from '../actions/actions.service.js';
import type { PermissionScope } from '../agents/agents.types.js';
import { prisma } from '../lib/prisma.js';
import { JitService } from '../jit/jit.service.js';
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
  input: { recipient: string; message: string; jitToken?: string | null };
}): Promise<{ jid?: string; phone?: string | null; name?: string | null }> {
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

  return { jid: result.jid, phone: result.phone, name: result.name };
}
