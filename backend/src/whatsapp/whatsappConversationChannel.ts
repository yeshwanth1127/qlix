import type { PermissionScope } from '../agents/agents.types.js';
import { prisma } from '../lib/prisma.js';
import { JitService } from '../jit/jit.service.js';
import {
  sendWhatsAppPoll,
  sendWhatsAppToRecipient,
} from '../connectors/whatsappServiceClient.js';
import type {
  ConversationChannelAdapter,
  ConversationPluginContext,
  ConversationSendInput,
} from '../conversations/conversationPlugins.js';
import type { ConversationPrompt } from '../conversations/conversationPrompt.js';

export const WHATSAPP_CONVERSATION_CHANNEL = 'whatsapp';
export const WHATSAPP_CHANNEL_SEND_SCOPE: PermissionScope = 'whatsapp.contact_send';

const WHATSAPP_CHOICE_NAME_MAX = 255;
const WHATSAPP_CHOICE_OPTION_MAX = 100;
const WHATSAPP_CHOICE_MIN_OPTIONS = 2;
const WHATSAPP_CHOICE_MAX_OPTIONS = 12;

const jitService = new JitService();

export type WhatsAppConversationTarget = {
  connectorId: string;
  recipient: string;
  teamRunId?: string | null;
  agentId?: string | null;
  agentRunId?: string | null;
};

