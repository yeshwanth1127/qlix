import { ActionsService, JitTokenInvalidError, JitTokenRequiredError } from '../actions/actions.service.js';
import type { PermissionScope } from '../agents/agents.types.js';
import { prisma } from '../lib/prisma.js';
import { JitService } from '../jit/jit.service.js';
import { isAgentRunTerminal } from '../agentChat/agentRunService.js';
import { resolveTeamWhatsAppWaitMode } from '../wait/waitPolicy.js';
import { appendEmailActionLog } from './emailAudit.service.js';
import { getWhatsAppConnectorForAgent } from './whatsappConnector.service.js';
import { hasConversationCapability } from '../conversations/conversationScope.js';
import {
  getWhatsAppChatMessages,
  getWhatsAppSessionStatus,
  isWhatsAppServiceConfigured,
  listWhatsAppContacts,
  resolveWhatsAppRecipient,
  sendWhatsAppDocumentToRecipient,
  sendWhatsAppPoll,
  sendWhatsAppToRecipient,
  startWhatsAppSession,
} from './whatsappServiceClient.js';
import { TeamsRepository } from '../teams/teams.repository.js';
import {
  assertTeamOutboundAllowed,
  TeamOutboundProvenanceError,
} from '../teams/teamOutboundGuard.js';

const actionsService = new ActionsService();
const jitService = new JitService();

async function enforceLiveTeamOutboundTarget(input: {
  runId: string | null;
  agentId: string;
  connectorId: string;
  recipient: string;
}): Promise<string> {
  if (!input.runId) return input.recipient;
  const agentRun = await prisma.agentRun.findUnique({
    where: { id: input.runId },
    select: { teamRunId: true },
  });
  if (!agentRun?.teamRunId) return input.recipient;
  const resolved = await resolveWhatsAppRecipient({
    connectorId: input.connectorId,
    recipient: input.recipient,
  });
  if (!resolved.ok || !resolved.jid) {
    throw new WhatsAppToolError(resolved.error ?? 'Failed to resolve WhatsApp recipient');
  }
  const repo = new TeamsRepository();
  const run = await repo.findRun(agentRun.teamRunId);
  if (!run) throw new WhatsAppToolError('Team run not found');
  try {
    assertTeamOutboundAllowed(run, await repo.listMailboxResults(run.id), {
      recipient: input.recipient,
      jid: resolved.jid,
      phone: resolved.phone ?? null,
      name: resolved.name ?? null,
    });
  } catch (error) {
    if (error instanceof TeamOutboundProvenanceError) {
      await repo.appendEvent(run.id, run.teamId, input.agentId, 'outbound_blocked', {
        message: error.message,
        recipient: input.recipient,
      });
      throw new WhatsAppToolError(error.message);
    }
    throw error;
  }
  return resolved.jid;
}

type TeamOutboundGate =
  | { kind: 'live' }
  | { kind: 'blocked'; reason: string }
  | {
      kind: 'queue';
      teamRunId: string;
      orgId: string;
      userId: string;
      fulfillment: 'first_match' | 'collect_until_timeout';
    };

