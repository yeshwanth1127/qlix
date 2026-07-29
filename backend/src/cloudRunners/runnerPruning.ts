import { execFile } from 'node:child_process';
import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { prisma } from '../lib/prisma.js';
import { computeRunnerSdkHash, runnerBaseImageRepository, sharedRunnerImageRef } from './runnerImage.js';
import { DockerRunnerOrchestrator, type RunnerOrchestrator } from './runnerOrchestrator.js';

const execFileAsync = promisify(execFile);

function dockerSshTarget(): string | null {
  const host = process.env.DOCKER_HOST?.trim();
  if (!host?.startsWith('ssh://')) return null;
  return host.slice('ssh://'.length);
}

function runnerStateRoot(): string {
  return process.env.QLIX_CLOUD_RUNNER_STATE_DIR?.trim() || path.join(process.cwd(), '.qlix-runners');
}

/**
 * Removes one agent's on-disk runner state dir (`agent.json`, `adk/*`) — locally, and on the
 * remote Docker host too when `DOCKER_HOST=ssh://...`. Call this whenever an agent is deleted;
 * previously nothing ever did, so `.qlix-runners/` grew by one directory per agent forever.
 */
export async function pruneAgentRunnerState(agentId: string): Promise<void> {
  const root = runnerStateRoot();
  const dir = path.join(root, agentId);
  await rm(dir, { recursive: true, force: true }).catch((err) => {
    console.warn(`[runnerPruning] failed to remove local state dir for ${agentId}`, err);
  });

  const sshTarget = dockerSshTarget();
  if (sshTarget) {
    await execFileAsync('ssh', [sshTarget, `rm -rf ${JSON.stringify(dir)}`], { timeout: 30_000 }).catch((err) => {
      console.warn(`[runnerPruning] failed to remove remote state dir for ${agentId}`, err);
    });
  }
}

/**
 * Sweeps `.qlix-runners/<id>` directories whose Agent row no longer exists — catches anything
 * orphaned before `pruneAgentRunnerState` existed, or left behind by a crash between container
 * teardown and dir removal.
 */
export async function pruneOrphanedRunnerStateDirs(): Promise<number> {
  const root = runnerStateRoot();
  const dirents = await readdir(root, { withFileTypes: true }).catch(() => []);
  const ids = dirents.filter((d) => d.isDirectory()).map((d) => d.name);
  if (ids.length === 0) return 0;

  const existing = await prisma.agent.findMany({ where: { id: { in: ids } }, select: { id: true } });
  const existingIds = new Set(existing.map((a) => a.id));
  const orphaned = ids.filter((id) => !existingIds.has(id));

  for (const id of orphaned) {
    await pruneAgentRunnerState(id);
  }
  return orphaned.length;
}

/**
 * Removes shared runner images whose tag doesn't match the current SDK-hash. Safe because
 * per-agent ADK manifests are bind-mounted at container start, never baked into the image —
 * an old image tag is never referenced again once a newer one exists.
 */
export async function pruneStaleRunnerImages(
  orchestrator: RunnerOrchestrator = new DockerRunnerOrchestrator(),
): Promise<number> {
  const repo = runnerBaseImageRepository();
  const currentHash = await computeRunnerSdkHash();
  const currentRef = sharedRunnerImageRef(currentHash);

  const images = await orchestrator.listImages(repo).catch(() => [] as string[]);
  const stale = images.filter((ref) => ref !== currentRef);
  for (const ref of stale) {
    await orchestrator.removeImageIfExists(ref);
  }
  return stale.length;
}
