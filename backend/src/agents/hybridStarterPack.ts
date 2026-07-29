import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PassThrough } from 'node:stream';
import archiver from 'archiver';

import { ensureHybridAgentJsonBackendUrl, sdkAgentFolderName } from './sdkAgentFile.js';

export type HybridStarterPlatform = 'windows' | 'macos' | 'linux';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STARTER_TEMPLATES_DIR = join(__dirname, '../../assets/hybrid-starter/templates');
const WHEEL_PATH = join(__dirname, '../../assets/hybrid-starter/qlix-0.1.0-py3-none-any.whl');

const LAUNCHER_BY_PLATFORM: Record<HybridStarterPlatform, string> = {
  windows: 'Start Qlix Agent.bat',
  macos: 'Start Qlix Agent.command',
  linux: 'Start Qlix Agent.sh',
};

export function hybridStarterPackFilename(agentName: string, platform: HybridStarterPlatform): string {
  const slug = sdkAgentFolderName(agentName);
  return `${slug}-starter-pack-${platform}.zip`;
}

/** Infer OS from browser / API client User-Agent when the client does not send platform. */
export function detectHybridPlatformFromUserAgent(userAgent: string | undefined): HybridStarterPlatform {
  const ua = (userAgent ?? '').toLowerCase();
  if (ua.includes('windows')) return 'windows';
  if (ua.includes('macintosh') || ua.includes('mac os')) return 'macos';
  if (ua.includes('linux') && !ua.includes('android')) return 'linux';
  return 'windows';
}

export function resolveHybridStarterPlatform(
  clientPlatform: string | undefined,
  userAgent: string | undefined,
): HybridStarterPlatform {
  if (clientPlatform === 'windows' || clientPlatform === 'macos' || clientPlatform === 'linux') {
    return clientPlatform;
  }
  return detectHybridPlatformFromUserAgent(userAgent);
}

/**
 * Zip for end users: agent.json, README, one OS launcher, optional qlix wheel.
 */
export async function buildHybridStarterPackZip(
  agentJson: Record<string, unknown>,
  _agentName: string,
  platform: HybridStarterPlatform,
  request?: { protocol?: string; get(name: string): string | undefined },
): Promise<Buffer> {
  const launcherName = LAUNCHER_BY_PLATFORM[platform];
  const packedJson = ensureHybridAgentJsonBackendUrl(agentJson, request);

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const archive = archiver('zip', { zlib: { level: 9 } });
    const out = new PassThrough();

    out.on('data', (chunk: Buffer) => chunks.push(chunk));
    out.on('end', () => resolve(Buffer.concat(chunks)));
    out.on('error', reject);
    archive.on('error', reject);

    archive.pipe(out);

    archive.append(JSON.stringify(packedJson, null, 2) + '\n', { name: 'agent.json' });

    const readmePath = join(STARTER_TEMPLATES_DIR, 'README.txt');
    if (existsSync(readmePath)) {
      archive.file(readmePath, { name: 'README.txt' });
    }

    const launcherPath = join(STARTER_TEMPLATES_DIR, launcherName);
    if (existsSync(launcherPath)) {
      if (launcherName.endsWith('.command') || launcherName.endsWith('.sh')) {
        archive.append(readFileSync(launcherPath), { name: launcherName, mode: 0o755 });
      } else {
        archive.file(launcherPath, { name: launcherName });
      }
    }

    if (existsSync(WHEEL_PATH)) {
      archive.append(createReadStream(WHEEL_PATH), { name: 'qlix-0.1.0-py3-none-any.whl' });
    }

    void archive.finalize();
  });
}