async function getTeamOutboundGate(runId: string | null): Promise<TeamOutboundGate> {
  if (!runId) return { kind: 'live' };
  const agentRun = await prisma.agentRun.findUnique({
    where: { id: runId },
    select: {
      status: true,
      teamRun: {
        select: {
          id: true,
          orgId: true,
          startedByUserId: true,
          status: true,
          goal: true,
          team: {
            select: {
              config: true,
              members: { select: { stageOrder: true, delegatedScopes: true } },
            },
          },
        },
      },
    },
  });
  if (!agentRun) return { kind: 'live' };
  if (isAgentRunTerminal(agentRun.status)) {
    return { kind: 'blocked', reason: 'Run was stopped; WhatsApp send skipped' };
  }
  const teamRun = agentRun.teamRun;
  if (!teamRun) return { kind: 'live' };

  const teamConfig = (teamRun.team?.config ?? {}) as { waitSteps?: unknown[] };
  const mode = resolveTeamWhatsAppWaitMode({
    teamRunStatus: teamRun.status,
    goal: teamRun.goal,
    waitSteps: teamConfig.waitSteps,
  });
  if (mode === 'blocked') {
    return { kind: 'blocked', reason: 'Team run was stopped; WhatsApp send skipped' };
  }
  if (mode === 'live') return { kind: 'live' };

  const { resolveWaitStepsForTeam, findWaitStepForStage, inferOutreachStageOrderFromWorkers } =
    await import('../wait/waitPolicy.js');
  const workers = (teamRun.team?.members ?? []).map((member) => ({
    stageOrder: member.stageOrder,
    permissionScopes: member.delegatedScopes as string[],
  }));
  const outreachStage =
    workers.length > 0
      ? inferOutreachStageOrderFromWorkers(workers)
      : 2;
  const waitSteps = resolveWaitStepsForTeam(
    teamConfig as import('../teams/teams.types.js').TeamConfig,
    teamRun.goal,
    outreachStage,
  );
  const waitStep = findWaitStepForStage(waitSteps, outreachStage);
  const fulfillment = waitStep?.trigger.fulfillment ?? 'collect_until_timeout';

  return {
    kind: 'queue',
    teamRunId: teamRun.id,
    orgId: teamRun.orgId,
    userId: teamRun.startedByUserId,
    fulfillment,
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

async function ensureOutreachThreadForContact(input: {
  agentId: string;
  runId: string | null;
  orgId: string;
  connectorId: string;
  jid: string;
  name?: string | null;
}): Promise<void> {
  try {
    const agentRun = input.runId
      ? await prisma.agentRun.findUnique({
          where: { id: input.runId },
          select: { teamRunId: true },
        })
      : null;
    const { startOutreachConversations } = await import('../conversations/conversationCapability.service.js');
    await startOutreachConversations({
      orgId: input.orgId,
      ownerType: agentRun?.teamRunId ? 'team' : 'agent',
      ownerId: agentRun?.teamRunId ?? input.agentId,
      teamRunId: agentRun?.teamRunId ?? null,
      agentId: input.agentId,
      channel: 'whatsapp',
      recipients: [{
        address: input.jid,
        displayName: input.name ?? null,
        connectorId: input.connectorId,
      }],
      openingMessage: '',
    });
  } catch (err) {
    console.warn(
      '[conversation] start after WhatsApp send failed:',
      err instanceof Error ? err.message : err,
    );
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
  const allowByGrant = async (): Promise<boolean> => {
    const sessionGranted = await jitService.hasActiveConversationGrantForRun(
      params.runId,
      'whatsapp.contact_send',
    );
    if (!sessionGranted) return false;
    await jitService.touchConversationGrantForRun(params.runId, 'whatsapp.contact_send');
    return true;
  };

  if (!token) {
    if (await allowByGrant()) return;
    throw new JitTokenRequiredError('whatsapp.contact_send requires dashboard approval');
  }

  const ok = await actionsService.consumeJitToken({
    agentId: params.agentId,
    actionType: 'whatsapp.contact_send',
    token,
  });
  if (ok) return;
  if (await allowByGrant()) return;
  throw new JitTokenInvalidError('Invalid or already used jitToken for whatsapp.contact_send');
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
  /** True when the message is held until wait mode + TTL are set. */
  deferredUntilWait?: boolean;
  queued?: boolean;
  note?: string;
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

  // Team reply-wait runs: queue the message and send only after wait mode + TTL.
  // That closes the race where contacts reply before the run is paused / sheet is ready.
  const outboundGate = await getTeamOutboundGate(params.runId);
  if (outboundGate.kind === 'blocked') {
    throw new WhatsAppToolError(outboundGate.reason);
  }
  if (outboundGate.kind === 'queue') {
      const resolved = await resolveWhatsAppRecipient({
        connectorId: connector.id,
        recipient: params.input.recipient,
      });
      if (!resolved.ok || !resolved.jid) {
        if (resolved.matches?.length) {
          throw new WhatsAppToolError(
            `${resolved.error ?? 'Ambiguous recipient'}: ${resolved.matches
              .map((m) => `${m.name ?? 'unknown'} (${m.phone ?? m.jid})`)
              .join(', ')}`,
          );
        }
        throw new WhatsAppToolError(resolved.error ?? 'Failed to resolve WhatsApp recipient');
      }

      const { normalizeReplyInstructions } = await import('../whatsapp/whatsappAutoReply.service.js');
      const { persistPendingWaitOutbound } = await import('../wait/pendingWaitOutbound.js');
      const { inferNameFromOutreachMessage } = await import('../wait/liveSheetColumns.js');
      const recipientLooksLikeName =
        Boolean(params.input.recipient?.trim()) &&
        !/^[\d+\s()-]+$/.test(params.input.recipient.trim()) &&
        !params.input.recipient.includes('@');
      const displayName =
        resolved.name?.trim() ||
        (recipientLooksLikeName ? params.input.recipient.trim() : null) ||
        inferNameFromOutreachMessage(params.input.message);

      await persistPendingWaitOutbound({
        teamRunId: outboundGate.teamRunId,
        outbound: {
          agentId: params.agentId,
          connectorId: connector.id,
          recipient: params.input.recipient,
          message: params.input.message,
          replyInstructions: normalizeReplyInstructions(params.input.replyInstructions),
          jid: resolved.jid,
          phone: resolved.phone ?? null,
          name: displayName,
        },
      });

      await appendEmailActionLog({
        agentId: params.agentId,
        userId: ctx.userId,
        actionType: 'whatsapp.contact_send',
        payload: {
          tool: 'whatsapp_send_message',
          recipient: params.input.recipient,
          jid: resolved.jid,
          name: displayName,
          messagePreview: params.input.message.slice(0, 200),
          runId: params.runId,
          deferredUntilWait: true,
        },
        status: 'success',
        riskLevel: 'high',
      }).catch(() => {});

      if (hasConversationCapability(scopes) && resolved.jid && ctx.orgId) {
        await ensureOutreachThreadForContact({
          agentId: params.agentId,
          runId: params.runId,
          orgId: ctx.orgId,
          connectorId: connector.id,
          jid: resolved.jid,
          name: displayName,
        });
      }

      return {
        jid: resolved.jid,
        phone: resolved.phone,
        name: displayName,
        autoReplyArmed: false,
        teamWaitArmed: false,
        replyInstructionsSet: Boolean(normalizeReplyInstructions(params.input.replyInstructions)),
        deferredUntilWait: true,
        queued: true,
        note:
          'Message queued. Qlix will send it after this stage finishes and the wait duration is set — so replies are captured live.',
      };
  }

  const guardedRecipient = await enforceLiveTeamOutboundTarget({
    runId: params.runId,
    agentId: params.agentId,
    connectorId: connector.id,
    recipient: params.input.recipient,
  });
  const result = await sendWhatsAppToRecipient({
    connectorId: connector.id,
    recipient: guardedRecipient,
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
  if (hasConversationCapability(scopes) && result.jid) {
    try {
      const { armAutoReplySession, normalizeReplyInstructions } = await import(
        '../whatsapp/whatsappAutoReply.service.js'
      );
      const instructions = normalizeReplyInstructions(params.input.replyInstructions);
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
      replyInstructionsSet = Boolean(instructions);
    } catch (err) {
      console.warn(
        '[whatsapp-auto-reply] arm failed:',
        err instanceof Error ? err.message : err,
      );
    }
    if (ctx.orgId) {
      await ensureOutreachThreadForContact({
        agentId: params.agentId,
        runId: params.runId,
        orgId: ctx.orgId,
        connectorId: connector.id,
        jid: result.jid,
        name: result.name ?? null,
      });
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

function normalizePollInput(input: {
  name: string;
  values: string[];
  selectableCount?: number;
}): { name: string; values: string[]; selectableCount: number } {
  const name = input.name.trim();
  if (!name) throw new WhatsAppToolError('poll name is required');
  if (name.length > 255) throw new WhatsAppToolError('poll name too long (max 255 chars)');
  const seen = new Set<string>();
  const values: string[] = [];
  for (const raw of input.values ?? []) {
    const option = String(raw ?? '').trim();
    if (!option) continue;
    if (option.length > 100) throw new WhatsAppToolError('poll option too long (max 100 chars)');
    const key = option.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    values.push(option);
  }
  if (values.length < 2) throw new WhatsAppToolError('poll needs at least 2 options');
  if (values.length > 12) throw new WhatsAppToolError('poll allows at most 12 options');
  const selectableCount = Math.max(
    1,
    Math.min(values.length, Math.floor(Number(input.selectableCount ?? 1) || 1)),
  );
  return { name, values, selectableCount };
}

export async function executeWhatsAppPollSend(params: {
  agentId: string;
  runId: string | null;
  input: {
    recipient: string;
    name: string;
    values: string[];
    selectableCount?: number;
    jitToken?: string | null;
    replyInstructions?: string | null;
  };
}): Promise<{
  jid?: string;
  phone?: string | null;
  name?: string | null;
  pollName?: string;
  pollValues?: string[];
  autoReplyArmed?: boolean;
  teamWaitArmed?: boolean;
  replyInstructionsSet?: boolean;
  deferredUntilWait?: boolean;
  queued?: boolean;
  note?: string;
}> {
  const ctx = await loadAgentRunContext(params.agentId);
  const scopes = new Set([
    ...(ctx.permissionScopes as string[]),
    ...(ctx.alwaysScopes as string[]),
  ]);
  if (!scopes.has('whatsapp.contact_send')) {
    throw new WhatsAppScopeDeniedError('whatsapp.contact_send');
  }

  const poll = normalizePollInput({
    name: params.input.name,
    values: params.input.values,
    selectableCount: params.input.selectableCount,
  });

  await assertWhatsAppContactSendJit({
    agentId: params.agentId,
    runId: params.runId,
    ctx,
    jitToken: params.input.jitToken,
  });

  const connector = await ensureLiveWhatsApp(params.agentId);

  const outboundGate = await getTeamOutboundGate(params.runId);
  if (outboundGate.kind === 'blocked') {
    throw new WhatsAppToolError(outboundGate.reason);
  }
  if (outboundGate.kind === 'queue') {
      const resolved = await resolveWhatsAppRecipient({
        connectorId: connector.id,
        recipient: params.input.recipient,
      });
      if (!resolved.ok || !resolved.jid) {
        if (resolved.matches?.length) {
          throw new WhatsAppToolError(
            `${resolved.error ?? 'Ambiguous recipient'}: ${resolved.matches
              .map((m) => `${m.name ?? 'unknown'} (${m.phone ?? m.jid})`)
              .join(', ')}`,
          );
        }
        throw new WhatsAppToolError(resolved.error ?? 'Failed to resolve WhatsApp recipient');
      }

      const { normalizeReplyInstructions } = await import('../whatsapp/whatsappAutoReply.service.js');
      const { persistPendingWaitOutbound } = await import('../wait/pendingWaitOutbound.js');
      const recipientLooksLikeName =
        Boolean(params.input.recipient?.trim()) &&
        !/^[\d+\s()-]+$/.test(params.input.recipient.trim()) &&
        !params.input.recipient.includes('@');
      const displayName =
        resolved.name?.trim() ||
        (recipientLooksLikeName ? params.input.recipient.trim() : null);

      await persistPendingWaitOutbound({
        teamRunId: outboundGate.teamRunId,
        outbound: {
          agentId: params.agentId,
          connectorId: connector.id,
          recipient: params.input.recipient,
          message: poll.name,
          kind: 'poll',
          pollName: poll.name,
          pollValues: poll.values,
          pollSelectableCount: poll.selectableCount,
          replyInstructions: normalizeReplyInstructions(params.input.replyInstructions),
          jid: resolved.jid,
          phone: resolved.phone ?? null,
          name: displayName,
        },
      });

      await appendEmailActionLog({
        agentId: params.agentId,
        userId: ctx.userId,
        actionType: 'whatsapp.contact_send',
        payload: {
          tool: 'whatsapp_send_poll',
          recipient: params.input.recipient,
          jid: resolved.jid,
          name: displayName,
          pollName: poll.name,
          pollValues: poll.values,
          runId: params.runId,
          deferredUntilWait: true,
        },
        status: 'success',
        riskLevel: 'high',
      }).catch(() => {});

      if (hasConversationCapability(scopes) && resolved.jid && ctx.orgId) {
        await ensureOutreachThreadForContact({
          agentId: params.agentId,
          runId: params.runId,
          orgId: ctx.orgId,
          connectorId: connector.id,
          jid: resolved.jid,
          name: displayName,
        });
      }

      return {
        jid: resolved.jid,
        phone: resolved.phone,
        name: displayName,
        pollName: poll.name,
        pollValues: poll.values,
        autoReplyArmed: false,
        teamWaitArmed: false,
        replyInstructionsSet: Boolean(normalizeReplyInstructions(params.input.replyInstructions)),
        deferredUntilWait: true,
        queued: true,
        note:
          'Poll queued. Qlix will send it after this stage finishes and the wait duration is set — votes are captured as replies.',
      };
  }

  const guardedRecipient = await enforceLiveTeamOutboundTarget({
    runId: params.runId,
    agentId: params.agentId,
    connectorId: connector.id,
    recipient: params.input.recipient,
  });
  const result = await sendWhatsAppPoll({
    connectorId: connector.id,
    recipient: guardedRecipient,
    name: poll.name,
    values: poll.values,
    selectableCount: poll.selectableCount,
  });
  if (!result.ok) {
    if (result.matches?.length) {
      throw new WhatsAppToolError(
        `${resolvedMatchesMessage(result)}`,
      );
    }
    throw new WhatsAppToolError(result.error ?? 'Failed to send WhatsApp poll');
  }

  await appendEmailActionLog({
    agentId: params.agentId,
    userId: ctx.userId,
    actionType: 'whatsapp.contact_send',
    payload: {
      tool: 'whatsapp_send_poll',
      recipient: params.input.recipient,
      jid: result.jid ?? null,
      name: result.name ?? null,
      pollName: poll.name,
      pollValues: poll.values,
      runId: params.runId,
    },
    status: 'success',
    riskLevel: 'high',
  }).catch(() => {});

  let autoReplyArmed = false;
  let replyInstructionsSet = false;
  if (hasConversationCapability(scopes) && result.jid) {
    try {
      const { armAutoReplySession, normalizeReplyInstructions } = await import(
        '../whatsapp/whatsappAutoReply.service.js'
      );
      const instructions = normalizeReplyInstructions(params.input.replyInstructions);
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
      replyInstructionsSet = Boolean(instructions);
    } catch (err) {
      console.warn(
        '[whatsapp-auto-reply] arm failed:',
        err instanceof Error ? err.message : err,
      );
    }
    if (ctx.orgId) {
      await ensureOutreachThreadForContact({
        agentId: params.agentId,
        runId: params.runId,
        orgId: ctx.orgId,
        connectorId: connector.id,
        jid: result.jid,
        name: result.name ?? null,
      });
    }
  }

  return {
    jid: result.jid,
    phone: result.phone,
    name: result.name,
    pollName: poll.name,
    pollValues: poll.values,
    autoReplyArmed,
    teamWaitArmed: false,
    replyInstructionsSet,
  };
}

export async function executeWhatsAppDocumentSend(params: {
  agentId: string;
  runId: string | null;
  input: {
    recipient: string;
    fileName?: string | null;
    contentBase64?: string | null;
    /** Prefer this when sending a brochure/file from Brain — loads retained original or PDF fallback. */
    brainDocumentId?: string | null;
    mimetype?: string | null;
    jitToken?: string | null;
    replyInstructions?: string | null;
  };
}): Promise<{
  jid?: string;
  phone?: string | null;
  name?: string | null;
  fileName?: string;
  autoReplyArmed?: boolean;
  teamWaitArmed?: boolean;
  replyInstructionsSet?: boolean;
  deferredUntilWait?: boolean;
  queued?: boolean;
  note?: string;
  brainSource?: 'original' | 'generated_pdf';
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

  let buffer: Buffer;
  let fileNameHint: string;
  let mimeHint: string | undefined;
  let brainSource: 'original' | 'generated_pdf' | undefined;

  const brainDocumentId = params.input.brainDocumentId?.trim() || null;
  if (brainDocumentId) {
    if (!scopes.has('brain.query')) {
      throw new WhatsAppScopeDeniedError('brain.query');
    }
    const orgId = ctx.orgId;
    if (!orgId) throw new WhatsAppToolError('Agent must belong to an organization to load Brain files');
    const { loadBrainDocumentFile } = await import('../aiBrain/brainFileStorage.js');
    const file = await loadBrainDocumentFile({ orgId, documentId: brainDocumentId });
    buffer = file.bytes;
    fileNameHint = params.input.fileName?.trim() || file.fileName;
    mimeHint = params.input.mimetype ?? file.mimetype;
    brainSource = file.source;
  } else {
    const raw = params.input.contentBase64;
    if (!raw) {
      throw new WhatsAppToolError('Provide content_base64 or brain_document_id');
    }
    buffer = Buffer.from(raw, 'base64');
    if (buffer.length === 0) {
      throw new WhatsAppToolError('content_base64 decoded to empty file');
    }
    fileNameHint = params.input.fileName?.trim() || 'document.bin';
    mimeHint = params.input.mimetype ?? undefined;
  }

  const { resolveWhatsAppDocumentIdentity } = await import('../whatsapp/documentFileIdentity.js');
  const identity = resolveWhatsAppDocumentIdentity({
    fileName: fileNameHint,
    bytes: buffer,
    mimetype: mimeHint,
  });

  const connector = await ensureLiveWhatsApp(params.agentId);

  const outboundGate = await getTeamOutboundGate(params.runId);
  if (outboundGate.kind === 'blocked') {
    throw new WhatsAppToolError(outboundGate.reason);
  }
  if (outboundGate.kind === 'queue') {
      const resolved = await resolveWhatsAppRecipient({
        connectorId: connector.id,
        recipient: params.input.recipient,
      });
      if (!resolved.ok || !resolved.jid) {
        if (resolved.matches?.length) {
          throw new WhatsAppToolError(resolvedMatchesMessage(resolved));
        }
        throw new WhatsAppToolError(resolved.error ?? 'Failed to resolve WhatsApp recipient');
      }

      const { normalizeReplyInstructions } = await import('../whatsapp/whatsappAutoReply.service.js');
      const { persistPendingWaitOutbound, stagePendingWaitDocument } = await import(
        '../wait/pendingWaitOutbound.js'
      );
      const recipientLooksLikeName =
        Boolean(params.input.recipient?.trim()) &&
        !/^[\d+\s()-]+$/.test(params.input.recipient.trim()) &&
        !params.input.recipient.includes('@');
      const displayName =
        resolved.name?.trim() ||
        (recipientLooksLikeName ? params.input.recipient.trim() : null);

      const staged = await stagePendingWaitDocument({
        teamRunId: outboundGate.teamRunId,
        fileName: identity.fileName,
        bytes: buffer,
      });

      await persistPendingWaitOutbound({
        teamRunId: outboundGate.teamRunId,
        outbound: {
          agentId: params.agentId,
          connectorId: connector.id,
          recipient: params.input.recipient,
          message: staged.fileName,
          kind: 'document',
          documentFileName: staged.fileName,
          documentMimetype: identity.mimetype,
          documentStagedPath: staged.stagedPath,
          brainDocumentId,
          replyInstructions: normalizeReplyInstructions(params.input.replyInstructions),
          jid: resolved.jid,
          phone: resolved.phone ?? null,
          name: displayName,
        },
      });

      await appendEmailActionLog({
        agentId: params.agentId,
        userId: ctx.userId,
        actionType: 'whatsapp.contact_send',
        payload: {
          tool: 'whatsapp_send_document',
          recipient: params.input.recipient,
          jid: resolved.jid,
          name: displayName,
          fileName: staged.fileName,
          runId: params.runId,
          deferredUntilWait: true,
          brainDocumentId: brainDocumentId,
          brainSource,
        },
        status: 'success',
        riskLevel: 'high',
      }).catch(() => {});

      if (hasConversationCapability(scopes) && resolved.jid && ctx.orgId) {
        await ensureOutreachThreadForContact({
          agentId: params.agentId,
          runId: params.runId,
          orgId: ctx.orgId,
          connectorId: connector.id,
          jid: resolved.jid,
          name: displayName,
        });
      }

      return {
        jid: resolved.jid,
        phone: resolved.phone,
        name: displayName,
        fileName: staged.fileName,
        autoReplyArmed: false,
        teamWaitArmed: false,
        replyInstructionsSet: Boolean(normalizeReplyInstructions(params.input.replyInstructions)),
        deferredUntilWait: true,
        queued: true,
        brainSource,
        note:
          'Document queued. Qlix will send it after this stage finishes and the wait duration is set — in the same order as other messages to this contact.',
      };
  }

  const { writeFile, unlink } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { randomUUID } = await import('node:crypto');
  const tmpPath = join(tmpdir(), `qlix-wa-${randomUUID()}-${identity.fileName}`);
  await writeFile(tmpPath, buffer);
  try {
    const guardedRecipient = await enforceLiveTeamOutboundTarget({
      runId: params.runId,
      agentId: params.agentId,
      connectorId: connector.id,
      recipient: params.input.recipient,
    });
    const result = await sendWhatsAppDocumentToRecipient({
      connectorId: connector.id,
      recipient: guardedRecipient,
      filePath: tmpPath,
      fileName: identity.fileName,
      mimetype: identity.mimetype,
    });
    if (!result.ok) {
      if (result.matches?.length) {
        throw new WhatsAppToolError(resolvedMatchesMessage(result));
      }
      throw new WhatsAppToolError(result.error ?? 'Failed to send WhatsApp document');
    }

    await appendEmailActionLog({
      agentId: params.agentId,
      userId: ctx.userId,
      actionType: 'whatsapp.contact_send',
      payload: {
        tool: 'whatsapp_send_document',
        recipient: params.input.recipient,
        jid: result.jid ?? null,
        name: result.name ?? null,
        fileName: identity.fileName,
        runId: params.runId,
      },
      status: 'success',
      riskLevel: 'high',
    }).catch(() => {});

    let autoReplyArmed = false;
    let replyInstructionsSet = false;
    if (hasConversationCapability(scopes) && result.jid) {
      try {
        const { armAutoReplySession, normalizeReplyInstructions } = await import(
          '../whatsapp/whatsappAutoReply.service.js'
        );
        const instructions = normalizeReplyInstructions(params.input.replyInstructions);
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
        replyInstructionsSet = Boolean(instructions);
      } catch (err) {
        console.warn(
          '[whatsapp-auto-reply] arm failed:',
          err instanceof Error ? err.message : err,
        );
      }
      if (ctx.orgId) {
        await ensureOutreachThreadForContact({
          agentId: params.agentId,
          runId: params.runId,
          orgId: ctx.orgId,
          connectorId: connector.id,
          jid: result.jid,
          name: result.name ?? null,
        });
      }
    }

    return {
      jid: result.jid,
      phone: result.phone,
      name: result.name,
      fileName: identity.fileName,
      autoReplyArmed,
      teamWaitArmed: false,
      replyInstructionsSet,
      brainSource,
    };
  } finally {
    await unlink(tmpPath).catch(() => {
      /* best-effort */
    });
  }
}

function resolvedMatchesMessage(result: {
  error?: string;
  matches?: Array<{ name: string | null; phone: string | null; jid: string }>;
}): string {
  return `${result.error ?? 'Ambiguous recipient'}: ${(result.matches ?? [])
    .map((m) => `${m.name ?? 'unknown'} (${m.phone ?? m.jid})`)
    .join(', ')}`;
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
  if (!hasConversationCapability(scopes)) {
    throw new WhatsAppScopeDeniedError('conversation');
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
  if (!hasConversationCapability(scopes)) {
    throw new WhatsAppScopeDeniedError('conversation');
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
  if (!hasConversationCapability(scopes)) {
    throw new WhatsAppScopeDeniedError('conversation');
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
