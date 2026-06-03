import type {
  Team as PrismaTeam,
  TeamMember as PrismaTeamMember,
  TeamRun as PrismaTeamRun,
  TeamRunEvent as PrismaTeamRunEvent,
  A2ATask as PrismaA2ATask,
} from '@prisma/client';
import type { TeamRunReplyChannel, TeamRunSourceChannel } from './teams.types.js';
import { createHash } from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import type {
  A2ATaskDTO,
  A2ATaskStatus,
  AddTeamMemberInput,
  CreateTeamInput,
  TeamConfig,
  TeamDTO,
  TeamMemberDTO,
  TeamRunDTO,
  TeamRunEventDTO,
  TeamRunEventType,
  TeamRunStatus,
  TeamStatus,
} from './teams.types.js';
import { DEFAULT_TEAM_CONFIG } from './teams.types.js';

function toTeamDTO(t: PrismaTeam & {
  members?: Array<PrismaTeamMember & { agent?: { id: string; name: string; did: string; status: string; permissionScopes: string[]; agentKind: string } }>;
  supervisorAgent?: { id: string; name: string; did: string; status: string } | null;
}): TeamDTO {
  return {
    id: t.id,
    orgId: t.orgId,
    createdByUserId: t.createdByUserId,
    supervisorAgentId: t.supervisorAgentId,
    did: t.did,
    name: t.name,
    description: t.description,
    status: t.status as TeamStatus,
    config: { ...DEFAULT_TEAM_CONFIG, ...(t.config as object) } as TeamConfig,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    members: t.members?.map(toTeamMemberDTO),
    supervisorAgent: t.supervisorAgent ?? undefined,
  };
}

function toTeamMemberDTO(m: PrismaTeamMember & {
  agent?: { id: string; name: string; did: string; status: string; permissionScopes: string[]; agentKind: string };
}): TeamMemberDTO {
  return {
    id: m.id,
    teamId: m.teamId,
    agentId: m.agentId,
    role: m.role,
    delegatedScopes: m.delegatedScopes as TeamMemberDTO['delegatedScopes'],
    agentCardSnapshot: m.agentCardSnapshot as Record<string, unknown> | null,
    stageOrder: m.stageOrder ?? 0,
    addedAt: m.addedAt.toISOString(),
    agent: m.agent
      ? {
          ...m.agent,
          permissionScopes: m.agent.permissionScopes as TeamMemberDTO['delegatedScopes'],
        }
      : undefined,
  };
}

/**
 * Prisma include shape that pulls members in pipeline order (stage_order, then added_at).
 * Used everywhere we read a team so the rest of the app can rely on members being sorted.
 */
const MEMBERS_ORDERED = {
  include: {
    agent: {
      select: {
        id: true,
        name: true,
        did: true,
        status: true,
        permissionScopes: true,
        agentKind: true,
      },
    },
  },
  orderBy: [{ stageOrder: 'asc' as const }, { addedAt: 'asc' as const }],
};

function toRunDTO(r: PrismaTeamRun): TeamRunDTO {
  return {
    id: r.id,
    teamId: r.teamId,
    orgId: r.orgId,
    startedByUserId: r.startedByUserId,
    goal: r.goal,
    sourceChannel: (r.sourceChannel ?? 'web') as TeamRunSourceChannel,
    sourceConnectorId: r.sourceConnectorId ?? null,
    replyChannel: (r.replyChannel ?? 'none') as TeamRunReplyChannel,
    status: r.status as TeamRunStatus,
    supervisorTrace: r.supervisorTrace as unknown[],
    artifacts: r.artifacts as unknown as TeamRunDTO['artifacts'],
    scopeEscalations: r.scopeEscalations as unknown as TeamRunDTO['scopeEscalations'],
    result: r.result,
    errorMessage: r.errorMessage,
    createdAt: r.createdAt.toISOString(),
    startedAt: r.startedAt?.toISOString() ?? null,
    completedAt: r.completedAt?.toISOString() ?? null,
  };
}

