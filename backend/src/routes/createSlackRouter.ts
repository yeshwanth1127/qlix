import { Router, type Request, type Response } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { buildSlackInbound } from '../gateway/adapters/slack.adapter.js';
import { gatewayService } from '../gateway/index.js';
import { assertInternalServiceSecret } from '../middleware/assertInternalServiceSecret.js';
import { encryptForAgentSecrets } from '../cloudRunners/agentSecrets.js';
import { authenticateUser } from '../middleware/authenticateUser.js';
import { requireSubscriptionAccess } from '../middleware/requireSubscriptionAccess.js';

function verifySlackSignature(req: Request): boolean {
  const secret = process.env.SLACK_SIGNING_SECRET?.trim();
  if (!secret) return process.env.NODE_ENV === 'development';
  const timestamp = req.header('x-slack-request-timestamp') ?? '';
  const signature = req.header('x-slack-signature') ?? '';
  if (!timestamp || !signature) return false;
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 60 * 5) return false;
  const raw = (req as Request & { rawBody?: string }).rawBody;
  const body = typeof raw === 'string' ? raw : JSON.stringify(req.body ?? {});
  const base = `v0:${timestamp}:${body}`;
  const digest = `v0=${createHmac('sha256', secret).update(base).digest('hex')}`;
  try {
    return timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
  } catch {
    return false;
  }
}

const eventSchema = z.object({
  type: z.string(),
  challenge: z.string().optional(),
  event: z
    .object({
      type: z.string(),
      user: z.string().optional(),
      text: z.string().optional(),
      channel: z.string().optional(),
      thread_ts: z.string().optional(),
      ts: z.string().optional(),
      bot_id: z.string().optional(),
    })
    .optional(),
  team_id: z.string().optional(),
});

/**
 * Slack Events API + interactive entry.
 * Configure org/agent mapping via env for v1:
 *   SLACK_DEFAULT_ORG_ID, SLACK_DEFAULT_AGENT_ID, SLACK_DEFAULT_USER_ID
 */
export function createSlackRouter(): Router {
  const router = Router();

  /** Store a Slack bot token for the workspace (OAuth code exchange can replace this later). */
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
          botToken: z.string().min(10).max(300),
          defaultAgentId: z.string().min(1).optional(),
          teamName: z.string().max(200).optional(),
        })
        .safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: { code: 'invalid_body', message: 'botToken required' } });
        return;
      }
      const orgId = req.auth!.orgId;
      const userId = req.auth!.userId;
      const tokenEnc = encryptForAgentSecrets(
        JSON.stringify({ accessToken: parsed.data.botToken, tokenType: 'bot' }),
      );
      await prisma.connectorAccount.upsert({
        where: { orgId_provider: { orgId, provider: 'slack' } },
        create: {
          orgId,
          userId,
          provider: 'slack',
          status: 'connected',
          scopes: ['chat:write', 'channels:history'],
          emailAddress: parsed.data.teamName ?? null,
          tokenEnc,
          whatsappDefaultAgentId: parsed.data.defaultAgentId ?? null,
        },
        update: {
          status: 'connected',
          emailAddress: parsed.data.teamName ?? undefined,
          tokenEnc,
          ...(parsed.data.defaultAgentId !== undefined
            ? { whatsappDefaultAgentId: parsed.data.defaultAgentId }
            : {}),
        },
      });
      if (!process.env.SLACK_BOT_TOKEN?.trim()) {
        process.env.SLACK_BOT_TOKEN = parsed.data.botToken;
      }
      res.json({ ok: true, provider: 'slack' });
    },
  );

  router.post('/events', async (req: Request, res: Response) => {
    if (!verifySlackSignature(req) && process.env.SLACK_SIGNING_SECRET) {
      res.status(401).json({ error: 'invalid_signature' });
      return;
    }
    const parsed = eventSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body' });
      return;
    }
    if (parsed.data.type === 'url_verification' && parsed.data.challenge) {
      res.json({ challenge: parsed.data.challenge });
      return;
    }

    const ev = parsed.data.event;
    if (!ev || ev.bot_id || ev.type !== 'message' || !ev.text || !ev.user || !ev.channel) {
      res.json({ ok: true });
      return;
    }

    let orgId = process.env.SLACK_DEFAULT_ORG_ID?.trim();
    let agentId = process.env.SLACK_DEFAULT_AGENT_ID?.trim();
    let userId = process.env.SLACK_DEFAULT_USER_ID?.trim();
    if (!orgId || !agentId || !userId) {
      const slackConn = await prisma.connectorAccount.findFirst({
        where: { provider: 'slack', status: 'connected', whatsappDefaultAgentId: { not: null } },
        select: { orgId: true, userId: true, whatsappDefaultAgentId: true },
      });
      if (slackConn?.whatsappDefaultAgentId) {
        orgId = orgId || slackConn.orgId;
        agentId = agentId || slackConn.whatsappDefaultAgentId;
        userId = userId || slackConn.userId;
      }
    }
    if (!orgId || !agentId || !userId) {
      console.warn('[slack] missing SLACK_DEFAULT_* env mapping and no connector defaults');
      res.json({ ok: true });
      return;
    }

    const agent = await prisma.agent.findFirst({
      where: { id: agentId, orgId },
      select: { id: true, name: true },
    });
    if (!agent) {
      res.json({ ok: true });
      return;
    }

    const [{ getOrCreateGatewayConversation }, { buildSessionKey }] = await Promise.all([
      import('../agentChat/conversationService.js'),
      import('../gateway/sessionKey.js'),
    ]);
    const threadTs = ev.thread_ts ?? ev.ts;
    const convo = await getOrCreateGatewayConversation({
      agentId: agent.id,
      userId,
      orgId,
      sessionKey: buildSessionKey({
        orgId,
        userId,
        channel: 'slack',
        peerId: ev.channel,
        threadId: threadTs,
      }),
      title: `Slack #${ev.channel}`,
    });

    // Ack Slack quickly; process via gateway async.
    res.json({ ok: true });

    void gatewayService
      .handleInbound(
        buildSlackInbound({
          orgId,
          userId,
          slackUserId: ev.user,
          channelId: ev.channel,
          threadTs,
          text: ev.text,
          agentId: agent.id,
          conversationId: convo.id,
          agentName: agent.name,
        }),
      )
      .catch((err) => console.error('[slack] gateway inbound', err));
  });

  /** Internal helper for tests / sidecars */
  router.post('/inbound', assertInternalServiceSecret, async (req: Request, res: Response) => {
    const body = z
      .object({
        orgId: z.string().uuid(),
        userId: z.string().uuid(),
        agentId: z.string().min(1),
        channelId: z.string().min(1),
        slackUserId: z.string().min(1),
        text: z.string().min(1),
        threadTs: z.string().optional(),
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
    const [{ getOrCreateGatewayConversation }, { buildSessionKey }] = await Promise.all([
      import('../agentChat/conversationService.js'),
      import('../gateway/sessionKey.js'),
    ]);
    const convo = await getOrCreateGatewayConversation({
      agentId: agent.id,
      userId: body.data.userId,
      orgId: body.data.orgId,
      sessionKey: buildSessionKey({
        orgId: body.data.orgId,
        userId: body.data.userId,
        channel: 'slack',
        peerId: body.data.channelId,
        threadId: body.data.threadTs ?? null,
      }),
      title: `Slack #${body.data.channelId}`,
    });
    const turn = await gatewayService.handleInbound(
      buildSlackInbound({
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
