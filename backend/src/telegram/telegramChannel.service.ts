import { prisma } from '../lib/prisma.js';
import type { ConnectorAccountDTO } from '../connectors/connectors.types.js';
import { ConnectorsRepository } from '../connectors/connectors.repository.js';
import {
  buildDisambiguationOptions,
  classifyWhatsAppIntent,
  formatDisambiguationMenu,
  parseDisambiguationSelection,
  routeHintForConfidence,
  type IntentRosterAgent,
  type IntentRouteDecision,
} from '../whatsapp/whatsappIntentRouter.js';
import {
  parseWhatsAppRunModifiers,
  resolveUseBrainForWhatsAppRun,
} from '../whatsapp/whatsappRunModifiers.js';
import {
  clearTelegramPendingRoute,
  getTelegramPendingRoute,
  resolveTelegramPendingSelection,
  saveTelegramPendingRoute,
} from './telegramPendingRoute.service.js';

const LOW_CONFIDENCE_THRESHOLD = 0.45;
const repo = new ConnectorsRepository();

function agentScopeWhere(connector: ConnectorAccountDTO) {
  const userId = connector.userId;
  return { OR: [{ orgId: connector.orgId }, { userId, orgId: null }] };
}

async function resolveDefaultAgent(
  connector: ConnectorAccountDTO,
): Promise<{ id: string; name: string } | null> {
  if (!connector.whatsappDefaultAgentId) return null;
  return prisma.agent.findFirst({
    where: {
      id: connector.whatsappDefaultAgentId,
      ...agentScopeWhere(connector),
      agentKind: { not: 'org_brain' },
    },
    select: { id: true, name: true },
  });
}

function formatQueuedReply(
  name: string,
  input: { useBrain: boolean; routeHint?: string | null },
): string {
  const hints: string[] = [];
  if (input.useBrain) hints.push('brain on');
  if (input.routeHint) hints.push(`matched: ${input.routeHint}`);
  const suffix = hints.length > 0 ? ` (${hints.join(', ')})` : '';
  return `Queued — ${name} is on it.${suffix}`;
}

async function ensureAgentConversation(input: {
  agentId: string;
  userId: string;
  orgId: string | null;
  telegramUserId: string;
  chatId: string;
}): Promise<string> {
  // Use primary chat so Telegram turns appear in the agent web chat panel
  // (AgentChatPanel boots via getOrCreatePrimaryConversation).
  const { getOrCreatePrimaryConversation } = await import('../agentChat/conversationService.js');
  const { buildSessionKey } = await import('../gateway/sessionKey.js');
  const convo = await getOrCreatePrimaryConversation({
    agentId: input.agentId,
    userId: input.userId,
    orgId: input.orgId,
  });
  const sessionKey = buildSessionKey({
    orgId: input.orgId,
    userId: input.userId,
    channel: 'telegram',
    peerId: input.telegramUserId,
    threadId: input.chatId,
  });
  await prisma.agentConversation
    .update({ where: { id: convo.id }, data: { sessionKey } })
    .catch(() => undefined);
  return convo.id;
}

async function enqueueTelegramAgentRun(input: {
  connector: ConnectorAccountDTO;
  agent: { id: string; name: string };
  prompt: string;
  brainFlag: boolean;
  telegramUserId: string;
  chatId: string;
  routeHint?: string | null;
}): Promise<{ reply: string }> {
  const agentRow = await prisma.agent.findUnique({
    where: { id: input.agent.id },
    select: { orgId: true, permissionScopes: true },
  });

  const useBrain = resolveUseBrainForWhatsAppRun({
    modifierFlag: input.brainFlag,
    prompt: input.prompt,
    permissionScopes: agentRow?.permissionScopes ?? [],
  });

  const orgId = agentRow?.orgId ?? input.connector.orgId;
  const conversationId = await ensureAgentConversation({
    agentId: input.agent.id,
    userId: input.connector.userId,
    orgId,
    telegramUserId: input.telegramUserId,
    chatId: input.chatId,
  });

  const { buildTelegramInbound, gatewayService } = await import('../gateway/index.js');
  const turn = await gatewayService.handleInbound(
    buildTelegramInbound({
      orgId,
      userId: input.connector.userId,
      chatId: input.chatId,
      telegramUserId: input.telegramUserId,
      text: input.prompt,
      agentId: input.agent.id,
      conversationId,
      agentName: input.agent.name,
      useBrain,
    }),
  );

  // Rebuild inbound without routeHint in preResolved — patch via metadata isn't needed;
  // ack uses routeHint for the queued message only.
  if (turn.status === 'accepted' || turn.status === 'steered') {
    return {
      reply:
        turn.ackReply ??
        formatQueuedReply(input.agent.name, { useBrain, routeHint: input.routeHint }),
    };
  }
  return {
    reply: turn.ackReply ?? (turn.status === 'rejected' ? turn.reason : 'Could not queue run'),
  };
}

