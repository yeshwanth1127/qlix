import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { appendBrainActionLog } from '../aiBrain/brainAudit.service.js';
import { prisma } from '../lib/prisma.js';
import { roleCan } from '../lib/orgPermissions.js';

export const HYPOTHESIS_KINDS = [
  'problem', 'segment', 'trigger', 'user', 'champion', 'buyer', 'value', 'offer', 'channel', 'price',
] as const;
export const EVIDENCE_CLASSES = [
  'founder_provided', 'externally_verified', 'inferred', 'prospect_reported', 'experiment_observed', 'unknown',
] as const;
export const HYPOTHESIS_RELATIONSHIPS = ['supports', 'contradicts', 'qualifies', 'unknown'] as const;
export const HYPOTHESIS_REVIEW_STATUSES = ['active', 'supported', 'contradicted', 'validated', 'rejected'] as const;
export const HYPOTHESIS_EVIDENCE_TYPES = ['founder_statement', 'prospect_statement', 'external_claim', 'experiment_observation'] as const;

export const hypothesisEvidenceSchema = z.object({
  evidenceType: z.enum(HYPOTHESIS_EVIDENCE_TYPES),
  evidenceId: z.string().trim().max(240).optional(),
  relationship: z.enum(HYPOTHESIS_RELATIONSHIPS),
  note: z.string().trim().min(1).max(4000),
});

export const hypothesisReviewSchema = z.object({ status: z.enum(HYPOTHESIS_REVIEW_STATUSES) });

export const ideaPayloadSchema = z.object({
  idea: z.string().trim().min(1).max(2000),
  problem: z.string().trim().max(4000).default(''),
  solution: z.string().trim().max(4000).default(''),
  audience: z.string().trim().max(4000).default(''),
  outcome: z.string().trim().max(4000).default(''),
  constraints: z.string().trim().max(4000).default(''),
});

export type GtmIdeaPayload = z.infer<typeof ideaPayloadSchema>;

const hypothesisPayloadSchema = z.object({
  hypothesisId: z.string().cuid().optional(),
  kind: z.enum(HYPOTHESIS_KINDS),
  statement: z.string().trim().min(1).max(4000),
  evidenceClass: z.enum(EVIDENCE_CLASSES),
  details: z.record(z.string(), z.unknown()).default({}),
});

export const discoveryProposalSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('idea'), rationale: z.string().trim().min(1).max(2000), payload: ideaPayloadSchema }),
  z.object({ kind: z.literal('hypothesis'), rationale: z.string().trim().min(1).max(2000), payload: hypothesisPayloadSchema }),
]);

export type DiscoveryProposalInput = z.infer<typeof discoveryProposalSchema>;

export class GtmDiscoveryError extends Error {
  constructor(message: string, readonly code: 'forbidden' | 'invalid' | 'not_found' | 'not_pending') {
    super(message);
    this.name = 'GtmDiscoveryError';
  }
}

export function discoveryResolutionState(
  status: string,
  decision: 'confirm' | 'reject',
): 'apply' | 'replay' | 'conflict' {
  if (status === 'pending') return 'apply';
  if ((status === 'confirmed' && decision === 'confirm') || (status === 'rejected' && decision === 'reject')) return 'replay';
  return 'conflict';
}

function requireManager(role: string): void {
  if (!roleCan(role, 'manage_brain')) {
    throw new GtmDiscoveryError('Only organization owners and admins can change discovery foundations.', 'forbidden');
  }
}

function proposalDto(row: {
  id: string; kind: string; status: string; payload: Prisma.JsonValue; rationale: string;
  source: string; createdAt: Date; resolvedAt: Date | null;
}) {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    payload: row.payload,
    rationale: row.rationale,
    source: row.source,
    createdAt: row.createdAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
  };
}

function ideaDto(row: { id: string; version: number; status: string; content: Prisma.JsonValue; source: string; createdAt: Date } | null) {
  return row ? { ...row, createdAt: row.createdAt.toISOString() } : null;
}

