import type { ChannelAdapter, DeliveryTarget, InboundMessage, ReplyPayload } from '../types.js';
import { resolveTelegramBotToken } from '../../telegram/telegramConnector.service.js';

/** Telegram Bot API hard limit is 4096; keep a small safety margin. */
export const TELEGRAM_MAX_MESSAGE_LENGTH = 4000;

/**
 * Split long replies into Telegram-safe chunks (~4000 chars).
 * Prefers newline, then space, then a hard cut.
 */
export function chunkTelegramText(
  text: string,
  maxLen: number = TELEGRAM_MAX_MESSAGE_LENGTH,
): string[] {
  const input = text ?? '';
  if (input.length === 0) return [''];
  if (input.length <= maxLen) return [input];

  const chunks: string[] = [];
  let remaining = input;
  while (remaining.length > maxLen) {
    let splitAt = remaining.lastIndexOf('\n', maxLen);
    if (splitAt < Math.floor(maxLen * 0.5)) {
      splitAt = remaining.lastIndexOf(' ', maxLen);
    }
    if (splitAt < Math.floor(maxLen * 0.5)) {
      splitAt = maxLen;
    }
    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }
  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}

export type SendTelegramMessageOptions = {
  orgId?: string | null;
  botToken?: string | null;
};

/**
 * Reusable Telegram Bot API sendMessage.
 * Never logs the bot token.
 */
export async function sendTelegramMessage(
  chatId: string | number,
  text: string,
  options: SendTelegramMessageOptions = {},
): Promise<void> {
  const token =
    options.botToken?.trim() ||
    (await resolveTelegramBotToken(options.orgId)) ||
    process.env.TELEGRAM_BOT_TOKEN?.trim() ||
    null;
  if (!token) {
    console.warn('[telegram] sendMessage skipped — no bot token');
    return;
  }

  const chunks = chunkTelegramText(text);
  for (const chunk of chunks) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: chunk,
          disable_web_page_preview: true,
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.warn('[telegram] sendMessage failed', res.status, body.slice(0, 200));
      }
    } catch (err) {
      console.warn('[telegram] sendMessage error', err instanceof Error ? err.message : err);
    }
  }
}

/**
 * Telegram Bot API adapter → gateway ingress + reply.
 * Webhook: POST /api/integrations/telegram/webhook
 * Connect: POST /api/v1/telegram/connect
 */
export const telegramAdapter: ChannelAdapter = {
  channel: 'telegram',
  async deliver(target: DeliveryTarget, payload: ReplyPayload): Promise<void> {
    const chatId = target.peerId ?? target.threadId;
    if (!chatId) {
      console.warn('[telegram] deliver skipped — missing chat id');
      return;
    }
    const text = payload.ok
      ? typeof payload.result === 'string'
        ? payload.result
        : JSON.stringify(payload.result ?? {}, null, 2)
      : `Run failed: ${payload.errorMessage ?? 'unknown error'}`;
    await sendTelegramMessage(chatId, text, { orgId: target.orgId });
  },
};

/**
 * Build an inbound gateway message for a Telegram private chat.
 *
 * Conversations are keyed by Telegram user/chat ids today
 * (`peerId` = telegram user id, `threadId` = chat id).
 * Later: map telegram_user_id → qlix_user_id without changing this shape.
 */
export function buildTelegramInbound(input: {
  orgId: string;
  userId: string;
  chatId: string;
  telegramUserId: string;
  text: string;
  agentId: string;
  conversationId: string;
  agentName?: string;
  useBrain?: boolean;
}): InboundMessage {
  return {
    channel: 'telegram',
    orgId: input.orgId,
    userId: input.userId,
    peerId: input.telegramUserId,
    threadId: input.chatId,
    body: input.text,
    useBrain: input.useBrain,
    deliveryTarget: {
      channel: 'telegram',
      orgId: input.orgId,
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
    metadata: {
      // Hook for future account linking: telegram_user_id → qlix_user_id
      telegramUserId: input.telegramUserId,
      telegramChatId: input.chatId,
    },
  };
}
