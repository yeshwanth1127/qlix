import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { toAgentDTO } from '../agents/agents.repository.js';
import type { AgentDTO } from '../agents/agents.types.js';
import type { EmployeeEngagementDTO, EmployeeEngagementStatus, EmployeeRoleManifest } from './employees.types.js';

function toEngagementDTO(
  row: Prisma.EmployeeEngagementGetPayload<{ include: { agent: true } }>,
): EmployeeEngagementDTO {
  return {
    id: row.id,
    agentId: row.agentId,
    workspaceOrgId: row.workspaceOrgId,
    hiredByUserId: row.hiredByUserId,
    roleSlug: row.roleSlug as EmployeeEngagementDTO['roleSlug'],
    packVersion: row.packVersion,
    packHash: row.packHash,
    packSnapshot: row.packSnapshot as unknown as EmployeeRoleManifest,
    configOverrides: (row.configOverrides as Record<string, unknown>) ?? {},
    status: row.status as EmployeeEngagementStatus,
    hiredAt: row.hiredAt.toISOString(),
    suspendedAt: row.suspendedAt?.toISOString() ?? null,
    terminatedAt: row.terminatedAt?.toISOString() ?? null,
    replacedById: row.replacedById,
    agent: toAgentDTO(row.agent),
  };
}

export class EmployeesRepository {
  async createEngagement(input: {
    agentId: string;
    workspaceOrgId: string;
    hiredByUserId: string;
    roleSlug: string;
    packVersion: string;
    packHash: string;
    packSnapshot: EmployeeRoleManifest;
    configOverrides?: Record<string, unknown>;
  }): Promise<EmployeeEngagementDTO> {
    const row = await prisma.employeeEngagement.create({
      data: {
        agentId: input.agentId,
        workspaceOrgId: input.workspaceOrgId,
        hiredByUserId: input.hiredByUserId,
        roleSlug: input.roleSlug,
        packVersion: input.packVersion,
        packHash: input.packHash,
        packSnapshot: input.packSnapshot as unknown as Prisma.InputJsonValue,
        configOverrides: (input.configOverrides ?? {}) as Prisma.InputJsonValue,
        status: 'active',
      },
      include: { agent: true },
    });
    return toEngagementDTO(row);
  }

  async findById(id: string): Promise<EmployeeEngagementDTO | null> {
    const row = await prisma.employeeEngagement.findUnique({
      where: { id },
      include: { agent: true },
    });
    return row ? toEngagementDTO(row) : null;
  }

  async findByAgentId(agentId: string): Promise<EmployeeEngagementDTO | null> {
    const row = await prisma.employeeEngagement.findUnique({
      where: { agentId },
      include: { agent: true },
    });
    return row ? toEngagementDTO(row) : null;
  }

  async listForWorkspace(workspaceOrgId: string): Promise<EmployeeEngagementDTO[]> {
    const rows = await prisma.employeeEngagement.findMany({
      where: { workspaceOrgId, status: { in: ['active', 'suspended'] } },
      include: { agent: true },
      orderBy: { hiredAt: 'desc' },
    });
    return rows.map(toEngagementDTO);
  }

  async updateStatus(
    id: string,
    status: EmployeeEngagementStatus,
    extra?: { suspendedAt?: Date | null; terminatedAt?: Date | null; replacedById?: string | null },
  ): Promise<EmployeeEngagementDTO> {
    const row = await prisma.employeeEngagement.update({
      where: { id },
      data: { status, ...extra },
      include: { agent: true },
    });
    return toEngagementDTO(row);
  }
}

export async function isAgentEngaged(agentId: string): Promise<boolean> {
  const row = await prisma.employeeEngagement.findUnique({
    where: { agentId },
    select: { status: true },
  });
  return row != null && (row.status === 'active' || row.status === 'suspended');
}
