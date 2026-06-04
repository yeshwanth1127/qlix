import { prisma } from '../lib/prisma.js';
import { enqueueAgentRun } from '../agentChat/agentRunService.js';
import { getConnectedWhatsAppForOrg } from '../connectors/whatsappConnector.service.js';
import {
  getWhatsAppSessionStatus,
  isWhatsAppServiceConfigured,
  startWhatsAppSession,
} from '../connectors/whatsappServiceClient.js';
import { sendMessage, sendNotification } from '../jit/whatsappNotifier.js';
import type { ConnectorAccountDTO } from '../connectors/connectors.types.js';
import { ConnectorsRepository } from '../connectors/connectors.repository.js';
import { goalRequestsWhatsAppDelivery } from './whatsappDeliveryIntent.js';
import {
  parseWhatsAppRunModifiers,
  resolveUseBrainForWhatsAppRun,
} from './whatsappRunModifiers.js';

const WHATSAPP_BODY_MAX = 1500;

function truncateBody(text: string): string {
  return text.length > WHATSAPP_BODY_MAX ? `${text.slice(0, WHATSAPP_BODY_MAX)}…` : text;
}

function formatResultMessage(title: string, body: string): string {
  return `📋 *Qlix — ${title}*\n\n${body}`;
}

/** Ignore our own WhatsApp replies echoed back in self-chat. */
function isLikelyOutboundEcho(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  const markers = [
    'Qlix API error',
    'Multiple agents',
    'set a default agent in Connectors',
    'No team named',
    'Queued —',
    '📋 *Qlix',
    '*Team run active*',
    'Added guidance to active team run',
    'No active team run',
    'No active worker',
    'Could not inject',
    'Canceled team run',
    'No pending approval',
    '✅ Approved',
    '❌ Rejected',
    '*Qlix agents*',
    'No agents registered',
    '🚀 *',
    '▶️ ',
    '🚨 ',
  ];
  return markers.some((m) => t.startsWith(m) || t.includes(m));
}

export interface WhatsAppDeliveryResult {
  sent: boolean;
  reason?: string;
}

/**
 * Send plain text to the workspace's linked WhatsApp (if connected).
 */
export async function deliverTextToWorkspaceWhatsApp(
  orgId: string,
  input: { title: string; body: string; level?: 'info' | 'error' },
): Promise<WhatsAppDeliveryResult> {
  if (!isWhatsAppServiceConfigured()) {
    return { sent: false, reason: 'WhatsApp service not configured on backend' };
  }

  const connector = await getConnectedWhatsAppForOrg(orgId);
  if (!connector) {
    return { sent: false, reason: 'WhatsApp not linked in Connectors for this workspace' };
  }

  const body = truncateBody(input.body.trim());
  if (!body) {
    return { sent: false, reason: 'Empty message body' };
  }

  let session = await getWhatsAppSessionStatus(connector.id);
  if (!session.connected) {
    const restarted = await startWhatsAppSession(connector.id);
    if (restarted.ok) {
      await new Promise((r) => setTimeout(r, 2000));
      session = await getWhatsAppSessionStatus(connector.id);
    }
  }
  if (!session.connected) {
    return {
      sent: false,
      reason:
        'WhatsApp session is offline — open Connectors and re-link WhatsApp (or restart qlix-whatsapp-service)',
    };
  }

  const delivery =
    input.level === 'error'
      ? await sendNotification(connector.id, `${input.title}: ${body}`, 'error')
      : await sendMessage(connector.id, formatResultMessage(input.title, body));

  if (!delivery.ok) {
    return { sent: false, reason: delivery.error ?? 'WhatsApp send failed' };
  }
  return { sent: true };
}

/**
 * Deliver when user asked for WhatsApp in source text, or run was started from WhatsApp.
 */
export async function deliverRunResultToWhatsAppIfRequested(input: {
  orgId: string;
  title: string;
  body: string;
  sourceText: string;
  /** Inbound WhatsApp runs always notify even without keyword in prompt. */
  fromWhatsAppChannel?: boolean;
  /** If the agent's own description mentions WhatsApp, delivery triggers without a keyword in the prompt. */
  agentDescription?: string | null;
  success?: boolean;
  errorMessage?: string | null;
}): Promise<WhatsAppDeliveryResult> {
  const wantsDelivery =
    input.fromWhatsAppChannel === true ||
    goalRequestsWhatsAppDelivery(input.sourceText) ||
    goalRequestsWhatsAppDelivery(input.agentDescription ?? '');
  if (!wantsDelivery) {
    return { sent: false, reason: 'not_requested' };
  }

  if (input.success === false) {
    return deliverTextToWorkspaceWhatsApp(input.orgId, {
      title: input.title,
      body: input.errorMessage ?? 'Run failed',
      level: 'error',
    });
  }

  return deliverTextToWorkspaceWhatsApp(input.orgId, {
    title: input.title,
    body: input.body,
  });
}

const repo = new ConnectorsRepository();

