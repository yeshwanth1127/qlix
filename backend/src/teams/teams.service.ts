import { buildAgentCard } from '../agents/agentCard.js';
import { AgentsService } from '../agents/agents.service.js';
import { AgentsRepository } from '../agents/agents.repository.js';
import type { AgentDTO, PermissionScope } from '../agents/agents.types.js';
import type { DockerTeamContext } from '../cloudRunners/dockerNaming.js';
import { writePendingTeamContext } from '../cloudRunners/pendingTeamContext.js';
import { generateDID } from '../agents/did.js';
import { CloudProvisionerService } from '../cloudRunners/cloudProvisioner.service.js';
import { hasEmailConnector } from '../connectors/emailTool.service.js';
import { GMAIL_CONNECT_SHORT } from '../connectors/connectorUserMessages.js';
import { prisma } from '../lib/prisma.js';
import {
  assertRunnersReady,
  buildTeamRunnersStatus,
} from './teamRunners.service.js';
import type {
  AddTeamMemberInput,
  CreateTeamInput,
  ReorderTeamMembersInput,
  TeamDTO,
  TeamMemberDTO,
  TeamRunCheckpoint,
  TeamRunDTO,
  TeamRunReplyChannel,
  TeamRunSourceChannel,
  TeamRunnersStatusDTO,
} from './teams.types.js';
import { TeamsRepository } from './teams.repository.js';
import { TeamOrchestrator } from './teamOrchestrator.js';

function formatWaitHours(hours: number): string {
  if (hours === 1) return '1 hour';
  if (Number.isInteger(hours)) return `${hours} hours`;
  return `${hours} hours`;
}

export class TeamNotFoundError extends Error {
  readonly code = 'not_found';
  constructor() { super('Team not found'); }
}

export class TeamForbiddenError extends Error {
  readonly code = 'forbidden';
  constructor(msg = 'Not authorized for this team') { super(msg); }
}

export class TeamNoSupervisorError extends Error {
  readonly code = 'no_supervisor';
  constructor() { super('Team has no supervisor assigned. Create a supervisor agent before starting a run.'); }
}

export class TeamMemberAlreadyExistsError extends Error {
  readonly code = 'member_exists';
  constructor() { super('Agent is already a member of this team'); }
}

export class TeamMemberNotFoundError extends Error {
  readonly code = 'member_not_found';
  constructor() { super('Agent is not a member of this team'); }
}

export class TeamScopeExceedsAgentError extends Error {
  readonly code = 'scope_exceeds_agent';
  constructor(offending: string[]) {
    super(`Delegated scopes exceed agent capabilities: ${offending.join(', ')}`);
  }
}

export class TeamAgentNotInOrgError extends Error {
  readonly code = 'agent_wrong_org';
  constructor() { super('Agent does not belong to this organization'); }
}

export class TeamAgentMustBeCloudError extends Error {
  readonly code = 'agent_must_be_cloud';
  constructor() { super('Team agents must use cloud or hybrid runtime'); }
}

export class TeamRunnersNotReadyError extends Error {
  readonly code = 'team_runners_not_ready';
  constructor(message: string) { super(message); }
}

export class TeamEmailConnectorRequiredError extends Error {
  readonly code = 'email_connector_required';
  constructor() {
    super(`No Gmail or Microsoft 365 mailbox is connected for this workspace. ${GMAIL_CONNECT_SHORT}`);
  }
}

export class TeamContinuesRunError extends Error {
  readonly code = 'invalid_continues_run';
  readonly status = 400;
  constructor(message = 'continuesRunId is not a finished run on this team') {
    super(message);
  }
}

export class TeamConfirmNameMismatchError extends Error {
  readonly code = 'confirm_name_mismatch';
  constructor(expected: 'team' | 'agent') {
    super(
      expected === 'team'
        ? 'Confirmation name does not match team name'
        : 'Confirmation name does not match agent name',
    );
  }
}

export class TeamNoSupervisorToDeleteError extends Error {
  readonly code = 'no_supervisor';
  constructor() {
    super('Team has no supervisor to delete');
  }
}

export class TeamsService {
  private readonly repo = new TeamsRepository();
  private readonly agentsRepo = new AgentsRepository();
  private readonly agentsService = new AgentsService();
  private readonly cloudProvisioner = new CloudProvisionerService();
  private readonly defaultBackendUrl = process.env.PUBLIC_API_URL?.trim() || '';
  private readonly autoReprovision = process.env.QLIX_TEAM_AUTO_REPROVISION === '1';

