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
  TeamRunDTO,
  TeamRunReplyChannel,
  TeamRunSourceChannel,
  TeamRunnersStatusDTO,
} from './teams.types.js';
import { TeamsRepository } from './teams.repository.js';
import { TeamOrchestrator } from './teamOrchestrator.js';
import { approveLeadOutreachForTeamRun } from '../leads/leadOutreachGate.js';
import { findLeadReviewCheckpoint, memberLeadGenStage } from '../leads/leadGenPipelineGoals.js';

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
    super(`Gmail is not connected for this workspace. ${GMAIL_CONNECT_SHORT}`);
  }
}

export class TeamRunNotPausedError extends Error {
  readonly code = 'run_not_paused';
  constructor() {
    super('Team run is not paused awaiting lead review');
  }
}

export class TeamRunNoLeadCheckpointError extends Error {
  readonly code = 'no_lead_checkpoint';
  constructor() {
    super('No lead review checkpoint found for this run');
  }
}

export class TeamRunAlreadyApprovedError extends Error {
  readonly code = 'already_approved';
  constructor() {
    super('Lead outreach was already approved for this run');
  }
}

export class TeamNoEnrichWorkerError extends Error {
  readonly code = 'no_enrich_worker';
  constructor() {
    super('Team has no email enricher worker configured');
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

    // Team starts as 'draft'; becomes 'active' once a supervisor is assigned
    return this.repo.createTeam({
      ...input,
      members: membersWithCards,
      did,
      createdByUserId: userId,
    });
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
    const teamContext: DockerTeamContext = {
      id: teamId,
      name: team.name,
      role: 'supervisor',
    };
    if (!(await this.deferTeamContextIfNeeded(agent, teamContext))) {
      this.cloudProvisioner.scheduleApplyTeamContext({
        agentId,
        teamId,
        teamName: team.name,
        role: 'supervisor',
        backendUrl,
      });
    }
    // Activate the team once it has a supervisor
    if (updated.status === 'draft') {
      await this.repo.updateStatus(teamId, 'active');
      return { ...updated, status: 'active' };
    }
    return updated;
  }

  async listTeams(orgId: string): Promise<TeamDTO[]> {
    return this.repo.listTeams(orgId);
  }

  async getTeam(id: string, orgId: string): Promise<TeamDTO> {
    const team = await this.repo.findByIdAndOrg(id, orgId);
    if (!team) throw new TeamNotFoundError();
    return team;
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
    const teamContext: DockerTeamContext = {
      id: teamId,
      name: team.name,
      role: 'worker',
    };
    if (!(await this.deferTeamContextIfNeeded(agent, teamContext))) {
      this.cloudProvisioner.scheduleApplyTeamContext({
        agentId: input.agentId,
        teamId,
        teamName: team.name,
        role: 'worker',
        backendUrl: backendBaseUrl,
      });
    }
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

  async approveLeadOutreach(teamId: string, runId: string, orgId: string): Promise<TeamRunDTO> {
    const team = await this.repo.findByIdAndOrg(teamId, orgId);
    if (!team) throw new TeamNotFoundError();
    const run = await this.repo.findRun(runId);
    if (!run || run.teamId !== teamId) throw new TeamNotFoundError();
    if (run.status !== 'paused') throw new TeamRunNotPausedError();
    if (run.leadOutreachApprovedAt) throw new TeamRunAlreadyApprovedError();
    if (!findLeadReviewCheckpoint(run.supervisorTrace)) throw new TeamRunNoLeadCheckpointError();

    const outreachMember = (team.members ?? []).find((m) => memberLeadGenStage(m) === 'outreach');

    await this.repo.updateRunLeadReview(runId, {
      leadOutreachApprovedAt: new Date(),
      status: 'running',
    });
    await approveLeadOutreachForTeamRun(runId, outreachMember?.agentId, run.leadCampaignId);

    const refreshed = await this.repo.findRun(runId);
    if (!refreshed) throw new TeamNotFoundError();

    const orchestrator = new TeamOrchestrator();
    void orchestrator.resumeFromCheckpoint(refreshed, team, () => {}).catch((err) => {
      console.error(`[TeamsService] resumeFromCheckpoint failed for ${runId}:`, err);
    });

    return refreshed;
  }

  async retryLeadEnrichment(teamId: string, runId: string, orgId: string): Promise<TeamRunDTO> {
    const team = await this.repo.findByIdAndOrg(teamId, orgId);
    if (!team) throw new TeamNotFoundError();
    const run = await this.repo.findRun(runId);
    if (!run || run.teamId !== teamId) throw new TeamNotFoundError();
    if (run.status !== 'paused') throw new TeamRunNotPausedError();
    if (run.leadOutreachApprovedAt) throw new TeamRunAlreadyApprovedError();
    if (!findLeadReviewCheckpoint(run.supervisorTrace)) throw new TeamRunNoLeadCheckpointError();

    const enrichMember = (team.members ?? []).find((m) => memberLeadGenStage(m) === 'enrich');
    if (!enrichMember) throw new TeamNoEnrichWorkerError();

    await this.repo.updateRunStatus(runId, 'running');

    const refreshed = (await this.repo.findRun(runId))!;
    const orchestrator = new TeamOrchestrator();
    void orchestrator.retryLeadEnrichment(refreshed, team, () => {}).catch((err) => {
      console.error(`[TeamsService] retryLeadEnrichment failed for ${runId}:`, err);
    });

    return refreshed;
  }

  // ─── Internal helpers ───────────────────────────────────────────────────────

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