function hypothesisDto(row: {
  id: string; kind: string; status: string; createdAt: Date; updatedAt: Date;
  versions: Array<{ id: string; version: number; statement: string; details: Prisma.JsonValue; evidenceClass: string; createdAt: Date; _count?: { evidence: number } }>;
}) {
  const current = row.versions[0];
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    current: current ? { ...current, evidenceCount: current._count?.evidence ?? 0, createdAt: current.createdAt.toISOString() } : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getDiscoveryFoundation(orgId: string) {
  const [idea, hypotheses, proposals] = await Promise.all([
    prisma.gtmIdea.findFirst({ where: { orgId, status: 'active' }, orderBy: { version: 'desc' } }),
    prisma.gtmHypothesis.findMany({
      where: { orgId, status: { not: 'superseded' } },
      include: { versions: { orderBy: { version: 'desc' }, take: 1, include: { _count: { select: { evidence: true } } } } },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.gtmDiscoveryProposal.findMany({ where: { orgId, status: 'pending' }, orderBy: { createdAt: 'desc' }, take: 20 }),
  ]);
  return {
    idea: ideaDto(idea),
    hypotheses: hypotheses.map(hypothesisDto),
    proposals: proposals.map(proposalDto),
  };
}

export async function listHypothesisEvidence(orgId: string, hypothesisId: string) {
  const hypothesis = await prisma.gtmHypothesis.findFirst({ where: { id: hypothesisId, orgId }, select: { id: true } });
  if (!hypothesis) throw new GtmDiscoveryError('Hypothesis not found.', 'not_found');
  return prisma.gtmHypothesisEvidence.findMany({
    where: { orgId, hypothesisVersion: { hypothesisId } },
    orderBy: { createdAt: 'desc' },
  }).then((rows) => rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })));
}

export async function addHypothesisEvidence(input: {
  orgId: string; userId: string; role: string; brainAgentId: string; hypothesisId: string; body: unknown;
}) {
  requireManager(input.role);
  const parsed = hypothesisEvidenceSchema.safeParse(input.body);
  if (!parsed.success) throw new GtmDiscoveryError('Add a short learning note and choose how it affects the assumption.', 'invalid');
  const hypothesis = await prisma.gtmHypothesis.findFirst({
    where: { id: input.hypothesisId, orgId: input.orgId },
    include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
  });
  const version = hypothesis?.versions[0];
  if (!hypothesis || !version) throw new GtmDiscoveryError('Hypothesis not found.', 'not_found');
  const evidence = await prisma.gtmHypothesisEvidence.create({
    data: {
      orgId: input.orgId, hypothesisVersionId: version.id,
      evidenceType: parsed.data.evidenceType, evidenceId: parsed.data.evidenceId,
      relationship: parsed.data.relationship, note: parsed.data.note, createdBy: input.userId,
    },
  });
  await appendBrainActionLog({
    brainAgentId: input.brainAgentId, userId: input.userId,
    actionType: 'gtm.hypothesis_evidence_add',
    payload: { description: 'Added reviewed hypothesis learning', hypothesisId: hypothesis.id, hypothesisVersionId: version.id, evidenceId: evidence.id, relationship: evidence.relationship },
    status: 'success', riskLevel: 'low',
  });
  return { ...evidence, createdAt: evidence.createdAt.toISOString() };
}

export async function reviewHypothesis(input: {
  orgId: string; userId: string; role: string; brainAgentId: string; hypothesisId: string; body: unknown;
}) {
  requireManager(input.role);
  const parsed = hypothesisReviewSchema.safeParse(input.body);
  if (!parsed.success) throw new GtmDiscoveryError('Choose a valid hypothesis conclusion.', 'invalid');
  const updated = await prisma.gtmHypothesis.updateMany({
    where: { id: input.hypothesisId, orgId: input.orgId }, data: { status: parsed.data.status },
  });
  if (updated.count === 0) throw new GtmDiscoveryError('Hypothesis not found.', 'not_found');
  await appendBrainActionLog({
    brainAgentId: input.brainAgentId, userId: input.userId,
    actionType: 'gtm.hypothesis_review',
    payload: { description: `Reviewed hypothesis as ${parsed.data.status}`, hypothesisId: input.hypothesisId, status: parsed.data.status },
    status: 'success', riskLevel: 'low',
  });
}

export async function createDiscoveryProposal(input: {
  orgId: string; userId: string; role: string; brainAgentId: string; body: unknown; source?: 'exa' | 'operator';
}) {
  requireManager(input.role);
  const parsed = discoveryProposalSchema.safeParse(input.body);
  if (!parsed.success) throw new GtmDiscoveryError('Check the required fields and try again.', 'invalid');
  if (parsed.data.kind === 'hypothesis' && parsed.data.payload.hypothesisId) {
    const exists = await prisma.gtmHypothesis.count({ where: { id: parsed.data.payload.hypothesisId, orgId: input.orgId } });
    if (!exists) throw new GtmDiscoveryError('Hypothesis not found.', 'not_found');
  }
  const row = await prisma.gtmDiscoveryProposal.create({
    data: {
      orgId: input.orgId,
      kind: parsed.data.kind,
      payload: parsed.data.payload as Prisma.InputJsonValue,
      rationale: parsed.data.rationale,
      source: input.source ?? 'operator',
      createdBy: input.userId,
    },
  });
  await appendBrainActionLog({
    brainAgentId: input.brainAgentId, userId: input.userId,
    actionType: 'gtm.discovery_proposal_create',
    payload: { description: `Created ${parsed.data.kind} discovery proposal`, proposalId: row.id, kind: row.kind },
    status: 'success', riskLevel: 'low',
  });
  return proposalDto(row);
}

