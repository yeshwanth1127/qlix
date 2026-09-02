import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import type { ConversationWorkflow } from './workflow.types.js';
import { compileConversationWorkflow } from './workflowCompiler.js';
import {
  WHATSAPP_LEAD_OUTREACH_SEQUENTIAL_KEY,
  WHATSAPP_LEAD_OUTREACH_SEQUENTIAL_WORKFLOW,
} from './whatsappLeadOutreachSequentialWorkflow.js';

function checksum(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/**
 * Ensures the system (org-less) sequential lead-outreach workflow is published.
 * Idempotent when the latest published checksum matches this snapshot.
 */
export async function ensureWhatsAppLeadOutreachSequentialWorkflow(): Promise<{
  workflowVersionId: string;
}> {
  compileConversationWorkflow(WHATSAPP_LEAD_OUTREACH_SEQUENTIAL_WORKFLOW);
  const snapshot: ConversationWorkflow = { ...WHATSAPP_LEAD_OUTREACH_SEQUENTIAL_WORKFLOW };
  const hash = checksum(snapshot);

  const definition = await prisma.conversationWorkflowDefinition.findFirst({
    where: { orgId: null, key: WHATSAPP_LEAD_OUTREACH_SEQUENTIAL_KEY },
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
        name: 'WhatsApp lead outreach (sequential polls)',
        description:
          'Greeting, optional Brain brochure, then four WhatsApp polls with a wait after each answer.',
        latestVersion: version,
      },
    });
    return { workflowVersionId: created.id };
  }

  const created = await prisma.conversationWorkflowDefinition.create({
    data: {
      orgId: null,
      key: WHATSAPP_LEAD_OUTREACH_SEQUENTIAL_KEY,
      name: 'WhatsApp lead outreach (sequential polls)',
      description:
        'Greeting, optional Brain brochure, then four WhatsApp polls with a wait after each answer.',
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
