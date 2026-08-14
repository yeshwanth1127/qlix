import { enqueueAgentRun } from '../agentChat/agentRunService.js';
import { buildMemoryBlock } from '../agentChat/agentMemory.service.js';
import { prisma } from '../lib/prisma.js';
import { addInjection } from '../teams/runInjectionStore.js';
import type { TeamRunSourceChannel } from '../teams/teams.types.js';
import { admitTurn } from './admission.js';
import { GatewayDrainingError, isGatewayDraining } from './drain.js';
import { putPrefetchedMemory } from './memoryPrefetch.js';
import { replyDispatcher } from './replyDispatcher.js';
import { GatewayRouteError, resolveRoute } from './resolveRoute.js';
import { buildSessionKeyFromInbound } from './sessionKey.js';
import { setActiveRun, withSessionLane } from './sessionLane.js';
import type {
  GatewayTurnResult,
  InboundMessage,
  ResolvedRoute,
} from './types.js';

function formatQueuedAck(route: ResolvedRoute, useBrain?: boolean): string {
  const name = route.targetName ?? (route.targetType === 'team' ? 'Team' : 'Agent');
  const hints: string[] = [];
  if (useBrain) hints.push('brain');
  if (route.routeHint) hints.push(route.routeHint);
  const suffix = hints.length > 0 ? ` (${hints.join(', ')})` : '';
  if (route.targetType === 'team') {
    return `Queued — ${name}.${suffix}`.trim();
  }
  return `Queued — ${name} is on it.${suffix}`;
}

/**
 * Unified ingress: route → admit → enqueue (or launch team) → track reply.
 * Keeps poll-based runners; adds OpenClaw-style session admission.
 */
export class GatewayService {
  async handleInbound(msg: InboundMessage): Promise<GatewayTurnResult> {
    const sessionKey = buildSessionKeyFromInbound(msg);

    if (isGatewayDraining()) {
      return {
        status: 'rejected',
        reason: new GatewayDrainingError().message,
        sessionKey,
        ackReply: 'Gateway is draining for deploy — retry shortly',
      };
    }

    let route: ResolvedRoute;
    try {
      route = await resolveRoute(msg, sessionKey);
    } catch (err) {
      if (err instanceof GatewayRouteError) {
        return {
          status: 'rejected',
          reason: err.message,
          sessionKey,
          ackReply: err.message,
        };
      }
      throw err;
    }

    return withSessionLane(sessionKey, async () => {
      const admission = await admitTurn(sessionKey, msg);
      if (admission.action === 'reject' && admission.result) {
        return admission.result;
      }

      if (admission.action === 'steer' && admission.activeRunId) {
        await injectSteerNote(admission.activeRunId, msg.body);
        return (
          admission.result ?? {
            status: 'steered',
            runId: admission.activeRunId,
            sessionKey,
            ackReply: 'Steering active run…',
          }
        );
      }

      if (route.targetType === 'team' && route.teamId) {
        return this.enqueueTeam(msg, route, sessionKey);
      }

      if (!route.agentId || !route.conversationId) {
        return {
          status: 'rejected',
          reason: 'Resolved agent route missing agentId/conversationId',
          sessionKey,
        };
      }

      const { runId, messageId } = await enqueueAgentRun({
        agentId: route.agentId,
        conversationId: route.conversationId,
        userId: route.userId,
        orgId: route.orgId,
        email: msg.email,
        prompt: msg.body,
        displayPrompt: msg.displayBody ?? msg.body,
        attachments: msg.attachments,
        skills: msg.skills,
        inferenceModel: msg.inferenceModel,
        reasoningEffort: msg.reasoningEffort ?? null,
        useBrain: msg.useBrain,
        teamRole: route.teamRole,
        sourceChannel: msg.channel === 'system' ? 'web' : msg.channel,
        whatsappReplyToJid:
          typeof msg.metadata?.whatsappReplyToJid === 'string'
            ? msg.metadata.whatsappReplyToJid
            : null,
      });

      setActiveRun(sessionKey, runId);
      replyDispatcher.track(runId, msg.deliveryTarget, sessionKey);

      // Prefetch memory while the runner is still claiming the run.
      void buildMemoryBlock({
        agentId: route.agentId,
        userId: route.userId,
        conversationId: route.conversationId,
        currentPrompt: msg.body,
      })
        .then((block) => putPrefetchedMemory(runId, block))
        .catch(() => putPrefetchedMemory(runId, null));

      if (route.conversationId) {
        void prisma.agentConversation
          .update({
            where: { id: route.conversationId },
            data: { sessionKey },
          })
          .catch(() => undefined);
      }

      // Lightweight audit metadata on ActionLog-friendly shape (gateway routing decision).
      void logGatewayRoute({
        sessionKey,
        channel: msg.channel,
        userId: msg.userId,
        orgId: route.orgId,
        agentId: route.agentId,
        teamId: route.teamId,
        runId,
        targetType: route.targetType,
      }).catch(() => undefined);

      return {
        status: 'accepted',
        runId,
        messageId,
        sessionKey,
        targetType: 'agent',
        ackReply: formatQueuedAck(route, msg.useBrain),
      };
    });
  }

