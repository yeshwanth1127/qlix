import { decryptForAgentSecrets, encryptForAgentSecrets } from '../cloudRunners/agentSecrets.js';
import { prisma } from '../lib/prisma.js';

export type TelegramBotTokenPayload = {
  accessToken: string;
  tokenType: 'bot';
};

export function isTelegramBotConnectorToken(tokenEnc: string): boolean {
  return Boolean(tokenEnc?.trim()) && tokenEnc !== 'channel-defaults';
}

/** Validate a bot token with Telegram getMe. Never logs the token. */
export async function verifyTelegramBotToken(botToken: string): Promise<{
  id: number;
  username: string | null;
  firstName: string | null;
}> {
  const res = await fetch(`https://api.telegram.org/bot${botToken.trim()}/getMe`);
  const body = (await res.json().catch(() => null)) as {
    ok?: boolean;
    description?: string;
    result?: { id?: number; username?: string; first_name?: string };
  } | null;
  if (!res.ok || !body?.ok || !body.result?.id) {
    throw new Error(body?.description || 'Invalid Telegram bot token');
  }
  return {
    id: body.result.id,
    username: body.result.username ?? null,
    firstName: body.result.first_name ?? null,
  };
}

export async function upsertTelegramBotConnector(params: {
  orgId: string;
  userId: string;
  botToken: string;
  defaultAgentId?: string | null;
  botUsername?: string | null;
}): Promise<void> {
  const tokenEnc = encryptForAgentSecrets(
    JSON.stringify({
      accessToken: params.botToken.trim(),
      tokenType: 'bot',
    } satisfies TelegramBotTokenPayload),
  );
  const display = params.botUsername?.trim()
    ? params.botUsername.startsWith('@')
      ? params.botUsername.trim()
      : `@${params.botUsername.trim()}`
    : 'Telegram bot';

  await prisma.connectorAccount.upsert({
    where: { orgId_provider: { orgId: params.orgId, provider: 'telegram' } },
    create: {
      orgId: params.orgId,
      userId: params.userId,
      provider: 'telegram',
      status: 'connected',
      scopes: ['bot'],
      emailAddress: display,
      tokenEnc,
      whatsappDefaultAgentId: params.defaultAgentId ?? null,
    },
    update: {
      status: 'connected',
      scopes: ['bot'],
      emailAddress: display,
      tokenEnc,
      userId: params.userId,
      ...(params.defaultAgentId !== undefined
        ? { whatsappDefaultAgentId: params.defaultAgentId }
        : {}),
    },
  });

  // Keep process env in sync for single-bot webhook deployments when unset.
  if (!process.env.TELEGRAM_BOT_TOKEN?.trim()) {
    process.env.TELEGRAM_BOT_TOKEN = params.botToken.trim();
  }
}

export async function deleteTelegramBotConnector(orgId: string): Promise<void> {
  await prisma.connectorAccount.deleteMany({ where: { orgId, provider: 'telegram' } });
}

export async function getTelegramBotTokenForOrg(orgId: string): Promise<string | null> {
  const row = await prisma.connectorAccount.findUnique({
    where: { orgId_provider: { orgId, provider: 'telegram' } },
    select: { tokenEnc: true, status: true },
  });
  if (!row || row.status !== 'connected' || !isTelegramBotConnectorToken(row.tokenEnc)) {
    return null;
  }
  try {
    const parsed = JSON.parse(decryptForAgentSecrets(row.tokenEnc)) as Partial<TelegramBotTokenPayload>;
    const token = parsed.accessToken?.trim();
    return token || null;
  } catch {
    return null;
  }
}

/**
 * Resolve bot token for outbound delivery.
 * Prefer org connector token; fall back to TELEGRAM_BOT_TOKEN.
 */
export async function resolveTelegramBotToken(orgId?: string | null): Promise<string | null> {
  if (orgId) {
    const fromOrg = await getTelegramBotTokenForOrg(orgId);
    if (fromOrg) return fromOrg;
  }
  return process.env.TELEGRAM_BOT_TOKEN?.trim() || null;
}
