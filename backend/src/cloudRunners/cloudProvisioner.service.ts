import { mkdir, readFile, writeFile } from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import type { AgentDTO } from '../agents/agents.types.js';
import { buildSdkAgentJson, resolveDockerBackendUrl } from '../agents/sdkAgentFile.js';
import { AgentsRepository } from '../agents/agents.repository.js';
import { decryptForAgentSecrets, encryptForAgentSecrets } from './agentSecrets.js';
import { prisma } from '../lib/prisma.js';
import {
  DockerNotAvailableError,
} from './dockerClient.js';
import { DockerRunnerOrchestrator, type RunnerOrchestrator } from './runnerOrchestrator.js';
import {
  type DockerAgentIdentity,
  type DockerTeamContext,
  dockerContainerName,
  dockerImageListPrefix,
  dockerImageRef,
  dockerTeamContainerName,
  dockerTeamNetworkName,
  legacyDockerContainerName,
  mergeDockerLabels,
} from './dockerNaming.js';

export class CloudProvisionFailedError extends Error {
  constructor(message = 'Cloud runner provisioning failed') {
    super(message);
  }
}

function safeProvisioningErrorMessage(input: unknown): string {
  const raw = String((input as any)?.message ?? input ?? 'Cloud runner provisioning failed');
  // Keep this UI-safe: trim + cap length, avoid dumping megabytes of logs.
  return raw.length > 2000 ? `${raw.slice(0, 2000)}…(truncated)` : raw;
}

function runnerBaseImageRef(): string {
  return process.env.QLIX_CLOUD_RUNNER_IMAGE?.trim() || 'qlix-cloud-runner:dev';
}

function runnerDockerfileAbsPath(): string {
  // Default: repo ships the Dockerfile under sdk/python.
  const repoRoot = path.resolve(process.cwd(), '..');
  return path.join(repoRoot, 'sdk', 'python', 'docker', 'cloud-runner', 'Dockerfile');
}

function repoRootAbsPath(): string {
  const repoRoot = path.resolve(process.cwd(), '..');
  return repoRoot;
}

function shouldAlwaysBuildRunnerImage(): boolean {
  return process.env.QLIX_CLOUD_RUNNER_ALWAYS_BUILD?.trim() === 'true';
}

function randomRunnerToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export class CloudProvisionerService {
  constructor(
    private readonly repo: AgentsRepository = new AgentsRepository(),
    private readonly orchestrator: RunnerOrchestrator = new DockerRunnerOrchestrator(),
  ) {}

  private async ensureRunnerImageAvailable(): Promise<void> {
    await this.orchestrator.ensureAvailable();
    if (shouldAlwaysBuildRunnerImage()) {
      await this.orchestrator.buildImage({
        imageRef: runnerBaseImageRef(),
        dockerfilePath: runnerDockerfileAbsPath(),
        contextPath: repoRootAbsPath(),
      });
    }
  }

  private runnerStateRoot(): string {
    return process.env.QLIX_CLOUD_RUNNER_STATE_DIR?.trim() || path.join(process.cwd(), '.qlix-runners');
  }

  private async createAdkArtifact(agent: AgentDTO): Promise<{
    adkDir: string;
    manifestPath: string;
    modulePath: string;
    versionHash: string;
  }> {
    const stateRoot = this.runnerStateRoot();
    const adkDir = path.join(stateRoot, agent.id, 'adk');
    await mkdir(adkDir, { recursive: true });
    const manifestPath = path.join(adkDir, 'manifest.json');
    const modulePath = path.join(adkDir, 'adk_agent.py');
    const manifest = {
      manifestVersion: '1',
      agentId: agent.id,
      did: agent.did,
      name: agent.name,
      model: agent.model,
      systemPrompt: agent.description?.trim()
        ? `You are ${agent.name}. ${agent.description.trim()}`
        : `You are ${agent.name}. Follow user intent safely and use tools when useful.`,
      permissionScopes: agent.permissionScopes,
      jitScopes: agent.jitScopes,
      alwaysScopes: agent.alwaysScopes,
      runtime: 'cloud',
      generatedAt: new Date().toISOString(),
    };
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    const modulePy = [
      'from __future__ import annotations',
      '',
      'import qlix',
      '',
      `@qlix.agent(`,
      `    name=${JSON.stringify(agent.name)},`,
      `    description=${JSON.stringify(`Cloud ADK for ${agent.name}`)},`,
      `    system_prompt=${JSON.stringify(manifest.systemPrompt)},`,
      `    model=${JSON.stringify(agent.model || '')},`,
      ')',
      'class CloudDeployedAgent:',
      '    @qlix.tool(scope="system.file_read", risk="low", description="Read current cloud agent manifest")',
      '    async def read_manifest(self) -> str:',
      '        with open("/run/adk/manifest.json", "r", encoding="utf-8") as fh:',
      '            return fh.read()',
      '',
    ].join('\n');
    await writeFile(modulePath, modulePy, 'utf8');
    const repoRoot = repoRootAbsPath();
    const runnerFingerprintPaths = [
      path.join(repoRoot, 'sdk', 'python', 'qlix', 'cloud_runner.py'),
      path.join(repoRoot, 'sdk', 'python', 'qlix', 'backend_inference_client.py'),
      path.join(repoRoot, 'sdk', 'python', 'qlix', 'http_client.py'),
      path.join(repoRoot, 'sdk', 'python', 'qlix', 'cloud_browser_runtime.py'),
      path.join(repoRoot, 'sdk', 'python', 'qlix', 'cloud_email_runtime.py'),
    ];
    const h = crypto.createHash('sha256');
    h.update(await readFile(manifestPath, 'utf8'));
    h.update(await readFile(modulePath, 'utf8'));
    for (const fp of runnerFingerprintPaths) {
      try {
        h.update(await readFile(fp, 'utf8'));
      } catch {
        // dev layout may differ; omit if missing
      }
    }
    const versionHash = h.digest('hex').slice(0, 16);
    return { adkDir, manifestPath, modulePath, versionHash };
  }

  private async buildPerAgentImage(agent: DockerAgentIdentity, versionHash: string): Promise<string> {
    const imageRef = dockerImageRef(agent, versionHash);
    const stateRoot = this.runnerStateRoot();
    const agentRoot = path.join(stateRoot, agent.id);
    const dockerfilePath = path.join(agentRoot, 'Dockerfile');
    const repoRoot = repoRootAbsPath();
    const dockerfile = [
      'FROM python:3.12-slim',
      '',
      'ARG AGENT_BROWSER_VERSION=0.9.4',
      'ARG NODE_VERSION=22.16.0',
      '',
      'ENV PYTHONDONTWRITEBYTECODE=1 \\',
      '    PYTHONUNBUFFERED=1 \\',
      '    LUNA_BROWSER_HEADLESS=1 \\',
      '    LUNA_BROWSER_ENGINE=agent_browser \\',
      '    AGENT_BROWSER_BIN=/usr/local/bin/agent-browser \\',
      '    AGENT_BROWSER_SOCKET_DIR=/tmp/agent-browser',
      '',
      'WORKDIR /app',
      'RUN apt-get update && apt-get install -y --no-install-recommends \\',
      '    ca-certificates curl xz-utils \\',
      '    && rm -rf /var/lib/apt/lists/*',
      '',
      'RUN set -eux; \\',
      '    arch="$(uname -m)"; \\',
      '    case "${arch}" in \\',
      '      x86_64) node_arch="x64" ;; \\',
      '      aarch64) node_arch="arm64" ;; \\',
      '      *) echo "unsupported arch: ${arch}"; exit 1 ;; \\',
      '    esac; \\',
      '    curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${node_arch}.tar.xz" \\',
      '      | tar -xJ -C /usr/local --strip-components=1',
      '',
      'RUN npm install -g "agent-browser@${AGENT_BROWSER_VERSION}" \\',
      '    && npx --yes playwright install-deps chromium \\',
      '    && npx --yes playwright install chromium \\',
      '    && mkdir -p /tmp/agent-browser \\',
      '    && AGENT_BROWSER_SESSION=image-warmup AGENT_BROWSER_SOCKET_DIR=/tmp/agent-browser \\',
      '       agent-browser --json open about:blank \\',
      '    && agent-browser --json close',
      'COPY sdk/python /app/sdk/python',
      'RUN pip install --no-cache-dir -e "/app/sdk/python"',
      `COPY backend/.qlix-runners/${agent.id}/adk /app/adk`,
      'CMD ["python", "-m", "qlix.cloud_runner"]',
      '',
    ].join('\n');
    await writeFile(dockerfilePath, dockerfile, 'utf8');
    const imagePrefix = dockerImageListPrefix(agent);
    const all = await this.orchestrator.listImages(imagePrefix);
    const exists = all.includes(imageRef);
    if (!exists || shouldAlwaysBuildRunnerImage()) {
      await this.orchestrator.buildImage({
        imageRef,
        dockerfilePath,
        contextPath: repoRoot,
      });
    }
    const afterBuild = await this.orchestrator.listImages(imagePrefix);
    for (const ref of afterBuild) {
      if (ref !== imageRef) {
        await this.orchestrator.removeImageIfExists(ref);
      }
    }
    return imageRef;
  }

  private async startContainer(params: {
    agent: DockerAgentIdentity;
    backendUrl: string;
    identityJson: Record<string, unknown>;
    runnerToken: string;
    adkManifestPath: string;
    adkModulePath: string;
    adkClassName: string;
    imageRef: string;
    teamContext?: DockerTeamContext | null;
  }): Promise<string> {
    await this.ensureRunnerImageAvailable();

    // Use a persistent host path per agent so Docker Desktop binds stay valid
    // after container start (temp files can disappear and break /run/agent.json).
    const runnerStateRoot = this.runnerStateRoot();
    const dir = path.join(runnerStateRoot, params.agent.id);
    await mkdir(dir, { recursive: true });
    const identityPath = path.join(dir, 'agent.json');
    await writeFile(identityPath, JSON.stringify(params.identityJson, null, 2) + '\n', 'utf8');

    const containerName = params.teamContext
      ? dockerTeamContainerName(params.agent, params.teamContext)
      : dockerContainerName(params.agent);
    await this.orchestrator.removeContainerIfExists(legacyDockerContainerName(params.agent.id));
    await this.orchestrator.removeContainerIfExists(containerName);
    await this.orchestrator.removeContainerIfExists(dockerContainerName(params.agent));
    if (params.teamContext) {
      await this.orchestrator.removeContainerIfExists(
        dockerTeamContainerName(params.agent, params.teamContext),
      );
    }

    let network: string | undefined;
    if (params.teamContext) {
      network = dockerTeamNetworkName(params.teamContext.id);
      await this.orchestrator.ensureNetwork(network);
    }

    const runnerId = await this.orchestrator.runContainer({
      name: containerName,
      imageRef: params.imageRef,
      labels: mergeDockerLabels(params.agent, params.teamContext),
      network,
      env: {
        QLIX_AGENT_FILE: '/run/agent.json',
        QLIX_BACKEND_URL: params.backendUrl,
        QLIX_CLOUD_PING_INTERVAL_MS: process.env.QLIX_CLOUD_PING_INTERVAL_MS?.trim() || '5000',
        QLIX_RUNNER_TOKEN: params.runnerToken,
        QLIX_ADK_MANIFEST: '/run/adk/manifest.json',
        QLIX_ADK_MODULE: '/run/adk/adk_agent.py',
        QLIX_ADK_CLASS: params.adkClassName,
      },
      mounts: [
        { hostPath: identityPath, containerPath: '/run/agent.json', readOnly: true },
        { hostPath: params.adkManifestPath, containerPath: '/run/adk/manifest.json', readOnly: true },
        { hostPath: params.adkModulePath, containerPath: '/run/adk/adk_agent.py', readOnly: true },
      ],
      cmd: ['python', '-m', 'qlix.cloud_runner'],
    });
    return runnerId || containerName;
  }

  /**
   * Provision (docker-local) cloud runner for a just-created cloud agent.
   * Stores encrypted private key and runner metadata on the agent row.
   */
  async provisionCloudRunner(params: {
    agent: AgentDTO;
    privateKey: string;
    requestForBackendUrl: { protocol?: string; get(name: string): string | undefined };
  }): Promise<void> {
    const { agent } = params;
    if (agent.runtime !== 'cloud') return;

    const backendUrl = resolveDockerBackendUrl(params.requestForBackendUrl);
    const identity = buildSdkAgentJson(agent, params.privateKey, backendUrl);
    const adk = await this.createAdkArtifact(agent);
    const imageRef = await this.buildPerAgentImage(agent, adk.versionHash);

    // Encrypt private key for at-rest storage (cloud agents only).
    const enc = encryptForAgentSecrets(params.privateKey);
    // Runner token for agent<->backend polling/logging.
    const runnerToken = randomRunnerToken();
    const runnerTokenEnc = encryptForAgentSecrets(runnerToken);
    await this.repo.updateCloudFields(agent.id, {
      cloudPrivateKeyEnc: enc,
      cloudProvisioningStatus: 'provisioning',
      cloudProvisioningError: null,
      cloudRunnerTokenEnc: runnerTokenEnc,
    });

    try {
      const runnerId = await this.startContainer({
        agent,
        backendUrl,
        identityJson: identity,
        runnerToken,
        adkManifestPath: adk.manifestPath,
        adkModulePath: adk.modulePath,
        adkClassName: 'CloudDeployedAgent',
        imageRef,
      });
      await this.repo.updateCloudFields(agent.id, {
        cloudRunnerId: runnerId,
        cloudProvisioningStatus: 'provisioning',
        cloudProvisioningError: null,
      });
    } catch (err) {
      const logs = await this.orchestrator.logs(dockerContainerName(agent), 200).catch(() => '');
      await this.repo.updateCloudFields(agent.id, { cloudProvisioningStatus: 'failed' });
      throw new CloudProvisionFailedError(
        safeProvisioningErrorMessage(`${String((err as Error)?.message ?? err)}\n${logs}`.trim()),
      );
    }
  }

  /**
   * Returns immediately; provisioning continues in the background. Poll runtime-status for outcome.
   */
  scheduleRestartCloudRunner(params: { agentId: string; backendUrl: string }): void {
    // Defer until after the HTTP response is flushed (avoids client "Failed to fetch" on slow Docker work).
    setImmediate(() => {
      void this.restartCloudRunner(params).catch(async (err) => {
        const message =
          err instanceof CloudProvisionFailedError
            ? err.message
            : err instanceof DockerNotAvailableError
              ? err.message
              : err instanceof Error
                ? err.message
                : 'Cloud runner restart failed';
        console.warn('[cloudRestart]', params.agentId, message);
        await this.repo
          .updateCloudFields(params.agentId, {
            cloudProvisioningStatus: 'failed',
            cloudProvisioningError: safeProvisioningErrorMessage(message),
          })
          .catch(() => {});
      });
    });
  }

  async restartCloudRunner(params: { agentId: string; backendUrl: string }): Promise<void> {
    const row = await prisma.agent.findUnique({
      where: { id: params.agentId },
      select: {
        id: true,
        name: true,
        did: true,
        publicKey: true,
        llmMode: true,
        permissionScopes: true,
        jitScopes: true,
        alwaysScopes: true,
        runtime: true,
        cloudPrivateKeyEnc: true,
        agentKind: true,
      },
    });
    if (!row || row.runtime !== 'cloud') {
      throw new CloudProvisionFailedError('Agent not found or not cloud runtime');
    }
    if (!row.cloudPrivateKeyEnc) {
      throw new CloudProvisionFailedError('Missing cloudPrivateKeyEnc for this agent (recreate agent)');
    }

    const backendUrl = params.backendUrl.replace(/\/$/, '');
    const privateKey = decryptForAgentSecrets(row.cloudPrivateKeyEnc);
    const runnerTokenEnc = await prisma.agent
      .findUnique({ where: { id: row.id }, select: { cloudRunnerTokenEnc: true } })
      .then((r) => r?.cloudRunnerTokenEnc ?? null);
    const runnerToken =
      runnerTokenEnc != null
        ? decryptForAgentSecrets(runnerTokenEnc)
        : (() => {
            const t = randomRunnerToken();
            const enc = encryptForAgentSecrets(t);
            // Backfill token so future restarts work.
            void this.repo.updateCloudFields(row.id, { cloudRunnerTokenEnc: enc }).catch(() => {});
            return t;
          })();
    const agentDto: AgentDTO = {
      id: row.id,
      userId: '',
      orgId: null,
      did: row.did,
      publicKey: row.publicKey,
      name: row.name,
      status: 'active',
      runtime: 'cloud',
      model: '',
      localInferenceMode: null,
      llmMode: row.llmMode as any,
      permissionScopes: row.permissionScopes as any,
      jitScopes: row.jitScopes as any,
      alwaysScopes: row.alwaysScopes as any,
      description: (row as any).description ?? null,
      webauthnCredentialId: null,
      keypairDeliveredAt: null,
      lastConnectedAt: null,
      lastActive: null,
      createdAt: new Date().toISOString(),
      cloudProvisioningStatus: null,
      cloudRunnerId: null,
      cloudLastHeartbeatAt: null,
      cloudProvisioningError: null,
      agentKind: ((row.agentKind as AgentDTO['agentKind']) ?? 'standard'),
    };
    const identity = buildSdkAgentJson(agentDto, privateKey, backendUrl);
    const adk = await this.createAdkArtifact(agentDto);
    const agentIdentity: DockerAgentIdentity = { id: row.id, name: row.name, did: row.did };
    const imageRef = await this.buildPerAgentImage(agentIdentity, adk.versionHash);

    await this.repo.updateCloudFields(row.id, { cloudProvisioningStatus: 'provisioning' });
    try {
      const runnerId = await this.startContainer({
        agent: agentIdentity,
        backendUrl,
        identityJson: identity,
        runnerToken,
        adkManifestPath: adk.manifestPath,
        adkModulePath: adk.modulePath,
        adkClassName: 'CloudDeployedAgent',
        imageRef,
      });
      await this.repo.updateCloudFields(row.id, {
        cloudRunnerId: runnerId,
        cloudProvisioningStatus: 'provisioning',
        cloudProvisioningError: null,
      });
    } catch (err) {
      const logs = await this.orchestrator.logs(dockerContainerName(agentIdentity), 200).catch(() => '');
      const message = safeProvisioningErrorMessage(`${String((err as Error)?.message ?? err)}\n${logs}`.trim());
      await this.repo.updateCloudFields(row.id, { cloudProvisioningStatus: 'failed', cloudProvisioningError: message });
      throw new CloudProvisionFailedError(message);
    }
  }

  /**
   * Re-label and reconnect a cloud agent's runner to a team network (restarts container).
   */
  async applyTeamContext(params: {
    agentId: string;
    teamId: string;
    teamName: string;
    role: 'supervisor' | 'worker';
    backendUrl: string;
  }): Promise<void> {
    const row = await prisma.agent.findUnique({
      where: { id: params.agentId },
      select: { id: true, name: true, did: true, runtime: true, cloudPrivateKeyEnc: true },
    });
    if (!row || row.runtime !== 'cloud') {
      throw new CloudProvisionFailedError('Agent must be cloud runtime to join a team runner pool');
    }
    if (!row.cloudPrivateKeyEnc) {
      throw new CloudProvisionFailedError('Cloud agent missing secrets; recreate the agent');
    }

    const teamContext: DockerTeamContext = {
      id: params.teamId,
      name: params.teamName,
      role: params.role,
    };

    await this.restartCloudRunnerWithTeam({
      agentId: params.agentId,
      backendUrl: params.backendUrl,
      teamContext,
    });
  }

  private async restartCloudRunnerWithTeam(params: {
    agentId: string;
    backendUrl: string;
    teamContext: DockerTeamContext;
  }): Promise<void> {
    const row = await prisma.agent.findUnique({
      where: { id: params.agentId },
      select: {
        id: true,
        name: true,
        did: true,
        publicKey: true,
        llmMode: true,
        permissionScopes: true,
        jitScopes: true,
        alwaysScopes: true,
        runtime: true,
        cloudPrivateKeyEnc: true,
        agentKind: true,
      },
    });
    if (!row || row.runtime !== 'cloud' || !row.cloudPrivateKeyEnc) {
      throw new CloudProvisionFailedError('Agent not found or not cloud runtime');
    }

    const backendUrl = params.backendUrl.replace(/\/$/, '');
    const privateKey = decryptForAgentSecrets(row.cloudPrivateKeyEnc);
    const runnerTokenEnc = await prisma.agent
      .findUnique({ where: { id: row.id }, select: { cloudRunnerTokenEnc: true } })
      .then((r) => r?.cloudRunnerTokenEnc ?? null);
    const runnerToken =
      runnerTokenEnc != null
        ? decryptForAgentSecrets(runnerTokenEnc)
        : (() => {
            const t = randomRunnerToken();
            const enc = encryptForAgentSecrets(t);
            void this.repo.updateCloudFields(row.id, { cloudRunnerTokenEnc: enc }).catch(() => {});
            return t;
          })();

    const agentDto: AgentDTO = {
      id: row.id,
      userId: '',
      orgId: null,
      did: row.did,
      publicKey: row.publicKey,
      name: row.name,
      status: 'active',
      runtime: 'cloud',
      model: '',
      localInferenceMode: null,
      llmMode: row.llmMode as AgentDTO['llmMode'],
      permissionScopes: row.permissionScopes as AgentDTO['permissionScopes'],
      jitScopes: row.jitScopes as AgentDTO['jitScopes'],
      alwaysScopes: row.alwaysScopes as AgentDTO['alwaysScopes'],
      description: (row as any).description ?? null,
      webauthnCredentialId: null,
      keypairDeliveredAt: null,
      lastConnectedAt: null,
      lastActive: null,
      createdAt: new Date().toISOString(),
      cloudProvisioningStatus: null,
      cloudRunnerId: null,
      cloudLastHeartbeatAt: null,
      cloudProvisioningError: null,
      agentKind: (row.agentKind as AgentDTO['agentKind']) ?? 'standard',
    };

    const identity = buildSdkAgentJson(agentDto, privateKey, backendUrl);
    const adk = await this.createAdkArtifact(agentDto);
    const agentIdentity: DockerAgentIdentity = { id: row.id, name: row.name, did: row.did };
    const imageRef = await this.buildPerAgentImage(agentIdentity, adk.versionHash);

    await this.repo.updateCloudFields(row.id, { cloudProvisioningStatus: 'provisioning' });
    try {
      const runnerId = await this.startContainer({
        agent: agentIdentity,
        backendUrl,
        identityJson: identity,
        runnerToken,
        adkManifestPath: adk.manifestPath,
        adkModulePath: adk.modulePath,
        adkClassName: 'CloudDeployedAgent',
        imageRef,
        teamContext: params.teamContext,
      });
      await this.repo.updateCloudFields(row.id, {
        cloudRunnerId: runnerId,
        cloudProvisioningStatus: 'provisioning',
        cloudProvisioningError: null,
      });
    } catch (err) {
      const logs = await this.orchestrator
        .logs(dockerTeamContainerName(agentIdentity, params.teamContext), 200)
        .catch(() => '');
      const message = safeProvisioningErrorMessage(`${String((err as Error)?.message ?? err)}\n${logs}`.trim());
      await this.repo.updateCloudFields(row.id, {
        cloudProvisioningStatus: 'failed',
        cloudProvisioningError: message,
      });
      throw new CloudProvisionFailedError(message);
    }
  }

  scheduleApplyTeamContext(params: {
    agentId: string;
    teamId: string;
    teamName: string;
    role: 'supervisor' | 'worker';
    backendUrl: string;
  }): void {
    setImmediate(() => {
      void this.applyTeamContext(params).catch((err) => {
        console.warn('[applyTeamContext]', params.agentId, err);
      });
    });
  }

  /**
   * Stop and remove cloud runner containers/images for an agent (all known naming variants).
   */
  async teardownCloudRunner(params: {
    agentId: string;
    name: string;
    did: string;
    cloudRunnerId?: string | null;
    teamContext?: DockerTeamContext | null;
  }): Promise<void> {
    const identity: DockerAgentIdentity = {
      id: params.agentId,
      name: params.name,
      did: params.did,
    };

    const names = new Set<string>();
    if (params.cloudRunnerId?.trim()) names.add(params.cloudRunnerId.trim());
    names.add(legacyDockerContainerName(params.agentId));
    names.add(dockerContainerName(identity));
    if (params.teamContext) {
      names.add(dockerTeamContainerName(identity, params.teamContext));
    }

    for (const name of names) {
      await this.orchestrator.removeContainerIfExists(name);
    }

    const prefix = dockerImageListPrefix(identity);
    const images = await this.orchestrator.listImages(prefix);
    for (const ref of images) {
      await this.orchestrator.removeImageIfExists(ref);
    }
  }
}