export type WhatsAppConversationChannelDeps = {
  sendText: (input: {
    connectorId: string;
    recipient: string;
    message: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  sendChoice: (input: {
    connectorId: string;
    recipient: string;
    name: string;
    values: string[];
    selectableCount?: number;
  }) => Promise<{ ok: boolean; error?: string }>;
  resolveTarget: (context: ConversationPluginContext) => Promise<WhatsAppConversationTarget | null>;
  assertSendGrant?: (target: WhatsAppConversationTarget) => Promise<void>;
};

export function renderWhatsAppChoice(prompt: Extract<ConversationPrompt, { kind: 'choice' }>): {
  name: string;
  values: string[];
  selectableCount: number;
} {
  const name = prompt.content.trim();
  if (!name) throw new Error('WhatsApp choice prompt content is required');
  if (name.length > WHATSAPP_CHOICE_NAME_MAX) {
    throw new Error(`WhatsApp choice question is too long (max ${WHATSAPP_CHOICE_NAME_MAX} chars)`);
  }
  const seen = new Set<string>();
  const values: string[] = [];
  for (const raw of prompt.options) {
    const option = String(raw ?? '').trim();
    if (!option) continue;
    if (option.length > WHATSAPP_CHOICE_OPTION_MAX) {
      throw new Error(`WhatsApp choice option is too long (max ${WHATSAPP_CHOICE_OPTION_MAX} chars)`);
    }
    const key = option.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    values.push(option);
  }
  if (values.length < WHATSAPP_CHOICE_MIN_OPTIONS) {
    throw new Error('WhatsApp choice prompt needs at least 2 options');
  }
  if (values.length > WHATSAPP_CHOICE_MAX_OPTIONS) {
    throw new Error('WhatsApp choice prompt allows at most 12 options');
  }
  const selectableCount = Math.max(
    1,
    Math.min(values.length, Math.floor(Number(prompt.maxSelections ?? 1) || 1)),
  );
  return { name, values, selectableCount };
}

export async function resolveWhatsAppConversationTarget(
  context: ConversationPluginContext,
): Promise<WhatsAppConversationTarget | null> {
  const binding = await prisma.conversationBinding.findFirst({
    where: { threadId: context.threadId, channel: 'whatsapp', active: true },
    select: { connectorId: true, keyValue: true },
    orderBy: { priority: 'desc' },
  });
  if (!binding?.connectorId || !binding.keyValue) return null;
  const thread = await prisma.conversationThread.findUnique({
    where: { id: context.threadId },
    select: { ownerType: true, ownerId: true, stateJson: true },
  });
  const variables =
    thread?.stateJson && typeof thread.stateJson === 'object'
      ? ((thread.stateJson as { variables?: Record<string, unknown> }).variables ?? {})
      : {};
  const wait = await prisma.waitTrigger.findFirst({
    where: { conversationThreadId: context.threadId },
    select: { agentId: true, teamRunId: true },
  });
  const teamRunId =
    (typeof variables.teamRunId === 'string' && variables.teamRunId) ||
    (thread?.ownerType === 'team' ? thread.ownerId : null) ||
    wait?.teamRunId ||
    null;
  const agentId =
    (typeof variables.agentId === 'string' && variables.agentId) || wait?.agentId || null;
  let agentRunId: string | null = null;
  if (teamRunId && agentId) {
    const run = await prisma.agentRun.findFirst({
      where: { teamRunId, agentId },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    agentRunId = run?.id ?? null;
  }
  return {
    connectorId: binding.connectorId,
    recipient: binding.keyValue,
    teamRunId,
    agentId,
    agentRunId,
  };
}

export async function assertWhatsAppChannelSendGrant(target: WhatsAppConversationTarget): Promise<void> {
  const autoApprove =
    process.env.QLIX_JIT_AUTO_APPROVE === '1' || process.env.QLIX_JIT_AUTO_APPROVE === 'true';
  if (autoApprove) return;
  if (target.agentId) {
    const agent = await prisma.agent.findUnique({
      where: { id: target.agentId },
      select: { jitScopes: true, alwaysScopes: true },
    });
    const always = Array.isArray(agent?.alwaysScopes) ? (agent.alwaysScopes as string[]) : [];
    if (always.includes(WHATSAPP_CHANNEL_SEND_SCOPE)) return;
    const jit = Array.isArray(agent?.jitScopes) ? (agent.jitScopes as string[]) : [];
    if (!jit.includes(WHATSAPP_CHANNEL_SEND_SCOPE)) return;
  }
  if (target.agentRunId) {
    const granted = await jitService.hasActiveConversationGrantForRun(
      target.agentRunId,
      WHATSAPP_CHANNEL_SEND_SCOPE,
    );
    if (granted) {
      await jitService.touchConversationGrantForRun(target.agentRunId, WHATSAPP_CHANNEL_SEND_SCOPE);
      return;
    }
  }
  // Team wait / managed workflow follow-ups: the user already approved
  // whatsapp.contact_send for the outreach stage, and selecting wait TTL (or an
  // open wait trigger) authorizes delivery for this team run. Do not require a
  // second dashboard prompt when the conversation middleware sends greeting/polls.
  if (target.teamRunId) {
    const openWait = await prisma.waitTrigger.findFirst({
      where: {
        teamRunId: target.teamRunId,
        status: 'open',
        continuationKind: 'resume_team_run',
      },
      select: { id: true },
    });
    if (openWait) return;
  }
  throw new Error('whatsapp.contact_send requires dashboard approval');
}

const defaultDeps: WhatsAppConversationChannelDeps = {
  sendText: sendWhatsAppToRecipient,
  sendChoice: sendWhatsAppPoll,
  resolveTarget: resolveWhatsAppConversationTarget,
  assertSendGrant: assertWhatsAppChannelSendGrant,
};

export function createWhatsAppConversationChannel(
  deps: Partial<WhatsAppConversationChannelDeps> = {},
): ConversationChannelAdapter {
  const sendText = deps.sendText ?? defaultDeps.sendText;
  const sendChoice = deps.sendChoice ?? defaultDeps.sendChoice;
  const resolveTarget = deps.resolveTarget ?? defaultDeps.resolveTarget;
  const assertSendGrant =
    deps.assertSendGrant ?? defaultDeps.assertSendGrant ?? assertWhatsAppChannelSendGrant;
  return {
    channel: WHATSAPP_CONVERSATION_CHANNEL,
    sendScope: WHATSAPP_CHANNEL_SEND_SCOPE,
    async send(context, input: ConversationSendInput) {
      const target = await resolveTarget(context);
      if (!target) throw new Error('WhatsApp conversation target is missing');
      await assertSendGrant(target);
      const prompt = input.prompt;
      if (prompt.kind === 'choice') {
        const poll = renderWhatsAppChoice(prompt);
        const result = await sendChoice({
          connectorId: target.connectorId,
          recipient: target.recipient,
          name: poll.name,
          values: poll.values,
          selectableCount: poll.selectableCount,
        });
        if (!result.ok) throw new Error(result.error ?? 'WhatsApp choice send failed');
        return result;
      }
      const message = prompt.content.trim() || input.content.trim();
      if (!message) throw new Error('WhatsApp text send content is required');
      const result = await sendText({
        connectorId: target.connectorId,
        recipient: target.recipient,
        message,
      });
      if (!result.ok) throw new Error(result.error ?? 'WhatsApp send failed');
      return result;
    },
  };
}

export function registerWhatsAppConversationPlugins(registry: {
  registerChannel: (adapter: ConversationChannelAdapter, owner?: { id: string; kind: 'organization' }) => unknown;
}): void {
  registry.registerChannel(createWhatsAppConversationChannel(), {
    id: 'whatsapp',
    kind: 'organization',
  });
}
