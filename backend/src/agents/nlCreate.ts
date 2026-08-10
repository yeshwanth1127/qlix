import { AgentsService, type CreateAgentResult } from './agents.service.js';
import { AgentsRepository } from './agents.repository.js';
import { TeamsService } from '../teams/teams.service.js';
import { detectPlaybookFromScopeSets } from '../teams/teamPlaybook.js';
import { CloudProvisionerService } from '../cloudRunners/cloudProvisioner.service.js';
import { encryptForAgentSecrets, AgentSecretsKeyMissingError } from '../cloudRunners/agentSecrets.js';
import { generateHybridRunnerToken } from '../agentChat/runnerAuth.js';
import {
  buildSdkAgentJson,
  buildSdkAgentJsonPublic,
  buildSdkAgentJsonHybrid,
  buildSdkAgentPathsHint,
  resolvePublicBackendUrl,
  resolveHybridRunnerBackendUrl,
} from './sdkAgentFile.js';
import {
  buildHybridStarterPackZip,
  hybridStarterPackFilename,
  resolveHybridStarterPlatform,
  type HybridStarterPlatform,
} from './hybridStarterPack.js';
import type { AgentCreationPlan, NLAgentSpec, NLWorkerSpec } from './nlTypes.js';
import { wireAgentMcpFromScopes } from './agentMcpWire.js';

/** Minimal subset of Express Request that resolvers need. */
export type RequestLike = { protocol?: string; get(name: string): string | undefined; headers: Record<string, string | string[] | undefined> };

export interface NLAgentCreationOutput {
  agentResult: CreateAgentResult;
  sdkAgentFile: Record<string, unknown>;
  sdkAgentPaths: ReturnType<typeof buildSdkAgentPathsHint>;
  hybridStarterPack?: { filename: string; base64: string };
}

export interface NLSingleCreateResult {
  type: 'single';
  output: NLAgentCreationOutput;
}

export interface NLTeamCreateResult {
  type: 'team';
  teamId: string;
  supervisorOutput: NLAgentCreationOutput;
  workerOutputs: NLAgentCreationOutput[];
}

export type NLCreateResult = NLSingleCreateResult | NLTeamCreateResult;

export class NLCreationService {
  private readonly agentsService = new AgentsService();
  private readonly agentsRepo = new AgentsRepository();
  private readonly teamsService = new TeamsService();
  private readonly cloudProvisioner = new CloudProvisionerService();

  async createFromPlan(input: {
    userId: string;
    orgId: string | null;
    plan: AgentCreationPlan;
    request: RequestLike;
    clientPlatform?: HybridStarterPlatform;
  }): Promise<NLCreateResult> {
    const { userId, orgId, plan, request, clientPlatform } = input;

    if (plan.type === 'single') {
      const output = await this.createOneAgent({ userId, orgId, spec: plan.agent, request, clientPlatform });
      return { type: 'single', output };
    }

    // Team: supervisor first, then workers sequentially
    const supervisorOutput = await this.createOneAgent({
      userId, orgId, spec: plan.team.supervisor, request, clientPlatform,
    });

    const workerOutputs: NLAgentCreationOutput[] = [];
    for (const worker of plan.team.workers) {
      const out = await this.createOneAgent({ userId, orgId, spec: worker, request, clientPlatform });
      workerOutputs.push(out);
    }

    // orgId required for teams
    const teamOrgId = orgId ?? '';
    const backendUrl = resolvePublicBackendUrl(request);

    const team = await this.teamsService.createTeam(
      userId,
      {
        orgId: teamOrgId,
        name: plan.team.name,
        description: plan.team.description,
        supervisorAgentId: supervisorOutput.agentResult.agent.id,
        members: plan.team.workers.map((w, i) => ({
          agentId: workerOutputs[i].agentResult.agent.id,
          role: w.role,
          delegatedScopes: w.permissionScopes,
        })),
        config: {
          maxParallelWorkers: plan.team.config.maxParallelWorkers,
          subtaskTimeoutMs: plan.team.config.subtaskTimeoutMs,
          retryPolicy: plan.team.config.retryPolicy,
          humanInLoopTriggers: ['web.transaction', 'finance.spend_50', 'finance.spend_100'],
          pipelineMode: true,
          autoSequence: false,
          // Pinned at creation so the stage goals a team runs never change under it when
          // members or delegated scopes are later edited.
          playbook: detectPlaybookFromScopeSets(plan.team.workers.map((w) => w.permissionScopes)),
        },
      },
      backendUrl,
    );

    return { type: 'team', teamId: team.id, supervisorOutput, workerOutputs };
  }

