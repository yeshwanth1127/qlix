import { prisma } from '../lib/prisma.js';
import { getConnectedWhatsAppForOrg } from '../connectors/whatsappConnector.service.js';
import {
  getWhatsAppSessionStatus,
  isWhatsAppServiceConfigured,
  sendWhatsAppDocument,
  startWhatsAppSession,
} from '../connectors/whatsappServiceClient.js';
import { fetchSandboxFile } from '../sandbox/sandboxClient.js';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { sendMessage, sendNotification } from '../jit/whatsappNotifier.js';
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
} from './whatsappIntentRouter.js';
import {
  clearPendingRoute,
  getPendingRoute,
  resolvePendingSelection,
  savePendingRoute,
} from './whatsappPendingRoute.service.js';
import {
  parseWhatsAppRunModifiers,
  resolveUseBrainForWhatsAppRun,
} from './whatsappRunModifiers.js';
import {
  autoReplyInferenceOverride,
  resolveWhatsAppRunDelivery,
} from './whatsappDeliveryPolicy.js';

const WHATSAPP_BODY_MAX = 1500;
const LOW_CONFIDENCE_THRESHOLD = 0.45;

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
    'WhatsApp default agent',
    'No team named',
    'Queued —',
    'matched:',
    'I can help — which agent',
    'Reply 1–',
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

/** Channel adapter used by generic wait side effects to deliver a sandbox file. */
export async function deliverSandboxFileToWorkspaceWhatsApp(
  orgId: string,
  input: { sandboxId: string; fileName: string },
): Promise<WhatsAppDeliveryResult> {
  if (!isWhatsAppServiceConfigured()) {
    return { sent: false, reason: 'WhatsApp service not configured on backend' };
  }
  const connector = await getConnectedWhatsAppForOrg(orgId);
  if (!connector) {
    return { sent: false, reason: 'WhatsApp not linked in Connectors for this workspace' };
  }
  const downloaded = await fetchSandboxFile(input.sandboxId);
  if (!downloaded) return { sent: false, reason: 'Sandbox file is missing or expired' };

  let session = await getWhatsAppSessionStatus(connector.id);
  if (!session.connected) {
    const restarted = await startWhatsAppSession(connector.id);
    if (restarted.ok) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      session = await getWhatsAppSessionStatus(connector.id);
    }
  }
  if (!session.connected) return { sent: false, reason: 'WhatsApp session is offline' };

  const dir = await mkdtemp(path.join(os.tmpdir(), 'qlix-wait-delivery-'));
  const filePath = path.join(dir, path.basename(input.fileName || downloaded.fileName));
  try {
    await writeFile(filePath, downloaded.body);
    const delivery = await sendWhatsAppDocument({
      connectorId: connector.id,
      filePath,
      fileName: input.fileName || downloaded.fileName,
      mimetype: downloaded.contentType,
    });
    return delivery.ok
      ? { sent: true }
      : { sent: false, reason: delivery.error ?? 'WhatsApp document send failed' };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Contact auto-reply may still dump a successful reply to the lead when the
 * agent did not use whatsapp_send_message. Agent-run completion never posts to
 * self-chat (team final synthesis / JIT / whatsapp_send / inbound acks only).
 */
async function runAlreadySentWhatsAppToContact(runId?: string | null): Promise<boolean> {
  if (!runId) return false;
  const row = await prisma.actionLog.findFirst({
    where: {
      actionType: 'whatsapp.contact_send',
      status: 'success',
      payload: { path: ['runId'], equals: runId },
    },
    select: { id: true },
  });
  return Boolean(row);
}

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
  /** When set, send the result to this contact JID instead of self-chat. */
  replyToJid?: string | null;
  connectorId?: string | null;
  runId?: string | null;
}): Promise<WhatsAppDeliveryResult> {
  const replyToJid = input.replyToJid?.trim() || null;
  const success = input.success !== false;

  // Never dump agent-run completion into the owner's self-chat.
  if (!replyToJid) {
    return { sent: false, reason: 'self_chat_completion_disabled' };
  }

  const alreadySentToContact = await runAlreadySentWhatsAppToContact(input.runId);
  const mode = resolveWhatsAppRunDelivery({
    replyToJid,
    success,
    alreadySentToContact,
  });

  if (mode === 'none') {
    return { sent: false, reason: 'already_sent_via_tool' };
  }

  // Failures previously notified the owner in self-chat — disabled by policy.
  if (mode === 'self' || !success) {
    return { sent: false, reason: 'self_chat_completion_disabled' };
  }

  if (mode === 'contact' && replyToJid) {
    if (!isWhatsAppServiceConfigured()) {
      return { sent: false, reason: 'WhatsApp service not configured on backend' };
    }
    const connector =
      (input.connectorId
        ? await repo.findById(input.connectorId)
        : null) ?? (await getConnectedWhatsAppForOrg(input.orgId));
    if (!connector || connector.status !== 'connected') {
      return { sent: false, reason: 'WhatsApp not linked' };
    }

    const bodyText = truncateBody(input.body.trim());
    if (!bodyText) return { sent: false, reason: 'Empty message body' };

    const { sendWhatsAppToRecipient } = await import('../connectors/whatsappServiceClient.js');
    const sent = await sendWhatsAppToRecipient({
      connectorId: connector.id,
      recipient: replyToJid,
      message: bodyText,
    });
    if (!sent.ok) return { sent: false, reason: sent.error ?? 'WhatsApp send failed' };
    return { sent: true };
  }

  return { sent: false, reason: 'self_chat_completion_disabled' };
}

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

