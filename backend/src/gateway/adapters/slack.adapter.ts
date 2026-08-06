import type { ChannelAdapter, DeliveryTarget, InboundMessage, ReplyPayload } from '../types.js';
import { ConnectorsRepository } from '../../connectors/connectors.repository.js';

const connectorsRepo = new ConnectorsRepository();

async function resolveSlackDeliverToken(orgId: string | null | undefined): Promise<string | null> {
  if (orgId) {
    const tokens = await connectorsRepo.loadTokens(orgId, 'slack');
    if (tokens?.accessToken) return tokens.accessToken;
    if (tokens?.slackBotAccessToken) return tokens.slackBotAccessToken;
  }
  return process.env.SLACK_BOT_TOKEN?.trim() ?? null;
}

/**
 * Slack channel adapter — Bolt-style Events API webhook → gateway ingress.
 * Outbound uses the org OAuth user token when available (Option B), else SLACK_BOT_TOKEN.
 */
export const slackAdapter: ChannelAdapter = {
  channel: 'slack',
  async deliver(target: DeliveryTarget, payload: ReplyPayload): Promise<void> {
    const token = await resolveSlackDeliverToken(target.orgId);
    const channel = target.peerId ?? target.threadId;
    if (!token || !channel) {
      console.warn('[slack] deliver skipped — missing token or channel');
      return;
    }
    const text = payload.ok
      ? typeof payload.result === 'string'
        ? payload.result
        : JSON.stringify(payload.result ?? {}, null, 2)
      : `Run failed: ${payload.errorMessage ?? 'unknown error'}`;

    try {
      const res = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify({
          channel,
          text: text.slice(0, 3900),
          thread_ts: target.threadId && target.threadId !== channel ? target.threadId : undefined,
        }),
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!body?.ok) {
        console.warn('[slack] chat.postMessage failed', body?.error ?? res.status);
      }
    } catch (err) {
      console.warn('[slack] deliver error', err instanceof Error ? err.message : err);
    }
  },
};

export function buildSlackInbound(input: {
  orgId: string;
  userId: string;
  slackUserId: string;
  channelId: string;
  threadTs?: string | null;
  text: string;
  agentId: string;
  conversationId: string;
  agentName?: string;
}): InboundMessage {
  return {
    channel: 'slack',
    orgId: input.orgId,
    userId: input.userId,
    peerId: input.slackUserId,
    threadId: input.threadTs ?? input.channelId,
    body: input.text,
    deliveryTarget: {
      channel: 'slack',
      orgId: input.orgId,
      peerId: input.channelId,
      threadId: input.threadTs ?? input.channelId,
    },
    preResolved: {
      targetType: 'agent',
      agentId: input.agentId,
      conversationId: input.conversationId,
      orgId: input.orgId,
      userId: input.userId,
      targetName: input.agentName,
      teamRole: 'slack',
    },
  };
}

/** Deliver a JIT approval card to Slack (Approve / Deny buttons via Block Kit). */
export async function deliverSlackJitApproval(input: {
  channelId: string;
  threadTs?: string | null;
  actionType: string;
  jitRequestId: string;
  agentName?: string;
}): Promise<boolean> {
  const token = process.env.SLACK_BOT_TOKEN?.trim();
  if (!token) return false;
  const base = process.env.FRONTEND_URL?.replace(/\/$/, '') ?? '';
  const text =
    `*JIT approval needed*\nAgent: ${input.agentName ?? 'Agent'}\nAction: \`${input.actionType}\`\n` +
    (base ? `<${base}/jit?id=${input.jitRequestId}|Open in Qlix>` : `Request: ${input.jitRequestId}`);
  try {
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        channel: input.channelId,
        text,
        thread_ts: input.threadTs ?? undefined,
      }),
    });
    const body = (await res.json().catch(() => null)) as { ok?: boolean } | null;
    return Boolean(body?.ok);
  } catch {
    return false;
  }
}