  private async createOneAgent(input: {
    userId: string;
    orgId: string | null;
    spec: NLAgentSpec | NLWorkerSpec;
    request: RequestLike;
    clientPlatform?: HybridStarterPlatform;
  }): Promise<NLAgentCreationOutput> {
    const { userId, orgId, spec, request, clientPlatform } = input;

    const agentResult = await this.agentsService.createAgent(userId, {
      name: spec.name,
      description: spec.description || null,
      permissionScopes: spec.permissionScopes,
      jitScopes: spec.jitScopes,
      runtime: spec.runtime,
      model: spec.model,
      llmMode: spec.llmMode,
      llmProvider: spec.model.toLowerCase().startsWith('exora/') ? 'exora' : 'openrouter',
      localInferenceMode: spec.localInferenceMode,
      orgId,
    });

    const { agent, privateKey } = agentResult;

    // Prefer persisted scopes (includes always-on defaults merged in createAgent).
    await wireAgentMcpFromScopes({
      userId,
      orgId,
      agentId: agent.id,
      scopes: agent.permissionScopes,
    });

    const backendUrl =
      agent.runtime === 'hybrid' || agent.runtime === 'local'
        ? resolveHybridRunnerBackendUrl(request)
        : resolvePublicBackendUrl(request);

    let sdkAgentFile: Record<string, unknown>;
    let hybridStarterPack: { filename: string; base64: string } | undefined;

    if (agent.runtime === 'cloud') {
      try {
        const enc = encryptForAgentSecrets(privateKey);
        await this.agentsRepo.updateCloudFields(agent.id, {
          cloudPrivateKeyEnc: enc,
          cloudProvisioningStatus: 'provisioning',
          cloudProvisioningError: null,
        });
      } catch (e) {
        const msg =
          e instanceof AgentSecretsKeyMissingError ? e.message
          : e instanceof Error ? e.message
          : String(e);
        console.warn('[nlCreate] Failed to encrypt cloud agent key:', msg);
        await this.agentsRepo
          .updateCloudFields(agent.id, { cloudProvisioningStatus: 'failed', cloudRunnerId: null, cloudProvisioningError: msg })
          .catch(() => {});
      }
      this.cloudProvisioner.scheduleProvisionCloudRunner({ agent, privateKey, requestForBackendUrl: request });
      sdkAgentFile = buildSdkAgentJsonPublic(agent, backendUrl);
    } else if (agent.runtime === 'hybrid') {
      const { token: runnerToken, hash: runnerTokenHash } = generateHybridRunnerToken();
      await this.agentsRepo.updateHybridFields(agent.id, { hybridRunnerTokenHash: runnerTokenHash });
      sdkAgentFile = buildSdkAgentJsonHybrid(agent, privateKey, runnerToken, backendUrl);
      try {
        const platform = resolveHybridStarterPlatform(clientPlatform, request.headers['user-agent'] as string | undefined);
        const zip = await buildHybridStarterPackZip(sdkAgentFile, agent.name, platform, request);
        hybridStarterPack = {
          filename: hybridStarterPackFilename(agent.name, platform),
          base64: zip.toString('base64'),
        };
      } catch (packErr) {
        console.warn('[nlCreate] hybridStarterPack failed:', packErr);
      }
    } else {
      sdkAgentFile = buildSdkAgentJson(agent, privateKey, backendUrl);
    }

    return {
      agentResult,
      sdkAgentFile,
      sdkAgentPaths: buildSdkAgentPathsHint(agent.name),
      hybridStarterPack,
    };
  }

}
