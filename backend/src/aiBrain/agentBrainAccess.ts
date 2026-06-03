import { prisma } from '../lib/prisma.js';
import type { AgentKind } from '../agents/agents.types.js';

export class BrainQueryForbiddenError extends Error {
  readonly code = 'brain_query_forbidden';
  constructor(message = 'This agent is not allowed to query the org AI brain') {
    super(message);
  }
}

export class BrainNotProvisionedError extends Error {
  readonly code = 'brain_required';
  constructor(message = 'Provision the org AI brain first') {
    super(message);
  }
}

export class BrainWrongOrgError extends Error {
  readonly code = 'brain_org_mismatch';
  constructor(message = 'Agent org does not match') {
    super(message);
  }
}

export interface WorkerAndBrainRows {
  workerOrgId: string;
  workerAgentId: string;
  workerAgentKind: AgentKind;
  brainAgentId: string;
  brainModel: string;
}

/**
 * Ensures a standard org-scoped agent may use org brain: org brain exists, same org, `brain.query` scope.
 */
export async function assertStandardAgentCanQueryBrain(
  workerAgentId: string,
  orgId: string,
): Promise<WorkerAndBrainRows> {
  const worker = await prisma.agent.findUnique({
    where: { id: workerAgentId },
    select: {
      id: true,
      orgId: true,
      agentKind: true,
      permissionScopes: true,
    },
  });
  if (!worker) {
    throw new BrainQueryForbiddenError('Agent not found');
  }
  if (worker.agentKind !== 'standard') {
    throw new BrainQueryForbiddenError('Only standard agents can query the brain as workers');
  }
  if (!worker.orgId || worker.orgId !== orgId) {
    throw new BrainWrongOrgError();
  }
  if (!worker.permissionScopes.includes('brain.query')) {
    throw new BrainQueryForbiddenError('Missing brain.query permission');
  }

  const brain = await prisma.agent.findFirst({
    where: { orgId, agentKind: 'org_brain' },
    select: { id: true, llmModel: true },
  });
  if (!brain) {
    throw new BrainNotProvisionedError();
  }

  return {
    workerOrgId: worker.orgId,
    workerAgentId: worker.id,
    workerAgentKind: worker.agentKind,
    brainAgentId: brain.id,
    brainModel: brain.llmModel,
  };
}