export async function resolveDiscoveryProposal(input: {
  orgId: string; userId: string; role: string; brainAgentId: string; proposalId: string; decision: 'confirm' | 'reject';
}) {
  requireManager(input.role);
  const proposal = await prisma.gtmDiscoveryProposal.findFirst({ where: { id: input.proposalId, orgId: input.orgId } });
  if (!proposal) throw new GtmDiscoveryError('Proposal not found.', 'not_found');
  const resolutionState = discoveryResolutionState(proposal.status, input.decision);
  if (resolutionState === 'replay') {
    return {
      proposal: proposalDto(proposal),
      foundation: await getDiscoveryFoundation(input.orgId),
      ideaConfirmed: false,
    };
  }
  if (resolutionState === 'conflict') throw new GtmDiscoveryError('Proposal was already resolved differently.', 'not_pending');

  if (input.decision === 'reject') {
    const rejected = await prisma.gtmDiscoveryProposal.update({
      where: { id: proposal.id },
      data: { status: 'rejected', resolvedBy: input.userId, resolvedAt: new Date() },
    });
    await appendBrainActionLog({
      brainAgentId: input.brainAgentId, userId: input.userId,
      actionType: 'gtm.discovery_proposal_reject',
      payload: { description: `Rejected ${proposal.kind} discovery proposal`, proposalId: proposal.id },
      status: 'success', riskLevel: 'low',
    });
    return {
      proposal: proposalDto(rejected),
      foundation: await getDiscoveryFoundation(input.orgId),
      ideaConfirmed: false,
    };
  }

  const parsed = discoveryProposalSchema.safeParse({
    kind: proposal.kind, rationale: proposal.rationale, payload: proposal.payload,
  });
  if (!parsed.success) throw new GtmDiscoveryError('Stored proposal payload is invalid.', 'invalid');

  await prisma.$transaction(async (tx) => {
    if (parsed.data.kind === 'idea') {
      const current = await tx.gtmIdea.findFirst({ where: { orgId: input.orgId, status: 'active' }, orderBy: { version: 'desc' } });
      if (current) {
        await tx.gtmIdea.update({ where: { id: current.id }, data: { status: 'superseded', supersededAt: new Date() } });
      }
      const latest = await tx.gtmIdea.findFirst({ where: { orgId: input.orgId }, orderBy: { version: 'desc' }, select: { version: true } });
      await tx.gtmIdea.create({
        data: { orgId: input.orgId, version: (latest?.version ?? 0) + 1, content: parsed.data.payload, source: proposal.source, createdBy: input.userId },
      });
    } else {
      const payload = parsed.data.payload;
      const hypothesis = payload.hypothesisId
        ? await tx.gtmHypothesis.findFirst({ where: { id: payload.hypothesisId, orgId: input.orgId } })
        : await tx.gtmHypothesis.create({ data: { orgId: input.orgId, kind: payload.kind, ownerUserId: input.userId } });
      if (!hypothesis) throw new GtmDiscoveryError('Hypothesis not found.', 'not_found');
      const latest = await tx.gtmHypothesisVersion.findFirst({ where: { hypothesisId: hypothesis.id }, orderBy: { version: 'desc' }, select: { version: true } });
      await tx.gtmHypothesis.update({ where: { id: hypothesis.id }, data: { kind: payload.kind, status: 'active' } });
      await tx.gtmHypothesisVersion.create({
        data: {
          orgId: input.orgId, hypothesisId: hypothesis.id, version: (latest?.version ?? 0) + 1,
          statement: payload.statement, details: payload.details as Prisma.InputJsonValue,
          evidenceClass: payload.evidenceClass, createdBy: input.userId,
        },
      });
    }
    await tx.gtmDiscoveryProposal.update({
      where: { id: proposal.id },
      data: { status: 'confirmed', resolvedBy: input.userId, resolvedAt: new Date() },
    });
  });

  await appendBrainActionLog({
    brainAgentId: input.brainAgentId, userId: input.userId,
    actionType: 'gtm.discovery_proposal_confirm',
    payload: { description: `Confirmed ${proposal.kind} discovery proposal`, proposalId: proposal.id },
    status: 'success', riskLevel: 'low',
  });
  const resolved = await prisma.gtmDiscoveryProposal.findUniqueOrThrow({ where: { id: proposal.id } });
  return {
    proposal: proposalDto(resolved),
    foundation: await getDiscoveryFoundation(input.orgId),
    ideaConfirmed: parsed.data.kind === 'idea',
  };
}
