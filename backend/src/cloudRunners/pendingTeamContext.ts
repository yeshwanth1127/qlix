import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { DockerTeamContext } from './dockerNaming.js';

const PENDING_FILENAME = 'pending-team.json';

export async function writePendingTeamContext(
  stateRoot: string,
  agentId: string,
  team: DockerTeamContext,
): Promise<void> {
  const dir = path.join(stateRoot, agentId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, PENDING_FILENAME), JSON.stringify(team, null, 2) + '\n', 'utf8');
}

export async function readPendingTeamContext(
  stateRoot: string,
  agentId: string,
): Promise<DockerTeamContext | null> {
  try {
    const raw = await readFile(path.join(stateRoot, agentId, PENDING_FILENAME), 'utf8');
    const parsed = JSON.parse(raw) as DockerTeamContext;
    if (!parsed?.id || !parsed?.name || !parsed?.role) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function clearPendingTeamContext(stateRoot: string, agentId: string): Promise<void> {
  try {
    await unlink(path.join(stateRoot, agentId, PENDING_FILENAME));
  } catch {
    // ignore
  }
}
