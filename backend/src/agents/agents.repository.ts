import type { Agent as PrismaAgent, Prisma } from '@prisma/client';
import { DeviceVerificationService } from '../deviceVerification/deviceVerification.js';
import { prisma } from '../lib/prisma.js';
import type {
  AgentDTO,
  AgentRuntime,
  LocalInferenceMode,
  LlmMode,
  LlmProvider,
  PermissionScope,
} from './agents.types.js';
import type { ToolProfile } from './toolProfiles.js';
import {
  parseReasoningEffort,
  type ReasoningEffort,
} from '../llm/routing/reasoningBudget.js';

export class OrgMembershipError extends Error {
  readonly code = 'forbidden_org';
  constructor(message = 'Not a member of the requested organization') {
    super(message);
  }
}

export interface CreateAgentDbInput {
  userId: string;
  orgId: string | null;
  name: string;
  description?: string | null;
  did: string;
  publicKey: string;
  runtime: AgentRuntime;
  model: string;
  llmMode: LlmMode;
  llmProvider: LlmProvider;
  localInferenceMode: LocalInferenceMode | null;
  permissionScopes: PermissionScope[];
  jitScopes: PermissionScope[];
  alwaysScopes: PermissionScope[];
  webauthnCredentialId: string | null;
  cloudProvisioningStatus?: string | null;
  cloudRunnerId?: string | null;
  cloudLastHeartbeatAt?: Date | null;
  cloudPrivateKeyEnc?: string | null;
  cloudProvisioningError?: string | null;
  cloudRunnerTokenEnc?: string | null;
  hybridRunnerTokenHash?: string | null;
  /** Defaults to `standard` when omitted (normal agents UI). */
  agentKind?: 'standard' | 'org_brain';
}

export function toAgentDTO(agent: PrismaAgent): AgentDTO {
  return {
    id: agent.id,
    userId: agent.userId,
    orgId: agent.orgId,
    did: agent.did,
    publicKey: agent.publicKey,
    name: agent.name,
    description: (agent as any).description ?? null,
    status: agent.status,
    runtime: agent.runtime as AgentRuntime,
    model: agent.llmModel,
    llmMode: agent.llmMode as LlmMode,
    llmProvider: agent.llmProvider as LlmProvider,
    reasoningEffort: parseReasoningEffort((agent as { reasoningEffort?: unknown }).reasoningEffort),
    localInferenceMode: (agent.localInferenceMode as LocalInferenceMode | null) ?? null,
    permissionScopes: agent.permissionScopes as PermissionScope[],
    jitScopes: agent.jitScopes as PermissionScope[],
    alwaysScopes: agent.alwaysScopes as PermissionScope[],
    webauthnCredentialId: agent.webauthnCredentialId,
    keypairDeliveredAt: agent.keypairDeliveredAt ? agent.keypairDeliveredAt.toISOString() : null,
    lastConnectedAt: agent.lastConnectedAt ? agent.lastConnectedAt.toISOString() : null,
    lastActive: agent.lastActive ? agent.lastActive.toISOString() : null,
    createdAt: agent.createdAt.toISOString(),
    cloudProvisioningStatus: (agent.cloudProvisioningStatus as string | null) ?? null,
    cloudRunnerId: (agent.cloudRunnerId as string | null) ?? null,
    cloudLastHeartbeatAt: agent.cloudLastHeartbeatAt ? agent.cloudLastHeartbeatAt.toISOString() : null,
    cloudProvisioningError: (agent.cloudProvisioningError as string | null) ?? null,
    hybridLastHeartbeatAt: (agent as any).hybridLastHeartbeatAt
      ? ((agent as any).hybridLastHeartbeatAt as Date).toISOString()
      : null,
    agentKind: (agent.agentKind as AgentDTO['agentKind']) ?? 'standard',
    toolProfile: (((agent as { toolProfile?: string }).toolProfile as AgentDTO['toolProfile']) ??
      'full') as AgentDTO['toolProfile'],
  };
}

