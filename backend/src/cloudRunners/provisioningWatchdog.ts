import { prisma } from '../lib/prisma.js';
import { AgentsRepository } from '../agents/agents.repository.js';
import { CloudProvisionerService } from './cloudProvisioner.service.js';
import { ensureSharedRunnerImage } from './runnerImage.js';
import { DockerRunnerOrchestrator } from './runnerOrchestrator.js';
import { ProvisioningQueue } from './provisioningQueue.js';
import { resolveDockerBackendUrl } from '../agents/sdkAgentFile.js';

function stuckAfterMs(): number {
  const raw = process.env.QLIX_PROVISION_STUCK_MS?.trim();
  const n = raw ? Number.parseInt(raw, 10) : 120_000;
  return Number.isFinite(n) && n >= 30_000 ? n : 120_000;
}

/**
 * On backend boot: warm the shared runner image and re-queue agents stuck in provisioning.
 */
export async function startProvisioningWatchdog(
  provisioner: CloudProvisionerService = new CloudProvisionerService(),
): Promise<void> {
  const queue = ProvisioningQueue.getInstance();
  provisioner.registerQueueHandler();

  const backendUrl = resolveDockerBackendUrl({ protocol: 'http', get: () => undefined });
  if (!backendUrl) {
    console.warn('[provisionWatchdog] PUBLIC_API_URL unset; skipping stuck-agent recovery');
    return;
  }

  // Warm shared image in background so first user provision is fast.
  void ensureSharedRunnerImage(new DockerRunnerOrchestrator())
    .then((ref) => console.log('[provisionWatchdog] shared runner image ready:', ref))
    .catch((err) => console.warn('[provisionWatchdog] shared runner image warmup failed:', err));

  const cutoff = new Date(Date.now() - stuckAfterMs());
  const stuck = await prisma.agent.findMany({
    where: {
      runtime: 'cloud',
      OR: [
        {
          cloudProvisioningStatus: 'provisioning',
          OR: [{ cloudRunnerId: null }, { createdAt: { lt: cutoff } }],
        },
        {
          cloudProvisioningStatus: 'failed',
          cloudRunnerId: null,
          createdAt: { gt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
      ],
    },
    select: { id: true, name: true, createdAt: true, cloudRunnerId: true, cloudProvisioningStatus: true },
    take: 50,
  });

  if (stuck.length === 0) return;

  const unique = [...new Map(stuck.map((a) => [a.id, a])).values()];

  console.log(
    `[provisionWatchdog] re-queuing ${unique.length} stuck cloud agent(s):`,
    unique.map((a) => a.name).join(', '),
  );

  const repo = new AgentsRepository();
  for (const row of unique) {
    await repo
      .updateCloudFields(row.id, {
        cloudProvisioningStatus: 'provisioning',
        cloudProvisioningError: null,
      })
      .catch(() => {});
    queue.enqueue({ kind: 'restart', agentId: row.id, backendUrl });
  }
}
