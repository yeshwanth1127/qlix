import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Platform-wide research credential wiring for cloud runners.
 *
 * Driven by the shared registry at sdk/python/qlix/research_sources.json — the
 * SAME file the Python runner reads (qlix/research_sources.py). Adding a research
 * source is a one-line registry change: this module bind-mounts whichever secret
 * files exist on the host and forwards the declared env vars into every runner.
 */

/** Legacy export kept for callers that referenced the YouTube cookie path constant. */
export const PLATFORM_YOUTUBE_COOKIES_CONTAINER_PATH = '/run/platform/youtube-cookies.txt';

interface RegistrySecretFile {
  filename?: string;
  container_path?: string;
  /** Env var that overrides the host path (e.g. QLIX_PLATFORM_YOUTUBE_COOKIES_PATH). */
  host_path_env?: string;
  /** Env var set in the container pointing at the credential (yt-dlp style). */
  env_var?: string;
}

interface RegistrySource {
  id?: string;
  secret_file?: RegistrySecretFile;
  passthrough_env?: string[];
}

interface ResearchRegistry {
  sources?: RegistrySource[];
  global_passthrough_env?: string[];
}

export interface ResearchMount {
  hostPath: string;
  containerPath: string;
  readOnly: boolean;
}

export interface ResearchProvisioning {
  mounts: ResearchMount[];
  env: Record<string, string>;
}

/** Safety-net registry covering the sources that already worked (file resolution stays graceful). */
const FALLBACK_REGISTRY: ResearchRegistry = {
  global_passthrough_env: ['AGENT_REACH_PROXY'],
  sources: [
    {
      id: 'youtube',
      secret_file: {
        filename: 'youtube-cookies.txt',
        container_path: PLATFORM_YOUTUBE_COOKIES_CONTAINER_PATH,
        host_path_env: 'QLIX_PLATFORM_YOUTUBE_COOKIES_PATH',
        env_var: 'YT_DLP_COOKIES_FILE',
      },
    },
    { id: 'twitter', passthrough_env: ['AGENT_REACH_TWITTER_AUTH_TOKEN', 'AGENT_REACH_TWITTER_CT0'] },
  ],
};

function registryCandidatePaths(): string[] {
  const override = process.env.QLIX_RESEARCH_SOURCES_FILE?.trim();
  const repoRoot = path.resolve(process.cwd(), '..');
  return [
    ...(override ? [override] : []),
    path.join(repoRoot, 'sdk', 'python', 'qlix', 'research_sources.json'),
    path.resolve(process.cwd(), 'sdk', 'python', 'qlix', 'research_sources.json'),
  ];
}

let _registry: ResearchRegistry | null = null;

function loadRegistry(): ResearchRegistry {
  if (_registry) return _registry;
  for (const candidate of registryCandidatePaths()) {
    try {
      const parsed = JSON.parse(readFileSync(candidate, 'utf8')) as ResearchRegistry;
      if (parsed && Array.isArray(parsed.sources)) {
        _registry = parsed;
        return _registry;
      }
    } catch {
      // try next candidate
    }
  }
  // eslint-disable-next-line no-console
  console.warn('[research] research_sources.json not found; using built-in fallback registry');
  _registry = FALLBACK_REGISTRY;
  return _registry;
}

function dockerSshTarget(): string | null {
  const host = process.env.DOCKER_HOST?.trim();
  if (!host?.startsWith('ssh://')) return null;
  return host.slice('ssh://'.length);
}

export function platformResearchSecretsRoot(): string {
  const fromEnv = process.env.QLIX_PLATFORM_RESEARCH_SECRETS_DIR?.trim();
  if (fromEnv) return fromEnv;
  return path.resolve(process.cwd(), '..', 'secrets');
}

/** Host path for a source's secret file, honouring any per-source override env var. */
function secretHostPath(secret: RegistrySecretFile): string | null {
  if (secret.host_path_env) {
    const explicit = process.env[secret.host_path_env]?.trim();
    if (explicit) return path.resolve(explicit);
  }
  if (!secret.filename) return null;
  return path.join(platformResearchSecretsRoot(), secret.filename);
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * When DOCKER_HOST=ssh://…, bind-mount paths must exist on the remote daemon
 * host. rsync the local secret there and return the remote path Docker should use.
 */
async function resolveMountHostPath(localPath: string, filename: string): Promise<string> {
  const sshTarget = dockerSshTarget();
  if (!sshTarget) return localPath;

  const remoteRoot =
    process.env.QLIX_PLATFORM_RESEARCH_SECRETS_DIR?.trim() || '/var/www/qlix/secrets';
  const remotePath = path.join(remoteRoot, filename);
  await execFileAsync('ssh', [sshTarget, `mkdir -p ${remoteRoot}`], { timeout: 60_000 });
  await execFileAsync('rsync', ['-az', localPath, `${sshTarget}:${remotePath}`], {
    timeout: 120_000,
    maxBuffer: 10 * 1024 * 1024,
  });
  return remotePath;
}

function passthroughEnvKeys(registry: ResearchRegistry): string[] {
  const keys = new Set<string>(registry.global_passthrough_env ?? []);
  for (const source of registry.sources ?? []) {
    for (const key of source.passthrough_env ?? []) keys.add(key);
  }
  return [...keys];
}

/**
 * Resolve every research secret mount + env var to inject into a cloud runner,
 * from the shared registry. File sources are bind-mounted read-only when their
 * host file exists; env sources are forwarded from the backend process env.
 */
export async function resolvePlatformResearchProvisioning(): Promise<ResearchProvisioning> {
  const registry = loadRegistry();
  const env: Record<string, string> = {};
  const mounts: ResearchMount[] = [];

  for (const key of passthroughEnvKeys(registry)) {
    const value = process.env[key]?.trim();
    if (!value) continue;
    // Skip the documented placeholder proxy value from .env.example.
    if (key === 'AGENT_REACH_PROXY' && value.includes('your-residential-proxy')) continue;
    env[key] = value;
  }

  for (const source of registry.sources ?? []) {
    const secret = source.secret_file;
    if (!secret?.container_path) continue;
    const hostPath = secretHostPath(secret);
    if (!hostPath || !(await fileExists(hostPath))) continue;

    const filename = secret.filename ?? path.basename(secret.container_path);
    const mountHost = await resolveMountHostPath(hostPath, filename);
    mounts.push({ hostPath: mountHost, containerPath: secret.container_path, readOnly: true });
    if (secret.env_var) env[secret.env_var] = secret.container_path;
  }

  return { mounts, env };
}

/** Read the configured registry sources (id + secret filename) for diagnostics/tests. */
export async function platformResearchRegistrySummary(): Promise<
  { id: string; filename: string | null; hostExists: boolean }[]
> {
  const registry = loadRegistry();
  const out: { id: string; filename: string | null; hostExists: boolean }[] = [];
  for (const source of registry.sources ?? []) {
    const secret = source.secret_file;
    if (!secret) {
      out.push({ id: source.id ?? '', filename: null, hostExists: false });
      continue;
    }
    const hostPath = secretHostPath(secret);
    out.push({
      id: source.id ?? '',
      filename: secret.filename ?? null,
      hostExists: hostPath ? await fileExists(hostPath).catch(() => false) : false,
    });
  }
  return out;
}
