import { timingSafeEqual } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { assertInternalServiceSecret } from '../middleware/assertInternalServiceSecret.js';
import { authenticateUser } from '../middleware/authenticateUser.js';
import { requireSubscriptionAccess } from '../middleware/requireSubscriptionAccess.js';
import { sendTelegramMessage } from '../gateway/adapters/telegram.adapter.js';
import {
  findTelegramConnectorForInbound,
  handleTelegramInbound,
} from '../telegram/telegramChannel.service.js';
import {
  deleteTelegramBotConnector,
  upsertTelegramBotConnector,
  verifyTelegramBotToken,
} from '../telegram/telegramConnector.service.js';
import { claimTelegramUpdateId } from '../telegram/telegramUpdateDedupe.js';

const updateSchema = z.object({
  update_id: z.number(),
  message: z
    .object({
      message_id: z.number().optional(),
      text: z.string().optional(),
      chat: z.object({
        id: z.union([z.number(), z.string()]),
        type: z.string().optional(),
      }),
      from: z
        .object({
          id: z.union([z.number(), z.string()]),
          is_bot: z.boolean().optional(),
        })
        .optional(),
    })
    .optional(),
});

function secretsEqual(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function assertTelegramWebhookSecret(req: Request, res: Response): boolean {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (!secret) {
    console.warn('[telegram] TELEGRAM_WEBHOOK_SECRET unset — rejecting webhook');
    res.status(503).json({ error: 'webhook_not_configured' });
    return false;
  }
  const provided = req.header('x-telegram-bot-api-secret-token')?.trim() ?? '';
  if (!provided || !secretsEqual(provided, secret)) {
    res.status(401).json({ error: 'invalid_secret' });
    return false;
  }
  return true;
}

/**
 * Telegram Bot API:
 * - POST /webhook (public, secret header) — mount at /api/integrations/telegram
 * - POST /connect, DELETE / (authenticated) — also mount at /api/v1/telegram
 */
export function createTelegramRouter(): Router {
  const router = Router();

  /** Enable Telegram for this workspace using TELEGRAM_BOT_TOKEN from server env. */
  router.post(
    '/connect',
    authenticateUser(true),
    requireSubscriptionAccess,
    async (req: Request, res: Response) => {
      if (req.auth!.role === 'member') {
        res.status(403).json({ error: { code: 'forbidden', message: 'Admin required' } });
        return;
      }
      const parsed = z
        .object({
          defaultAgentId: z.string().min(1).optional().nullable(),
        })
        .safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({
          error: { code: 'invalid_body', message: 'Invalid body' },
        });
        return;
      }

      const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
      if (!botToken) {
        res.status(503).json({
          error: {
            code: 'telegram_not_configured',
            message: 'TELEGRAM_BOT_TOKEN is not configured on the server',
          },
        });
        return;
      }

      const orgId = req.auth!.orgId;
      const userId = req.auth!.userId;
      const defaultAgentId = parsed.data.defaultAgentId?.trim() || null;

      if (defaultAgentId) {
        const agent = await prisma.agent.findFirst({
          where: { id: defaultAgentId, orgId },
          select: { id: true },
        });
        if (!agent) {
          res.status(400).json({ error: { code: 'invalid_agent', message: 'Default agent not found' } });
          return;
        }
      }

      try {
        const me = await verifyTelegramBotToken(botToken);
        await upsertTelegramBotConnector({
          orgId,
          userId,
          botToken,
          defaultAgentId,
          botUsername: me.username,
        });
        res.json({
          ok: true,
          provider: 'telegram',
          bot: { id: me.id, username: me.username, firstName: me.firstName },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to connect Telegram';
        res.status(400).json({ error: { code: 'telegram_connect_failed', message } });
      }
    },
  );

  router.delete(
    '/',
    authenticateUser(true),
    requireSubscriptionAccess,
    async (req: Request, res: Response) => {
      if (req.auth!.role === 'member') {
        res.status(403).json({ error: { code: 'forbidden', message: 'Admin required' } });
        return;
      }
      try {
        await deleteTelegramBotConnector(req.auth!.orgId);
        res.status(204).send();
      } catch (err) {
        console.error('[telegram] disconnect', err instanceof Error ? err.message : err);
        res.status(500).json({ error: { code: 'disconnect_failed', message: 'Failed to disconnect Telegram' } });
      }
    },
  );

  router.post('/webhook', async (req: Request, res: Response) => {
    if (!assertTelegramWebhookSecret(req, res)) return;

    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.json({ ok: true });
      return;
    }

    const updateId = parsed.data.update_id;
    if (!(await claimTelegramUpdateId(updateId))) {
      res.json({ ok: true });
      return;
    }

    const msg = parsed.data.message;
    if (
      !msg?.text ||
      !msg.chat ||
      msg.chat.type !== 'private' ||
      !msg.from?.id ||
      msg.from.is_bot
    ) {
      res.json({ ok: true });
      return;
    }

    const telegramUserId = String(msg.from.id);
    const chatId = String(msg.chat.id);
    const text = msg.text.trim();
    if (!text) {
      res.json({ ok: true });
      return;
    }

    const connector = await findTelegramConnectorForInbound();
    if (!connector) {
      console.warn('[telegram] no connected Telegram connector — connect in Connectors UI');
      res.json({ ok: true });
      return;
    }

    res.json({ ok: true });

    void (async () => {
      try {
        const result = await handleTelegramInbound({
          connectorId: connector.id,
          text,
          chatId,
          telegramUserId,
        });
        if (result.reply?.trim()) {
          await sendTelegramMessage(chatId, result.reply, { orgId: connector.orgId });
        }
      } catch (err) {
        console.error('[telegram] inbound', err instanceof Error ? err.message : err);
        await sendTelegramMessage(
          chatId,
          err instanceof Error ? err.message : 'Failed to process message',
          { orgId: connector.orgId },
        ).catch(() => undefined);
      }
    })();
  });

  /** Internal helper for tests / sidecars. */
  router.post('/inbound', assertInternalServiceSecret, async (req: Request, res: Response) => {
    const body = z
      .object({
        connectorId: z.string().uuid().optional(),
        orgId: z.string().uuid().optional(),
        chatId: z.string().min(1),
        telegramUserId: z.string().min(1),
        text: z.string().min(1),
      })
      .safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: { code: 'invalid_body' } });
      return;
    }

    try {
      let connectorId = body.data.connectorId;
      if (!connectorId && body.data.orgId) {
        const row = await prisma.connectorAccount.findUnique({
          where: { orgId_provider: { orgId: body.data.orgId, provider: 'telegram' } },
          select: { id: true },
        });
        connectorId = row?.id;
      }
      if (!connectorId) {
        const fallback = await findTelegramConnectorForInbound();
        connectorId = fallback?.id;
      }
      if (!connectorId) {
        res.status(404).json({ error: { code: 'not_found', message: 'Telegram connector not found' } });
        return;
      }

      const result = await handleTelegramInbound({
        connectorId,
        text: body.data.text,
        chatId: body.data.chatId,
        telegramUserId: body.data.telegramUserId,
      });
      res.json({ result });
    } catch (err) {
      console.error('[telegram] inbound sync', err instanceof Error ? err.message : err);
      res.status(500).json({ error: { code: 'internal_error' } });
    }
  });

  return router;
}