function toEventDTO(e: PrismaTeamRunEvent): TeamRunEventDTO {
  return {
    id: e.id,
    runId: e.runId,
    teamId: e.teamId,
    agentId: e.agentId,
    seq: e.seq,
    eventType: e.eventType as TeamRunEventType,
    payload: e.payload,
    prevHash: e.prevHash,
    timestampMs: e.timestampMs.toString(),
  };
}

function toA2ATaskDTO(t: PrismaA2ATask): A2ATaskDTO {
  return {
    id: t.id,
    runId: t.runId,
    teamId: t.teamId,
    fromAgentId: t.fromAgentId,
    toAgentId: t.toAgentId,
    agentRunId: t.agentRunId,
    goal: t.goal,
    status: t.status as A2ATaskStatus,
    messages: t.messages as unknown as A2ATaskDTO['messages'],
    artifacts: t.artifacts as unknown as A2ATaskDTO['artifacts'],
    inputRequest: t.inputRequest,
    inputResponse: t.inputResponse,
    errorMessage: t.errorMessage,
    createdAt: t.createdAt.toISOString(),
    startedAt: t.startedAt?.toISOString() ?? null,
    completedAt: t.completedAt?.toISOString() ?? null,
  };
}

const MEMBER_AGENT_SELECT = {
  id: true,
  name: true,
  did: true,
  status: true,
  permissionScopes: true,
  agentKind: true,
} as const;

export class TeamsRepository {
  async createTeam(input: CreateTeamInput & { did: string; createdByUserId: string }): Promise<TeamDTO> {
    const config = { ...DEFAULT_TEAM_CONFIG, ...(input.config ?? {}) };
    const team = await prisma.team.create({
      data: {
        orgId: input.orgId,
        createdByUserId: input.createdByUserId,
        supervisorAgentId: input.supervisorAgentId ?? null,
        did: input.did,
        name: input.name,
        description: input.description ?? null,
        status: 'draft',
        config,
        members: {
          create: (input.members ?? []).map((m, i) => ({
            agentId: m.agentId,
            role: m.role,
            delegatedScopes: m.delegatedScopes,
            // Members declared in the create payload are assigned stages in declaration order.
            stageOrder: i + 1,
          })),
        },
      },
      include: {
        members: MEMBERS_ORDERED,
        supervisorAgent: { select: { id: true, name: true, did: true, status: true } },
      },
    });
    return toTeamDTO(team);
  }

  async clearSupervisor(teamId: string): Promise<TeamDTO> {
    const team = await prisma.team.update({
      where: { id: teamId },
      data: { supervisorAgentId: null, status: 'draft' },
      include: {
        members: MEMBERS_ORDERED,
        supervisorAgent: { select: { id: true, name: true, did: true, status: true } },
      },
    });
    return toTeamDTO(team);
  }

  async setSupervisor(teamId: string, agentId: string): Promise<TeamDTO> {
    const team = await prisma.team.update({
      where: { id: teamId },
      data: { supervisorAgentId: agentId },
      include: {
        members: MEMBERS_ORDERED,
        supervisorAgent: { select: { id: true, name: true, did: true, status: true } },
      },
    });
    return toTeamDTO(team);
  }

