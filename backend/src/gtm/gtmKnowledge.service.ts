import { prisma } from '../lib/prisma.js';
import { roleCan } from '../lib/orgPermissions.js';
import { appendBrainActionLog } from '../aiBrain/brainAudit.service.js';
import type { BrainDocumentRetrievalFilter } from '../aiBrain/brainQuery.service.js';

export const GTM_KNOWLEDGE_COLLECTIONS = [
  {
    purpose: 'company_positioning',
    name: 'GTM · Company and Positioning',
    description: 'Reviewed company facts, positioning, capabilities, boundaries, and differentiators.',
  },
  {
    purpose: 'offers_qualification',
    name: 'GTM · Offers and Qualification',
    description: 'Reviewed offers, pricing motion, entry criteria, disqualifiers, and commercial boundaries.',
  },
  {
    purpose: 'proof_case_studies',
    name: 'GTM · Proof and Case Studies',
    description: 'Approved proof points, outcomes, case studies, and evidence that may support discovery.',
  },
  {
    purpose: 'discovery_playbooks',
    name: 'GTM · Discovery Playbooks',
    description: 'Discovery questions, qualification rubrics, objection patterns, and operator playbooks.',
  },
  {
    purpose: 'reviewed_market_learning',
    name: 'GTM · Reviewed Market Learning',
    description: 'Human-reviewed market observations and learning promoted from campaign evidence.',
  },
  {
    purpose: 'customer_outcomes',
    name: 'GTM · Customer Outcomes',
    description: 'Verified customer outcomes and implementation patterns available to GTM discovery.',
  },
] as const;

export type GtmKnowledgePurpose = typeof GTM_KNOWLEDGE_COLLECTIONS[number]['purpose'];

/** Collections Exa may use during GTM setup (not campaign learning or outcomes). */
export const GTM_SETUP_KNOWLEDGE_PURPOSES: readonly GtmKnowledgePurpose[] = [
  'company_positioning',
  'offers_qualification',
  'proof_case_studies',
  'discovery_playbooks',
] as const;

export class GtmKnowledgeForbiddenError extends Error {
  readonly code = 'forbidden_gtm_knowledge';
}

export async function listGtmKnowledgeBindings(orgId: string) {
  return prisma.gtmKnowledgeBinding.findMany({
    where: { orgId },
    orderBy: { purpose: 'asc' },
    include: {
      collection: {
        include: {
          _count: { select: { documents: true } },
          documents: { select: { reviewStatus: true, freshnessExpiresAt: true } },
        },
      },
    },
  }).then((rows) => rows.map((row) => {
    const now = Date.now();
    let reviewedCount = 0;
    let pendingReviewCount = 0;
    let staleCount = 0;
    for (const doc of row.collection.documents) {
      if (doc.reviewStatus === 'reviewed') {
        reviewedCount += 1;
        if (doc.freshnessExpiresAt && doc.freshnessExpiresAt.getTime() <= now) staleCount += 1;
      } else if (doc.reviewStatus === 'pending') {
        pendingReviewCount += 1;
      }
    }
    return {
      purpose: row.purpose as GtmKnowledgePurpose,
      collectionId: row.collectionId,
      name: row.collection.name,
      description: row.collection.description,
      documentCount: row.collection._count.documents,
      reviewedDocumentCount: reviewedCount,
      pendingReviewCount,
      staleDocumentCount: staleCount,
    };
  }));
}

export async function resolveGtmCollectionIds(
  orgId: string,
  purposes: readonly GtmKnowledgePurpose[],
): Promise<string[]> {
  const bindings = await prisma.gtmKnowledgeBinding.findMany({
    where: { orgId, purpose: { in: [...purposes] } },
    select: { collectionId: true },
  });
  return bindings.map((binding) => binding.collectionId);
}

export async function buildGtmSetupRetrievalFilter(orgId: string): Promise<BrainDocumentRetrievalFilter> {
  const collectionIds = await resolveGtmCollectionIds(orgId, GTM_SETUP_KNOWLEDGE_PURPOSES);
  return {
    collectionIds,
    reviewStatuses: ['reviewed'],
    requireFresh: true,
  };
}

export const GTM_SETUP_EXA_PROMPT_APPEND = [
  'You are helping configure GTM Revenue OS setup for this organization.',
  'Ground answers ONLY in retrieved reviewed GTM Brain collections (company, offers, proof, playbooks).',
  'Never treat unreviewed or stale knowledge as confirmed commercial truth.',
  'When the operator agrees on setup fields, call propose_gtm_setup with a structured patch and rationale.',
  'When the organization starts with only an idea, ask one useful question at a time and accept unknown as a valid answer.',
  'Use propose_gtm_idea for the starting idea and propose_gtm_hypothesis for one explicit problem, segment, buyer, trigger, value, offer, channel, or price assumption.',
  'Never describe an idea or hypothesis as verified merely because the operator stated it.',
  'Do not tell the operator setup was saved until they confirm the proposal card in the GTM workspace.',
  'Distinguish draft suggestions from fields the operator has already confirmed.',
].join('\n');

export async function bootstrapGtmKnowledge(input: {
  orgId: string;
  userId: string;
  role: string;
  brainAgentId: string;
}) {
  if (!roleCan(input.role, 'manage_brain')) {
    throw new GtmKnowledgeForbiddenError('Only organization owners and admins can initialize GTM knowledge.');
  }

  const existing = await prisma.gtmKnowledgeBinding.findMany({ where: { orgId: input.orgId } });
  const existingPurposes = new Set(existing.map((binding) => binding.purpose));
  const missing = GTM_KNOWLEDGE_COLLECTIONS.filter((definition) => !existingPurposes.has(definition.purpose));

  if (missing.length > 0) {
    await prisma.$transaction(async (transaction) => {
      for (const definition of missing) {
        const collection = await transaction.brainKnowledgeCollection.create({
          data: {
            orgId: input.orgId,
            name: definition.name,
            description: definition.description,
          },
        });
        await transaction.gtmKnowledgeBinding.create({
          data: { orgId: input.orgId, collectionId: collection.id, purpose: definition.purpose },
        });
      }
    });

    await appendBrainActionLog({
      brainAgentId: input.brainAgentId,
      userId: input.userId,
      actionType: 'brain.gtm_collections_bootstrap',
      payload: {
        description: `Initialized ${missing.length} GTM knowledge collections`,
        purposes: missing.map((definition) => definition.purpose),
      },
      status: 'success',
      riskLevel: 'low',
    });
  }

  return listGtmKnowledgeBindings(input.orgId);
}
