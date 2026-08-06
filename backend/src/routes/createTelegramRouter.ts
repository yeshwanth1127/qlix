import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { buildTelegramInbound } from '../gateway/adapters/telegram.adapter.js';
import { gatewayService } from '../gateway/index.js';
import { assertInternalServiceSecret } from '../middleware/assertInternalServiceSecret.js';

const updateSchema = z.object({
  message: z
    .object({
      message_id: z.number().optional(),
      text: z.string().optional(),
      chat: z.object({ id: z.union([z.number(), z.string()]) }),
      from: z.object({ id: z.union([z.number(), z.string()]) }).optional(),
    })
    .optional(),
});

/**
 * Telegram webhook + internal inbound.
 * Env: TELEGRAM_BOT_TOKEN, TELEGRAM_DEFAULT_ORG_ID, TELEGRAM_DEFAULT_AGENT_ID, TELEGRAM_DEFAULT_USER_ID
 * Optional: TELEGRAM_WEBHOOK_SECRET (compared to x-telegram-bot-api-secret-token)
 */
export function createTelegramRouter(): Router {
  const router = Router();

  router.post('/webhook', async (req: Request, res: Response) => {
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
    if (secret) {
      const provided = req.header('x-telegram-bot-api-secret-token')?.trim();
      if (provided !== secret) {
        res.status(401).json({ error: 'invalid_secret' });
        return;
      }
    }

    const parsed = updateSchema.safeParse(req.body);
    const msg = parsed.success ? parsed.data.message : undefined;
    if (!msg?.text || !msg.chat) {
      res.json({ ok: true });
      return;
    }

    const orgId = process.env.TELEGRAM_DEFAULT_ORG_ID?.trim();
    const agentId = process.env.TELEGRAM_DEFAULT_AGENT_ID?.trim();
    const userId = process.env.TELEGRAM_DEFAULT_USER_ID?.trim();
    if (!orgId || !agentId || !userId) {
      console.warn('[telegram] missing TELEGRAM_DEFAULT_* env');
      res.json({ ok: true });
      return;
    }

    res.json({ ok: true });

    const agent = await prisma.agent.findFirst({
      where: { id: agentId, orgId },
      select: { id: true, name: true },
    });
    if (!agent) return;

    const { getOrCreatePrimaryConversation } = await import('../agentChat/conversationService.js');
    const convo = await getOrCreatePrimaryConversation({
      agentId: agent.id,
      userId,
      orgId,
    });

    void gatewayService
      .handleInbound(
        buildTelegramInbound({
          orgId,
          userId,
          chatId: String(msg.chat.id),
          telegramUserId: String(msg.from?.id ?? msg.chat.id),
          text: msg.text,
          agentId: agent.id,
          conversationId: convo.id,
          agentName: agent.name,
        }),
      )
      .catch((err) => console.error('[telegram] inbound', err));
  });

  router.post('/inbound', assertInternalServiceSecret, async (req: Request, res: Response) => {
    const body = z
      .object({
        orgId: z.string().uuid(),
        userId: z.string().uuid(),
        agentId: z.string().min(1),
        chatId: z.string().min(1),
        telegramUserId: z.string().min(1),
        text: z.string().min(1),
      })
      .safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: { code: 'invalid_body' } });
      return;
    }
    const agent = await prisma.agent.findFirst({
      where: { id: body.data.agentId, orgId: body.data.orgId },
      select: { id: true, name: true },
    });
    if (!agent) {
      res.status(404).json({ error: { code: 'not_found' } });
      return;
    }
    const { getOrCreatePrimaryConversation } = await import('../agentChat/conversationService.js');
    const convo = await getOrCreatePrimaryConversation({
      agentId: agent.id,
      userId: body.data.userId,
      orgId: body.data.orgId,
    });
    const turn = await gatewayService.handleInbound(
      buildTelegramInbound({
        ...body.data,
        agentId: agent.id,
        conversationId: convo.id,
        agentName: agent.name,
      }),
    );
    res.json({ turn });
  });

  return router;
}