  async createTeam(userId: string, input: CreateTeamInput, backendBaseUrl: string): Promise<TeamDTO> {
    // Supervisor is optional at creation — assigned later via PATCH /:id/supervisor
    if (input.supervisorAgentId) {
      await this.assertAgentInOrg(input.supervisorAgentId, input.orgId);
    }

    // Validate each member agent belongs to org and scopes don't exceed capabilities
    for (const m of (input.members ?? [])) {
      const agent = await this.assertAgentInOrg(m.agentId, input.orgId);
      this.assertDelegatedScopesValid(m.delegatedScopes, agent.permissionScopes);
    }

    const did = generateDID();

    // Build agent card snapshots for members
    const membersWithCards = await Promise.all(
      (input.members ?? []).map(async (m) => {
        const agent = await this.agentsRepo.findById(m.agentId);
        const agentCardSnapshot = agent ? buildAgentCard(agent, backendBaseUrl) : null;
        return { ...m, agentCardSnapshot };
      }),
    );

    // Draft until a supervisor exists. NL/API create often passes supervisorAgentId
    // up front — those teams must be active, same as PATCH /supervisor.
    const team = await this.repo.createTeam({
      ...input,
      members: membersWithCards,
      did,
      createdByUserId: userId,
    });

    if (input.supervisorAgentId) {
      const supervisor = await this.agentsRepo.findById(input.supervisorAgentId);
      if (supervisor) {
        await this.applyMemberTeamContext(
          supervisor,
          team.id,
          team.name,
          'supervisor',
          backendBaseUrl,
        );
      }
    }
    for (const member of input.members ?? []) {
      const worker = await this.agentsRepo.findById(member.agentId);
      if (!worker) continue;
      await this.applyMemberTeamContext(worker, team.id, team.name, 'worker', backendBaseUrl);
    }

    return team;
  }

  async setSupervisor(
    teamId: string,
    orgId: string,
    agentId: string,
    backendUrl: string,
  ): Promise<TeamDTO> {
    const team = await this.repo.findByIdAndOrg(teamId, orgId);
    if (!team) throw new TeamNotFoundError();
    const agent = await this.assertCloudAgentInOrg(agentId, orgId);
    const updated = await this.repo.setSupervisor(teamId, agentId);
    await this.applyMemberTeamContext(agent, teamId, team.name, 'supervisor', backendUrl);
    // Activate the team once it has a supervisor
    if (updated.status === 'draft') {
      await this.repo.updateStatus(teamId, 'active');
      return { ...updated, status: 'active' };
    }
    return updated;
  }

  async listTeams(orgId: string): Promise<TeamDTO[]> {
    const teams = await this.repo.listTeams(orgId);
    return Promise.all(teams.map((team) => this.activateIfSupervisorAssigned(team)));
  }

  async getTeam(id: string, orgId: string): Promise<TeamDTO> {
    const team = await this.repo.findByIdAndOrg(id, orgId);
    if (!team) throw new TeamNotFoundError();
    return this.activateIfSupervisorAssigned(team);
  }

  async deleteTeam(
    id: string,
    orgId: string,
    userId: string,
    userRole: string,
    confirmName: string,
  ): Promise<void> {
    const team = await this.repo.findByIdAndOrg(id, orgId);
    if (!team) throw new TeamNotFoundError();
    this.assertCanManageTeam(team.createdByUserId, userId, userRole);

    if (confirmName.trim() !== team.name.trim()) {
      throw new TeamConfirmNameMismatchError('team');
    }

    const agentIds = this.collectTeamAgentIds(team);
    for (const agentId of agentIds) {
      const agent = await this.agentsRepo.findById(agentId);
      if (!agent) continue;
      await this.teardownAgentDocker(agent, team);
    }

    await this.repo.deleteById(id);

    for (const agentId of agentIds) {
      const agent = await this.agentsRepo.findById(agentId);
      if (!agent) continue;
      try {
        await this.agentsService.deleteAgent(userId, orgId, userRole, agentId, agent.name);
      } catch (err) {
        console.warn(`[deleteTeam] failed to delete agent ${agentId}:`, err);
      }
    }
  }

