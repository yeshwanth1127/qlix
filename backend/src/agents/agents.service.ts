import { CredentialsService } from '../credentials/credentials.service.js';
import type { VerifiableCredentialDTO } from '../credentials/vc.types.js';
import { CloudProvisionerService } from '../cloudRunners/cloudProvisioner.service.js';
import { roleCan } from '../lib/orgPermissions.js';
import { AgentsRepository, OrgMembershipError } from './agents.repository.js';
import type { AgentDTO, CreateAgentInput, LlmProvider, ReasoningEffort } from './agents.types.js';
import { reconcileRuntimeWithScopes } from './scopeCatalog.js';
import { generateDID } from './did.js';
import { enforceJitRules } from './jit.js';
import { generateKeypair } from './keypair.js';
import { isMcpScope } from '../mcp/mcpScopeCatalog.js';
import { mcpService } from '../mcp/mcp.service.js';
import { ensureQlixJobsMcpForOrg } from '../jobs/ensureQlixJobsMcp.js';
import { ensureQlixScheduleMcpForOrg } from '../schedules/ensureQlixScheduleMcp.js';
import { prisma } from '../lib/prisma.js';
import type { PermissionScope } from './agents.types.js';
import { withDefaultAgentScopes } from './defaultAgentScopes.js';
import { wireAgentMcpFromScopes } from './agentMcpWire.js';
import {
  defaultLlmProvider,
  modelForProvider,
} from '../llm/inferenceRouter.js';

export class AgentDeleteForbiddenError extends Error {
  readonly code = 'forbidden_delete';
  constructor(message = 'Not allowed to delete this agent') {
    super(message);
  }
}

export class AgentConfirmNameMismatchError extends Error {
  readonly code = 'confirm_name_mismatch';
  constructor() {
    super('Confirmation name does not match agent name');
  }
}

export class AgentNotFoundError extends Error {
  readonly code = 'not_found' as const;
  constructor() {
    super('Agent not found');
  }
}

export class AgentScopeUpdateError extends Error {
  readonly code = 'invalid_scopes';
  constructor(message: string) {
    super(message);
  }
}

export interface CreateAgentResult {
  agent: AgentDTO;
  credentials: VerifiableCredentialDTO[];
  privateKey: string;
}

export class AgentsService {
  constructor(
    private readonly repo: AgentsRepository = new AgentsRepository(),
    private readonly vcService: CredentialsService = new CredentialsService(),
  ) {}

  async createAgent(userId: string, input: CreateAgentInput): Promise<CreateAgentResult> {
    const { webauthnCredentialId } = await this.repo.assertDeviceVerified(userId);
    await this.repo.assertOrgMembership(userId, input.orgId);

    // Always-on: brain.query regardless of intent / caller scopes. Schedule MCP is intent-based.
    const permissionScopes = withDefaultAgentScopes(input.permissionScopes);
    const jitScopesInput = input.jitScopes.filter((s) => permissionScopes.includes(s));

    const runtime = reconcileRuntimeWithScopes(input.runtime, permissionScopes);
    const normalizedInput: CreateAgentInput =
      runtime === input.runtime
        ? { ...input, permissionScopes, jitScopes: jitScopesInput }
        : {
            ...input,
            permissionScopes,
            jitScopes: jitScopesInput,
            runtime,
            llmMode: runtime === 'local' ? input.llmMode : 'proxy',
            localInferenceMode: runtime === 'local' ? input.localInferenceMode : null,
          };

    const { jitScopes, alwaysScopes } = enforceJitRules(
      normalizedInput.permissionScopes,
      normalizedInput.jitScopes,
    );
    const llmProvider = normalizedInput.llmProvider ?? defaultLlmProvider();

    const did = generateDID();
    const { publicKey, privateKey } = await generateKeypair();

    const agent = await this.repo.createAgent({
      userId,
      orgId: normalizedInput.orgId,
      name: normalizedInput.name,
      description: normalizedInput.description ?? null,
      did,
      publicKey,
      runtime: normalizedInput.runtime,
      model:
        normalizedInput.llmMode === 'proxy'
          ? modelForProvider(normalizedInput.model, llmProvider)
          : normalizedInput.model,
      llmMode: normalizedInput.llmMode,
      llmProvider,
      localInferenceMode: normalizedInput.localInferenceMode,
      permissionScopes: normalizedInput.permissionScopes,
      jitScopes,
      alwaysScopes,
      webauthnCredentialId,
    });

    // Bind MCP tools (e.g. qlix-schedule when granted) before callers re-wire their own scopes.
    await wireAgentMcpFromScopes({
      userId,
      orgId: normalizedInput.orgId,
      agentId: agent.id,
      scopes: normalizedInput.permissionScopes,
    });

    // Re-read so VCs + returned DTO include MCP scopes written by syncAgentScopes during wire.
    const fresh = (await this.repo.findById(agent.id)) ?? agent;

    const credentials = await this.vcService.issueAgentVCs({
      id: fresh.id,
      did: fresh.did,
      webauthnCredentialId: fresh.webauthnCredentialId,
      permissionScopes: fresh.permissionScopes,
      jitScopes: fresh.jitScopes,
      alwaysScopes: fresh.alwaysScopes,
    });

    return {
      agent: fresh,
      credentials,
      privateKey,
    };
  }

