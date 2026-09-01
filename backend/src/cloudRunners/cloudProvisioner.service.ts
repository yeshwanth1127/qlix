import { execFile } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
import type { AgentDTO } from '../agents/agents.types.js';
import { buildSdkAgentJson, resolveDockerBackendUrl } from '../agents/sdkAgentFile.js';
import { AgentsRepository } from '../agents/agents.repository.js';
import { decryptForAgentSecrets, encryptForAgentSecrets } from './agentSecrets.js';
import { prisma } from '../lib/prisma.js';
import { DockerNotAvailableError } from './dockerClient.js';
import { DockerRunnerOrchestrator, type RunnerOrchestrator } from './runnerOrchestrator.js';
import {
  type DockerAgentIdentity,
  type DockerTeamContext,
  dockerContainerName,
  dockerTeamContainerName,
  dockerTeamNetworkName,
  legacyDockerContainerName,
  mergeDockerLabels,
} from './dockerNaming.js';
import { ensureSharedRunnerImage } from './runnerImage.js';
import { resolveRunnerResourceLimits } from './runnerResourceLimits.js';
import { pruneAgentRunnerState } from './runnerPruning.js';
import {
  clearPendingTeamContext,
  readPendingTeamContext,
} from './pendingTeamContext.js';
import { ProvisioningQueue, type ProvisionJob } from './provisioningQueue.js';

export class CloudProvisionFailedError extends Error {
  constructor(message = 'Cloud runner provisioning failed') {
    super(message);
  }
}

function safeProvisioningErrorMessage(input: unknown): string {
  const raw = String((input as any)?.message ?? input ?? 'Cloud runner provisioning failed');
  return raw.length > 2000 ? `${raw.slice(0, 2000)}…(truncated)` : raw;
}

/** Fail provisioning if the runner image is missing core research CLIs (Exa/mcporter). */
async function verifyRunnerResearchStack(
  orchestrator: RunnerOrchestrator,
  containerName: string,
): Promise<void> {
  const result = await orchestrator.execContainer(
    containerName,
    ['sh', '-c', 'command -v mcporter && command -v agent-reach'],
    15_000,
  );
  if (result.ok) return;
  const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
  throw new CloudProvisionFailedError(
    `Runner missing research stack (mcporter/agent-reach). Rebuild the shared cloud runner image.${detail ? `\n${detail}` : ''}`,
  );
}

/** When DOCKER_HOST=ssh://…, bind-mount paths resolve on the remote daemon host. */
function dockerSshTarget(): string | null {
  const host = process.env.DOCKER_HOST?.trim();
  if (!host?.startsWith('ssh://')) return null;
  return host.slice('ssh://'.length);
}

async function syncAgentRunnerStateToDockerHost(agentId: string, stateRoot: string): Promise<void> {
  const sshTarget = dockerSshTarget();
  if (!sshTarget) return;
  const localDir = path.join(stateRoot, agentId);
  const remoteDir = localDir;
  await execFileAsync('ssh', [sshTarget, `mkdir -p ${remoteDir}/adk`], { timeout: 60_000 });
  await execFileAsync('rsync', ['-az', '--delete', `${localDir}/`, `${sshTarget}:${remoteDir}/`], {
    timeout: 120_000,
    maxBuffer: 10 * 1024 * 1024,
  });
}

function randomRunnerToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export class CloudProvisionerService {
  constructor(
    private readonly repo: AgentsRepository = new AgentsRepository(),
    private readonly orchestrator: RunnerOrchestrator = new DockerRunnerOrchestrator(),
  ) {}

  runnerStateRoot(): string {
    return process.env.QLIX_CLOUD_RUNNER_STATE_DIR?.trim() || path.join(process.cwd(), '.qlix-runners');
  }

  registerQueueHandler(): void {
    const queue = ProvisioningQueue.getInstance();
    queue.setHandler((job) => this.runQueuedJob(job));
  }

  private enqueue(job: ProvisionJob): void {
    ProvisioningQueue.getInstance().enqueue(job);
  }

  private async runQueuedJob(job: ProvisionJob): Promise<void> {
    try {
      switch (job.kind) {
        case 'provision':
          await this._doProvisionCloudRunner({
            agent: job.agent,
            privateKey: job.privateKey,
            backendUrl: job.backendUrl,
          });
          break;
        case 'restart':
          await this.restartCloudRunner({ agentId: job.agentId, backendUrl: job.backendUrl });
          break;
        case 'team':
          await this.applyTeamContext({
            agentId: job.agentId,
            teamId: job.teamContext.id,
            teamName: job.teamContext.name,
            role: job.teamContext.role,
            backendUrl: job.backendUrl,
          });
          break;
      }
    } catch (err) {
      const agentId =
        job.kind === 'provision' ? job.agent.id : job.agentId;
      const message =
        err instanceof CloudProvisionFailedError
          ? err.message
          : err instanceof DockerNotAvailableError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'Cloud runner provisioning failed';
      console.warn('[cloudProvision]', agentId, message);
      await this.repo
        .updateCloudFields(agentId, {
          cloudProvisioningStatus: 'failed',
          cloudProvisioningError: safeProvisioningErrorMessage(message),
        })
        .catch(() => {});
    }
  }

  private async createAdkArtifact(agent: AgentDTO): Promise<{
    adkDir: string;
    manifestPath: string;
    modulePath: string;
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
    return { adkDir, manifestPath, modulePath };
  }

  private async resolveRunnerImageRef(): Promise<string> {
    return ensureSharedRunnerImage(this.orchestrator);
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
    const runnerStateRoot = this.runnerStateRoot();
    const dir = path.join(runnerStateRoot, params.agent.id);
    // Agent identity is delivered ephemerally through the container environment. Do not persist
    // another plaintext private-key copy in the runner state directory.
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const identityPath = path.join(dir, 'agent.json');
    await rm(identityPath, { force: true });
    await syncAgentRunnerStateToDockerHost(params.agent.id, runnerStateRoot);

    let teamContext = params.teamContext ?? null;
    if (!teamContext) {
      teamContext = await readPendingTeamContext(runnerStateRoot, params.agent.id);
    }

    const containerName = teamContext
      ? dockerTeamContainerName(params.agent, teamContext)
      : dockerContainerName(params.agent);
    await this.orchestrator.removeContainerIfExists(legacyDockerContainerName(params.agent.id));
    await this.orchestrator.removeContainerIfExists(containerName);
    await this.orchestrator.removeContainerIfExists(dockerContainerName(params.agent));
    if (teamContext) {
      await this.orchestrator.removeContainerIfExists(
        dockerTeamContainerName(params.agent, teamContext),
      );
    }

    let network: string | undefined;
    if (teamContext) {
      network = dockerTeamNetworkName(teamContext.id);
      await this.orchestrator.ensureNetwork(network);
    }

    const mounts = [
      { hostPath: params.adkManifestPath, containerPath: '/run/adk/manifest.json', readOnly: true },
      { hostPath: params.adkModulePath, containerPath: '/run/adk/adk_agent.py', readOnly: true },
    ];

    const resourceLimits = resolveRunnerResourceLimits();
    const runnerId = await this.orchestrator.runContainer({
      name: containerName,
      imageRef: params.imageRef,
      labels: mergeDockerLabels(params.agent, teamContext),
      network,
      memoryLimit: resourceLimits.memoryLimit,
      memoryReservation: resourceLimits.memoryReservation,
      cpuLimit: resourceLimits.cpuLimit,
      pidsLimit: resourceLimits.pidsLimit,
      user: '10001:10001',
      readOnlyRoot: true,
      dropAllCapabilities: true,
      noNewPrivileges: true,
      tmpfs: [
        { containerPath: '/tmp', options: 'rw,nosuid,nodev,noexec,size=512m,mode=1777' },
        { containerPath: '/home/qlix', options: 'rw,nosuid,nodev,size=128m,uid=10001,gid=10001,mode=0700' },
      ],
      env: {
        QLIX_AGENT_JSON_B64: Buffer.from(JSON.stringify(params.identityJson), 'utf8').toString('base64'),
        QLIX_BACKEND_URL: params.backendUrl,
        QLIX_CLOUD_PING_INTERVAL_MS: process.env.QLIX_CLOUD_PING_INTERVAL_MS?.trim() || '5000',
        QLIX_RUNNER_TOKEN: params.runnerToken,
        QLIX_ADK_MANIFEST: '/run/adk/manifest.json',
        QLIX_ADK_MODULE: '/run/adk/adk_agent.py',
        QLIX_ADK_CLASS: params.adkClassName,
        HOME: '/home/qlix',
        XDG_CACHE_HOME: '/home/qlix/.cache',
        XDG_CONFIG_HOME: '/home/qlix/.config',
        QLIX_BROWSER_CF_FAILOVER: '0',
      },
      mounts,
      cmd: ['python', '-m', 'qlix.cloud_runner'],
    });

    await verifyRunnerResearchStack(this.orchestrator, containerName).catch(async (err) => {
      await this.orchestrator.removeContainerIfExists(containerName);
      throw err;
    });

    if (teamContext) {
      await clearPendingTeamContext(runnerStateRoot, params.agent.id);
    }

    return runnerId || containerName;
  }

  private async _doProvisionCloudRunner(params: {
    agent: AgentDTO;
    privateKey: string;
    backendUrl: string;
  }): Promise<void> {
    const { agent, privateKey, backendUrl } = params;
    const identity = buildSdkAgentJson(agent, privateKey, backendUrl);
    const adk = await this.createAdkArtifact(agent);
    const imageRef = await this.resolveRunnerImageRef();

    const enc = encryptForAgentSecrets(privateKey);
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

  async provisionCloudRunner(params: {
    agent: AgentDTO;
    privateKey: string;
    requestForBackendUrl: { protocol?: string; get(name: string): string | undefined };
  }): Promise<void> {
    if (params.agent.runtime !== 'cloud') return;
    const backendUrl = resolveDockerBackendUrl(params.requestForBackendUrl);
    await this._doProvisionCloudRunner({ agent: params.agent, privateKey: params.privateKey, backendUrl });
  }

  scheduleProvisionCloudRunner(params: {
    agent: AgentDTO;
    privateKey: string;
    requestForBackendUrl: { protocol?: string; get(name: string): string | undefined };
  }): void {
    if (params.agent.runtime !== 'cloud') return;
    const backendUrl = resolveDockerBackendUrl(params.requestForBackendUrl);
    this.enqueue({
      kind: 'provision',
      agent: params.agent,
      privateKey: params.privateKey,
      backendUrl,
    });
  }

  scheduleRestartCloudRunner(params: { agentId: string; backendUrl: string }): void {
    this.enqueue({ kind: 'restart', agentId: params.agentId, backendUrl: params.backendUrl });
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
        llmProvider: true,
        permissionScopes: true,
        jitScopes: true,
        alwaysScopes: true,
        runtime: true,
        cloudPrivateKeyEnc: true,
        agentKind: true,
        description: true,
      },
    });
    if (!row || row.runtime !== 'cloud') {
      throw new CloudProvisionFailedError('Agent not found or not cloud runtime');
    }
    if (!row.cloudPrivateKeyEnc) {
      throw new CloudProvisionFailedError('Missing cloudPrivateKeyEnc for this agent (recreate agent)');
    }

    const backendUrl = resolveDockerBackendUrl({ protocol: 'http', get: () => undefined });
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
      llmProvider: row.llmProvider as AgentDTO['llmProvider'],
      reasoningEffort: null,
      permissionScopes: row.permissionScopes as AgentDTO['permissionScopes'],
      jitScopes: row.jitScopes as AgentDTO['jitScopes'],
      alwaysScopes: row.alwaysScopes as AgentDTO['alwaysScopes'],
      description: row.description ?? null,
      webauthnCredentialId: null,
      keypairDeliveredAt: null,
      lastConnectedAt: null,
      lastActive: null,
      createdAt: new Date().toISOString(),
      cloudProvisioningStatus: null,
      cloudRunnerId: null,
      cloudLastHeartbeatAt: null,
      cloudProvisioningError: null,
      hybridLastHeartbeatAt: null,
      agentKind: (row.agentKind as AgentDTO['agentKind']) ?? 'standard',
      toolProfile: 'full',
    };

    const identity = buildSdkAgentJson(agentDto, privateKey, backendUrl);
    const adk = await this.createAdkArtifact(agentDto);
    const agentIdentity: DockerAgentIdentity = { id: row.id, name: row.name, did: row.did };
    const imageRef = await this.resolveRunnerImageRef();

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

  async applyTeamContext(params: {
    agentId: string;
    teamId: string;
    teamName: string;
    role: 'supervisor' | 'worker';
    backendUrl: string;
  }): Promise<void> {
    const row = await prisma.agent.findUnique({
      where: { id: params.agentId },
      select: { id: true, name: true, did: true, runtime: true, cloudPrivateKeyEnc: true, cloudRunnerId: true },
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
        llmProvider: true,
        permissionScopes: true,
        jitScopes: true,
        alwaysScopes: true,
        runtime: true,
        cloudPrivateKeyEnc: true,
        agentKind: true,
        description: true,
      },
    });
    if (!row || row.runtime !== 'cloud' || !row.cloudPrivateKeyEnc) {
      throw new CloudProvisionFailedError('Agent not found or not cloud runtime');
    }

    const backendUrl = resolveDockerBackendUrl({ protocol: 'http', get: () => undefined });
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
      llmProvider: row.llmProvider as AgentDTO['llmProvider'],
      reasoningEffort: null,
      permissionScopes: row.permissionScopes as AgentDTO['permissionScopes'],
      jitScopes: row.jitScopes as AgentDTO['jitScopes'],
      alwaysScopes: row.alwaysScopes as AgentDTO['alwaysScopes'],
      description: row.description ?? null,
      webauthnCredentialId: null,
      keypairDeliveredAt: null,
      lastConnectedAt: null,
      lastActive: null,
      createdAt: new Date().toISOString(),
      cloudProvisioningStatus: null,
      cloudRunnerId: null,
      cloudLastHeartbeatAt: null,
      cloudProvisioningError: null,
      hybridLastHeartbeatAt: null,
      agentKind: (row.agentKind as AgentDTO['agentKind']) ?? 'standard',
      toolProfile: 'full',
    };

    const identity = buildSdkAgentJson(agentDto, privateKey, backendUrl);
    const adk = await this.createAdkArtifact(agentDto);
    const agentIdentity: DockerAgentIdentity = { id: row.id, name: row.name, did: row.did };
    const imageRef = await this.resolveRunnerImageRef();

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
    this.enqueue({
      kind: 'team',
      agentId: params.agentId,
      backendUrl: params.backendUrl,
      teamContext: {
        id: params.teamId,
        name: params.teamName,
        role: params.role,
      },
    });
  }

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

    await pruneAgentRunnerState(params.agentId);
  }
}
