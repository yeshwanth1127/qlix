import type { ChannelAdapter, DeliveryTarget, InboundMessage, ReplyPayload } from '../types.js';

/**
 * Telegram Bot API adapter → gateway ingress + reply.
 * Configure TELEGRAM_BOT_TOKEN; webhook at POST /api/v1/telegram/webhook.
 */
export const telegramAdapter: ChannelAdapter = {
  channel: 'telegram',
  async deliver(target: DeliveryTarget, payload: ReplyPayload): Promise<void> {
    const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
    const chatId = target.peerId ?? target.threadId;
    if (!token || !chatId) {
      console.warn('[telegram] deliver skipped — missing token or chat id');
      return;
    }
    const text = payload.ok
      ? typeof payload.result === 'string'
        ? payload.result
        : JSON.stringify(payload.result ?? {}, null, 2)
      : `Run failed: ${payload.errorMessage ?? 'unknown error'}`;
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: text.slice(0, 3900),
          disable_web_page_preview: true,
        }),
      });
      if (!res.ok) {
        console.warn('[telegram] sendMessage failed', res.status, await res.text().catch(() => ''));
      }
    } catch (err) {
      console.warn('[telegram] deliver error', err instanceof Error ? err.message : err);
    }
  },
};

export function buildTelegramInbound(input: {
  orgId: string;
  userId: string;
  chatId: string;
  telegramUserId: string;
  text: string;
  agentId: string;
  conversationId: string;
  agentName?: string;
}): InboundMessage {
  return {
    channel: 'telegram',
    orgId: input.orgId,
    userId: input.userId,
    peerId: input.telegramUserId,
    threadId: input.chatId,
    body: input.text,
    deliveryTarget: {
      channel: 'telegram',
      peerId: input.chatId,
      threadId: input.chatId,
    },
    preResolved: {
      targetType: 'agent',
      agentId: input.agentId,
      conversationId: input.conversationId,
      orgId: input.orgId,
      userId: input.userId,
      targetName: input.agentName,
      teamRole: 'telegram',
    },
  };
}
