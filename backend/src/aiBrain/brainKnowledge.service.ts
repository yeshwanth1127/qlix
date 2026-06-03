import { prisma } from '../lib/prisma.js';
import { roleCan } from '../lib/orgPermissions.js';
import { AgentsRepository } from '../agents/agents.repository.js';
import { appendBrainActionLog } from './brainAudit.service.js';
import { BrainQueryService } from './brainQuery.service.js';

const queryService = new BrainQueryService();

const CHUNK_SIZE = 2000;

function chunkText(body: string): string[] {
  const t = body.trim();
  if (!t) return [];
  const parts: string[] = [];
  for (let i = 0; i < t.length; i += CHUNK_SIZE) {
    parts.push(t.slice(i, i + CHUNK_SIZE));
  }
  return parts;
}

export class BrainKnowledgeForbiddenError extends Error {
  readonly code = 'forbidden_knowledge';
}

export class BrainKnowledgeService {
  private readonly agentsRepo = new AgentsRepository();

  async listCollections(
    userId: string,
    orgId: string,
  ): Promise<
    Array<{
      id: string;
      name: string;
      description: string;
      retentionDays: number | null;
      documentCount: number;
    }>
  > {
    await this.agentsRepo.assertOrgMembership(userId, orgId);
    const rows = await prisma.brainKnowledgeCollection.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { documents: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      retentionDays: r.retentionDays,
      documentCount: r._count.documents,
    }));
  }

  async createCollection(input: {
    userId: string;
    orgId: string;
    role: string;
    brainAgentId: string;
    name: string;
    description?: string;
    retentionDays?: number | null;
  }): Promise<{ id: string }> {
    await this.agentsRepo.assertOrgMembership(input.userId, input.orgId);
    if (!roleCan(input.role, 'manage_brain')) {
      throw new BrainKnowledgeForbiddenError('Only owners and admins can create knowledge collections.');
    }

    const created = await prisma.brainKnowledgeCollection.create({
      data: {
        orgId: input.orgId,
        name: input.name.trim(),
        description: (input.description ?? '').trim(),
        retentionDays: input.retentionDays ?? null,
      },
    });

    await appendBrainActionLog({
      brainAgentId: input.brainAgentId,
      userId: input.userId,
      actionType: 'brain.collection_create',
      payload: {
        description: `Created knowledge collection "${input.name.trim()}"`,
        collectionId: created.id,
      },
      status: 'success',
      riskLevel: 'low',
    });

    return { id: created.id };
  }

  async listKnowledgeDocuments(
    userId: string,
    orgId: string,
  ): Promise<
    Array<{
      id: string;
      collectionId: string;
      collectionName: string;
      title: string;
      ingestStatus: string;
      sourceUri: string | null;
      createdAt: string;
      chunkCount: number;
    }>
  > {
    await this.agentsRepo.assertOrgMembership(userId, orgId);
    const rows = await prisma.brainKnowledgeDocument.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
      take: 500,
      include: {
        collection: { select: { id: true, name: true } },
        _count: { select: { chunks: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      collectionId: r.collectionId,
      collectionName: r.collection.name,
      title: r.title,
      ingestStatus: r.ingestStatus,
      sourceUri: r.sourceUri,
      createdAt: r.createdAt.toISOString(),
      chunkCount: r._count.chunks,
    }));
  }

  async ingestDocument(input: {
    userId: string;
    orgId: string;
    role: string;
    brainAgentId: string;
    collectionId: string;
    title: string;
    bodyText: string;
    sourceUri?: string | null;
  }): Promise<{ id: string; chunkCount: number }> {
    await this.agentsRepo.assertOrgMembership(input.userId, input.orgId);
    if (!roleCan(input.role, 'manage_brain')) {
      throw new BrainKnowledgeForbiddenError('Only owners and admins can ingest documents.');
    }

    const coll = await prisma.brainKnowledgeCollection.findFirst({
      where: { id: input.collectionId, orgId: input.orgId },
    });
    if (!coll) {
      throw new Error('Collection not found');
    }

    const chunks = chunkText(input.bodyText);
    if (chunks.length === 0) {
      throw new Error('bodyText is empty');
    }

    const doc = await prisma.brainKnowledgeDocument.create({
      data: {
        orgId: input.orgId,
        collectionId: input.collectionId,
        title: input.title.trim(),
        bodyText: input.bodyText,
        sourceUri: input.sourceUri?.trim() || null,
        ingestStatus: 'ready',
        chunks: {
          create: chunks.map((textContent, ordinal) => ({
            orgId: input.orgId,
            ordinal,
            textContent,
          })),
        },
      },
    });

    await appendBrainActionLog({
      brainAgentId: input.brainAgentId,
      userId: input.userId,
      actionType: 'brain.knowledge_ingest',
      payload: {
        description: `Ingested document "${input.title.trim()}" (${chunks.length} chunks)`,
        collectionId: input.collectionId,
        documentId: doc.id,
      },
      status: 'success',
      riskLevel: 'low',
    });

    // Fire-and-forget: embed chunks in background (doesn't block response)
    void queryService.embedAndStoreChunks(input.orgId, doc.id).catch((err) => {
      console.error('[brainKnowledge] Async embedding failed for doc', doc.id, err instanceof Error ? err.message : err);
    });

    return { id: doc.id, chunkCount: chunks.length };
  }

  async deleteKnowledgeDocument(input: {
    userId: string;
    orgId: string;
    role: string;
    brainAgentId: string;
    documentId: string;
  }): Promise<void> {
    await this.agentsRepo.assertOrgMembership(input.userId, input.orgId);
    if (!roleCan(input.role, 'manage_brain')) {
      throw new BrainKnowledgeForbiddenError('Only owners and admins can delete knowledge documents.');
    }

    const doc = await prisma.brainKnowledgeDocument.findFirst({
      where: { id: input.documentId, orgId: input.orgId },
      select: { id: true, title: true, collectionId: true },
    });
    if (!doc) {
      throw new Error('Document not found');
    }

    await prisma.brainKnowledgeDocument.delete({
      where: { id: doc.id },
    });

    await appendBrainActionLog({
      brainAgentId: input.brainAgentId,
      userId: input.userId,
      actionType: 'brain.knowledge_delete',
      payload: {
        description: `Deleted knowledge document "${doc.title}"`,
        collectionId: doc.collectionId,
        documentId: doc.id,
      },
      status: 'success',
      riskLevel: 'low',
    });
  }
}