async function enqueueTelegramTeamRun(input: {
  connector: ConnectorAccountDTO;
  team: { id: string; name: string };
  goal: string;
  chatId: string;
  routeHint?: string | null;
}): Promise<{ reply: string }> {
  const { buildTeamInbound, gatewayService } = await import('../gateway/index.js');
  const turn = await gatewayService.handleInbound(
    buildTeamInbound({
      channel: 'telegram',
      teamId: input.team.id,
      teamName: input.team.name,
      orgId: input.connector.orgId,
      userId: input.connector.userId,
      goal: input.goal,
      connectorId: input.connector.id,
      peerId: input.chatId,
    }),
  );

  if (turn.status === 'accepted') {
    const hint = input.routeHint ? ` (matched: ${input.routeHint})` : '';
    return { reply: (turn.ackReply ?? `Queued — ${input.team.name}.`) + hint };
  }
  return {
    reply: turn.ackReply ?? (turn.status === 'rejected' ? turn.reason : 'Could not queue team run'),
  };
}

async function routeByIntentDecision(input: {
  connector: ConnectorAccountDTO;
  prompt: string;
  brainFlag: boolean;
  decision: IntentRouteDecision;
  telegramUserId: string;
  chatId: string;
}): Promise<{ reply: string }> {
  const routeHint = routeHintForConfidence(input.decision);
  if (input.decision.targetType === 'team') {
    return enqueueTelegramTeamRun({
      connector: input.connector,
      team: { id: input.decision.targetId, name: input.decision.targetName },
      goal: input.prompt,
      chatId: input.chatId,
      routeHint,
    });
  }
  return enqueueTelegramAgentRun({
    connector: input.connector,
    agent: { id: input.decision.targetId, name: input.decision.targetName },
    prompt: input.prompt,
    brainFlag: input.brainFlag,
    telegramUserId: input.telegramUserId,
    chatId: input.chatId,
    routeHint,
  });
}

async function fallbackAgentRoute(input: {
  connector: ConnectorAccountDTO;
  prompt: string;
  brainFlag: boolean;
  rosterAgents: IntentRosterAgent[];
  telegramUserId: string;
  chatId: string;
}): Promise<{ reply: string }> {
  const defaultAgent = await resolveDefaultAgent(input.connector);
  if (defaultAgent) {
    return enqueueTelegramAgentRun({
      connector: input.connector,
      agent: defaultAgent,
      prompt: input.prompt,
      brainFlag: input.brainFlag,
      telegramUserId: input.telegramUserId,
      chatId: input.chatId,
    });
  }

  if (input.rosterAgents.length === 0) {
    return { reply: 'No agents registered in Qlix for this workspace.' };
  }
  if (input.rosterAgents.length === 1) {
    return enqueueTelegramAgentRun({
      connector: input.connector,
      agent: { id: input.rosterAgents[0]!.id, name: input.rosterAgents[0]!.name },
      prompt: input.prompt,
      brainFlag: input.brainFlag,
      telegramUserId: input.telegramUserId,
      chatId: input.chatId,
    });
  }

  const hybridAgents = input.rosterAgents.filter((a) => a.runtime === 'hybrid');
  if (hybridAgents.length === 1) {
    return enqueueTelegramAgentRun({
      connector: input.connector,
      agent: { id: hybridAgents[0]!.id, name: hybridAgents[0]!.name },
      prompt: input.prompt,
      brainFlag: input.brainFlag,
      telegramUserId: input.telegramUserId,
      chatId: input.chatId,
    });
  }

  const options = buildDisambiguationOptions(input.rosterAgents);
  await saveTelegramPendingRoute(input.connector.id, input.chatId, {
    prompt: input.prompt,
    brainFlag: input.brainFlag,
    options,
  });
  return {
    reply: formatDisambiguationMenu(options, {
      defaultHint: 'or set a Telegram default agent in Connectors (optional).',
    }),
  };
}

async function routePlainTextMessage(input: {
  connector: ConnectorAccountDTO;
  prompt: string;
  brainFlag: boolean;
  telegramUserId: string;
  chatId: string;
}): Promise<{ reply: string }> {
  // Reuse WhatsApp classifier — same roster/default-agent field on ConnectorAccount.
  const { decision, agents } = await classifyWhatsAppIntent(input.connector, input.prompt);

  if (decision && decision.confidence >= LOW_CONFIDENCE_THRESHOLD) {
    return routeByIntentDecision({ ...input, decision });
  }

  if (decision && decision.confidence < LOW_CONFIDENCE_THRESHOLD) {
    const defaultAgent = await resolveDefaultAgent(input.connector);
    if (defaultAgent) {
      return enqueueTelegramAgentRun({
        connector: input.connector,
        agent: defaultAgent,
        prompt: input.prompt,
        brainFlag: input.brainFlag,
        telegramUserId: input.telegramUserId,
        chatId: input.chatId,
      });
    }
  }

  return fallbackAgentRoute({ ...input, rosterAgents: agents });
}

