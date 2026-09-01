import 'dotenv/config';
import { CloudProvisionerService } from '../cloudRunners/cloudProvisioner.service.js';
import { prisma } from '../lib/prisma.js';
import { resolveExaminerSeedOrg } from './examinerSeedOrg.js';
import { DEMO_SESSION_METADATA_KEY, FULL_STACK_EXAMINER_TEAM_NAME } from './examinerTeamRecipe.js';

/**
 * Removes Full stack Examiner teams/agents/demo sessions from every org except
 * the Yeshwanth seed org. Stops their Docker runners first.
 */
async function main(): Promise<void> {
  const keep = await resolveExaminerSeedOrg();
  console.log(`Keeping examiners on ${keep.orgName} (${keep.orgId})`);

  const extras = await prisma.team.findMany({
    where: { name: FULL_STACK_EXAMINER_TEAM_NAME, orgId: { not: keep.orgId } },
    include: {
      members: { include: { agent: { select: { id: true, name: true, did: true, cloudRunnerId: true } } } },
      supervisorAgent: { select: { id: true, name: true, did: true, cloudRunnerId: true } },
    },
  });

  const provisioner = new CloudProvisionerService();
  for (const team of extras) {
    const org = await prisma.organization.findUnique({ where: { id: team.orgId }, select: { name: true } });
    console.log(`Removing team ${team.id} from ${org?.name ?? team.orgId}`);

    const byId = new Map<string, (typeof extras)[0]['members'][0]['agent']>();
    if (team.supervisorAgent) byId.set(team.supervisorAgent.id, team.supervisorAgent);
    for (const m of team.members) byId.set(m.agent.id, m.agent);
    const agents = [...byId.values()];

    for (const agent of agents) {
      await provisioner.teardownCloudRunner({
        agentId: agent.id,
        name: agent.name,
        did: agent.did,
        cloudRunnerId: agent.cloudRunnerId,
        teamContext: { id: team.id, name: team.name, role: 'worker' },
      });
      console.log(`  stopped runner ${agent.name}`);
    }

    const demoSessions = await prisma.workSession.findMany({
      where: {
        orgId: team.orgId,
        metadata: { path: ['demoKey'], equals: DEMO_SESSION_METADATA_KEY },
      },
      select: { id: true },
    });
    for (const s of demoSessions) {
      await prisma.workSession.delete({ where: { id: s.id } });
      console.log(`  deleted demo session ${s.id}`);
    }

    await prisma.team.delete({ where: { id: team.id } });
    for (const agent of agents) {
      await prisma.agent.delete({ where: { id: agent.id } });
      console.log(`  deleted agent ${agent.name}`);
    }
  }

  console.log(`Done. Removed ${extras.length} extra team(s).`);
}

main()
  .then(() => prisma.$disconnect())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
