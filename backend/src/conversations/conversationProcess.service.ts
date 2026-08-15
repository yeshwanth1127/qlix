import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import type { ConversationOwnerType } from './conversation.types.js';

export async function createConversationProcess(input: {
  orgId: string;
  ownerType: ConversationOwnerType;
  ownerId?: string | null;
  externalRefType?: string | null;
  externalRefId?: string | null;
  completionMode?: 'all_terminal' | 'all_terminal_or_timeout' | 'first_success' | 'manual' | 'continuous';
  metadata?: Record<string, unknown>;
}): Promise<{ id: string; status: string }> {
  const created = await prisma.conversationProcess.create({
    data: {
      orgId: input.orgId,
      ownerType: input.ownerType,
      ownerId: input.ownerId ?? null,
      externalRefType: input.externalRefType ?? null,
      externalRefId: input.externalRefId ?? null,
      completionMode: input.completionMode ?? 'all_terminal',
      counters: { total: 0, active: 0 },
      metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
    },
  });
  return { id: created.id, status: created.status };
}

export async function getConversationProcess(processId: string): Promise<{
  id: string;
  status: string;
  completionMode: string;
  counters: Record<string, number>;
  metadata: Record<string, unknown>;
}> {
  const process = await prisma.conversationProcess.findUnique({ where: { id: processId } });
  if (!process) throw new Error(`Conversation process ${processId} was not found`);
  return {
    id: process.id,
    status: process.status,
    completionMode: process.completionMode,
    counters: process.counters as Record<string, number>,
    metadata: process.metadata as Record<string, unknown>,
  };
}

