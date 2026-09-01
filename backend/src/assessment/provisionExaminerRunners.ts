import 'dotenv/config';
import { CloudProvisionerService } from '../cloudRunners/cloudProvisioner.service.js';
import { prisma } from '../lib/prisma.js';
import { resolveExaminerSeedOrg } from './examinerSeedOrg.js';
import { FULL_STACK_EXAMINER_TEAM_NAME } from './examinerTeamRecipe.js';

async function main(): Promise<void> {
  const seedOrg = await resolveExaminerSeedOrg();
  const teams = await prisma.team.findMany({
    where: {
      name: FULL_STACK_EXAMINER_TEAM_NAME,
      orgId: seedOrg.orgId,
    },
    include: {
      members: { select: { agentId: true } },
    },
  });
  if (teams.length === 0) {
    throw new Error(`No team named "${FULL_STACK_EXAMINER_TEAM_NAME}" found`);
  }

  const provisioner = new CloudProvisionerService();
  const backendUrl = process.env.DOCKER_BACKEND_URL?.trim() || 'http://host.docker.internal:4000';

  const jobs: Array<{ agentId: string; teamId: string; teamName: string; role: 'supervisor' | 'worker'; label: string }> =
    [];
  for (const team of teams) {
    if (team.supervisorAgentId) {
      jobs.push({
        agentId: team.supervisorAgentId,
        teamId: team.id,
        teamName: team.name,
        role: 'supervisor',
        label: `supervisor ${team.supervisorAgentId}`,
      });
    }
    for (const m of team.members) {
      jobs.push({
        agentId: m.agentId,
        teamId: team.id,
        teamName: team.name,
        role: 'worker',
        label: `worker ${m.agentId}`,
      });
    }
  }

  console.log(`Provisioning ${jobs.length} cloud runner(s) for ${teams.length} team(s)…`);
  let ok = 0;
  let failed = 0;
  for (const [i, job] of jobs.entries()) {
    process.stdout.write(`[${i + 1}/${jobs.length}] ${job.role} ${job.agentId} … `);
    try {
      await provisioner.applyTeamContext({
        agentId: job.agentId,
        teamId: job.teamId,
        teamName: job.teamName,
        role: job.role,
        backendUrl,
      });
      ok += 1;
      console.log('ok');
    } catch (err) {
      failed += 1;
      console.log('FAILED', err instanceof Error ? err.message : err);
    }
  }
  console.log(`Done. ok=${ok} failed=${failed}`);
}

main()
  .then(() => prisma.$disconnect())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