  async listTeams(orgId: string): Promise<TeamDTO[]> {
    const teams = await prisma.team.findMany({
      where: { orgId },
      include: {
        members: MEMBERS_ORDERED,
        supervisorAgent: { select: { id: true, name: true, did: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return teams.map(toTeamDTO);
  }

  async findById(id: string): Promise<TeamDTO | null> {
    const team = await prisma.team.findUnique({
      where: { id },
      include: {
        members: MEMBERS_ORDERED,
        supervisorAgent: { select: { id: true, name: true, did: true, status: true } },
      },
    });
    return team ? toTeamDTO(team) : null;
  }

  async findByIdAndOrg(id: string, orgId: string): Promise<TeamDTO | null> {
    const team = await prisma.team.findFirst({
      where: { id, orgId },
      include: {
        members: MEMBERS_ORDERED,
        supervisorAgent: { select: { id: true, name: true, did: true, status: true } },
      },
    });
    return team ? toTeamDTO(team) : null;
  }

  async updateStatus(id: string, status: TeamStatus): Promise<void> {
    await prisma.team.update({ where: { id }, data: { status } });
  }

  async updateConfig(id: string, configPatch: Partial<TeamConfig>): Promise<TeamDTO> {
    const existing = await prisma.team.findUnique({ where: { id }, select: { config: true } });
    const merged = {
      ...DEFAULT_TEAM_CONFIG,
      ...((existing?.config as object) ?? {}),
      ...configPatch,
    };
    const team = await prisma.team.update({
      where: { id },
      data: { config: merged },
      include: {
        members: MEMBERS_ORDERED,
        supervisorAgent: { select: { id: true, name: true, did: true, status: true } },
      },
    });
    return toTeamDTO(team);
  }

  async deleteById(id: string): Promise<void> {
    await prisma.team.delete({ where: { id } });
  }

  async addMember(teamId: string, input: AddTeamMemberInput & { agentCardSnapshot?: unknown }): Promise<TeamMemberDTO> {
    // New members are appended to the end of the pipeline (max stage + 1).
    const max = await prisma.teamMember.aggregate({
      where: { teamId },
      _max: { stageOrder: true },
    });
    const nextStage = (max._max.stageOrder ?? 0) + 1;
    const m = await prisma.teamMember.create({
      data: {
        teamId,
        agentId: input.agentId,
        role: input.role,
        delegatedScopes: input.delegatedScopes,
        agentCardSnapshot: (input.agentCardSnapshot as object | undefined) ?? undefined,
        stageOrder: nextStage,
      },
      include: { agent: { select: MEMBER_AGENT_SELECT } },
    });
    return toTeamMemberDTO(m);
  }

  async removeMember(teamId: string, agentId: string): Promise<void> {
    await prisma.teamMember.deleteMany({ where: { teamId, agentId } });
    // Re-pack remaining stage_order values so the sequence stays 1..N (no gaps).
    await this.repackStageOrder(teamId);
  }

  /**
   * Rewrite the member pipeline order. `memberIds` must contain every member of the team
   * exactly once; the array index becomes the new stage (index + 1).
   */
  async reorderMembers(teamId: string, memberIds: string[]): Promise<TeamDTO> {
    const existing = await prisma.teamMember.findMany({
      where: { teamId },
      select: { id: true },
    });
    const existingIds = new Set(existing.map((m) => m.id));
    if (memberIds.length !== existingIds.size || memberIds.some((id) => !existingIds.has(id))) {
      throw new Error('reorderMembers: memberIds must list every member of the team exactly once');
    }
    if (new Set(memberIds).size !== memberIds.length) {
      throw new Error('reorderMembers: duplicate memberIds');
    }
    await prisma.$transaction(
      memberIds.map((id, i) =>
        prisma.teamMember.update({ where: { id }, data: { stageOrder: i + 1 } }),
      ),
    );
    const team = await this.findById(teamId);
    if (!team) throw new Error('Team disappeared during reorder');
    return team;
  }

  /** Renumber members to a contiguous 1..N range while preserving current order. */
  private async repackStageOrder(teamId: string): Promise<void> {
    const members = await prisma.teamMember.findMany({
      where: { teamId },
      orderBy: [{ stageOrder: 'asc' }, { addedAt: 'asc' }],
      select: { id: true },
    });
    if (members.length === 0) return;
    await prisma.$transaction(
      members.map((m, i) =>
        prisma.teamMember.update({ where: { id: m.id }, data: { stageOrder: i + 1 } }),
      ),
    );
  }

  async updateMemberScopes(
    teamId: string,
    agentId: string,
    delegatedScopes: AddTeamMemberInput['delegatedScopes'],
  ): Promise<TeamMemberDTO> {
    const m = await prisma.teamMember.update({
      where: { teamId_agentId: { teamId, agentId } },
      data: { delegatedScopes },
      include: { agent: { select: MEMBER_AGENT_SELECT } },
    });
    return toTeamMemberDTO(m);
  }

  async isMember(teamId: string, agentId: string): Promise<boolean> {
    const m = await prisma.teamMember.findFirst({ where: { teamId, agentId } });
    return m !== null;
  }

  // ─── Runs ───────────────────────────────────────────────────────────────────

  async createRun(
    teamId: string,
    orgId: string,
    userId: string,
    goal: string,
    opts?: {
      sourceChannel?: TeamRunSourceChannel;
      sourceConnectorId?: string | null;
      replyChannel?: TeamRunReplyChannel;
    },
  ): Promise<TeamRunDTO> {
    const sourceChannel = opts?.sourceChannel ?? 'web';
    const replyChannel =
      opts?.replyChannel ?? (sourceChannel === 'whatsapp' ? 'whatsapp' : 'none');
    const run = await prisma.teamRun.create({
      data: {
        teamId,
        orgId,
        startedByUserId: userId,
        goal,
        status: 'queued',
        sourceChannel,
        sourceConnectorId: opts?.sourceConnectorId ?? null,
        replyChannel,
      },
    });
    return toRunDTO(run);
  }

  async upsertChannelSession(params: {
    connectorId: string;
    teamRunId: string;
    teamId: string;
    userId: string;
  }): Promise<void> {
    await prisma.teamRunChannelSession.upsert({
      where: { connectorId: params.connectorId },
      create: {
        connectorId: params.connectorId,
        teamRunId: params.teamRunId,
        teamId: params.teamId,
        userId: params.userId,
      },
      update: {
        teamRunId: params.teamRunId,
        teamId: params.teamId,
        userId: params.userId,
      },
    });
  }

  async clearChannelSession(connectorId: string): Promise<void> {
    await prisma.teamRunChannelSession.deleteMany({ where: { connectorId } });
  }

  async findActiveRunForConnector(connectorId: string): Promise<TeamRunDTO | null> {
    const session = await prisma.teamRunChannelSession.findUnique({
      where: { connectorId },
      include: { run: true },
    });
    if (!session?.run) return null;
    if (!['queued', 'running'].includes(session.run.status)) {
      await this.clearChannelSession(connectorId);
      return null;
    }
    return toRunDTO(session.run);
  }

  async listRuns(teamId: string): Promise<TeamRunDTO[]> {
    const runs = await prisma.teamRun.findMany({
      where: { teamId },
      orderBy: { createdAt: 'desc' },
    });
    return runs.map(toRunDTO);
  }

  async findRun(runId: string): Promise<TeamRunDTO | null> {
    const run = await prisma.teamRun.findUnique({ where: { id: runId } });
    return run ? toRunDTO(run) : null;
  }

  async updateRunStatus(runId: string, status: TeamRunStatus, extra?: {
    startedAt?: Date;
    completedAt?: Date;
    result?: unknown;
    errorMessage?: string;
  }): Promise<void> {
    await prisma.teamRun.update({
      where: { id: runId },
      data: {
        status,
        ...(extra?.startedAt ? { startedAt: extra.startedAt } : {}),
        ...(extra?.completedAt ? { completedAt: extra.completedAt } : {}),
        ...(extra?.result !== undefined ? { result: extra.result as object } : {}),
        ...(extra?.errorMessage ? { errorMessage: extra.errorMessage } : {}),
      },
    });
  }

  async appendSupervisorTrace(runId: string, step: unknown): Promise<void> {
    const run = await prisma.teamRun.findUnique({ where: { id: runId }, select: { supervisorTrace: true } });
    if (!run) return;
    const trace = (run.supervisorTrace as unknown[]).concat([step]);
    await prisma.teamRun.update({ where: { id: runId }, data: { supervisorTrace: trace as object[] } });
  }

  async appendArtifact(runId: string, artifact: unknown): Promise<void> {
    const run = await prisma.teamRun.findUnique({ where: { id: runId }, select: { artifacts: true } });
    if (!run) return;
    const artifacts = (run.artifacts as unknown[]).concat([artifact]);
    await prisma.teamRun.update({ where: { id: runId }, data: { artifacts: artifacts as object[] } });
  }

  async appendScopeEscalation(runId: string, escalation: unknown): Promise<void> {
    const run = await prisma.teamRun.findUnique({ where: { id: runId }, select: { scopeEscalations: true } });
    if (!run) return;
    const esc = (run.scopeEscalations as unknown[]).concat([escalation]);
    await prisma.teamRun.update({ where: { id: runId }, data: { scopeEscalations: esc as object[] } });
  }

  // ─── Events ─────────────────────────────────────────────────────────────────

  // Serialize appendEvent per runId to prevent (run_id, seq) unique-constraint
  // races when multiple workers emit events concurrently.
  private readonly _appendQueues = new Map<string, Promise<unknown>>();

  appendEvent(
    runId: string,
    teamId: string,
    agentId: string | null,
    eventType: TeamRunEventType,
    payload: unknown,
  ): Promise<TeamRunEventDTO> {
    const prev = this._appendQueues.get(runId) ?? Promise.resolve();
    const next = prev.then(() =>
      this._appendEventInner(runId, teamId, agentId, eventType, payload),
    );
    // Keep the chain alive; swallow errors so the queue doesn't get stuck
    this._appendQueues.set(runId, next.catch(() => {}));
    return next;
  }

  private async _appendEventInner(
    runId: string,
    teamId: string,
    agentId: string | null,
    eventType: TeamRunEventType,
    payload: unknown,
  ): Promise<TeamRunEventDTO> {
    const last = await prisma.teamRunEvent.findFirst({
      where: { runId },
      orderBy: { seq: 'desc' },
      select: { seq: true, payload: true },
    });
    const seq = (last?.seq ?? -1) + 1;
    const prevHash = last
      ? createHash('sha256').update(JSON.stringify(last.payload)).digest('hex')
      : 'genesis';

    const event = await prisma.teamRunEvent.create({
      data: {
        runId,
        teamId,
        agentId,
        seq,
        eventType,
        payload: payload as object,
        prevHash,
        timestampMs: BigInt(Date.now()),
      },
    });
    return toEventDTO(event);
  }

  async listEvents(runId: string): Promise<TeamRunEventDTO[]> {
    const events = await prisma.teamRunEvent.findMany({
      where: { runId },
      orderBy: { seq: 'asc' },
    });
    return events.map(toEventDTO);
  }

  async listEventsSince(runId: string, afterSeq: number): Promise<TeamRunEventDTO[]> {
    const events = await prisma.teamRunEvent.findMany({
      where: { runId, seq: { gt: afterSeq } },
      orderBy: { seq: 'asc' },
    });
    return events.map(toEventDTO);
  }

  // ─── A2A Tasks ───────────────────────────────────────────────────────────────

  async createA2ATask(
    runId: string,
    teamId: string,
    fromAgentId: string,
    toAgentId: string,
    goal: string,
  ): Promise<A2ATaskDTO> {
    const task = await prisma.a2ATask.create({
      data: { runId, teamId, fromAgentId, toAgentId, goal, status: 'submitted' },
    });
    return toA2ATaskDTO(task);
  }

  async updateA2ATask(
    taskId: string,
    data: Partial<{
      status: A2ATaskStatus;
      messages: unknown[];
      artifacts: unknown[];
      inputRequest: unknown;
      inputResponse: unknown;
      errorMessage: string;
      agentRunId: string;
      startedAt: Date;
      completedAt: Date;
    }>,
  ): Promise<A2ATaskDTO> {
    const task = await prisma.a2ATask.update({
      where: { id: taskId },
      data: {
        ...(data.status ? { status: data.status } : {}),
        ...(data.agentRunId ? { agentRunId: data.agentRunId } : {}),
        ...(data.messages ? { messages: data.messages as object[] } : {}),
        ...(data.artifacts ? { artifacts: data.artifacts as object[] } : {}),
        ...(data.inputRequest !== undefined ? { inputRequest: data.inputRequest as object } : {}),
        ...(data.inputResponse !== undefined ? { inputResponse: data.inputResponse as object } : {}),
        ...(data.errorMessage ? { errorMessage: data.errorMessage } : {}),
        ...(data.startedAt ? { startedAt: data.startedAt } : {}),
        ...(data.completedAt ? { completedAt: data.completedAt } : {}),
      },
    });
    return toA2ATaskDTO(task);
  }

  async listA2ATasks(runId: string): Promise<A2ATaskDTO[]> {
    const tasks = await prisma.a2ATask.findMany({
      where: { runId },
      orderBy: { createdAt: 'asc' },
    });
    return tasks.map(toA2ATaskDTO);
  }
}
