import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticateUser } from '../middleware/authenticateUser.js';
import { requireSubscriptionAccess } from '../middleware/requireSubscriptionAccess.js';
const patchSchema = z.object({
  whatsappAgentId: z.string().min(1).nullable().optional(),
  whatsappTeamId: z.string().min(1).nullable().optional(),
  slackAgentId: z.string().min(1).nullable().optional(),
  telegramAgentId: z.string().min(1).nullable().optional(),
});

/**
 * Default agent (and team) per inbound channel for the workspace.
 * WhatsApp uses ConnectorAccount fields; Slack/Telegram store on a slack/telegram connector row.
 */
export function createChannelDefaultsRouter(): Router {
  const router = Router();

  router.get('/', authenticateUser(true), requireSubscriptionAccess, async (req: Request, res: Response) => {
    const orgId = req.auth!.orgId;
    const connectors = await prisma.connectorAccount.findMany({
      where: { orgId, provider: { in: ['whatsapp_baileys', 'slack', 'telegram'] } },
      select: {
        provider: true,
        whatsappDefaultAgentId: true,
        whatsappDefaultTeamId: true,
        status: true,
      },
    });
    const by = Object.fromEntries(connectors.map((c) => [c.provider, c]));
    const wa = by.whatsapp_baileys;
    const slack = by.slack;
    const telegram = by.telegram;
    res.json({
      whatsapp: {
        agentId: wa?.whatsappDefaultAgentId ?? null,
        teamId: wa?.whatsappDefaultTeamId ?? null,
        connected: wa?.status === 'connected',
      },
      slack: {
        agentId: slack?.whatsappDefaultAgentId ?? null,
        connected: slack?.status === 'connected',
      },
      telegram: {
        agentId: telegram?.whatsappDefaultAgentId ?? null,
        connected: telegram?.status === 'connected',
      },
    });
  });

  router.patch('/', authenticateUser(true), requireSubscriptionAccess, async (req: Request, res: Response) => {
    if (req.auth!.role === 'member') {
      res.status(403).json({ error: { code: 'forbidden', message: 'Admin required' } });
      return;
    }
    const parsed = patchSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'invalid_body', message: 'Invalid channel defaults' } });
      return;
    }
    const orgId = req.auth!.orgId;
    const userId = req.auth!.userId;
    const d = parsed.data;

    if (d.whatsappAgentId !== undefined || d.whatsappTeamId !== undefined) {
      const wa = await prisma.connectorAccount.findUnique({
        where: { orgId_provider: { orgId, provider: 'whatsapp_baileys' } },
      });
      if (wa) {
        await prisma.connectorAccount.update({
          where: { id: wa.id },
          data: {
            ...(d.whatsappAgentId !== undefined
              ? { whatsappDefaultAgentId: d.whatsappAgentId }
              : {}),
            ...(d.whatsappTeamId !== undefined ? { whatsappDefaultTeamId: d.whatsappTeamId } : {}),
          },
        });
      }
    }

    for (const [provider, agentId] of [
      ['slack', d.slackAgentId],
      ['telegram', d.telegramAgentId],
    ] as const) {
      if (agentId === undefined) continue;
      await prisma.connectorAccount.upsert({
        where: { orgId_provider: { orgId, provider } },
        create: {
          orgId,
          userId,
          provider,
          status: 'connected',
          scopes: [],
          tokenEnc: 'channel-defaults',
          whatsappDefaultAgentId: agentId,
        },
        update: { whatsappDefaultAgentId: agentId },
      });
    }

    res.json({ ok: true });
  });

  return router;
}
