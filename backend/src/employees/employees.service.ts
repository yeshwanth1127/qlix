import { AgentsService } from '../agents/agents.service.js';
import type { PermissionScope } from '../agents/agents.types.js';
import { wireAgentMcpFromScopes } from '../agents/agentMcpWire.js';
import { CredentialsService } from '../credentials/credentials.service.js';
import { prisma } from '../lib/prisma.js';
import { compileEmployeeSystemPrompt } from './compileSystemPrompt.js';
import { appendEmployeeAuditLog } from './employeeAudit.service.js';
import { EmployeesRepository } from './employees.repository.js';
import type { EmployeeEngagementDTO, EmployeeRoleManifest, PreflightResult } from './employees.types.js';
import { hashRoleManifest } from './packHash.js';
import { getRoleManifest, resolvePreflight } from './packResolver.js';

export class EmployeeNotFoundError extends Error {
  readonly code = 'not_found';
  constructor() {
    super('Employee engagement not found');
  }
}

export class EmployeeHireForbiddenError extends Error {
  readonly code = 'hire_forbidden';
  constructor(message: string) {
    super(message);
  }
}

export class EmployeesService {
  constructor(
    private readonly repo: EmployeesRepository = new EmployeesRepository(),
    private readonly agentsService: AgentsService = new AgentsService(),
    private readonly vcService: CredentialsService = new CredentialsService(),
  ) {}