/** Parse optional `@AgentName: message` or `@AgentName message` prefix. */
export function parseAgentTarget(text: string): { agentName: string | null; prompt: string } {
  const colon = text.match(/^@([^:]+):\s*([\s\S]*)$/);
  if (colon) {
    return { agentName: colon[1]!.trim(), prompt: colon[2]!.trim() || text };
  }
  const bare = text.match(/^@(\S+)\s+([\s\S]+)$/);
  if (bare) {
    return { agentName: bare[1]!.trim(), prompt: bare[2]!.trim() };
  }
  return { agentName: null, prompt: text };
}

function agentScopeWhere(connector: ConnectorAccountDTO) {
  const userId = connector.userId;
  return { OR: [{ orgId: connector.orgId }, { userId, orgId: null }] as const };
}

async function findAgentByName(
  connector: ConnectorAccountDTO,
  agentName: string,
): Promise<{ id: string; name: string } | null> {
  return prisma.agent.findFirst({
    where: {
      name: { equals: agentName.trim(), mode: 'insensitive' },
      ...agentScopeWhere(connector),
    },
    select: { id: true, name: true },
  });
}

async function resolveAgentId(
  connector: ConnectorAccountDTO,
  agentName: string | null,
): Promise<{ id: string; name: string }> {
  const userId = connector.userId;

  if (agentName) {
    const byName = await findAgentByName(connector, agentName);
    if (!byName) throw new Error(`No agent named "${agentName}"`);
    return byName;
  }

  if (connector.whatsappDefaultAgentId) {
    const agent = await prisma.agent.findFirst({
      where: {
        id: connector.whatsappDefaultAgentId,
        ...agentScopeWhere(connector),
      },
      select: { id: true, name: true },
    });
    if (!agent) throw new Error('Default WhatsApp agent is invalid — re-save it in Connectors');
    return agent;
  }

  const routable = await prisma.agent.findMany({
    where: {
      ...agentScopeWhere(connector),
      agentKind: { not: 'org_brain' },
    },
    select: { id: true, name: true, runtime: true },
    orderBy: { createdAt: 'asc' },
  });

  if (routable.length === 0) {
    throw new Error('No agents registered for WhatsApp (org brain cannot be triggered from chat)');
  }
  if (routable.length === 1) return routable[0]!;

  const hybridAgents = routable.filter((a) => a.runtime === 'hybrid');
  if (hybridAgents.length === 1) return hybridAgents[0]!;

  const names = routable.map((a) => a.name).join(', ');
  throw new Error(
    `Which agent? You have: ${names}. Use @AgentName: your message (e.g. @local: …) or set Fallback default agent in Connectors.`,
  );
}

async function ensureConversation(
  agentId: string,
  userId: string,
  orgId: string | null,
): Promise<string> {
  const convo = await prisma.agentConversation.upsert({
    where: { agentId_userId: { agentId, userId } },
    create: { agentId, userId, orgId },
    update: {},
    select: { id: true },
  });
  return convo.id;
}

async function enqueueWhatsAppAgentRun(
  connector: ConnectorAccountDTO,
  agent: { id: string; name: string },
  prompt: string,
  brainFlag: boolean,
): Promise<{ reply: string }> {
  const agentRow = await prisma.agent.findUnique({
    where: { id: agent.id },
    select: { orgId: true, permissionScopes: true, runtime: true },
  });

  const useBrain = resolveUseBrainForWhatsAppRun({
    modifierFlag: brainFlag,
    prompt,
    permissionScopes: agentRow?.permissionScopes ?? [],
  });

  const conversationId = await ensureConversation(
    agent.id,
    connector.userId,
    agentRow?.orgId ?? connector.orgId,
  );

  await enqueueAgentRun({
    agentId: agent.id,
    conversationId,
    userId: connector.userId,
    orgId: agentRow?.orgId ?? connector.orgId,
    prompt,
    useBrain,
    teamRole: 'whatsapp',
  });

  const hints: string[] = [];
  if (useBrain) hints.push('brain on');
  const suffix = hints.length > 0 ? ` (${hints.join(', ')})` : '';
  return { reply: `Queued — ${agent.name} is on it.${suffix}` };
}