  async deleteSupervisor(
    teamId: string,
    orgId: string,
    userId: string,
    userRole: string,
    confirmName: string,
  ): Promise<TeamDTO> {
    const team = await this.repo.findByIdAndOrg(teamId, orgId);
    if (!team) throw new TeamNotFoundError();
    this.assertCanManageTeam(team.createdByUserId, userId, userRole);
    if (!team.supervisorAgentId) throw new TeamNoSupervisorToDeleteError();

    const agent = await this.assertAgentInOrg(team.supervisorAgentId, orgId);
    if (confirmName.trim() !== agent.name.trim()) {
      throw new TeamConfirmNameMismatchError('agent');
    }

    await this.repo.clearSupervisor(teamId);
    await this.teardownAgentDocker(agent, team);
    await this.agentsService.deleteAgent(userId, orgId, userRole, agent.id, agent.name);

    const updated = await this.repo.findByIdAndOrg(teamId, orgId);
    if (!updated) throw new TeamNotFoundError();
    return updated;
  }

  async deleteMemberAgent(
    teamId: string,
    orgId: string,
    userId: string,
    userRole: string,
    agentId: string,
    confirmName: string,
  ): Promise<void> {
    const team = await this.repo.findByIdAndOrg(teamId, orgId);
    if (!team) throw new TeamNotFoundError();
    this.assertCanManageTeam(team.createdByUserId, userId, userRole);

    if (team.supervisorAgentId === agentId) {
      throw new TeamMemberNotFoundError();
    }
    if (!(await this.repo.isMember(teamId, agentId))) {
      throw new TeamMemberNotFoundError();
    }

    const agent = await this.assertAgentInOrg(agentId, orgId);
    if (confirmName.trim() !== agent.name.trim()) {
      throw new TeamConfirmNameMismatchError('agent');
    }

    await this.repo.removeMember(teamId, agentId);
    await this.teardownAgentDocker(agent, team);
    await this.agentsService.deleteAgent(userId, orgId, userRole, agentId, agent.name);
  }

  async addMember(
    teamId: string,
    orgId: string,
    input: AddTeamMemberInput,
    backendBaseUrl: string,
  ): Promise<TeamMemberDTO> {
    const team = await this.repo.findByIdAndOrg(teamId, orgId);
    if (!team) throw new TeamNotFoundError();

    const agent = await this.assertCloudAgentInOrg(input.agentId, orgId);
    this.assertDelegatedScopesValid(input.delegatedScopes, agent.permissionScopes);

    if (await this.repo.isMember(teamId, input.agentId)) {
      throw new TeamMemberAlreadyExistsError();
    }

    const agentCardSnapshot = buildAgentCard(agent, backendBaseUrl);
    const member = await this.repo.addMember(teamId, { ...input, agentCardSnapshot });
    await this.applyMemberTeamContext(agent, teamId, team.name, 'worker', backendBaseUrl);
    return member;
  }

  async updateMemberScopes(
    teamId: string,
    orgId: string,
    agentId: string,
    delegatedScopes: PermissionScope[],
    backendUrl?: string,
  ): Promise<TeamMemberDTO> {
    const team = await this.repo.findByIdAndOrg(teamId, orgId);
    if (!team) throw new TeamNotFoundError();
    if (!(await this.repo.isMember(teamId, agentId))) throw new TeamMemberNotFoundError();

    const agent = await this.assertCloudAgentInOrg(agentId, orgId);
    this.assertDelegatedScopesValid(delegatedScopes, agent.permissionScopes);
    const updated = await this.repo.updateMemberScopes(teamId, agentId, delegatedScopes);
    // Ensure the worker container picks up new delegated scopes + latest runner runtime.
    const url = (backendUrl || this.defaultBackendUrl).trim();
    if (url && this.autoReprovision) {
      this.cloudProvisioner.scheduleApplyTeamContext({
        agentId,
        teamId,
        teamName: team.name,
        role: 'worker',
        backendUrl: url,
      });
    }
    return updated;
  }

  async removeMember(teamId: string, orgId: string, agentId: string): Promise<void> {
    const team = await this.repo.findByIdAndOrg(teamId, orgId);
    if (!team) throw new TeamNotFoundError();
    if (!(await this.repo.isMember(teamId, agentId))) throw new TeamMemberNotFoundError();
    await this.repo.removeMember(teamId, agentId);
  }

