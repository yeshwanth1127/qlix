import { z } from 'zod';

const boundedId = z.string().trim().min(1).max(160);
const domain = z.string().trim().toLowerCase().max(253).regex(
  /^[a-z0-9](?:[a-z0-9-]{0,62}\.)+[a-z]{2,63}$/,
  'Expected a normalized DNS domain.',
);

export const accountResearchInputSchema = z.object({
  schemaVersion: z.literal('gtm.account_research.input.v1'),
  campaignId: boundedId,
  accountId: boundedId,
  candidateDomain: domain,
  candidateNames: z.array(z.string().trim().min(1).max(240)).max(20).default([]),
  sourceSnapshotIds: z.array(boundedId).min(1).max(100),
  sourcePolicy: z.object({
    allowedTiers: z.array(z.enum(['A', 'B', 'C', 'D'])).min(1),
    maxAgeDays: z.number().int().min(1).max(3650),
    requireIndependentCorroboration: z.boolean(),
  }).strict(),
}).strict();

const claimPredicate = z.enum([
  'legal_name', 'trading_name', 'headquarters', 'operating_location', 'facility_count',
  'employee_band', 'industry', 'certification', 'technology', 'hiring_signal',
  'expansion_signal', 'operational_workflow', 'other',
]);

const claimSupportSchema = z.object({
  sourceSnapshotId: boundedId,
  excerpt: z.string().trim().min(1).max(4000),
  selector: z.string().trim().max(1000).nullable().default(null),
  relationship: z.enum(['supports', 'contradicts']),
}).strict();

const claimSchema = z.object({
  claimId: boundedId,
  predicate: claimPredicate,
  value: z.union([z.string().max(2000), z.number(), z.boolean()]),
  unit: z.string().trim().max(80).nullable().default(null),
  timeScope: z.string().trim().max(160).nullable(),
  support: z.array(claimSupportSchema).min(1).max(20),
  extractionConfidence: z.number().min(0).max(1),
}).strict().superRefine((claim, context) => {
  if (!claim.support.some((support) => support.relationship === 'supports')) {
    context.addIssue({
      code: 'custom',
      path: ['support'],
      message: 'A factual claim requires at least one supporting source excerpt.',
    });
  }
});

export const accountResearchResultSchema = z.object({
  schemaVersion: z.literal('gtm.account_research.result.v1'),
  identity: z.object({
    status: z.enum(['resolved', 'ambiguous', 'unresolved']),
    canonicalName: z.string().trim().max(240).nullable(),
    canonicalDomain: domain.nullable(),
    candidateEntities: z.array(z.object({
      name: z.string().trim().min(1).max(240),
      domain: domain.nullable(),
      reason: z.string().trim().min(1).max(1000),
      sourceSnapshotIds: z.array(boundedId).min(1).max(50),
    }).strict()).max(20),
    sourceSnapshotIds: z.array(boundedId).max(50),
  }).strict(),
  claims: z.array(claimSchema).max(250),
  hypotheses: z.array(z.object({
    hypothesisId: boundedId,
    statement: z.string().trim().min(1).max(2000),
    basisClaimIds: z.array(boundedId).max(50),
    validationQuestions: z.array(z.string().trim().min(1).max(1000)).min(1).max(20),
  }).strict()).max(50),
  warnings: z.array(z.string().trim().min(1).max(1000)).max(100),
  missingInformation: z.array(z.string().trim().min(1).max(1000)).max(100),
}).strict().superRefine((result, context) => {
  const claimIds = new Set(result.claims.map((claim) => claim.claimId));
  if (claimIds.size !== result.claims.length) {
    context.addIssue({ code: 'custom', path: ['claims'], message: 'claimId values must be unique.' });
  }
  for (const [index, hypothesis] of result.hypotheses.entries()) {
    for (const claimId of hypothesis.basisClaimIds) {
      if (!claimIds.has(claimId)) {
        context.addIssue({
          code: 'custom',
          path: ['hypotheses', index, 'basisClaimIds'],
          message: `Unknown basis claim: ${claimId}.`,
        });
      }
    }
  }
  if (result.identity.status === 'resolved' && (!result.identity.canonicalName || !result.identity.canonicalDomain)) {
    context.addIssue({
      code: 'custom', path: ['identity'], message: 'Resolved identity requires canonicalName and canonicalDomain.',
    });
  }
  if (result.identity.status !== 'resolved' && result.identity.candidateEntities.length === 0) {
    context.addIssue({
      code: 'custom', path: ['identity', 'candidateEntities'],
      message: 'Ambiguous or unresolved identity requires at least one candidate entity.',
    });
  }
});

export type AccountResearchInput = z.infer<typeof accountResearchInputSchema>;
export type AccountResearchResult = z.infer<typeof accountResearchResultSchema>;

export function validateAccountResearchEnvelope(inputValue: unknown, resultValue: unknown) {
  const input = accountResearchInputSchema.safeParse(inputValue);
  const result = accountResearchResultSchema.safeParse(resultValue);
  const lineageErrors: string[] = [];

  if (input.success && result.success) {
    const authorizedSnapshots = new Set(input.data.sourceSnapshotIds);
    const referencedSnapshots = new Set([
      ...result.data.identity.sourceSnapshotIds,
      ...result.data.identity.candidateEntities.flatMap((candidate) => candidate.sourceSnapshotIds),
      ...result.data.claims.flatMap((claim) => claim.support.map((support) => support.sourceSnapshotId)),
    ]);
    for (const snapshotId of referencedSnapshots) {
      if (!authorizedSnapshots.has(snapshotId)) {
        lineageErrors.push(`Result references unauthorized source snapshot: ${snapshotId}.`);
      }
    }
  }

  return {
    success: input.success && result.success && lineageErrors.length === 0,
    input,
    result,
    lineageErrors,
  };
}
