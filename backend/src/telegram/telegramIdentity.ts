import { prisma } from '../lib/prisma.js';
import { isTelegramBotConnectorToken } from './telegramConnector.service.js';

export type TelegramQlixIdentity = {
  orgId: string;
  userId: string;
  agentId: string;
};

/**
 * Resolve which Qlix org/user/agent handles a Telegram peer.
 *
 * Priority:
 * 1. Connected telegram ConnectorAccount with bot token + default agent
 * 2. TELEGRAM_DEFAULT_* env (shared bot → one workspace)
 *
 * Later: telegram_user_id → qlix_user_id account linking.
 */
export async function resolveTelegramQlixIdentity(
  _telegramUserId: string,
): Promise<TelegramQlixIdentity | null> {
  const connector = await prisma.connectorAccount.findFirst({
    where: {
      provider: 'telegram',
      status: 'connected',
      whatsappDefaultAgentId: { not: null },
    },
    orderBy: { updatedAt: 'desc' },
    select: {
      orgId: true,
      userId: true,
      tokenEnc: true,
      whatsappDefaultAgentId: true,
      scopes: true,
    },
  });

  if (
    connector?.whatsappDefaultAgentId &&
    (connector.scopes.includes('bot') || isTelegramBotConnectorToken(connector.tokenEnc))
  ) {
    return {
      orgId: connector.orgId,
      userId: connector.userId,
      agentId: connector.whatsappDefaultAgentId,
    };
  }

  const orgId = process.env.TELEGRAM_DEFAULT_ORG_ID?.trim();
  const userId = process.env.TELEGRAM_DEFAULT_USER_ID?.trim();
  const agentId = process.env.TELEGRAM_DEFAULT_AGENT_ID?.trim();
  if (!orgId || !userId || !agentId) return null;
  return { orgId, userId, agentId };
}
