import { CredentialsService } from '../credentials/credentials.service.js';
import type { VerifiableCredentialDTO } from '../credentials/vc.types.js';
import { CloudProvisionerService } from '../cloudRunners/cloudProvisioner.service.js';
import { roleCan } from '../lib/orgPermissions.js';
import { AgentsRepository, OrgMembershipError } from './agents.repository.js';
import type { AgentDTO, CreateAgentInput } from './agents.types.js';
import { generateDID } from './did.js';
import { enforceJitRules } from './jit.js';
import { generateKeypair } from './keypair.js';

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

    const { jitScopes, alwaysScopes } = enforceJitRules(
      input.permissionScopes,
      input.jitScopes,
    );

    const did = generateDID();
    const { publicKey, privateKey } = await generateKeypair();

    const agent = await this.repo.createAgent({
      userId,
      orgId: input.orgId,
      name: input.name,
      description: input.description ?? null,
      did,
      publicKey,
      runtime: input.runtime,
      model: input.model,
      llmMode: input.llmMode,
      localInferenceMode: input.localInferenceMode,
      permissionScopes: input.permissionScopes,
      jitScopes,
      alwaysScopes,
      webauthnCredentialId,
    });

    const credentials = await this.vcService.issueAgentVCs({
      id: agent.id,
      did: agent.did,
      webauthnCredentialId: agent.webauthnCredentialId,
      permissionScopes: agent.permissionScopes,
      jitScopes: agent.jitScopes,
      alwaysScopes: agent.alwaysScopes,
    });

    return {
      agent,
      credentials,
      privateKey,
    };
  }

  async listAgents(userId: string, orgId: string | null): Promise<AgentDTO[]> {
    return this.repo.listForUser(userId, orgId);
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
}

export { DeviceNotVerifiedError } from '../deviceVerification/deviceVerification.js';
export { OrgMembershipError } from './agents.repository.js';
