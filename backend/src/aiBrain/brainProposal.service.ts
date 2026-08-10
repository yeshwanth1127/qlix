import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import type { AgentCreationPlan, NLAgentSpec, NLWorkerSpec } from '../agents/nlTypes.js';
import { NLCreationService, type RequestLike } from '../agents/nlCreate.js';
import { NLParseError, sanitizeCreationPlan } from '../agents/nlParse.js';
import { appendBrainActionLog } from './brainAudit.service.js';
import type { HybridStarterPlatform } from '../agents/hybridStarterPack.js';

export class BrainProposalError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'not_found'
      | 'not_pending'
      | 'invalid_plan'
      | 'forbidden'
      | 'create_failed',
  ) {
    super(message);
    this.name = 'BrainProposalError';
  }
}

export interface BrainProposalSummaryAgent {
  name: string;
  description: string;
  permissionScopes: string[];
  jitScopes: string[];
  runtime: string;
  model: string;
  rationale: string;
  role?: string;
}

export interface BrainProposalDTO {
  id: string;
  status: string;
  rationale: string;
  kind: 'single' | 'team';
  agents: BrainProposalSummaryAgent[];
  teamName?: string;
  primaryAgentId: string | null;
  createdAgentIds: string[];
  teamId: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

function summarizeSpec(spec: NLAgentSpec | NLWorkerSpec): BrainProposalSummaryAgent {
  return {
    name: spec.name,
    description: spec.description,
    permissionScopes: [...spec.permissionScopes],
    jitScopes: [...spec.jitScopes],
    runtime: spec.runtime,
    model: spec.model,
    rationale: spec.rationale,
    ...('role' in spec ? { role: spec.role } : {}),
  };
}

export function planToDto(
  row: {
    id: string;
    status: string;
    rationale: string;
    planJson: Prisma.JsonValue;
    primaryAgentId: string | null;
    createdAgentIds: string[];
    teamId: string | null;
    createdAt: Date;
    resolvedAt: Date | null;
  },
): BrainProposalDTO {
  const plan = row.planJson as unknown as AgentCreationPlan;
  if (plan.type === 'single') {
    return {
      id: row.id,
      status: row.status,
      rationale: row.rationale || plan.rationale,
      kind: 'single',
      agents: [summarizeSpec(plan.agent)],
      primaryAgentId: row.primaryAgentId,
      createdAgentIds: row.createdAgentIds,
      teamId: row.teamId,
      createdAt: row.createdAt.toISOString(),
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
    };
  }
  return {
    id: row.id,
    status: row.status,
    rationale: row.rationale || plan.rationale,
    kind: 'team',
    teamName: plan.team.name,
    agents: [summarizeSpec(plan.team.supervisor), ...plan.team.workers.map(summarizeSpec)],
    primaryAgentId: row.primaryAgentId,
    createdAgentIds: row.createdAgentIds,
    teamId: row.teamId,
    createdAt: row.createdAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
  };
}

export class BrainProposalService {
  private readonly nlCreate = new NLCreationService();

  async createProposal(input: {
    orgId: string;
    brainAgentId: string;
    userId: string;
    conversationId?: string | null;
    rawPlan: unknown;
  }): Promise<BrainProposalDTO> {
    let plan: AgentCreationPlan;
    try {
      plan = await sanitizeCreationPlan(input.rawPlan, input.orgId);
    } catch (err) {
      const message = err instanceof NLParseError ? err.message : 'Invalid agent plan';
      throw new BrainProposalError(message, 'invalid_plan');
    }

    if (input.conversationId) {
      const conv = await prisma.brainConversation.findFirst({
        where: {
          id: input.conversationId,
          orgId: input.orgId,
          brainAgentId: input.brainAgentId,
        },
        select: { id: true },
      });
      if (!conv) {
        throw new BrainProposalError('Conversation not found for proposal', 'not_found');
      }
    }

    const row = await prisma.brainAgentProposal.create({
      data: {
        orgId: input.orgId,
        brainAgentId: input.brainAgentId,
        conversationId: input.conversationId ?? null,
        createdByUserId: input.userId,
        status: 'pending',
        planJson: plan as unknown as Prisma.InputJsonValue,
        rationale: plan.rationale,
      },
    });

    await appendBrainActionLog({
      brainAgentId: input.brainAgentId,
      userId: input.userId,
      actionType: 'brain.propose_plan',
      payload: {
        description: `Proposed ${plan.type} agent plan`,
        proposalId: row.id,
        kind: plan.type,
        agentCount: plan.type === 'single' ? 1 : 1 + plan.team.workers.length,
      },
      status: 'success',
      riskLevel: 'medium',
    });

    return planToDto(row);
  }