async function tryResolvePendingDisambiguation(input: {
  connector: ConnectorAccountDTO;
  text: string;
  telegramUserId: string;
  chatId: string;
}): Promise<{ reply: string } | null> {
  const pending = await getTelegramPendingRoute(input.connector.id, input.chatId);
  if (!pending) return null;

  const index = parseDisambiguationSelection(input.text, pending.options.length);
  if (index == null) return null;

  const resolved = await resolveTelegramPendingSelection(
    input.connector.id,
    input.chatId,
    index,
  );
  if (!resolved) {
    return { reply: 'That selection expired. Send your request again.' };
  }

  const { selected, prompt, brainFlag } = resolved;
  if (selected.targetType === 'team') {
    return enqueueTelegramTeamRun({
      connector: input.connector,
      team: { id: selected.targetId, name: selected.name },
      goal: prompt,
      chatId: input.chatId,
    });
  }
  return enqueueTelegramAgentRun({
    connector: input.connector,
    agent: { id: selected.targetId, name: selected.name },
    prompt,
    brainFlag,
    telegramUserId: input.telegramUserId,
    chatId: input.chatId,
  });
}

export type TelegramInboundResult = { reply: string };

/**
 * Telegram private-text ingress: intent classify → optional picker → gateway enqueue.
 * Mirrors WhatsApp `handleWhatsAppInbound` (agents + @Team + #brain + !help/!status).
 */
export async function handleTelegramInbound(input: {
  connectorId: string;
  text: string;
  chatId: string;
  telegramUserId: string;
}): Promise<TelegramInboundResult> {
  const connector = await repo.findById(input.connectorId);
  if (!connector || connector.provider !== 'telegram' || connector.status !== 'connected') {
    throw new Error('Telegram not connected for this workspace');
  }

  const trimmed = input.text.trim();
  const lower = trimmed.toLowerCase();

  if (lower.startsWith('!status')) {
    const { formatTeamRunStatus } = await import('../teams/teamChannel.service.js');
    const teamStatus = await formatTeamRunStatus(connector.id);
    if (teamStatus) return { reply: teamStatus };
    const { formatAgentsStatus } = await import('../whatsapp/whatsappChannel.service.js');
    return { reply: await formatAgentsStatus(connector.id) };
  }

  if (lower === '!help') {
    return {
      reply:
        'Just type your request — Qlix picks the right agent.\n' +
        '• @TeamName: goal — run a team\n' +
        '• #brain — use company AI brain\n' +
        '• !status · !cancel\n' +
        '• Reply with a number when asked which agent to use',
    };
  }

  const pendingReply = await tryResolvePendingDisambiguation({
    connector,
    text: trimmed,
    telegramUserId: input.telegramUserId,
    chatId: input.chatId,
  });
  if (pendingReply) return pendingReply;

  // Bare number with no open picker — do NOT treat as a new request (stops
  // double-delivery / late selection from re-showing the agent menu).
  if (/^\d{1,2}$/.test(trimmed)) {
    return { reply: 'That selection expired. Send your request again.' };
  }

  if (await getTelegramPendingRoute(connector.id, input.chatId)) {
    await clearTelegramPendingRoute(connector.id, input.chatId);
  }

  const { useBrain: brainFlag, text: promptText } = parseWhatsAppRunModifiers(trimmed);

  if (trimmed.startsWith('@')) {
    const { tryHandleTeamChannelInbound } = await import('../teams/teamChannel.service.js');
    const teamResult = await tryHandleTeamChannelInbound(connector, trimmed, 'telegram');
    if (teamResult.handled) return { reply: teamResult.reply };
    return {
      reply:
        'Use @TeamName: your goal for teams, or type your request plainly for a single agent.',
    };
  }

  if (!promptText.trim()) {
    return {
      reply:
        'Just type your request — Qlix routes it to the best agent.\n' +
        '• @TeamName: goal for teams\n' +
        '• Add #brain for company knowledge',
    };
  }

  return routePlainTextMessage({
    connector,
    prompt: promptText,
    brainFlag,
    telegramUserId: input.telegramUserId,
    chatId: input.chatId,
  });
}

/** Find the connected Telegram connector to own inbound bot traffic. */
export async function findTelegramConnectorForInbound(): Promise<ConnectorAccountDTO | null> {
  const row = await prisma.connectorAccount.findFirst({
    where: {
      provider: 'telegram',
      status: 'connected',
      scopes: { has: 'bot' },
    },
    orderBy: { updatedAt: 'desc' },
  });
  if (!row) return null;
  return repo.findById(row.id);
}
