import { prisma } from '../lib/prisma.js';

export async function addInjection(agentRunId: string, message: string): Promise<void> {
  await prisma.runInjection.create({
    data: { agentRunId, message },
  });
}

export async function drainInjections(agentRunId: string): Promise<string[]> {
  const rows = await prisma.runInjection.findMany({
    where: { agentRunId, consumedAt: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true, message: true },
  });
  if (rows.length === 0) return [];

  const now = new Date();
  await prisma.runInjection.updateMany({
    where: { id: { in: rows.map((r: { id: string }) => r.id) } },
    data: { consumedAt: now },
  });
  return rows.map((r: { message: string }) => r.message);
}