  async getProposal(orgId: string, proposalId: string): Promise<BrainProposalDTO | null> {
    const row = await prisma.brainAgentProposal.findFirst({
      where: { id: proposalId, orgId },
    });
    return row ? planToDto(row) : null;
  }

  async rejectProposal(input: {
    orgId: string;
    userId: string;
    proposalId: string;
    brainAgentId: string;
  }): Promise<BrainProposalDTO> {
    const row = await prisma.brainAgentProposal.findFirst({
      where: { id: input.proposalId, orgId: input.orgId },
    });
    if (!row) throw new BrainProposalError('Proposal not found', 'not_found');
    if (row.status !== 'pending') {
      throw new BrainProposalError('Proposal is no longer pending', 'not_pending');
    }

    const updated = await prisma.brainAgentProposal.update({
      where: { id: row.id },
      data: { status: 'rejected', resolvedAt: new Date() },
    });

    await appendBrainActionLog({
      brainAgentId: input.brainAgentId,
      userId: input.userId,
      actionType: 'brain.reject_plan',
      payload: {
        description: 'Rejected brain agent proposal',
        proposalId: row.id,
      },
      status: 'success',
      riskLevel: 'low',
    });

    return planToDto(updated);
  }

  async confirmProposal(input: {
    orgId: string;
    userId: string;
    proposalId: string;
    brainAgentId: string;
    request: RequestLike;
    clientPlatform?: HybridStarterPlatform;
  }): Promise<BrainProposalDTO> {
    const row = await prisma.brainAgentProposal.findFirst({
      where: { id: input.proposalId, orgId: input.orgId },
    });
    if (!row) throw new BrainProposalError('Proposal not found', 'not_found');
    if (row.status !== 'pending') {
      throw new BrainProposalError('Proposal is no longer pending', 'not_pending');
    }

    const plan = row.planJson as unknown as AgentCreationPlan;

    let result;
    try {
      result = await this.nlCreate.createFromPlan({
        userId: input.userId,
        orgId: input.orgId,
        plan,
        request: input.request,
        clientPlatform: input.clientPlatform,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create agents from proposal';
      throw new BrainProposalError(message, 'create_failed');
    }

    const primaryAgentId =
      result.type === 'single'
        ? result.output.agentResult.agent.id
        : result.supervisorOutput.agentResult.agent.id;
    const createdAgentIds =
      result.type === 'single'
        ? [result.output.agentResult.agent.id]
        : [
            result.supervisorOutput.agentResult.agent.id,
            ...result.workerOutputs.map((w) => w.agentResult.agent.id),
          ];
    const teamId = result.type === 'team' ? result.teamId : null;

    const updated = await prisma.brainAgentProposal.update({
      where: { id: row.id },
      data: {
        status: 'confirmed',
        resolvedAt: new Date(),
        primaryAgentId,
        createdAgentIds,
        teamId,
      },
    });

    await appendBrainActionLog({
      brainAgentId: input.brainAgentId,
      userId: input.userId,
      actionType: 'brain.confirm_plan',
      payload: {
        description: `Confirmed brain proposal — created ${createdAgentIds.length} agent(s)`,
        proposalId: row.id,
        primaryAgentId,
        createdAgentIds,
        teamId,
        kind: result.type,
      },
      status: 'success',
      riskLevel: 'high',
    });

    return planToDto(updated);
  }
}
