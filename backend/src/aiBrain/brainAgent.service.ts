import type { Request } from 'express';
import { CredentialsService } from '../credentials/credentials.service.js';
import { AgentsRepository, OrgMembershipError } from '../agents/agents.repository.js';
import type { AgentDTO, PermissionScope } from '../agents/agents.types.js';
import { generateDID } from '../agents/did.js';
import { enforceJitRules } from '../agents/jit.js';
import { generateKeypair } from '../agents/keypair.js';
import { roleCan } from '../lib/orgPermissions.js';
import { prisma } from '../lib/prisma.js';
import { appendBrainActionLog } from './brainAudit.service.js';
import { defaultLlmProvider, modelForProvider } from '../llm/inferenceRouter.js';

export class BrainAgentForbiddenError extends Error {
  readonly code = 'forbidden_brain';
  constructor(message = 'Not allowed to manage the org AI brain') {
    super(message);
  }
}

export type BrainHosting = 'cloud' | 'local';

export class BrainAgentLocalHostingNotSupportedError extends Error {
  readonly code = 'local_hosting_not_available';
  constructor(message = 'Local AI brain hosting is not available yet') {
    super(message);
  }
}

const BRAIN_SCOPES: PermissionScope[] = ['brain.query', 'brain.knowledge_read'];

/** OpenRouter-canonical id (proxy strips the `openrouter/` prefix). */
const DEFAULT_BRAIN_MODEL = 'openrouter/anthropic/claude-sonnet-4.6';

function isLegacyBrainModel(model: string | null | undefined): boolean {
  const m = (model ?? '').trim().toLowerCase();
  if (!m) return true;
  // Bare ids like `claude-sonnet-4-6` are rejected by OpenRouter.
  if (!m.includes('/')) return true;
  if (m === 'claude-sonnet-4-6' || m === 'openrouter/claude-sonnet-4-6') return true;
  return false;
}

export class BrainAgentService {
  constructor(
    private readonly repo = new AgentsRepository(),
    private readonly vcService = new CredentialsService(),
  ) {}

  async getOrgBrainAgent(orgId: string): Promise<AgentDTO | null> {
    const row = await prisma.agent.findFirst({
      where: { orgId, agentKind: 'org_brain' },
    });
    return row ? this.repo.findById(row.id) : null;
  }

  /** Ensures the org brain is named `exa` and uses a valid OpenRouter model id. */
  async normalizeOrgBrain(orgId: string): Promise<AgentDTO | null> {
    const brain = await this.getOrgBrainAgent(orgId);
    if (!brain) return null;
    await this.clearStaleBrainRunnerFields(brain.id);
    const patch: { name?: string; llmModel?: string } = {};
    if (brain.name !== 'exa') patch.name = 'exa';
    if (isLegacyBrainModel(brain.model)) patch.llmModel = DEFAULT_BRAIN_MODEL;
    if (Object.keys(patch).length > 0) {
      await prisma.agent.update({
        where: { id: brain.id },
        data: patch,
      });
    }
    return this.getOrgBrainAgent(orgId);
  }

  /**
   * Creates the canonical org brain agent when missing. Requires org owner or admin and verified device.
   */
  async ensureOrgBrainAgent(
    userId: string,
    orgId: string,
    orgRole: string,
    requestForBackendUrl?: Request,
    options?: { hosting?: BrainHosting },
  ): Promise<AgentDTO> {
    const hosting = options?.hosting ?? 'cloud';
    if (hosting === 'local') {
      throw new BrainAgentLocalHostingNotSupportedError();
    }

    await this.repo.assertOrgMembership(userId, orgId);
    if (!roleCan(orgRole, 'manage_brain')) {
      throw new BrainAgentForbiddenError();
    }
    await this.repo.assertDeviceVerified(userId);

    const existing = await this.getOrgBrainAgent(orgId);
    if (existing) {
      await this.clearStaleBrainRunnerFields(existing.id);
      const patch: { name?: string; llmModel?: string } = {};
      if (existing.name !== 'exa') patch.name = 'exa';
      if (isLegacyBrainModel(existing.model)) patch.llmModel = DEFAULT_BRAIN_MODEL;
      if (Object.keys(patch).length > 0) {
        await prisma.agent.update({
          where: { id: existing.id },
          data: patch,
        });
      }
      return (await this.getOrgBrainAgent(orgId)) ?? existing;
    }

    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { name: true },
    });
    if (!org) {
      throw new OrgMembershipError('Organization not found');
    }

    const { jitScopes, alwaysScopes } = enforceJitRules(BRAIN_SCOPES, []);
    const did = generateDID();
    const { publicKey } = await generateKeypair();
    const { webauthnCredentialId } = await this.repo.assertDeviceVerified(userId);

    const name = 'exa';
    const llmProvider = defaultLlmProvider();
    const agent = await this.repo.createAgent({
      userId,
      orgId,
      name,
      did,
      publicKey,
      /** RAG runs on the Qlix API — no Docker cloud runner. */
      runtime: 'local',
      model: modelForProvider(DEFAULT_BRAIN_MODEL, llmProvider),
      llmMode: 'proxy',
      llmProvider,
      localInferenceMode: 'cloud_api',
      permissionScopes: BRAIN_SCOPES,
      jitScopes,
      alwaysScopes,
      webauthnCredentialId,
      agentKind: 'org_brain',
    });

    await this.vcService.issueAgentVCs({
      id: agent.id,
      did: agent.did,
      webauthnCredentialId: agent.webauthnCredentialId,
      permissionScopes: agent.permissionScopes,
      jitScopes: agent.jitScopes,
      alwaysScopes: agent.alwaysScopes,
    });

    await appendBrainActionLog({
      brainAgentId: agent.id,
      userId,
      actionType: 'brain.ensure_agent',
      payload: {
        description: 'Provisioned canonical org AI brain agent (DID + scope credentials)',
        agentId: agent.id,
      },
      status: 'success',
      riskLevel: 'medium',
    });

    return agent;
  }

  /** Org brain does not use a cloud runner; clear legacy runner fields from older provisions. */
  private async clearStaleBrainRunnerFields(agentId: string): Promise<void> {
    await prisma.agent
      .update({
        where: { id: agentId },
        data: {
          runtime: 'local',
          llmMode: 'proxy',
          localInferenceMode: 'cloud_api',
          cloudProvisioningStatus: null,
          cloudProvisioningError: null,
          cloudRunnerId: null,
          cloudPrivateKeyEnc: null,
          cloudRunnerTokenEnc: null,
        },
      })
      .catch(() => {});
  }
}