export class AgentsRepository {
  private readonly deviceVerification = new DeviceVerificationService();

  async assertDeviceVerified(userId: string): Promise<{ webauthnCredentialId: string | null }> {
    const { webauthnCredentialId } = await this.deviceVerification.assertUserVerified(userId);
    return { webauthnCredentialId };
  }

  /**
   * Validates that the requesting user belongs to `orgId`. When `orgId` is null
   * (individual workspace), no membership check is needed.
   */
  async assertOrgMembership(userId: string, orgId: string | null): Promise<void> {
    if (!orgId) return;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { orgId: true },
    });
    if (!user || user.orgId !== orgId) {
      throw new OrgMembershipError();
    }
  }

  async createAgent(input: CreateAgentDbInput): Promise<AgentDTO> {
    const created = await prisma.agent.create({
      data: {
        userId: input.userId,
        orgId: input.orgId,
        name: input.name,
        description: input.description ?? null,
        did: input.did,
        publicKey: input.publicKey,
        runtime: input.runtime,
        llmModel: input.model,
        llmMode: input.llmMode,
        llmProvider: input.llmProvider,
        localInferenceMode: input.localInferenceMode,
        permissionScopes: input.permissionScopes,
        jitScopes: input.jitScopes,
        alwaysScopes: input.alwaysScopes,
        webauthnCredentialId: input.webauthnCredentialId,
        status: 'active',
        cloudProvisioningStatus: input.cloudProvisioningStatus ?? null,
        cloudRunnerId: input.cloudRunnerId ?? null,
        cloudLastHeartbeatAt: input.cloudLastHeartbeatAt ?? null,
        cloudPrivateKeyEnc: input.cloudPrivateKeyEnc ?? null,
        cloudProvisioningError: input.cloudProvisioningError ?? null,
        cloudRunnerTokenEnc: input.cloudRunnerTokenEnc ?? null,
        agentKind: input.agentKind ?? 'standard',
      },
    });
    return toAgentDTO(created);
  }

  async findById(id: string): Promise<AgentDTO | null> {
    const found = await prisma.agent.findUnique({ where: { id } });
    return found ? toAgentDTO(found) : null;
  }

  async hasCloudRunnerSecrets(agentId: string): Promise<boolean> {
    const row = await prisma.agent.findUnique({
      where: { id: agentId },
      select: { cloudPrivateKeyEnc: true },
    });
    return !!row?.cloudPrivateKeyEnc;
  }

  async findByDid(did: string): Promise<AgentDTO | null> {
    const found = await prisma.agent.findUnique({ where: { did } });
    return found ? toAgentDTO(found) : null;
  }

  /**
   * Lists agents for a workspace. When `orgId` is provided the query is org-scoped.
   * For an individual workspace (`orgId` null) it returns every agent owned by the
   * user, whether it was stored with no org (`orgId: null`, e.g. single builder
   * agents) or carries the user's personal workspace org (`workspaceOrgId`, e.g.
   * team-built agents). Without the union those two storage conventions would each
   * be visible on only one surface (Agents page vs. dashboard).
   */
  async listForUser(
    userId: string,
    orgId: string | null,
    workspaceOrgId: string | null = null,
  ): Promise<AgentDTO[]> {
    const where: Prisma.AgentWhereInput = orgId
      ? { orgId, agentKind: 'standard' }
      : {
          userId,
          agentKind: 'standard',
          OR: [{ orgId: null }, ...(workspaceOrgId ? [{ orgId: workspaceOrgId }] : [])],
        };
    const agents = await prisma.agent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
    return agents.map(toAgentDTO);
  }

  async markKeypairDelivered(agentId: string): Promise<void> {
    await prisma.agent.update({
      where: { id: agentId },
      data: { keypairDeliveredAt: new Date() },
    });
  }

  async markPing(agentId: string): Promise<void> {
    const now = new Date();
    await prisma.agent.update({
      where: { id: agentId },
      data: {
        status: 'active',
        lastConnectedAt: now,
        lastActive: now,
      },
    });
    // Cloud agents: update cloud heartbeat + provisioning status.
    await prisma.agent.updateMany({
      where: { id: agentId, runtime: 'cloud' },
      data: { cloudLastHeartbeatAt: now, cloudProvisioningStatus: 'running' },
    });
    // Hybrid agents: update hybrid heartbeat only.
    await prisma.agent.updateMany({
      where: { id: agentId, runtime: 'hybrid' },
      data: { hybridLastHeartbeatAt: now },
    });
  }

  async updateHybridFields(
    agentId: string,
    patch: { hybridRunnerTokenHash?: string | null; hybridLastHeartbeatAt?: Date | null },
  ): Promise<void> {
    await prisma.agent.update({ where: { id: agentId }, data: patch });
  }

  /**
   * Rotates the agent's public key. Used by the hybrid starter-pack re-issue flow when
   * the user has lost the original ZIP (the matching private key was never persisted).
   * DID and audit history are unaffected; previously issued VCs continue to verify since
   * Qlix-the-issuer signs them, not the agent.
   */
  async updatePublicKey(agentId: string, publicKey: string): Promise<AgentDTO> {
    const updated = await prisma.agent.update({
      where: { id: agentId },
      data: { publicKey },
    });
    return toAgentDTO(updated);
  }

  async updateCloudFields(
    agentId: string,
    patch: {
      cloudProvisioningStatus?: string | null;
      cloudRunnerId?: string | null;
      cloudPrivateKeyEnc?: string | null;
      cloudProvisioningError?: string | null;
      cloudRunnerTokenEnc?: string | null;
    },
  ): Promise<void> {
    await prisma.agent.update({
      where: { id: agentId },
      data: {
        cloudProvisioningStatus: patch.cloudProvisioningStatus,
        cloudRunnerId: patch.cloudRunnerId,
        cloudPrivateKeyEnc: patch.cloudPrivateKeyEnc,
        cloudProvisioningError: patch.cloudProvisioningError,
        cloudRunnerTokenEnc: patch.cloudRunnerTokenEnc,
      },
    });
  }

  async updateToolProfile(
    agentId: string,
    toolProfile: ToolProfile,
  ): Promise<AgentDTO> {
    const updated = await prisma.agent.update({
      where: { id: agentId },
      data: { toolProfile },
    });
    return toAgentDTO(updated);
  }

  async updateDescription(agentId: string, description: string | null): Promise<AgentDTO> {
    const updated = await prisma.agent.update({
      where: { id: agentId },
      data: { description },
    });
    return toAgentDTO(updated);
  }

  async updateInferenceProvider(
    agentId: string,
    llmProvider: LlmProvider,
    model: string,
    reasoningEffort?: ReasoningEffort | null,
  ): Promise<AgentDTO> {
    const updated = await prisma.agent.update({
      where: { id: agentId },
      data: {
        llmProvider,
        llmModel: model,
        ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
      },
    });
    return toAgentDTO(updated);
  }

  async updatePermissionScopes(
    agentId: string,
    patch: {
      permissionScopes: PermissionScope[];
      jitScopes: PermissionScope[];
      alwaysScopes: PermissionScope[];
      runtime?: AgentRuntime;
    },
  ): Promise<AgentDTO> {
    const updated = await prisma.agent.update({
      where: { id: agentId },
      data: {
        permissionScopes: patch.permissionScopes,
        jitScopes: patch.jitScopes,
        alwaysScopes: patch.alwaysScopes,
        ...(patch.runtime !== undefined ? { runtime: patch.runtime } : {}),
      },
    });
    return toAgentDTO(updated);
  }

  /**
   * Removes the agent row. Audit/billing history that uses SetNull (VCs, action logs,
   * RunUsage, BrainUsage) keeps durable identifiers and remains queryable.
   */
  async deleteById(agentId: string): Promise<void> {
    await prisma.agent.delete({ where: { id: agentId } });
  }
}