  async reorderMembers(
    teamId: string,
    orgId: string,
    userId: string,
    userRole: string,
    input: ReorderTeamMembersInput,
  ): Promise<TeamDTO> {
    const team = await this.repo.findByIdAndOrg(teamId, orgId);
    if (!team) throw new TeamNotFoundError();
    this.assertCanManageTeam(team.createdByUserId, userId, userRole);
    // `memberIds` is the flat form: every member gets its own stage, so nothing runs
    // concurrently. `stages` is the grouped form and wins when both are supplied.
    const stages = input.stages ?? (input.memberIds ?? []).map((id) => [id]);
    if (stages.length === 0) {
      throw new Error('reorderMembers: memberIds or stages is required');
    }
    return this.repo.reorderMembers(teamId, stages);
  }

  async updateConfig(
    teamId: string,
    orgId: string,
    userId: string,
    userRole: string,
    patch: { autoSequence?: boolean; pipelineMode?: boolean; defaultModel?: string },
  ): Promise<TeamDTO> {
    const team = await this.repo.findByIdAndOrg(teamId, orgId);
    if (!team) throw new TeamNotFoundError();
    this.assertCanManageTeam(team.createdByUserId, userId, userRole);
    return this.repo.updateConfig(teamId, patch);
  }

  async startRun(
    teamId: string,
    orgId: string,
    userId: string,
    goal: string,
    opts?: {
      sourceChannel?: TeamRunSourceChannel;
      sourceConnectorId?: string | null;
      replyChannel?: TeamRunReplyChannel;
      continuesRunId?: string | null;
      inputs?: import('./teams.types.js').TeamRunInput[];
    },
    backendUrl?: string,
  ): Promise<TeamRunDTO> {
    const team = await this.repo.findByIdAndOrg(teamId, orgId);
    if (!team) throw new TeamNotFoundError();
    if (!team.supervisorAgentId) throw new TeamNoSupervisorError();

    // Best-effort: refresh team runner containers (new runtime hash / scopes) before this run.
    // This prevents "think-only" loops caused by stale runner images.
    const url = (backendUrl || this.defaultBackendUrl).trim();
    if (url && this.autoReprovision) {
      this.cloudProvisioner.scheduleApplyTeamContext({
        agentId: team.supervisorAgentId,
        teamId,
        teamName: team.name,
        role: 'supervisor',
        backendUrl: url,
      });
      for (const m of team.members ?? []) {
        this.cloudProvisioner.scheduleApplyTeamContext({
          agentId: m.agentId,
          teamId,
          teamName: team.name,
          role: 'worker',
          backendUrl: url,
        });
      }
    }

    const status = await this.getRunnersStatus(teamId, orgId);
    try {
      assertRunnersReady(status);
    } catch (err) {
      throw new TeamRunnersNotReadyError(err instanceof Error ? err.message : 'Team runners not ready');
    }

    const emailScopes = new Set(['email.read', 'email.send']);
    const needsEmail = (team.members ?? []).some((m) =>
      m.delegatedScopes.some((s) => emailScopes.has(s)),
    );
    if (needsEmail) {
      const connected = await hasEmailConnector(orgId);
      if (!connected) throw new TeamEmailConnectorRequiredError();
    }

    return this.repo.createRun(teamId, orgId, userId, goal, opts);
  }

  async getRunnersStatus(teamId: string, orgId: string): Promise<TeamRunnersStatusDTO> {
    const team = await this.repo.findByIdAndOrg(teamId, orgId);
    if (!team) throw new TeamNotFoundError();

    const agentIds = new Set<string>();
    if (team.supervisorAgentId) agentIds.add(team.supervisorAgentId);
    for (const m of team.members ?? []) agentIds.add(m.agentId);

    const agents = new Map<string, AgentDTO>();
    for (const id of agentIds) {
      const agent = await this.agentsRepo.findById(id);
      if (agent) agents.set(id, agent);
    }

    return buildTeamRunnersStatus(team, agents);
  }

  async listRuns(teamId: string, orgId: string): Promise<TeamRunDTO[]> {
    const team = await this.repo.findByIdAndOrg(teamId, orgId);
    if (!team) throw new TeamNotFoundError();
    return this.repo.listRuns(teamId);
  }

  async getRun(teamId: string, runId: string, orgId: string): Promise<TeamRunDTO> {
    const team = await this.repo.findByIdAndOrg(teamId, orgId);
    if (!team) throw new TeamNotFoundError();
    const run = await this.repo.findRun(runId);
    if (!run || run.teamId !== teamId) throw new TeamNotFoundError();
    return run;
  }

