import { prisma } from '../lib/prisma.js';
import type { DisambiguationOption } from '../whatsapp/whatsappIntentRouter.js';

const PENDING_TTL_MS = 5 * 60 * 1000;

export type TelegramPendingRouteRecord = {
  prompt: string;
  brainFlag: boolean;
  options: DisambiguationOption[];
};

function keyWhere(connectorId: string, chatId: string) {
  return { connectorId_chatId: { connectorId, chatId } };
}

export async function saveTelegramPendingRoute(
  connectorId: string,
  chatId: string,
  input: TelegramPendingRouteRecord,
): Promise<void> {
  const expiresAt = new Date(Date.now() + PENDING_TTL_MS);
  await prisma.telegramPendingRoute.upsert({
    where: keyWhere(connectorId, chatId),
    create: {
      connectorId,
      chatId,
      prompt: input.prompt,
      brainFlag: input.brainFlag,
      optionsJson: input.options,
      expiresAt,
    },
    update: {
      prompt: input.prompt,
      brainFlag: input.brainFlag,
      optionsJson: input.options,
      expiresAt,
    },
  });
}

export async function getTelegramPendingRoute(
  connectorId: string,
  chatId: string,
): Promise<TelegramPendingRouteRecord | null> {
  const row = await prisma.telegramPendingRoute.findUnique({
    where: keyWhere(connectorId, chatId),
  });
  if (!row) return null;
  if (row.expiresAt.getTime() <= Date.now()) {
    await prisma.telegramPendingRoute
      .delete({ where: keyWhere(connectorId, chatId) })
      .catch(() => {});
    return null;
  }
  const options = row.optionsJson as DisambiguationOption[];
  if (!Array.isArray(options) || options.length === 0) return null;
  return {
    prompt: row.prompt,
    brainFlag: row.brainFlag,
    options,
  };
}

export async function clearTelegramPendingRoute(
  connectorId: string,
  chatId: string,
): Promise<void> {
  await prisma.telegramPendingRoute
    .delete({ where: keyWhere(connectorId, chatId) })
    .catch(() => {});
}

export async function resolveTelegramPendingSelection(
  connectorId: string,
  chatId: string,
  index: number,
): Promise<(TelegramPendingRouteRecord & { selected: DisambiguationOption }) | null> {
  const pending = await getTelegramPendingRoute(connectorId, chatId);
  if (!pending) return null;
  const selected = pending.options[index];
  if (!selected) return null;
  await clearTelegramPendingRoute(connectorId, chatId);
  return { ...pending, selected };
}