async function ensureConversation(
  agentId: string,
  userId: string,
  orgId: string | null,
): Promise<string> {
  const { getOrCreatePrimaryConversation } = await import('../agentChat/conversationService.js');
  const convo = await getOrCreatePrimaryConversation({ agentId, userId, orgId });
  return convo.id;
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

async function enqueueWhatsAppAgentRun(
  connector: ConnectorAccountDTO,
  agent: { id: string; name: string },
  prompt: string,
  brainFlag: boolean,
  routeHint?: string | null,
  whatsappReplyToJid?: string | null,
  inferenceModel?: string | null,
): Promise<{ reply: string; deliverTo: 'self' | 'none' | 'contact'; contactJid?: string }> {
  const agentRow = await prisma.agent.findUnique({
    where: { id: agent.id },
    select: { orgId: true, permissionScopes: true, runtime: true },
  });

  const useBrain = resolveUseBrainForWhatsAppRun({
    modifierFlag: brainFlag,
    prompt,
    permissionScopes: agentRow?.permissionScopes ?? [],
  });

  const orgId = agentRow?.orgId ?? connector.orgId;
  const conversationId = await ensureConversation(agent.id, connector.userId, orgId);

  const { buildWhatsAppInbound, gatewayService } = await import('../gateway/index.js');
  const turn = await gatewayService.handleInbound(
    buildWhatsAppInbound({
      connectorId: connector.id,
      orgId,
      userId: connector.userId,
      body: prompt,
      useBrain,
      whatsappReplyToJid: whatsappReplyToJid ?? null,
      inferenceModel: inferenceModel ?? null,
      preResolved: {
        targetType: 'agent',
        agentId: agent.id,
        conversationId,
        orgId,
        userId: connector.userId,
        targetName: agent.name,
        teamRole: 'whatsapp',
        routeHint: routeHint ?? null,
      },
    }),
  );

  if (turn.status === 'accepted' || turn.status === 'steered') {
    const deliverTo = whatsappReplyToJid ? ('none' as const) : ('self' as const);
    return {
      reply: turn.ackReply ?? formatQueuedReply(agent.name, { useBrain, routeHint }),
      deliverTo,
      contactJid: whatsappReplyToJid ?? undefined,
    };
  }
  return {
    reply: turn.ackReply ?? (turn.status === 'rejected' ? turn.reason : 'Could not queue run'),
    deliverTo: whatsappReplyToJid ? 'none' : 'self',
    contactJid: whatsappReplyToJid ?? undefined,
  };
}

async function enqueueWhatsAppTeamRun(
  connector: ConnectorAccountDTO,
  team: { id: string; name: string },
  goal: string,
  routeHint?: string | null,
): Promise<{ reply: string }> {
  const { buildTeamInbound, gatewayService } = await import('../gateway/index.js');
  const turn = await gatewayService.handleInbound(
    buildTeamInbound({
      channel: 'whatsapp',
      teamId: team.id,
      teamName: team.name,
      orgId: connector.orgId,
      userId: connector.userId,
      goal,
      connectorId: connector.id,
    }),
  );

  if (turn.status === 'accepted') {
    const hint = routeHint ? ` (matched: ${routeHint})` : '';
    return {
      reply: (turn.ackReply ?? `Queued — ${team.name}.`) + hint,
    };
  }
  return {
    reply: turn.ackReply ?? (turn.status === 'rejected' ? turn.reason : 'Could not queue team run'),
  };
}

async function routeByIntentDecision(
  connector: ConnectorAccountDTO,
  prompt: string,
  brainFlag: boolean,
  decision: IntentRouteDecision,
): Promise<{ reply: string }> {
  const routeHint = routeHintForConfidence(decision);

  if (decision.targetType === 'team') {
    return enqueueWhatsAppTeamRun(
      connector,
      { id: decision.targetId, name: decision.targetName },
      prompt,
      routeHint,
    );
  }

  return enqueueWhatsAppAgentRun(
    connector,
    { id: decision.targetId, name: decision.targetName },
    prompt,
    brainFlag,
    routeHint,
  );
}

async function fallbackAgentRoute(
  connector: ConnectorAccountDTO,
  prompt: string,
  brainFlag: boolean,
  rosterAgents: IntentRosterAgent[],
): Promise<{ reply: string }> {
  const defaultAgent = await resolveDefaultAgent(connector);
  if (defaultAgent) {
    return enqueueWhatsAppAgentRun(connector, defaultAgent, prompt, brainFlag);
  }

  if (rosterAgents.length === 0) {
    throw new Error('No agents registered for WhatsApp (org brain cannot be triggered from chat)');
  }
  if (rosterAgents.length === 1) {
    return enqueueWhatsAppAgentRun(
      connector,
      { id: rosterAgents[0]!.id, name: rosterAgents[0]!.name },
      prompt,
      brainFlag,
    );
  }

  const hybridAgents = rosterAgents.filter((a) => a.runtime === 'hybrid');
  if (hybridAgents.length === 1) {
    return enqueueWhatsAppAgentRun(
      connector,
      { id: hybridAgents[0]!.id, name: hybridAgents[0]!.name },
      prompt,
      brainFlag,
    );
  }

  const options = buildDisambiguationOptions(rosterAgents);
  await savePendingRoute(connector.id, { prompt, brainFlag, options });
  return { reply: formatDisambiguationMenu(options) };
}

async function routePlainTextMessage(
  connector: ConnectorAccountDTO,
  prompt: string,
  brainFlag: boolean,
): Promise<{ reply: string }> {
  const { decision, agents } = await classifyWhatsAppIntent(connector, prompt);

  if (decision && decision.confidence >= LOW_CONFIDENCE_THRESHOLD) {
    return routeByIntentDecision(connector, prompt, brainFlag, decision);
  }

  if (decision && decision.confidence < LOW_CONFIDENCE_THRESHOLD) {
    const defaultAgent = await resolveDefaultAgent(connector);
    if (defaultAgent) {
      return enqueueWhatsAppAgentRun(connector, defaultAgent, prompt, brainFlag);
    }
  }

  return fallbackAgentRoute(connector, prompt, brainFlag, agents);
}

async function tryResolvePendingDisambiguation(
  connector: ConnectorAccountDTO,
  text: string,
): Promise<{ reply: string } | null> {
  const pending = await getPendingRoute(connector.id);
  if (!pending) return null;

  const index = parseDisambiguationSelection(text, pending.options.length);
  if (index == null) return null;

  const resolved = await resolvePendingSelection(connector.id, index);
  if (!resolved) {
    return { reply: 'That selection expired. Send your request again.' };
  }

  const { selected, prompt, brainFlag } = resolved;
  if (selected.targetType === 'team') {
    return enqueueWhatsAppTeamRun(
      connector,
      { id: selected.targetId, name: selected.name },
      prompt,
    );
  }
  return enqueueWhatsAppAgentRun(
    connector,
    { id: selected.targetId, name: selected.name },
    prompt,
    brainFlag,
  );
}

export type WhatsAppInboundResult = {
  reply: string;
  /** Where the sidecar should post the ack (if any). Contact auto-reply uses `none`. */
  deliverTo: 'self' | 'none' | 'contact';
  contactJid?: string;
};

function withSelfReply(reply: string): WhatsAppInboundResult {
  return { reply, deliverTo: 'self' };
}

/** Fixed ack sent to a lead when their reply fulfills a team pipeline wait. */
export const TEAM_WAIT_CONTACT_ACK =
  "Thanks — we'll get back to you shortly.";

/**
 * Team waits take precedence over standalone auto-reply sessions. A successful
 * match stores the reply; the pipeline resumes only when every contacted lead
 * for that run has replied (or the wait TTL fires). Always sends a short fixed ack.
 */
async function handleContactTeamWaitInbound(
  connector: ConnectorAccountDTO,
  remoteJid: string,
  text: string,
  pushName?: string | null,
): Promise<WhatsAppInboundResult | null> {
  const { WaitTriggerService } = await import('../teams/waitTrigger.service.js');
  const waitService = new WaitTriggerService();
  const consumed = await waitService.consumeWhatsAppInbound({
    connectorId: connector.id,
    contactJid: remoteJid,
    text,
    pushName,
  });
  if (consumed.fulfilled.length === 0 && consumed.progressByTeamRun.length === 0) {
    return null;
  }

  const { TeamsRepository } = await import('../teams/teams.repository.js');
  const teamsRepo = new TeamsRepository();
  const touchedRunIds = new Set<string>([
    ...consumed.fulfilled.map((entry) => entry.teamRunId),
    ...consumed.progressByTeamRun.map((progress) => progress.teamRunId),
  ]);

  let contactAck: 'fixed' | 'none' | 'auto_reply' = 'fixed';

  for (const teamRunId of touchedRunIds) {
    try {
      const run = await teamsRepo.findRun(teamRunId);
      if (!run || run.status !== 'paused') continue;

      const team = await teamsRepo.findById(run.teamId);
      let checkpoint = run.checkpointJson as import('../teams/teams.types.js').TeamRunCheckpoint | null;
      if (!checkpoint) continue;

      if (team && !checkpoint.waitPolicySnapshot) {
        checkpoint = (
          await import('../wait/waitPolicy.js')
        ).ensureCheckpointWaitPolicy(checkpoint, team.config, run.goal);
        await teamsRepo.updateRunStatus(run.id, 'paused', { checkpointJson: checkpoint });
      }

      const sideEffectModule = await import('../wait/waitSideEffect.service.js');
      contactAck = sideEffectModule.resolveWaitContactAck(checkpoint);

      const inbound = {
        jid: remoteJid,
        text,
        timestampMs: Date.now(),
        pushName: pushName ?? null,
      };

      const sideEffectResult = await sideEffectModule.applyWaitInboundSideEffects({
        checkpoint,
        inbound,
        runId: run.id,
        userGoal: run.goal,
        supervisorAgentId: null,
      });

      if (sideEffectResult.checkpoint !== checkpoint) {
        await teamsRepo.updateRunStatus(run.id, 'paused', {
          checkpointJson: sideEffectResult.checkpoint,
        });
      }

      for (const artifact of sideEffectResult.artifacts) {
        await teamsRepo.upsertArtifactById(run.id, artifact);
      }

      for (const event of sideEffectResult.events) {
        if (event.type === 'live_artifact_updated') {
          await teamsRepo.appendEvent(run.id, run.teamId, null, 'live_artifact_updated', event.payload);
        }
      }
    } catch (err) {
      console.warn(
        '[whatsapp-team-wait] side-effect apply failed:',
        err instanceof Error ? err.message : err,
      );
    }
  }

  for (const progress of consumed.progressByTeamRun) {
    if (progress.remaining <= 0) continue;
    try {
      const run = await teamsRepo.findRun(progress.teamRunId);
      if (!run || run.status !== 'paused') continue;
      await teamsRepo.appendEvent(run.id, run.teamId, null, 'wait_progress', {
        received: progress.received,
        remaining: progress.remaining,
        total: progress.total,
        contactJid: remoteJid,
      });
    } catch (err) {
      console.warn(
        '[whatsapp-team-wait] wait_progress emit failed:',
        err instanceof Error ? err.message : err,
      );
    }
  }

  if (consumed.readyToResumeTeamRunIds.length > 0) {
    const { resumeTeamRun } = await import('../teams/teamsRunLauncher.js');
    for (const teamRunId of consumed.readyToResumeTeamRunIds) {
      await resumeTeamRun(teamRunId);
    }
  }

  // A workflow-managed conversation already produced the appropriate branch
  // response. Suppress the legacy fixed acknowledgement and auto-reply layer.
  if (consumed.conversationHandled) {
    return { reply: '', deliverTo: 'none', contactJid: remoteJid };
  }

  if (contactAck === 'auto_reply') {
    const { touchAutoReplySessionOutbound } = await import('./whatsappAutoReply.service.js');
    await touchAutoReplySessionOutbound(connector.id, remoteJid).catch(() => {});
    return null;
  }

  const { stopAutoReplySessionsForContact } = await import('./whatsappAutoReply.service.js');
  await stopAutoReplySessionsForContact({
    connectorId: connector.id,
    contactJid: remoteJid,
  }).catch((err) => {
    console.warn(
      '[whatsapp-team-wait] stop auto-reply after ack failed:',
      err instanceof Error ? err.message : err,
    );
  });

  if (contactAck === 'none') {
    return { reply: '', deliverTo: 'none', contactJid: remoteJid };
  }

  return {
    reply: TEAM_WAIT_CONTACT_ACK,
    deliverTo: 'contact',
    contactJid: remoteJid,
  };
}

async function handleContactAutoReplyInbound(
  connector: ConnectorAccountDTO,
  remoteJid: string,
  text: string,
): Promise<WhatsAppInboundResult | null> {
  const {
    findActiveAutoReplySession,
    markAutoReplyInbound,
  } = await import('./whatsappAutoReply.service.js');

  const session = await findActiveAutoReplySession(connector.id, remoteJid);
  if (!session) return null;

  const agent = await prisma.agent.findUnique({
    where: { id: session.agentId },
    select: { id: true, name: true, status: true, llmModel: true, llmProvider: true },
  });
  if (!agent || agent.status === 'suspended') {
    return { reply: '', deliverTo: 'none' };
  }

  await markAutoReplyInbound(session.id);

  const label = session.contactName || session.contactPhone || session.contactJid;
  const { buildAutoReplyInboundPrompt } = await import('./whatsappAutoReply.service.js');
  let threadId: string | null = null;
  if (connector.orgId) {
    const { findActiveThreadForBinding } = await import('../conversations/conversationCapability.service.js');
    threadId = await findActiveThreadForBinding({
      orgId: connector.orgId,
      channel: 'whatsapp',
      keyValue: session.contactJid,
      connectorId: connector.id,
    });
  }
  const prompt = buildAutoReplyInboundPrompt({
    label,
    contactJid: session.contactJid,
    text,
    replyInstructions: session.replyInstructions,
    threadId,
  });

  await enqueueWhatsAppAgentRun(
    connector,
    { id: agent.id, name: agent.name },
    prompt,
    false,
    'auto-reply',
    session.contactJid,
    autoReplyInferenceOverride(agent),
  );
  // Do not echo queue acks into the contact chat.
  return {
    reply: '',
    deliverTo: 'none',
    contactJid: session.contactJid,
  };
}

export async function handleWhatsAppInbound(
  connectorId: string,
  text: string,
  opts?: { remoteJid?: string | null; fromContact?: boolean; pushName?: string | null },
): Promise<WhatsAppInboundResult> {
  const connector = await repo.findById(connectorId);
  if (!connector || connector.status !== 'connected') {
    throw new Error('WhatsApp not connected for this workspace');
  }

  const trimmed = text.trim();
  if (isLikelyOutboundEcho(trimmed)) {
    return { reply: '', deliverTo: 'none' };
  }

  if (opts?.fromContact && opts.remoteJid) {
    const teamWaitResult = await handleContactTeamWaitInbound(
      connector,
      opts.remoteJid,
      trimmed,
      opts.pushName ?? null,
    );
    if (teamWaitResult) return teamWaitResult;
    const { isContactClosedAfterWaitAck, stopAutoReplySessionsForContact } = await import(
      './whatsappAutoReply.service.js'
    );
    if (await isContactClosedAfterWaitAck(connector.id, opts.remoteJid)) {
      await stopAutoReplySessionsForContact({
        connectorId: connector.id,
        contactJid: opts.remoteJid,
      }).catch(() => {});
      return { reply: '', deliverTo: 'none' };
    }
    const contactResult = await handleContactAutoReplyInbound(connector, opts.remoteJid, trimmed);
    if (contactResult) return contactResult;
    return { reply: '', deliverTo: 'none' };
  }

  const lower = trimmed.toLowerCase();
  if (lower.startsWith('!status')) {
    const { formatTeamRunStatus } = await import('../teams/teamChannel.service.js');
    const teamStatus = await formatTeamRunStatus(connectorId);
    if (teamStatus) return withSelfReply(teamStatus);
    const agentStatus = await formatAgentsStatus(connectorId);
    return withSelfReply(agentStatus);
  }

  if (lower === '!help') {
    return withSelfReply(
      'Just type your request — Qlix picks the right agent.\n' +
        '• @TeamName: goal — run a team\n' +
        '• #brain — use company AI brain\n' +
        '• !status · !cancel · yes/no for approvals',
    );
  }

  const pendingReply = await tryResolvePendingDisambiguation(connector, trimmed);
  if (pendingReply) return withSelfReply(pendingReply.reply);

  // Non-numeric message clears stale pending picker state.
  if (await getPendingRoute(connector.id)) {
    await clearPendingRoute(connector.id);
  }

  const { useBrain: brainFlag, text: promptText } = parseWhatsAppRunModifiers(trimmed);

  // @ prefix is reserved for teams.
  if (trimmed.startsWith('@')) {
    const { tryHandleTeamWhatsAppInbound } = await import('../teams/teamChannel.service.js');
    const teamResult = await tryHandleTeamWhatsAppInbound(connector, trimmed);
    if (teamResult.handled) {
      return withSelfReply(teamResult.reply);
    }
    return withSelfReply(
      'Use @TeamName: your goal for teams, or type your request plainly for a single agent.',
    );
  }

  if (!promptText.trim()) {
    return withSelfReply(
      'Just type your request — Qlix routes it to the best agent.\n' +
        '• @TeamName: goal for teams\n' +
        '• Add #brain for company knowledge\n' +
        '• Hybrid agents can open files on your PC (include the full path)',
    );
  }

  const routed = await routePlainTextMessage(connector, promptText, brainFlag);
  return withSelfReply(routed.reply);
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
      whatsappReplyToJid: true,
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
      replyToJid: run.whatsappReplyToJid,
      runId,
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
    replyToJid: run.whatsappReplyToJid,
    runId,
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