  /**
   * User-selected wait duration for a paused WhatsApp collect wait.
   * Applies the same expiresAt to every still-open wait for the run.
   */
  async setWaitTtlHours(
    teamId: string,
    runId: string,
    orgId: string,
    hours: number,
  ): Promise<{ expiresAt: string; hours: number; updatedWaits: number; sentCount: number }> {
    const {
      WaitTriggerService,
      clampWaitTtlHours,
    } = await import('./waitTrigger.service.js');
    const ttlHours = clampWaitTtlHours(hours);
    const run = await this.getRun(teamId, runId, orgId);
    if (run.status !== 'paused') {
      const err = new Error('Run is not waiting for WhatsApp replies') as Error & { status?: number; code?: string };
      err.status = 409;
      err.code = 'run_not_paused';
      throw err;
    }
    const checkpoint = run.checkpointJson as TeamRunCheckpoint | null | undefined;
    if (!checkpoint?.awaitingTtlSelection) {
      const err = new Error('Wait duration was already set for this pause') as Error & {
        status?: number;
        code?: string;
      };
      err.status = 409;
      err.code = 'ttl_already_set';
      throw err;
    }

    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
    const waitTriggers = new WaitTriggerService();

    // Deliver queued outreach only now — wait mode + duration are set, live sheet is ready.
    const { flushPendingWaitOutbounds } = await import('../wait/pendingWaitOutbound.js');
    const activeStep = checkpoint.waitPolicySnapshot
      ? (await import('../wait/waitPolicy.js')).getActiveWaitStep(checkpoint.waitPolicySnapshot)
      : null;
    const fulfillment = activeStep?.trigger.fulfillment ?? 'collect_until_timeout';
    const flush = await flushPendingWaitOutbounds({
      teamRunId: run.id,
      orgId: run.orgId,
      userId: run.startedByUserId,
      fulfillment,
      ttlHours,
    });

    const updatedWaits = await waitTriggers.setExpiresAtForOpenTeamWaits(run.id, expiresAt);
    const uniqueSentContacts = new Set(
      flush.sent.filter((row) => row.ok).map((row) => row.jid).filter(Boolean),
    );
    const contactCount = Math.max(
      flush.triggerIds.length,
      checkpoint.waitTriggerIds?.length ?? 0,
      uniqueSentContacts.size,
    );
    const nextCheckpoint: TeamRunCheckpoint = {
      ...flush.checkpoint,
      awaitingTtlSelection: false,
      waitExpiresAt: expiresAt.toISOString(),
      waitTtlHours: ttlHours,
      waitTriggerIds: flush.triggerIds.length > 0 ? flush.triggerIds : checkpoint.waitTriggerIds,
      // Keep any failed outbounds from flush; clear only when empty.
      pendingWaitOutbounds: flush.checkpoint.pendingWaitOutbounds ?? [],
      waitReason:
        `Waiting for WhatsApp replies from ${contactCount} contacted lead` +
        `${contactCount === 1 ? '' : 's'} ` +
        `(up to ${formatWaitHours(ttlHours)}, until ${expiresAt.toISOString()}).`,
    };
    await this.repo.updateRunStatus(run.id, 'paused', { checkpointJson: nextCheckpoint });

    const sentOk = flush.sent.filter((row) => row.ok).length;
    if (flush.sent.length > 0) {
      await this.repo.appendEvent(run.id, teamId, null, 'wait_progress', {
        phase: 'messages_sent',
        sent: sentOk,
        failed: flush.sent.length - sentOk,
        recipients: flush.sent,
        // Same fields as reply-progress events so the chat UI can show "0 of N received".
        received: 0,
        remaining: contactCount,
        total: contactCount,
        reason:
          sentOk > 0
            ? `Sent ${sentOk} WhatsApp message${sentOk === 1 ? '' : 's'} — now listening for replies.`
            : 'Failed to send queued WhatsApp messages.',
      });
    }

    // Explicit listening baseline when waits were already armed (nothing deferred to flush).
    if (flush.sent.length === 0 && contactCount > 0) {
      await this.repo.appendEvent(run.id, teamId, null, 'wait_progress', {
        phase: 'listening',
        received: 0,
        remaining: contactCount,
        total: contactCount,
        reason: `Listening for WhatsApp replies from ${contactCount} contact${contactCount === 1 ? '' : 's'}.`,
      });
    }

    await this.repo.appendEvent(run.id, teamId, null, 'wait_ttl_set', {
      hours: ttlHours,
      expiresAt: expiresAt.toISOString(),
      updatedWaits,
      sentCount: sentOk,
      reason: nextCheckpoint.waitReason,
    });
    return {
      expiresAt: expiresAt.toISOString(),
      hours: ttlHours,
      updatedWaits,
      sentCount: sentOk,
    };
  }

