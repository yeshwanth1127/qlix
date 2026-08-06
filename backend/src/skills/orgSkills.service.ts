import { prisma } from '../lib/prisma.js';

export async function listOrgSkills(orgId: string, status?: string) {
  return prisma.orgSkill.findMany({
    where: {
      orgId,
      ...(status ? { status } : {}),
    },
    orderBy: { updatedAt: 'desc' },
  });
}

export async function promoteRunToSkill(input: {
  orgId: string;
  userId: string;
  runId: string;
  name: string;
  description?: string;
}): Promise<{ id: string }> {
  const run = await prisma.agentRun.findUnique({
    where: { id: input.runId },
    select: {
      id: true,
      agentId: true,
      orgId: true,
      prompt: true,
      result: true,
      status: true,
      skills: true,
    },
  });
  if (!run || (run.orgId && run.orgId !== input.orgId)) {
    throw Object.assign(new Error('Run not found'), { code: 'not_found', status: 404 });
  }
  if (run.status !== 'success') {
    throw Object.assign(new Error('Only successful runs can be promoted'), {
      code: 'invalid_status',
      status: 409,
    });
  }

  const resultText =
    typeof run.result === 'string' ? run.result : JSON.stringify(run.result ?? {}, null, 2);
  const content = [
    `# Skill: ${input.name}`,
    '',
    '## Original prompt',
    run.prompt,
    '',
    '## Successful result',
    resultText.slice(0, 12_000),
    '',
    run.skills.length ? `## Skills used\n${run.skills.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const skill = await prisma.orgSkill.create({
    data: {
      orgId: input.orgId,
      name: input.name.trim(),
      description: input.description?.trim() ?? '',
      content,
      sourceRunId: run.id,
      sourceAgentId: run.agentId,
      createdByUserId: input.userId,
      status: 'draft',
    },
    select: { id: true },
  });
  return skill;
}

export async function approveOrgSkill(input: {
  orgId: string;
  skillId: string;
  userId: string;
}): Promise<void> {
  const skill = await prisma.orgSkill.findFirst({
    where: { id: input.skillId, orgId: input.orgId },
  });
  if (!skill) {
    throw Object.assign(new Error('Skill not found'), { code: 'not_found', status: 404 });
  }
  await prisma.orgSkill.update({
    where: { id: skill.id },
    data: {
      status: 'approved',
      approvedAt: new Date(),
      approvedByUserId: input.userId,
    },
  });
}
