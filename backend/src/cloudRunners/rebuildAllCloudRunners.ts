/**
 * Force-rebuild the shared cloud runner image and recreate every cloud agent
 * container (solo + team members) onto the new image.
 *
 * Usage (from backend/):
 *   QLIX_CLOUD_RUNNER_ALWAYS_BUILD=true npx tsx src/cloudRunners/rebuildAllCloudRunners.ts
 */
import 'dotenv/config';
import { prisma } from '../lib/prisma.js';
import { resolveDockerBackendUrl } from '../agents/sdkAgentFile.js';
import { CloudProvisionerService } from './cloudProvisioner.service.js';
import { DockerRunnerOrchestrator } from './runnerOrchestrator.js';
import {
  computeRunnerSdkHash,
  ensureSharedRunnerImage,
  sharedRunnerImageRef,
} from './runnerImage.js';

async function main(): Promise<void> {
  process.env.QLIX_CLOUD_RUNNER_ALWAYS_BUILD = 'true';

  const backendUrl =
    process.env.DOCKER_BACKEND_URL?.trim() ||
    resolveDockerBackendUrl({ protocol: 'http', get: () => undefined });
  if (!backendUrl) {
    throw new Error('No backend URL for runners (set DOCKER_BACKEND_URL or PUBLIC_API_URL)');
  }

  const sdkHash = await computeRunnerSdkHash();
  const expectedRef = sharedRunnerImageRef(sdkHash);
  console.log(`[rebuild] fingerprint hash=${sdkHash}`);
  console.log(`[rebuild] target image ${expectedRef}`);
  console.log(`[rebuild] building shared runner image (forced)…`);

  const orchestrator = new DockerRunnerOrchestrator();
  const imageRef = await ensureSharedRunnerImage(orchestrator);
  console.log(`[rebuild] shared image ready: ${imageRef}`);

  const agents = await prisma.agent.findMany({
    where: {
      cloudPrivateKeyEnc: { not: null },
      OR: [
        { runtime: 'cloud' },
        // Mis-labeled hybrids that still have an active cloud runner.
        { cloudRunnerId: { not: null }, cloudProvisioningStatus: { in: ['running', 'provisioning'] } },
      ],
    },
    select: {
      id: true,
      name: true,
      status: true,
      runtime: true,
      cloudRunnerId: true,
      cloudProvisioningStatus: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`[rebuild] found ${agents.length} cloud-capable agent(s) with secrets`);

  const provisioner = new CloudProvisionerService();
  let ok = 0;
  let failed = 0;
  const failures: string[] = [];

  for (const agent of agents) {
    if (agent.runtime !== 'cloud') {
      console.log(
        `[rebuild] aligning ${agent.name} runtime ${agent.runtime} → cloud (active cloud runner)`,
      );
      await prisma.agent.update({ where: { id: agent.id }, data: { runtime: 'cloud' } });
    }
    const supervised = await prisma.team.findFirst({
      where: { supervisorAgentId: agent.id },
      select: { id: true, name: true },
      orderBy: { updatedAt: 'desc' },
    });
    const membership = await prisma.teamMember.findFirst({
      where: { agentId: agent.id },
      select: { team: { select: { id: true, name: true } } },
      orderBy: { addedAt: 'desc' },
    });

    const mode = supervised
      ? `supervisor@${supervised.name}`
      : membership
        ? `worker@${membership.team.name}`
        : 'solo';

    process.stdout.write(`[rebuild] ${agent.name} (${agent.id}) ${mode}… `);
    try {
      if (supervised) {
        await provisioner.applyTeamContext({
          agentId: agent.id,
          teamId: supervised.id,
          teamName: supervised.name,
          role: 'supervisor',
          backendUrl,
        });
      } else if (membership) {
        await provisioner.applyTeamContext({
          agentId: agent.id,
          teamId: membership.team.id,
          teamName: membership.team.name,
          role: 'worker',
          backendUrl,
        });
      } else {
        await provisioner.restartCloudRunner({ agentId: agent.id, backendUrl });
      }
      ok += 1;
      console.log('ok');
    } catch (err) {
      failed += 1;
      const msg = err instanceof Error ? err.message : String(err);
      failures.push(`${agent.name}: ${msg.slice(0, 240)}`);
      console.log('FAILED');
      console.error(`  ${msg.slice(0, 400)}`);
    }
  }

  console.log(`[rebuild] done: ${ok} ok, ${failed} failed, image=${imageRef}`);
  if (failures.length > 0) {
    console.error('[rebuild] failures:');
    for (const f of failures) console.error(`  - ${f}`);
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error('[rebuild] fatal:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
