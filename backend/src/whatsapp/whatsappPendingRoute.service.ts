import { prisma } from '../lib/prisma.js';
import type { DisambiguationOption } from './whatsappIntentRouter.js';

const PENDING_TTL_MS = 5 * 60 * 1000;

export type PendingRouteRecord = {
  prompt: string;
  brainFlag: boolean;
  options: DisambiguationOption[];
};

export async function savePendingRoute(
  connectorId: string,
  input: PendingRouteRecord,
): Promise<void> {
  const expiresAt = new Date(Date.now() + PENDING_TTL_MS);
  await prisma.whatsAppPendingRoute.upsert({
    where: { connectorId },
    create: {
      connectorId,
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

export async function getPendingRoute(connectorId: string): Promise<PendingRouteRecord | null> {
  const row = await prisma.whatsAppPendingRoute.findUnique({
    where: { connectorId },
  });
  if (!row) return null;
  if (row.expiresAt.getTime() <= Date.now()) {
    await prisma.whatsAppPendingRoute.delete({ where: { connectorId } }).catch(() => {});
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

export async function clearPendingRoute(connectorId: string): Promise<void> {
  await prisma.whatsAppPendingRoute.delete({ where: { connectorId } }).catch(() => {});
}

export async function resolvePendingSelection(
  connectorId: string,
  index: number,
): Promise<(PendingRouteRecord & { selected: DisambiguationOption }) | null> {
  const pending = await getPendingRoute(connectorId);
  if (!pending) return null;
  const selected = pending.options[index];
  if (!selected) return null;
  await clearPendingRoute(connectorId);
  return { ...pending, selected };
}
