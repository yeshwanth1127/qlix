import type { AgentDTO } from './agents.types.js';

export function sdkAgentFolderName(agentName: string): string {
  const trimmed = agentName.trim().replace(/\s+/g, '-');
  const cleaned = trimmed.replace(/[^a-zA-Z0-9._-]/g, '');
  const base = cleaned.length > 0 ? cleaned : 'agent';
  if (!/^[a-zA-Z0-9]/.test(base)) {
    return `agent-${base}`;
  }
  return base.slice(0, 128);
}

/**
 * Canonical agent.json body for the Python SDK (`parse_identity` / `load_identity`).
 * Uses snake_case keys; loader also accepts camelCase.
 */
export function buildSdkAgentJson(
  agent: AgentDTO,
  privateKeyHex: string,
  backendUrl: string,
): Record<string, unknown> {
  const url = backendUrl.replace(/\/$/, '');
  const pk = privateKeyHex.trim().toLowerCase();
  const pub = agent.publicKey.trim().toLowerCase();

  return {
    did: agent.did,
    agent_id: agent.id,
    private_key: pk,
    public_key: pub,
    permission_scopes: agent.permissionScopes,
    jit_scopes: agent.jitScopes,
    always_scopes: agent.alwaysScopes,
    llm_mode: agent.llmMode,
    backend_url: url,
    issued_at: new Date().toISOString(),
  };
}

/**
 * Hybrid agent.json — includes private key (like local) plus a one-time runner token
 * that the daemon uses to authenticate against the run poll / heartbeat endpoints.
 * The runner_token is only returned once at creation; it is never stored in plaintext.
 */
export function buildSdkAgentJsonHybrid(
  agent: AgentDTO,
  privateKeyHex: string,
  runnerToken: string,
  backendUrl: string,
): Record<string, unknown> {
  return {
    ...buildSdkAgentJson(agent, privateKeyHex, backendUrl),
    runner_token: runnerToken,
    runtime: 'hybrid',
  };
}

/** Cloud agents do not download signing keys to the browser; this is a safe public identity file. */
export function buildSdkAgentJsonPublic(agent: AgentDTO, backendUrl: string): Record<string, unknown> {
  const url = backendUrl.replace(/\/$/, '');
  const pub = agent.publicKey.trim().toLowerCase();
  return {
    did: agent.did,
    agent_id: agent.id,
    public_key: pub,
    permission_scopes: agent.permissionScopes,
    jit_scopes: agent.jitScopes,
    always_scopes: agent.alwaysScopes,
    llm_mode: agent.llmMode,
    backend_url: url,
    issued_at: new Date().toISOString(),
  };
}

function isDockerInternalBackendUrl(url: string): boolean {
  return /host\.docker\.internal/i.test(url);
}

function rewriteDockerInternalUrl(url: string): string {
  if (!isDockerInternalBackendUrl(url)) return url.replace(/\/$/, '');
  try {
    const u = new URL(url);
    u.hostname = 'localhost';
    return u.toString().replace(/\/$/, '');
  } catch {
    return url.replace(/host\.docker\.internal/gi, 'localhost').replace(/\/$/, '');
  }
}

/** Resolve the API base URL clients should put in agent.json (for SDK HTTP calls). */
export function resolvePublicBackendUrl(request: { protocol?: string; get(name: string): string | undefined }): string {
  const fromEnv = process.env.PUBLIC_API_URL?.trim();
  if (fromEnv) {
    return fromEnv.replace(/\/$/, '');
  }
  const xfProto = request.get('x-forwarded-proto');
  const proto = (xfProto || request.protocol || 'http').replace(/:$/, '');
  const host = request.get('x-forwarded-host') || request.get('host') || 'localhost:8080';
  return `${proto}://${host}`.replace(/\/$/, '');
}

/**
 * Backend URL baked into hybrid/local starter packs — runs on the user's machine, not in Docker.
 * Never use host.docker.internal here (that is for cloud containers only).
 */
export function resolveHybridRunnerBackendUrl(request: {
  protocol?: string;
  get(name: string): string | undefined;
}): string {
  const explicit =
    process.env.HYBRID_RUNNER_BACKEND_URL?.trim() || process.env.LOCAL_RUNNER_BACKEND_URL?.trim();
  if (explicit) {
    return rewriteDockerInternalUrl(explicit);
  }

  const publicEnv = process.env.PUBLIC_API_URL?.trim();
  if (publicEnv && !isDockerInternalBackendUrl(publicEnv)) {
    return publicEnv.replace(/\/$/, '');
  }

  const fromRequest = resolvePublicBackendUrl(request);
  if (!isDockerInternalBackendUrl(fromRequest)) {
    return fromRequest;
  }

  return rewriteDockerInternalUrl(fromRequest);
}

/**
 * Resolve the backend URL to bake into Docker container agent.json files.
 * Checks DOCKER_BACKEND_URL first so containers on Docker Desktop (Windows/Mac)
 * can reach the host via host.docker.internal without affecting SDK files
 * downloaded to user machines.
 */
export function resolveDockerBackendUrl(request: { protocol?: string; get(name: string): string | undefined }): string {
  const fromEnv = process.env.DOCKER_BACKEND_URL?.trim();
  if (fromEnv) {
    return fromEnv.replace(/\/$/, '');
  }
  return resolvePublicBackendUrl(request);
}

/** Instructions for storing credentials locally (env-based path; no fixed ~/.qlix). */
export interface SdkAgentPathsHint {
  envVarName: 'QLIX_AGENT_FILE';
  suggestedDownloadFilename: string;
  instructions: string;
  posixExample: string;
  windowsCmdExample: string;
  windowsPwshExample: string;
}

export function buildSdkAgentPathsHint(agentName: string): SdkAgentPathsHint {
  const slug = sdkAgentFolderName(agentName);
  const fn = `${slug}-agent.json`;
  return {
    envVarName: 'QLIX_AGENT_FILE',
    suggestedDownloadFilename: fn,
    instructions:
      'Save the downloaded JSON anywhere on your machine, then set QLIX_AGENT_FILE to its absolute path in your environment or .env file before running the SDK.',
    posixExample: `export QLIX_AGENT_FILE="/absolute/path/to/${fn}"`,
    windowsCmdExample: `set QLIX_AGENT_FILE=C:\\absolute\\path\\to\\${fn}`,
    windowsPwshExample: `$env:QLIX_AGENT_FILE="C:\\absolute\\path\\to\\${fn}"`,
  };
}

/*
 * Browser (Qlix console): after POST /api/v1/agents returns 201, offer a download button:
 *
 *   const blob = new Blob([JSON.stringify(body.sdkAgentFile, null, 2)], { type: 'application/json' });
 *   const a = document.createElement('a');
 *   a.href = URL.createObjectURL(blob);
 *   a.download = body.sdkAgentPaths.suggestedDownloadFilename;
 *   a.click();
 *   URL.revokeObjectURL(a.href);
 *
 * Show body.sdkAgentPaths.instructions and the env examples below the button.
 */
