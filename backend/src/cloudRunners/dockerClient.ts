import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export class DockerNotAvailableError extends Error {
  constructor(message = 'Docker is required to provision cloud agents (docker not found or not running)') {
    super(message);
  }
}

async function runDocker(args: string[], opts?: { timeoutMs?: number }): Promise<string> {
  try {
    const { stdout } = await execFileAsync('docker', args, {
      timeout: opts?.timeoutMs ?? 60_000,
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
    });
    return String(stdout ?? '').trim();
  } catch (err: any) {
    const msg = typeof err?.message === 'string' ? err.message : 'docker command failed';
    throw new DockerNotAvailableError(msg);
  }
}

export async function dockerIsAvailable(): Promise<boolean> {
  try {
    await runDocker(['version'], { timeoutMs: 10_000 });
    return true;
  } catch {
    return false;
  }
}

export async function dockerImageExists(imageRef: string): Promise<boolean> {
  try {
    await runDocker(['image', 'inspect', imageRef], { timeoutMs: 15_000 });
    return true;
  } catch {
    return false;
  }
}

export async function dockerBuildImage(params: {
  imageRef: string;
  dockerfilePath: string;
  contextPath: string;
}): Promise<void> {
  await runDocker(['build', '-t', params.imageRef, '-f', params.dockerfilePath, params.contextPath], {
    timeoutMs: 20 * 60_000,
  });
}

export async function dockerRemoveContainerIfExists(containerName: string): Promise<void> {
  try {
    await runDocker(['rm', '-f', containerName], { timeoutMs: 30_000 });
  } catch {
    // ignore
  }
}

export async function dockerEnsureNetwork(networkName: string): Promise<void> {
  try {
    await runDocker(['network', 'inspect', networkName], { timeoutMs: 15_000 });
    return;
  } catch {
    // Another provision may have created the network concurrently.
    try {
      await runDocker(['network', 'create', networkName], { timeoutMs: 30_000 });
    } catch {
      await runDocker(['network', 'inspect', networkName], { timeoutMs: 15_000 });
    }
  }
}

export async function dockerRunDetached(params: {
  name: string;
  imageRef: string;
  env?: Record<string, string>;
  labels?: Record<string, string>;
  network?: string;
  mounts?: Array<{ hostPath: string; containerPath: string; readOnly?: boolean }>;
  cmd?: string[];
  /** Hard RAM ceiling, e.g. "1g" — Docker `--memory`. OOM-kills the container if exceeded. */
  memoryLimit?: string;
  /** Soft RAM target, e.g. "512m" — Docker `--memory-reservation`. */
  memoryReservation?: string;
  /** CPU ceiling in cores, e.g. "1.5" — Docker `--cpus`. */
  cpuLimit?: string;
  /** Caps forkbomb-style runaway process growth — Docker `--pids-limit`. */
  pidsLimit?: string;
}): Promise<string> {
  const args: string[] = ['run', '-d', '--restart', 'unless-stopped', '--name', params.name];
  if (params.memoryLimit?.trim()) {
    args.push('--memory', params.memoryLimit.trim());
  }
  if (params.memoryReservation?.trim()) {
    args.push('--memory-reservation', params.memoryReservation.trim());
  }
  if (params.cpuLimit?.trim()) {
    args.push('--cpus', params.cpuLimit.trim());
  }
  if (params.pidsLimit?.trim()) {
    args.push('--pids-limit', params.pidsLimit.trim());
  }
  if (params.network?.trim()) {
    args.push('--network', params.network.trim());
  }
  for (const [k, v] of Object.entries(params.labels ?? {})) {
    args.push('--label', `${k}=${v}`);
  }
  for (const [k, v] of Object.entries(params.env ?? {})) {
    args.push('-e', `${k}=${v}`);
  }
  for (const m of params.mounts ?? []) {
    const ro = m.readOnly === false ? '' : ':ro';
    args.push('-v', `${m.hostPath}:${m.containerPath}${ro}`);
  }
  args.push(params.imageRef);
  if (params.cmd?.length) args.push(...params.cmd);
  return runDocker(args, { timeoutMs: 60_000 });
}

export async function dockerLogs(params: { name: string; tail?: number }): Promise<string> {
  const args = ['logs', '--tail', String(params.tail ?? 200), params.name];
  return runDocker(args, { timeoutMs: 30_000 });
}

export async function dockerListImages(filterRefPrefix?: string): Promise<string[]> {
  const args = ['images', '--format', '{{.Repository}}:{{.Tag}}'];
  if (filterRefPrefix?.trim()) {
    args.push('--filter', `reference=${filterRefPrefix.trim()}*`);
  }
  const raw = await runDocker(args, { timeoutMs: 30_000 });
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => line !== '<none>:<none>');
}

export async function dockerRemoveImageIfExists(imageRef: string): Promise<void> {
  try {
    await runDocker(['rmi', '-f', imageRef], { timeoutMs: 60_000 });
  } catch {
    // ignore
  }
}

