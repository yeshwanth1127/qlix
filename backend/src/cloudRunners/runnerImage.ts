import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { RunnerOrchestrator } from './runnerOrchestrator.js';

export const RUNNER_DOCKERFILE_REV = 'shared-base-3';

const RUNNER_FINGERPRINT_REL_PATHS = [
  'sdk/python/qlix/cloud_runner.py',
  'sdk/python/qlix/runner_common.py',
  'sdk/python/qlix/subagents.py',
  'sdk/python/qlix/tool_router.py',
  'sdk/python/qlix/backend_inference_client.py',
  'sdk/python/qlix/http_client.py',
  'sdk/python/qlix/cloud_browser_runtime.py',
  'sdk/python/qlix/cloud_email_runtime.py',
  'sdk/python/qlix/cloud_google_workspace_runtime.py',
  'sdk/python/qlix/cloud_crm_runtime.py',
  'sdk/python/qlix/cloud_slack_runtime.py',
  'sdk/python/qlix/cloud_notion_runtime.py',
  'sdk/python/qlix/cloud_whatsapp_runtime.py',
  'sdk/python/qlix/jit.py',
  'sdk/python/qlix/cloud_research_runtime.py',
  'sdk/python/qlix/cloud_document_runtime.py',
  'sdk/python/qlix/pdf_render.py',
  'sdk/python/docker/cloud-runner/Dockerfile',
];

export function runnerBaseImageRepository(): string {
  const fromEnv = process.env.QLIX_CLOUD_RUNNER_IMAGE?.trim();
  if (fromEnv) {
    const colon = fromEnv.lastIndexOf(':');
    return colon > 0 ? fromEnv.slice(0, colon) : fromEnv;
  }
  return 'qlix-cloud-runner';
}

export function repoRootAbsPath(): string {
  return path.resolve(process.cwd(), '..');
}

export function runnerDockerfileAbsPath(): string {
  return path.join(repoRootAbsPath(), 'sdk', 'python', 'docker', 'cloud-runner', 'Dockerfile');
}

function shouldAlwaysBuildRunnerImage(): boolean {
  return process.env.QLIX_CLOUD_RUNNER_ALWAYS_BUILD?.trim() === 'true';
}

/** Fingerprint of SDK + runner Dockerfile — rebuild shared image when this changes. */
export async function computeRunnerSdkHash(): Promise<string> {
  const repoRoot = repoRootAbsPath();
  const h = createHash('sha256');
  for (const rel of RUNNER_FINGERPRINT_REL_PATHS) {
    try {
      h.update(await readFile(path.join(repoRoot, rel), 'utf8'));
    } catch {
      // dev layout may differ; omit if missing
    }
  }
  return h.digest('hex').slice(0, 16);
}

export function sharedRunnerImageRef(sdkHash: string): string {
  return `${runnerBaseImageRepository()}:${sdkHash}-${RUNNER_DOCKERFILE_REV}`;
}

let sharedImageBuild: Promise<string> | null = null;
let sharedImageBuildHash: string | null = null;

/**
 * Build (or reuse) one shared runner image for all cloud agents.
 * Per-agent ADK manifests are bind-mounted at container start — not baked into the image.
 */
export async function ensureSharedRunnerImage(orchestrator: RunnerOrchestrator): Promise<string> {
  const sdkHash = await computeRunnerSdkHash();
  if (sharedImageBuild && sharedImageBuildHash === sdkHash) return sharedImageBuild;

  sharedImageBuildHash = sdkHash;
  sharedImageBuild = (async () => {
    await orchestrator.ensureAvailable();
    const imageRef = sharedRunnerImageRef(sdkHash);
    const exists = await orchestrator.imageExists(imageRef);
    if (!exists || shouldAlwaysBuildRunnerImage()) {
      await orchestrator.buildImage({
        imageRef,
        dockerfilePath: runnerDockerfileAbsPath(),
        contextPath: repoRootAbsPath(),
      });
    }
    return imageRef;
  })();

  try {
    return await sharedImageBuild;
  } catch (err) {
    sharedImageBuild = null;
    sharedImageBuildHash = null;
    throw err;
  }
}