  // ─── Internal helpers ───────────────────────────────────────────────────────

  private async activateIfSupervisorAssigned(team: TeamDTO): Promise<TeamDTO> {
    if (team.status !== 'draft' || !team.supervisorAgentId) return team;
    await this.repo.updateStatus(team.id, 'active');
    return { ...team, status: 'active' };
  }

  private async applyMemberTeamContext(
    agent: AgentDTO,
    teamId: string,
    teamName: string,
    role: 'supervisor' | 'worker',
    backendUrl: string,
  ): Promise<void> {
    const teamContext: DockerTeamContext = { id: teamId, name: teamName, role };
    if (await this.deferTeamContextIfNeeded(agent, teamContext)) return;
    this.cloudProvisioner.scheduleApplyTeamContext({
      agentId: agent.id,
      teamId,
      teamName,
      role,
      backendUrl,
    });
  }

  private async deferTeamContextIfNeeded(
    agent: AgentDTO,
    teamContext: DockerTeamContext,
  ): Promise<boolean> {
    if (agent.runtime !== 'cloud') return false;
    // Initial provision still running — attach team network on first container start instead of rebuilding.
    if (agent.cloudRunnerId) return false;
    await writePendingTeamContext(this.cloudProvisioner.runnerStateRoot(), agent.id, teamContext);
    return true;
  }

  private async assertAgentInOrg(agentId: string, orgId: string): Promise<AgentDTO> {
    const agent = await this.agentsRepo.findById(agentId);
    if (!agent || agent.orgId !== orgId) throw new TeamAgentNotInOrgError();
    return agent;
  }

  private async assertCloudAgentInOrg(agentId: string, orgId: string): Promise<AgentDTO> {
    const agent = await this.assertAgentInOrg(agentId, orgId);
    if (agent.runtime !== 'cloud' && agent.runtime !== 'hybrid') throw new TeamAgentMustBeCloudError();
    return agent;
  }

  private assertDelegatedScopesValid(
    delegated: PermissionScope[],
    agentScopes: PermissionScope[],
  ): void {
    const agentSet = new Set(agentScopes);
    const offending = delegated.filter((s) => !agentSet.has(s));
    if (offending.length > 0) throw new TeamScopeExceedsAgentError(offending);
  }

  private assertCanManageTeam(createdByUserId: string, userId: string, userRole: string): void {
    if (createdByUserId === userId) return;
    if (['owner', 'admin'].includes(userRole)) return;
    throw new TeamForbiddenError('Only team creator, admin, or owner can modify this team');
  }

  private collectTeamAgentIds(team: TeamDTO): string[] {
    const ids = new Set<string>();
    if (team.supervisorAgentId) ids.add(team.supervisorAgentId);
    for (const m of team.members ?? []) ids.add(m.agentId);
    return [...ids];
  }

  private teamContextForAgent(
    team: TeamDTO,
    agentId: string,
  ): DockerTeamContext | null {
    if (team.supervisorAgentId === agentId) {
      return { id: team.id, name: team.name, role: 'supervisor' };
    }
    if (team.members?.some((m) => m.agentId === agentId)) {
      return { id: team.id, name: team.name, role: 'worker' };
    }
    return null;
  }

  private async teardownAgentDocker(agent: AgentDTO, team: TeamDTO): Promise<void> {
    if (agent.runtime !== 'cloud') return;
    try {
      await this.cloudProvisioner.teardownCloudRunner({
        agentId: agent.id,
        name: agent.name,
        did: agent.did,
        cloudRunnerId: agent.cloudRunnerId,
        teamContext: this.teamContextForAgent(team, agent.id),
      });
    } catch (err) {
      console.warn(`[teams] Docker teardown failed for ${agent.id}:`, err);
    }
  }
}
