import type { Prisma } from '@prisma/client';
import type { PermissionScope } from '../agents/agents.types.js';
import { generateDID } from '../agents/did.js';
import { generateKeypair } from '../agents/keypair.js';
import { AgentsRepository } from '../agents/agents.repository.js';
import { encryptForAgentSecrets } from '../cloudRunners/agentSecrets.js';
import { prisma } from '../lib/prisma.js';
import { TeamsRepository } from '../teams/teams.repository.js';
import type { TeamDTO } from '../teams/teams.types.js';
import {
  EXAMINER_SLOTS,
  FULL_STACK_EXAMINER_TEAM_CONFIG,
  FULL_STACK_EXAMINER_TEAM_NAME,
  SUPERVISOR_SLOT,
  WORKER_SLOTS,
  type ExaminerSlot,
} from './examinerTeamRecipe.js';

const agentsRepo = new AgentsRepository();
const teamsRepo = new TeamsRepository();

function scopesForSlot(slot: ExaminerSlot): {
  permissionScopes: PermissionScope[];
  jitScopes: PermissionScope[];
  alwaysScopes: PermissionScope[];
} {
  // Examiner tools are assessment-only. Keep jitScopes empty so the pipeline
  // is not stalled on catalog force-JIT (report.create). Human sign-off is
  // still POST /reports/:id/decide, not this flag.
  const permissionScopes = [...slot.permissionScopes];
  return {
    permissionScopes,
    jitScopes: [],
    alwaysScopes: permissionScopes,
  };
}

function assertNoScheduleScopes(scopes: readonly string[], label: string): void {
  const bad = scopes.filter((s) => s.startsWith('mcp.qlix-schedule.'));
  if (bad.length > 0) {
    throw new Error(`${label} has forbidden schedule scopes: ${bad.join(', ')}`);
  }
}

async function createCloudExaminerAgent(input: {
  userId: string;
  orgId: string;
  slot: ExaminerSlot;
}): Promise<{ id: string; name: string }> {
  const existing = await prisma.agent.findFirst({
    where: { orgId: input.orgId, name: input.slot.name },
    select: { id: true, name: true, permissionScopes: true },
  });
  if (existing) {
    const { permissionScopes, jitScopes, alwaysScopes } = scopesForSlot(input.slot);
    assertNoScheduleScopes(permissionScopes, input.slot.name);
    await prisma.agent.update({
      where: { id: existing.id },
      data: {
        description: input.slot.description,
        permissionScopes,
        jitScopes,
        alwaysScopes,
        runtime: 'cloud',
        llmMode: 'proxy',
        llmProvider: 'exora',
        llmModel: 'openrouter/qlix/auto',
      },
    });
    return { id: existing.id, name: existing.name };
  }

  const did = generateDID();
  const { publicKey, privateKey } = await generateKeypair();
  const { permissionScopes, jitScopes, alwaysScopes } = scopesForSlot(input.slot);
  assertNoScheduleScopes(permissionScopes, input.slot.name);

  const agent = await agentsRepo.createAgent({
    userId: input.userId,
    orgId: input.orgId,
    name: input.slot.name,
    description: input.slot.description,
    did,
    publicKey,
    runtime: 'cloud',
    model: 'openrouter/qlix/auto',
    llmMode: 'proxy',
    llmProvider: 'exora',
    localInferenceMode: null,
    permissionScopes,
    jitScopes,
    alwaysScopes,
    webauthnCredentialId: null,
    cloudPrivateKeyEnc: encryptForAgentSecrets(privateKey),
    cloudProvisioningStatus: null,
  });
  return { id: agent.id, name: agent.name };
}

export async function ensureFullStackExaminerTeam(input: {
  orgId: string;
  userId: string;
}): Promise<TeamDTO> {
  const created: { slotId: string; agentId: string }[] = [];
  for (const slot of EXAMINER_SLOTS) {
    const agent = await createCloudExaminerAgent({ userId: input.userId, orgId: input.orgId, slot });
    created.push({ slotId: slot.id, agentId: agent.id });
  }

  const bySlot = Object.fromEntries(created.map((c) => [c.slotId, c.agentId]));
  const supervisorAgentId = bySlot[SUPERVISOR_SLOT.id]!;

  const existing = await prisma.team.findFirst({
    where: { orgId: input.orgId, name: FULL_STACK_EXAMINER_TEAM_NAME },
    select: { id: true },
  });

  if (existing) {
    await prisma.team.update({
      where: { id: existing.id },
      data: {
        description:
          'Ordinary Qlix team that reads a full-stack student diary and writes findings, then a draft report a human must sign.',
        supervisorAgentId,
        status: 'active',
        config: FULL_STACK_EXAMINER_TEAM_CONFIG as unknown as Prisma.InputJsonValue,
      },
    });
    await prisma.teamMember.deleteMany({ where: { teamId: existing.id } });
    for (const slot of WORKER_SLOTS) {
      const { permissionScopes } = scopesForSlot(slot);
      await prisma.teamMember.create({
        data: {
          teamId: existing.id,
          agentId: bySlot[slot.id]!,
          role: slot.role,
          delegatedScopes: permissionScopes,
          stageOrder: slot.stageOrder ?? 1,
        },
      });
    }
    const team = await teamsRepo.findById(existing.id);
    if (!team) throw new Error('Failed to reload Full stack Examiner team');
    return team;
  }

  const team = await teamsRepo.createTeam({
    orgId: input.orgId,
    createdByUserId: input.userId,
    did: generateDID(),
    name: FULL_STACK_EXAMINER_TEAM_NAME,
    description:
      'Ordinary Qlix team that reads a full-stack student diary and writes findings, then a draft report a human must sign.',
    supervisorAgentId,
    config: FULL_STACK_EXAMINER_TEAM_CONFIG,
    members: WORKER_SLOTS.map((slot) => ({
      agentId: bySlot[slot.id]!,
      role: slot.role,
      delegatedScopes: scopesForSlot(slot).permissionScopes,
      stageOrder: slot.stageOrder ?? 1,
    })),
  });
  return team;
}