export async function handleWhatsAppInbound(
  connectorId: string,
  text: string,
): Promise<{ reply: string }> {
  const connector = await repo.findById(connectorId);
  if (!connector || connector.status !== 'connected') {
    throw new Error('WhatsApp not connected for this workspace');
  }

  const trimmed = text.trim();
  if (isLikelyOutboundEcho(trimmed)) {
    return { reply: '' };
  }

  const lower = trimmed.toLowerCase();
  if (lower.startsWith('!status')) {
    const { formatTeamRunStatus } = await import('../teams/teamChannel.service.js');
    const teamStatus = await formatTeamRunStatus(connectorId);
    if (teamStatus) return { reply: teamStatus };
    const agentStatus = await formatAgentsStatus(connectorId);
    return { reply: agentStatus };
  }

  const { useBrain: brainFlag, text: routedText } = parseWhatsAppRunModifiers(trimmed);
  const { agentName, prompt } = parseAgentTarget(routedText);

  // `@local:` / `@AgentName:` must hit agents when the name matches — not team routing.
  if (agentName) {
    const namedAgent = await findAgentByName(connector, agentName);
    if (namedAgent) {
      if (!prompt) {
        return {
          reply: `Add your request after @${namedAgent.name}: …`,
        };
      }
      return enqueueWhatsAppAgentRun(connector, namedAgent, prompt, brainFlag);
    }
  }

  const { tryHandleTeamWhatsAppInbound } = await import('../teams/teamChannel.service.js');
  const teamResult = await tryHandleTeamWhatsAppInbound(connector, trimmed);
  if (teamResult.handled) {
    return { reply: teamResult.reply };
  }

  if (!prompt) {
    return {
      reply:
        'Send a message or use @AgentName: your request\n' +
        '• Add #brain to use company AI brain\n' +
        '• Hybrid agents can open files on your PC (say "open" + full path)',
    };
  }

  const agent = await resolveAgentId(connector, agentName);
  return enqueueWhatsAppAgentRun(connector, agent, prompt, brainFlag);
}

export async function formatAgentsStatus(connectorId: string): Promise<string> {
  const connector = await repo.findById(connectorId);
  if (!connector) throw new Error('Connector not found');

  const agents = await prisma.agent.findMany({
    where: { OR: [{ orgId: connector.orgId }, { userId: connector.userId }] },
    select: {
      id: true,
      name: true,
      status: true,
      cloudProvisioningStatus: true,
      runs: {
        where: { status: { in: ['queued', 'running'] } },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { id: true, status: true, prompt: true },
      },
    },
    orderBy: { name: 'asc' },
  });

  if (agents.length === 0) return 'No agents registered in Qlix.';

  const lines = ['*Qlix agents*', ''];
  for (const a of agents) {
    const run = a.runs[0];
    const runLine = run
      ? ` — run ${run.status}: ${run.prompt.slice(0, 60)}${run.prompt.length > 60 ? '…' : ''}`
      : '';
    lines.push(
      `• ${a.name} (${a.status}${a.cloudProvisioningStatus ? `, cloud ${a.cloudProvisioningStatus}` : ''})${runLine}`,
    );
  }
  return lines.join('\n');
}

export async function stopAgentByName(connectorId: string, name: string): Promise<string> {
  const connector = await repo.findById(connectorId);
  if (!connector) throw new Error('Connector not found');

  const agent = await prisma.agent.findFirst({
    where: {
      name: { equals: name, mode: 'insensitive' },
      OR: [{ orgId: connector.orgId }, { userId: connector.userId }],
    },
    select: { id: true, name: true },
  });
  if (!agent) return `No agent named "${name}".`;

  const updated = await prisma.agentRun.updateMany({
    where: {
      agentId: agent.id,
      status: { in: ['queued', 'running'] },
    },
    data: { status: 'cancelled', finishedAt: new Date() },
  });

  return updated.count > 0
    ? `Stopped ${updated.count} run(s) for ${agent.name}.`
    : `No active runs for ${agent.name}.`;
}

export async function notifyWhatsappRunComplete(runId: string): Promise<void> {
  const run = await prisma.agentRun.findUnique({
    where: { id: runId },
    select: {
      teamRole: true,
      status: true,
      result: true,
      errorMessage: true,
      prompt: true,
      orgId: true,
      userId: true,
      agent: { select: { name: true, description: true, orgId: true } },
    },
  });
  if (!run) return;

  const orgId = run.orgId ?? run.agent?.orgId;
  if (!orgId) {
    const user = await prisma.user.findUnique({
      where: { id: run.userId },
      select: { orgId: true },
    });
    if (!user) return;
    await deliverRunResultToWhatsAppIfRequested({
      orgId: user.orgId,
      title: run.agent?.name ?? 'Agent',
      body: extractAgentRunResultText(run.result),
      sourceText: run.prompt,
      agentDescription: run.agent?.description,
      fromWhatsAppChannel: run.teamRole === 'whatsapp',
      success: run.status === 'success',
      errorMessage: run.errorMessage,
    });
    return;
  }

  const delivery = await deliverRunResultToWhatsAppIfRequested({
    orgId,
    title: run.agent?.name ?? 'Agent',
    body: extractAgentRunResultText(run.result),
    sourceText: run.prompt,
    agentDescription: run.agent?.description,
    fromWhatsAppChannel: run.teamRole === 'whatsapp',
    success: run.status === 'success',
    errorMessage: run.errorMessage,
  });
  if (!delivery.sent && delivery.reason && delivery.reason !== 'not_requested') {
    console.warn('[whatsapp] agent run delivery skipped:', delivery.reason);
  }
}

export function extractAgentRunResultText(result: unknown): string {
  if (typeof result === 'string') return result;
  if (result == null) return '';
  return JSON.stringify(result, null, 2);
}

export async function handleInternalAlert(message: string, source?: string): Promise<void> {
  console.warn(`[internal-alert] ${source ?? 'unknown'}: ${message}`);
}