  async listAgents(
    userId: string,
    orgId: string | null,
    workspaceOrgId: string | null = null,
  ): Promise<AgentDTO[]> {
    return this.repo.listForUser(userId, orgId, workspaceOrgId);
  }

  async getAgent(id: string): Promise<AgentDTO | null> {
    return this.repo.findById(id);
  }

  async getAgentByDid(did: string): Promise<AgentDTO | null> {
    return this.repo.findByDid(did);
  }

  async listCredentials(agentId: string): Promise<VerifiableCredentialDTO[]> {
    return this.vcService.listByAgentId(agentId);
  }

  async confirmDownload(agentId: string): Promise<void> {
    await this.repo.markKeypairDelivered(agentId);
  }

  /**
   * Generates a fresh signing keypair for the agent and returns the new private key
   * (plaintext, one-time) plus the updated agent record. Used by the hybrid starter-pack
   * re-issue endpoint when the user lost the original ZIP. Caller must persist the new
   * public key via `repo.updatePublicKey`.
   */
  async rotateAgentKeypair(agentId: string): Promise<{ agent: AgentDTO; privateKey: string }> {
    const { publicKey, privateKey } = await generateKeypair();
    const agent = await this.repo.updatePublicKey(agentId, publicKey);
    return { agent, privateKey };
  }

  async ping(didOrAgentId: string): Promise<AgentDTO | null> {
    const key = didOrAgentId.trim();
    let agent =
      key.startsWith('did:') ? await this.repo.findByDid(key) : await this.repo.findById(key);
    if (!agent && key.startsWith('did:')) {
      agent = await this.repo.findById(key);
    }
    if (!agent) return null;
    await this.repo.markPing(agent.id);
    return this.repo.findById(agent.id);
  }

