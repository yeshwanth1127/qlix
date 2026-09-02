import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { roleCan } from '../lib/orgPermissions.js';
import { appendBrainActionLog } from '../aiBrain/brainAudit.service.js';
import {
  applyGtmSetupPatch,
  fieldsFromSetupPatch,
  gtmSetupToJson,
  GTM_PLUGIN_ID,
  normalizeGtmSetup,
  type GtmSetupConfig,
  type GtmSetupPatch,
  GtmSetupValidationError,
} from './gtmSetup.js';

export class GtmSetupProposalError extends Error {
  constructor(
    message: string,
    readonly code: 'not_found' | 'not_pending' | 'forbidden' | 'invalid_patch',
  ) {
    super(message);
    this.name = 'GtmSetupProposalError';
  }
}

export interface GtmSetupProposalDiffEntry {
  field: string;
  before: string | readonly string[];
  after: string | readonly string[];
}

export interface GtmSetupProposalDTO {
  id: string;
  status: string;
  rationale: string;
  source: string;
  patch: GtmSetupPatch;
  diff: GtmSetupProposalDiffEntry[];
  createdAt: string;
  resolvedAt: string | null;
}

function valueForField(setup: GtmSetupConfig, field: string): string | readonly string[] {
  switch (field) {
    case 'companyDescription':
      return setup.companyDescription;
    case 'idealCustomerProfile':
      return setup.idealCustomerProfile;
    case 'primaryOffer':
      return setup.primaryOffer;
    case 'targetRegions':
      return setup.targetRegions;
    case 'buyerRolesAndWorkflows':
      return setup.buyerRolesAndWorkflows;
    case 'proofAndCaseStudies':
      return setup.proofAndCaseStudies;
    case 'validityPolicy':
      return setup.validityPolicy;
    case 'calibrationNotes':
      return setup.calibrationNotes;
    default:
      return '';
  }
}

function listsEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

export function buildSetupProposalDiff(
  currentSetup: GtmSetupConfig,
  patch: GtmSetupPatch,
): GtmSetupProposalDiffEntry[] {
  const preview = applyGtmSetupPatch(currentSetup, patch);
  const fields = fieldsFromSetupPatch(patch);
  const diff: GtmSetupProposalDiffEntry[] = [];
  for (const field of fields) {
    const before = valueForField(currentSetup, field);
    const after = valueForField(preview, field);
    if (typeof before === 'string' && typeof after === 'string' && before === after) continue;
    if (Array.isArray(before) && Array.isArray(after) && listsEqual(before, after)) continue;
    diff.push({ field, before, after });
  }
  return diff;
}

function rowToDto(row: {
  id: string;
  status: string;
  rationale: string;
  source: string;
  patch: Prisma.JsonValue;
  createdAt: Date;
  resolvedAt: Date | null;
}, currentSetup: GtmSetupConfig): GtmSetupProposalDTO {
  const patch = row.patch as unknown as GtmSetupPatch;
  return {
    id: row.id,
    status: row.status,
    rationale: row.rationale,
    source: row.source,
    patch,
    diff: buildSetupProposalDiff(currentSetup, patch),
    createdAt: row.createdAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
  };
}

export async function createGtmSetupProposal(input: {
  orgId: string;
  userId: string;
  role: string;
  brainAgentId: string;
  patch: GtmSetupPatch;
  rationale: string;
  source?: 'exa' | 'operator';
}): Promise<GtmSetupProposalDTO> {
  if (!roleCan(input.role, 'manage_brain')) {
    throw new GtmSetupProposalError('Only organization owners and admins can propose GTM setup changes.', 'forbidden');
  }

  const plugin = await prisma.orgPlugin.findUniqueOrThrow({
    where: { orgId_pluginId: { orgId: input.orgId, pluginId: GTM_PLUGIN_ID } },
    select: { config: true },
  });
  const currentSetup = normalizeGtmSetup(plugin.config);

  let normalizedPatch: GtmSetupPatch = { ...input.patch };
  try {
    if (fieldsFromSetupPatch(normalizedPatch).length === 0 && normalizedPatch.completedSteps === undefined) {
      throw new GtmSetupProposalError('Proposal must change at least one setup field.', 'invalid_patch');
    }
    applyGtmSetupPatch(currentSetup, normalizedPatch);
  } catch (error) {
    if (error instanceof GtmSetupValidationError) {
      throw new GtmSetupProposalError(error.message, 'invalid_patch');
    }
    throw error;
  }

  const row = await prisma.gtmSetupProposal.create({
    data: {
      orgId: input.orgId,
      patch: normalizedPatch as unknown as Prisma.InputJsonValue,
      rationale: input.rationale.trim(),
      source: input.source ?? 'exa',
      createdBy: input.userId,
    },
  });

  await appendBrainActionLog({
    brainAgentId: input.brainAgentId,
    userId: input.userId,
    actionType: 'gtm.setup_proposal_create',
    payload: {
      description: `GTM setup proposal created (${fieldsFromSetupPatch(normalizedPatch).join(', ')})`,
      proposalId: row.id,
      source: input.source ?? 'exa',
    },
    status: 'success',
    riskLevel: 'low',
  });

  return rowToDto(row, currentSetup);
}

