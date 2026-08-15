import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import type { ConversationWorkflow } from './workflow.types.js';
import { compileConversationWorkflow } from './workflowCompiler.js';

function checksum(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export async function publishConversationWorkflow(input: {
  orgId?: string | null;
  name: string;
  description?: string | null;
  workflow: ConversationWorkflow;
}): Promise<{ definitionId: string; workflowVersionId: string; version: number }> {
  compileConversationWorkflow(input.workflow);
  return prisma.$transaction(async (tx) => {
    let definition = await tx.conversationWorkflowDefinition.findFirst({
      where: { orgId: input.orgId ?? null, key: input.workflow.key },
    });
    if (!definition) {
      definition = await tx.conversationWorkflowDefinition.create({
        data: {
          orgId: input.orgId ?? null,
          key: input.workflow.key,
          name: input.name,
          description: input.description ?? null,
        },
      });
    }
    const version = definition.latestVersion + 1;
    const snapshot: ConversationWorkflow = { ...input.workflow, version };
    const created = await tx.conversationWorkflowVersion.create({
      data: {
        definitionId: definition.id,
        version,
        definition: snapshot as unknown as Prisma.InputJsonValue,
        checksum: checksum(snapshot),
      },
    });
    await tx.conversationWorkflowDefinition.update({
      where: { id: definition.id },
      data: {
        name: input.name,
        description: input.description ?? null,
        latestVersion: version,
      },
    });
    return { definitionId: definition.id, workflowVersionId: created.id, version };
  });
}

export interface ConversationWorkflowOption {
  definitionId: string;
  workflowVersionId: string;
  key: string;
  name: string;
  description: string | null;
  version: number;
}

/** Published workflow versions visible to an organization. */
export async function listPublishedConversationWorkflows(
  orgId: string,
): Promise<ConversationWorkflowOption[]> {
  const definitions = await prisma.conversationWorkflowDefinition.findMany({
    where: { OR: [{ orgId }, { orgId: null }] },
    orderBy: [{ name: 'asc' }, { key: 'asc' }],
  });
  const versions = await prisma.conversationWorkflowVersion.findMany({
    where: {
      definitionId: { in: definitions.map((definition) => definition.id) },
      status: 'published',
    },
    orderBy: { version: 'desc' },
    select: { id: true, definitionId: true, version: true },
  });
  const versionsByDefinition = new Map<string, typeof versions>();
  for (const version of versions) {
    const grouped = versionsByDefinition.get(version.definitionId) ?? [];
    grouped.push(version);
    versionsByDefinition.set(version.definitionId, grouped);
  }

  return definitions.flatMap((definition) =>
    (versionsByDefinition.get(definition.id) ?? []).map((version) => ({
          definitionId: definition.id,
          workflowVersionId: version.id,
          key: definition.key,
          name: definition.name,
          description: definition.description,
          version: version.version,
        })),
  );
}

export async function loadPublishedWorkflow(input: {
  workflowVersionId?: string;
  orgId?: string | null;
  workflowKey?: string;
}): Promise<{ id: string; workflow: ConversationWorkflow }> {
  let row = input.workflowVersionId
    ? await prisma.conversationWorkflowVersion.findUnique({ where: { id: input.workflowVersionId } })
    : null;
  if (!row) {
    const definition =
      (input.orgId
        ? await prisma.conversationWorkflowDefinition.findFirst({
            where: { orgId: input.orgId, key: input.workflowKey },
          })
        : null) ??
      await prisma.conversationWorkflowDefinition.findFirst({
        where: { orgId: null, key: input.workflowKey },
      });
    if (definition) {
      row = await prisma.conversationWorkflowVersion.findFirst({
        where: { definitionId: definition.id, status: 'published' },
        orderBy: { version: 'desc' },
      });
    }
  }
  if (!row) throw new Error('Published conversation workflow was not found');
  const owner = await prisma.conversationWorkflowDefinition.findUnique({
    where: { id: row.definitionId },
    select: { orgId: true },
  });
  if (!owner || (owner.orgId !== null && owner.orgId !== (input.orgId ?? null))) {
    throw new Error('Published conversation workflow was not found');
  }
  const workflow = row.definition as unknown as ConversationWorkflow;
  compileConversationWorkflow(workflow);
  return { id: row.id, workflow };
}