  /**
   * Update permission scopes (and JIT split). Syncs MCP bindings when mcp.* scopes change.
   */
  async updateAgentScopes(
    userId: string,
    authOrgId: string | null,
    agentId: string,
    input: { permissionScopes: PermissionScope[]; jitScopes?: PermissionScope[] },
  ): Promise<AgentDTO> {
    const agent = await this.repo.findById(agentId);
    if (!agent) throw new AgentNotFoundError();

    const ownsAgent =
      agent.userId === userId || (agent.orgId != null && agent.orgId === authOrgId);
    if (!ownsAgent) {
      throw new AgentDeleteForbiddenError('Not allowed to edit this agent');
    }

    // Always-on defaults cannot be stripped via the scope editor.
    const permissionScopes = withDefaultAgentScopes(input.permissionScopes);
    if (permissionScopes.length === 0) {
      throw new AgentScopeUpdateError('At least one permission scope is required');
    }

    const jitSet = new Set(
      (input.jitScopes ?? agent.jitScopes).filter((s) => permissionScopes.includes(s)),
    );
    const requestedJit = permissionScopes.filter((s) => jitSet.has(s));
    const { jitScopes, alwaysScopes } = enforceJitRules(permissionScopes, requestedJit);

    const runtime = reconcileRuntimeWithScopes(agent.runtime, permissionScopes);

    const nonMcpScopes = permissionScopes.filter((s) => !isMcpScope(s));
    await this.repo.updatePermissionScopes(agentId, {
      permissionScopes: nonMcpScopes,
      jitScopes: jitScopes.filter((s) => !isMcpScope(s)),
      alwaysScopes: alwaysScopes.filter((s) => !isMcpScope(s)),
      runtime,
    });

    let workspaceOrgId = agent.orgId ?? authOrgId;
    if (!workspaceOrgId) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { orgId: true },
      });
      workspaceOrgId = user?.orgId ?? null;
    }

    if (workspaceOrgId && permissionScopes.some((s) => s.startsWith('mcp.qlix-jobs.'))) {
      await ensureQlixJobsMcpForOrg(workspaceOrgId, userId);
    }
    if (workspaceOrgId && permissionScopes.some((s) => s.startsWith('mcp.qlix-schedule.'))) {
      await ensureQlixScheduleMcpForOrg(workspaceOrgId, userId);
    }

    if (workspaceOrgId && permissionScopes.some(isMcpScope)) {
      await mcpService.syncMcpBindingsFromScopes(agentId, workspaceOrgId, permissionScopes);
    } else if (workspaceOrgId) {
      await mcpService.syncMcpBindingsFromScopes(agentId, workspaceOrgId, []);
    }

    const updated = await this.repo.findById(agentId);
    if (!updated) throw new AgentNotFoundError();
    return updated;
  }

  async updateAgentInference(
    userId: string,
    authOrgId: string | null,
    agentId: string,
    input: { llmProvider: LlmProvider; model: string; reasoningEffort?: ReasoningEffort | null },
  ): Promise<AgentDTO> {
    const agent = await this.repo.findById(agentId);
    if (!agent) throw new AgentNotFoundError();
    const ownsAgent =
      agent.userId === userId || (agent.orgId != null && agent.orgId === authOrgId);
    if (!ownsAgent) {
      throw new AgentDeleteForbiddenError('Not allowed to edit this agent');
    }
    if (agent.llmMode !== 'proxy') {
      throw new AgentScopeUpdateError('Provider selection is only available for proxy inference');
    }
    return this.repo.updateInferenceProvider(
      agentId,
      input.llmProvider,
      input.model,
      input.reasoningEffort,
    );
  }

  /**
   * Individual workspace: creator may delete their agent (`org_id` null).
   * Organization: same-org agents require owner or admin (`delete_agent` action).
   */
  async deleteAgent(
    userId: string,
    orgId: string,
    userRole: string,
    agentId: string,
    confirmName: string,
  ): Promise<void> {
    const agent = await this.repo.findById(agentId);
    if (!agent) {
      throw new AgentNotFoundError();
    }

    const trimmed = confirmName.trim();
    if (trimmed !== agent.name.trim()) {
      throw new AgentConfirmNameMismatchError();
    }

    if (agent.orgId == null) {
      if (agent.userId !== userId) {
        throw new AgentDeleteForbiddenError('Only the agent owner can delete this agent');
      }
    } else {
      if (agent.orgId !== orgId) {
        throw new AgentDeleteForbiddenError('Agent belongs to another organization');
      }
      if (!roleCan(userRole, 'delete_agent')) {
        throw new AgentDeleteForbiddenError(
          'Organization members cannot delete agents; ask an admin or owner.',
        );
      }
    }

    if (agent.runtime === 'cloud') {
      try {
        await new CloudProvisionerService().teardownCloudRunner({
          agentId: agent.id,
          name: agent.name,
          did: agent.did,
          cloudRunnerId: agent.cloudRunnerId,
        });
      } catch (err) {
        console.warn(`Failed to clean up Docker resources for agent ${agentId}:`, err);
      }
    }

    await this.repo.deleteById(agentId);
  }

  async deleteAllAgents(userId: string, orgId: string | null, userRole: string): Promise<number> {
    if (orgId && !roleCan(userRole, 'delete_agent')) {
      throw new AgentDeleteForbiddenError(
        'Organization members cannot delete agents; ask an admin or owner.',
      );
    }
    const agents = await this.repo.listForUser(userId, orgId);
    let deleted = 0;
    for (const agent of agents) {
      if (agent.runtime === 'cloud') {
        try {
          await new CloudProvisionerService().teardownCloudRunner({
            agentId: agent.id,
            name: agent.name,
            did: agent.did,
            cloudRunnerId: agent.cloudRunnerId ?? null,
          });
        } catch (err) {
          console.warn(`Bulk delete: failed to tear down cloud runner for ${agent.id}:`, err);
        }
      }
      await this.repo.deleteById(agent.id);
      deleted++;
    }
    return deleted;
  }
}

export { DeviceNotVerifiedError } from '../deviceVerification/deviceVerification.js';
export { OrgMembershipError } from './agents.repository.js';