export async function listPendingGtmSetupProposals(orgId: string): Promise<GtmSetupProposalDTO[]> {
  const plugin = await prisma.orgPlugin.findUnique({
    where: { orgId_pluginId: { orgId, pluginId: GTM_PLUGIN_ID } },
    select: { config: true },
  });
  const currentSetup = normalizeGtmSetup(plugin?.config);
  const rows = await prisma.gtmSetupProposal.findMany({
    where: { orgId, status: 'pending' },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });
  return rows.map((row) => rowToDto(row, currentSetup));
}

export async function getGtmSetupProposal(orgId: string, proposalId: string): Promise<GtmSetupProposalDTO> {
  const plugin = await prisma.orgPlugin.findUnique({
    where: { orgId_pluginId: { orgId, pluginId: GTM_PLUGIN_ID } },
    select: { config: true },
  });
  const currentSetup = normalizeGtmSetup(plugin?.config);
  const row = await prisma.gtmSetupProposal.findFirst({
    where: { id: proposalId, orgId },
  });
  if (!row) throw new GtmSetupProposalError('Proposal not found.', 'not_found');
  return rowToDto(row, currentSetup);
}

async function resolveProposal(input: {
  orgId: string;
  userId: string;
  role: string;
  brainAgentId: string;
  proposalId: string;
  status: 'confirmed' | 'rejected';
}): Promise<{ setup: GtmSetupConfig; proposal: GtmSetupProposalDTO }> {
  if (!roleCan(input.role, 'manage_brain')) {
    throw new GtmSetupProposalError('Only organization owners and admins can resolve GTM setup proposals.', 'forbidden');
  }

  const row = await prisma.gtmSetupProposal.findFirst({
    where: { id: input.proposalId, orgId: input.orgId },
  });
  if (!row) throw new GtmSetupProposalError('Proposal not found.', 'not_found');
  if (row.status !== 'pending') {
    throw new GtmSetupProposalError('Proposal is no longer pending.', 'not_pending');
  }

  const plugin = await prisma.orgPlugin.findUniqueOrThrow({
    where: { orgId_pluginId: { orgId: input.orgId, pluginId: GTM_PLUGIN_ID } },
    select: { config: true },
  });
  const currentSetup = normalizeGtmSetup(plugin.config);
  const patch = row.patch as unknown as GtmSetupPatch;

  let nextSetup = currentSetup;
  if (input.status === 'confirmed') {
    nextSetup = applyGtmSetupPatch(currentSetup, patch);
    const confirmed = new Set(nextSetup.confirmedFields);
    for (const field of fieldsFromSetupPatch(patch)) confirmed.add(field);
    nextSetup.confirmedFields = [...confirmed];
  }

  const resolvedAt = new Date();
  await prisma.$transaction([
    prisma.gtmSetupProposal.update({
      where: { id: row.id },
      data: {
        status: input.status,
        resolvedBy: input.userId,
        resolvedAt,
      },
    }),
    ...(input.status === 'confirmed'
      ? [
          prisma.orgPlugin.update({
            where: { orgId_pluginId: { orgId: input.orgId, pluginId: GTM_PLUGIN_ID } },
            data: { config: gtmSetupToJson(nextSetup) },
          }),
        ]
      : []),
  ]);

  const updatedRow = await prisma.gtmSetupProposal.findUniqueOrThrow({ where: { id: row.id } });
  const proposal = rowToDto(updatedRow, input.status === 'confirmed' ? nextSetup : currentSetup);

  await appendBrainActionLog({
    brainAgentId: input.brainAgentId,
    userId: input.userId,
    actionType: input.status === 'confirmed' ? 'gtm.setup_proposal_confirm' : 'gtm.setup_proposal_reject',
    payload: {
      description: `GTM setup proposal ${input.status}`,
      proposalId: row.id,
      fields: fieldsFromSetupPatch(patch),
    },
    status: 'success',
    riskLevel: input.status === 'confirmed' ? 'medium' : 'low',
  });

  return { setup: input.status === 'confirmed' ? nextSetup : currentSetup, proposal };
}

export async function confirmGtmSetupProposal(input: {
  orgId: string;
  userId: string;
  role: string;
  brainAgentId: string;
  proposalId: string;
}) {
  return resolveProposal({ ...input, status: 'confirmed' });
}

export async function rejectGtmSetupProposal(input: {
  orgId: string;
  userId: string;
  role: string;
  brainAgentId: string;
  proposalId: string;
}) {
  return resolveProposal({ ...input, status: 'rejected' });
}
