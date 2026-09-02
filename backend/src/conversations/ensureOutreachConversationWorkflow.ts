import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import type { ConversationWorkflow } from './workflow.types.js';
import { compileConversationWorkflow } from './workflowCompiler.js';
import {
  OUTREACH_CONVERSATION_WORKFLOW,
  OUTREACH_CONVERSATION_WORKFLOW_KEY,
} from './outreachConversationWorkflow.js';

function checksum(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/**
 * Ensures the system (org-less) `outreach.conversation` workflow is published.
 * Idempotent: skips when the latest published version already matches this snapshot.
 */
export async function ensureOutreachConversationWorkflow(): Promise<{ workflowVersionId: string }> {
  compileConversationWorkflow(OUTREACH_CONVERSATION_WORKFLOW);
  const snapshot: ConversationWorkflow = { ...OUTREACH_CONVERSATION_WORKFLOW };
  const hash = checksum(snapshot);

  const definition = await prisma.conversationWorkflowDefinition.findFirst({
    where: { orgId: null, key: OUTREACH_CONVERSATION_WORKFLOW_KEY },
  });
  if (definition) {
    const latest = await prisma.conversationWorkflowVersion.findFirst({
      where: { definitionId: definition.id, status: 'published' },
      orderBy: { version: 'desc' },
    });
    if (latest?.checksum === hash) return { workflowVersionId: latest.id };
    const version = definition.latestVersion + 1;
    const created = await prisma.conversationWorkflowVersion.create({
      data: {
        definitionId: definition.id,
        version,
        definition: { ...snapshot, version } as unknown as Prisma.InputJsonValue,
        checksum: checksum({ ...snapshot, version }),
      },
    });
    await prisma.conversationWorkflowDefinition.update({
      where: { id: definition.id },
      data: {
        name: 'Outreach conversation',
        description: 'Start a thread, optionally send an opening message, then collect the reply.',
        latestVersion: version,
      },
    });
    return { workflowVersionId: created.id };
  }

  const created = await prisma.conversationWorkflowDefinition.create({
    data: {
      orgId: null,
      key: OUTREACH_CONVERSATION_WORKFLOW_KEY,
      name: 'Outreach conversation',
      description: 'Start a thread, optionally send an opening message, then collect the reply.',
      latestVersion: 1,
    },
  });
  const version = await prisma.conversationWorkflowVersion.create({
    data: {
      definitionId: created.id,
      version: 1,
      definition: { ...snapshot, version: 1 } as unknown as Prisma.InputJsonValue,
      checksum: checksum({ ...snapshot, version: 1 }),
    },
  });
  return { workflowVersionId: version.id };
}