  async resolveWorkspaceOrgId(userId: string): Promise<string> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { orgId: true },
    });
    if (!user?.orgId) throw new EmployeeHireForbiddenError('Workspace org not found');
    return user.orgId;
  }

  async preflight(
    userId: string,
    roleSlug: string,
    selectedPlatformIds: string[] = [],
  ): Promise<PreflightResult> {
    const workspaceOrgId = await this.resolveWorkspaceOrgId(userId);
    const manifest = getRoleManifest(roleSlug);
    if (!manifest) throw new EmployeeNotFoundError();
    return resolvePreflight(workspaceOrgId, manifest, selectedPlatformIds);
  }

  async hire(input: {
    userId: string;
    roleSlug: string;
    name?: string;
    limitedMode?: boolean;
    selectedPlatformIds?: string[];
    configOverrides?: Record<string, unknown>;
  }): Promise<{ engagement: EmployeeEngagementDTO; credentials: Awaited<ReturnType<CredentialsService['issueAgentVCs']>> }> {
    const workspaceOrgId = await this.resolveWorkspaceOrgId(input.userId);
    const manifest = getRoleManifest(input.roleSlug);
    if (!manifest) throw new EmployeeNotFoundError();

    const selectedPlatformIds = input.selectedPlatformIds ?? [];
    const preflight = await resolvePreflight(workspaceOrgId, manifest, selectedPlatformIds);
    if (preflight.hireMode === 'unavailable') {
      throw new EmployeeHireForbiddenError(
        preflight.messages.join(' ') || 'This role cannot be hired in the current workspace',
      );
    }
    if (preflight.hireMode === 'limited' && !input.limitedMode && preflight.readiness !== 'ready') {
      throw new EmployeeHireForbiddenError(
        'Some connectors or knowledge are missing. Confirm limited hire or connect required platforms first.',
      );
    }

    const displayName = input.name?.trim() || manifest.label;
    const packHash = hashRoleManifest(manifest);
    const description = compileEmployeeSystemPrompt(manifest, displayName);

    const agentOrgId = workspaceOrgId;
    let agentResult: Awaited<ReturnType<AgentsService['createAgent']>> | null = null;

    try {
      agentResult = await this.agentsService.createAgent(input.userId, {
        orgId: agentOrgId,
        name: displayName,
        description,
        permissionScopes: preflight.resolvedScopes as PermissionScope[],
        jitScopes: preflight.resolvedJitScopes as PermissionScope[],
        runtime: preflight.resolvedRuntime,
        model: manifest.model,
        llmMode: 'proxy',
        localInferenceMode: null,
      });

      await wireAgentMcpFromScopes({
        userId: input.userId,
        orgId: agentOrgId,
        agentId: agentResult.agent.id,
        scopes: preflight.resolvedScopes,
      });

      const engagement = await this.repo.createEngagement({
        agentId: agentResult.agent.id,
        workspaceOrgId,
        hiredByUserId: input.userId,
        roleSlug: manifest.slug,
        packVersion: manifest.version,
        packHash,
        packSnapshot: structuredClone(manifest) as EmployeeRoleManifest,
        configOverrides: {
          ...input.configOverrides,
          selectedPlatformIds,
        },
      });

      await this.vcService.issueEmploymentVC(
        {
          id: agentResult.agent.id,
          did: agentResult.agent.did,
          webauthnCredentialId: agentResult.agent.webauthnCredentialId,
          permissionScopes: agentResult.agent.permissionScopes,
          jitScopes: agentResult.agent.jitScopes,
          alwaysScopes: agentResult.agent.alwaysScopes,
        },
        {
          roleSlug: manifest.slug,
          packVersion: manifest.version,
          packHash,
          hiredAt: engagement.hiredAt,
        },
      );

      await appendEmployeeAuditLog({
        agentId: agentResult.agent.id,
        userId: input.userId,
        actionType: 'employee.hired',
        payload: {
          engagementId: engagement.id,
          roleSlug: manifest.slug,
          packVersion: manifest.version,
          packHash,
          hireMode: preflight.hireMode,
        },
      });

      // Pre-bind a gateway sessionKey so the first chat turn reuses a stable lane.
      try {
        const { buildSessionKey } = await import('../gateway/sessionKey.js');
        const sessionKey = buildSessionKey({
          orgId: agentOrgId,
          userId: input.userId,
          channel: 'web',
          peerId: input.userId,
          threadId: `employee:${engagement.id}`,
        });
        const { getOrCreatePrimaryConversation } = await import('../agentChat/conversationService.js');
        const primary = await getOrCreatePrimaryConversation({
          agentId: agentResult.agent.id,
          userId: input.userId,
          orgId: agentOrgId,
        });
        await prisma.agentConversation.update({
          where: { id: primary.id },
          data: { sessionKey },
        });
      } catch (sessionErr) {
        console.warn(
          '[employees] sessionKey bind failed',
          sessionErr instanceof Error ? sessionErr.message : sessionErr,
        );
      }

      return { engagement, credentials: agentResult.credentials };
    } catch (err) {
      if (agentResult?.agent.id) {
        try {
          await prisma.agent.delete({ where: { id: agentResult.agent.id } });
        } catch {
          // Best-effort rollback
        }
      }
      throw err;
    }
  }

  async listEngagements(userId: string): Promise<EmployeeEngagementDTO[]> {
    const workspaceOrgId = await this.resolveWorkspaceOrgId(userId);
    return this.repo.listForWorkspace(workspaceOrgId);
  }

  async getEngagement(userId: string, id: string): Promise<EmployeeEngagementDTO> {
    const workspaceOrgId = await this.resolveWorkspaceOrgId(userId);
    const engagement = await this.repo.findById(id);
    if (!engagement || engagement.workspaceOrgId !== workspaceOrgId) {
      throw new EmployeeNotFoundError();
    }
    return engagement;
  }

  async suspend(userId: string, id: string): Promise<EmployeeEngagementDTO> {
    const engagement = await this.getEngagement(userId, id);
    if (engagement.status !== 'active') {
      throw new EmployeeHireForbiddenError('Only active employees can be suspended');
    }
    const updated = await this.repo.updateStatus(id, 'suspended', { suspendedAt: new Date() });
    await prisma.agent.update({
      where: { id: engagement.agentId },
      data: { status: 'suspended' },
    });
    await appendEmployeeAuditLog({
      agentId: engagement.agentId,
      userId,
      actionType: 'employee.suspended',
      payload: { engagementId: id, roleSlug: engagement.roleSlug },
    });
    return updated;
  }

  async reactivate(userId: string, id: string): Promise<EmployeeEngagementDTO> {
    const engagement = await this.getEngagement(userId, id);
    if (engagement.status !== 'suspended') {
      throw new EmployeeHireForbiddenError('Only suspended employees can be reactivated');
    }
    const updated = await this.repo.updateStatus(id, 'active', { suspendedAt: null });
    await prisma.agent.update({
      where: { id: engagement.agentId },
      data: { status: 'active' },
    });
    await appendEmployeeAuditLog({
      agentId: engagement.agentId,
      userId,
      actionType: 'employee.reactivated',
      payload: { engagementId: id, roleSlug: engagement.roleSlug },
    });
    return updated;
  }
}