  private async enqueueTeam(
    msg: InboundMessage,
    route: ResolvedRoute,
    sessionKey: string,
  ): Promise<GatewayTurnResult> {
    if (!route.teamId || !route.orgId) {
      return {
        status: 'rejected',
        reason: 'Team route requires teamId and orgId',
        sessionKey,
      };
    }

    const { launchTeamRun } = await import('../teams/teamsRunLauncher.js');
    const { TeamContinuesRunError } = await import('../teams/teams.service.js');
    const sourceChannel: TeamRunSourceChannel =
      msg.channel === 'whatsapp' ||
      msg.channel === 'api' ||
      msg.channel === 'slack' ||
      msg.channel === 'telegram'
        ? msg.channel
        : 'web';

    const backendUrl =
      typeof msg.metadata?.backendUrl === 'string' ? msg.metadata.backendUrl : undefined;
    const inferenceModel =
      typeof msg.metadata?.inferenceModel === 'string' && msg.metadata.inferenceModel.trim()
        ? msg.metadata.inferenceModel.trim()
        : undefined;
    const reasoningEffort =
      typeof msg.metadata?.reasoningEffort === 'string' && msg.metadata.reasoningEffort.trim()
        ? msg.metadata.reasoningEffort.trim()
        : undefined;
    const continuesRunId =
      typeof msg.metadata?.continuesRunId === 'string' && msg.metadata.continuesRunId.trim()
        ? msg.metadata.continuesRunId.trim()
        : undefined;
    const inputs = Array.isArray(msg.metadata?.teamRunInputs)
      ? (msg.metadata.teamRunInputs as import('../teams/teams.types.js').TeamRunInput[])
      : undefined;

    let launched: Awaited<ReturnType<typeof launchTeamRun>>;
    try {
      launched = await launchTeamRun({
        teamId: route.teamId,
        orgId: route.orgId,
        userId: route.userId,
        goal: msg.body,
        backendUrl,
        inferenceModel,
        reasoningEffort,
        continuesRunId,
        inputs,
        source: {
          channel: sourceChannel,
          connectorId: msg.deliveryTarget.connectorId ?? undefined,
        },
        replyChannel: msg.channel === 'whatsapp' ? 'whatsapp' : undefined,
      });
    } catch (err) {
      if (err instanceof TeamContinuesRunError) {
        return {
          status: 'rejected',
          reason: err.message,
          sessionKey,
          ackReply: err.message,
        };
      }
      throw err;
    }
    const { run, team } = launched;

    setActiveRun(sessionKey, run.id);
    replyDispatcher.track(run.id, msg.deliveryTarget, sessionKey);

    void logGatewayRoute({
      sessionKey,
      channel: msg.channel,
      userId: msg.userId,
      orgId: route.orgId,
      teamId: route.teamId,
      runId: run.id,
      targetType: 'team',
    }).catch(() => undefined);

    return {
      status: 'accepted',
      runId: run.id,
      sessionKey,
      targetType: 'team',
      ackReply: `Queued — ${team.name} (run ${run.id.slice(0, 10)}…). Reply here to steer mid-run; !status · !cancel`,
    };
  }
}

async function injectSteerNote(runId: string, note: string): Promise<void> {
  const cleaned = note.replace(/^\/steer\s*/i, '').replace(/^!steer\s*/i, '').trim();
  if (!cleaned) return;

  // Runner polls RunInjection; also mirror as a run event for the SSE timeline.
  await addInjection(runId, cleaned);

  const run = await prisma.agentRun.findUnique({
    where: { id: runId },
    select: { conversationId: true },
  });
  if (!run) return;

  const last = await prisma.agentRunEvent.findFirst({
    where: { runId },
    orderBy: { seq: 'desc' },
    select: { seq: true },
  });
  const seq = (last?.seq ?? 0) + 1;
  await prisma.agentRunEvent.create({
    data: {
      runId,
      seq,
      type: 'injection',
      data: { text: cleaned, source: 'gateway_steer' },
    },
  });
  void import('./runEventBus.js')
    .then(({ runEventBus }) =>
      runEventBus.publish({
        runId,
        seq,
        type: 'injection',
        data: { text: cleaned, source: 'gateway_steer' },
        createdAt: new Date().toISOString(),
      }),
    )
    .catch(() => undefined);
  await prisma.agentMessage.create({
    data: {
      conversationId: run.conversationId,
      role: 'user',
      content: `[steer] ${cleaned}`,
    },
  });
}

async function logGatewayRoute(meta: {
  sessionKey: string;
  channel: string;
  userId: string;
  orgId: string | null;
  agentId?: string;
  teamId?: string;
  runId: string;
  targetType: string;
}): Promise<void> {
  // Soft audit: store as AgentRunEvent on the run for gateway metadata (ActionLog stays for signed actions).
  try {
    const last = await prisma.agentRunEvent.findFirst({
      where: { runId: meta.runId },
      orderBy: { seq: 'desc' },
      select: { seq: true },
    });
    await prisma.agentRunEvent.create({
      data: {
        runId: meta.runId,
        seq: (last?.seq ?? 0) + 1,
        type: 'gateway_route',
        data: {
          sessionKey: meta.sessionKey,
          channel: meta.channel,
          targetType: meta.targetType,
          agentId: meta.agentId ?? null,
          teamId: meta.teamId ?? null,
          orgId: meta.orgId,
          userId: meta.userId,
        },
      },
    });
  } catch {
    // Team runs may not have AgentRun rows — ignore.
  }
}

export const gatewayService = new GatewayService();
