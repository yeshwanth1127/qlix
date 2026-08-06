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

function isLoopbackUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return /\blocalhost\b|127\.0\.0\.1/i.test(url);
  }
}

function trimUrl(url: string): string {
  return url.replace(/\/$/, '');
}

/** True when a URL is unsuitable for hybrid starter packs (runs on the user's PC). */
function isUnusableHybridBackendUrl(url: string): boolean {
  return isDockerInternalBackendUrl(url) || isLoopbackUrl(url);
}

function rewriteDockerInternalUrl(url: string): string {
  if (!isDockerInternalBackendUrl(url)) return trimUrl(url);
  try {
    const u = new URL(url);
    u.hostname = 'localhost';
    return trimUrl(u.toString());
  } catch {
    return url.replace(/host\.docker\.internal/gi, 'localhost').replace(/\/$/, '');
  }
}

function rewriteLoopbackForDocker(url: string): string {
  const trimmed = trimUrl(url);
  if (!isLoopbackUrl(trimmed)) return trimmed;
  try {
    const parsed = new URL(trimmed);
    parsed.hostname = 'host.docker.internal';
    return trimUrl(parsed.toString());
  } catch {
    return trimmed
      .replace(/\blocalhost\b|127\.0\.0\.1|\[::1\]/gi, 'host.docker.internal')
      .replace(/\/$/, '');
  }
}

/** Resolve the API base URL clients should put in agent.json (for SDK HTTP calls). */
export function resolvePublicBackendUrl(request: { protocol?: string; get(name: string): string | undefined }): string {
  const fromEnv = process.env.PUBLIC_API_URL?.trim();
  if (fromEnv) {
    return trimUrl(fromEnv);
  }
  const xfProto = request.get('x-forwarded-proto');
  const proto = (xfProto || request.protocol || 'http').replace(/:$/, '');
  const host = request.get('x-forwarded-host') || request.get('host') || 'localhost:8080';
  return trimUrl(`${proto}://${host}`);
}

/**
 * Backend URL baked into hybrid/local starter packs — runs on the user's machine, not in Docker.
 * Prefers PUBLIC_API_URL (your public API origin) over loopback request headers.
 */
export function resolveHybridRunnerBackendUrl(request: {
  protocol?: string;
  get(name: string): string | undefined;
}): string {
  const isProd = process.env.NODE_ENV === 'production';
  const candidates = [
    process.env.PUBLIC_API_URL,
    process.env.HYBRID_RUNNER_BACKEND_URL,
    process.env.LOCAL_RUNNER_BACKEND_URL,
    process.env.FRONTEND_URL,
  ];

  for (const raw of candidates) {
    const c = raw?.trim();
    if (!c) continue;
    const url = trimUrl(c);
    if (isDockerInternalBackendUrl(url)) continue;
    if (isProd && isLoopbackUrl(url)) continue;
    return url;
  }

  const xfProto = request.get('x-forwarded-proto');
  const proto = (xfProto || request.protocol || 'https').replace(/:$/, '');
  const host = request.get('x-forwarded-host') || request.get('host');
  if (host) {
    const fromRequest = trimUrl(`${proto}://${host}`);
    if (!isDockerInternalBackendUrl(fromRequest) && !(isProd && isLoopbackUrl(fromRequest))) {
      return fromRequest;
    }
  }

  if (!isProd) {
    for (const raw of [process.env.HYBRID_RUNNER_BACKEND_URL, process.env.LOCAL_RUNNER_BACKEND_URL]) {
      const c = raw?.trim();
      if (c) return rewriteDockerInternalUrl(c);
    }
    return 'http://localhost:4000';
  }

  const publicEnv = process.env.PUBLIC_API_URL?.trim();
  if (publicEnv) {
    return trimUrl(publicEnv);
  }

  throw new Error(
    'Cannot resolve hybrid runner backend URL — set PUBLIC_API_URL to your public API origin (e.g. https://qlix.exora.solutions)',
  );
}

/**
 * Last-chance guard before writing agent.json into a hybrid starter ZIP.
 * Re-resolves when the baked URL is loopback or docker-internal.
 */
export function ensureHybridAgentJsonBackendUrl(
  agentJson: Record<string, unknown>,
  request?: { protocol?: string; get(name: string): string | undefined },
): Record<string, unknown> {
  const current = typeof agentJson.backend_url === 'string' ? agentJson.backend_url : '';
  if (current && !isUnusableHybridBackendUrl(current)) {
    return agentJson;
  }
  const resolved = resolveHybridRunnerBackendUrl(
    request ?? { protocol: 'https', get: () => undefined },
  );
  if (resolved !== current) {
    console.warn(
      '[hybridStarterPack] backend_url %s → %s',
      current || '(missing)',
      resolved,
    );
  }
  return { ...agentJson, backend_url: resolved };
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
    return rewriteLoopbackForDocker(fromEnv);
  }
  return rewriteLoopbackForDocker(resolvePublicBackendUrl(request));
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
