import type { PermissionScope } from '../agents/agents.types.js';
import {
  appendAgentRunLogEvent,
  cancelAgentRun,
  createTeamDispatchConversation,
  enqueueAgentRun,
  listAgentRunEventsSince,
  waitForAgentRunCompletion,
  type AgentRunTerminalStatus,
} from '../agentChat/agentRunService.js';
import { attachTrace, createTraceEnvelope } from '../contracts/traceEnvelope.js';
import type { TeamAgentRole, TeamDTO, TeamRunDTO } from './teams.types.js';
import { TEAM_DISPATCH_ONLY_SKILL } from './lunaTeamsHost.js';
import { TeamsRepository } from './teams.repository.js';
import type { RunEventEmitter } from './teamOrchestrator.js';

export interface TeamRunEnqueueParams {
  team: TeamDTO;
  teamRun: TeamRunDTO;
  agentId: string;
  userId: string;
  role: TeamAgentRole;
  prompt: string;
  skills: PermissionScope[];
  a2aTaskId?: string;
  dispatchId?: string;
  useBrain?: boolean;
  inferenceModel?: string | null;
  reasoningEffort?: string | null;
  attempt?: number;
  stageOrder?: number;
  nodeId?: string;
}

export interface TeamRunEnqueueResult {
  runId: string;
  conversationId: string;
}

/** Return the authoritative tool name only for a successfully completed runner event. */
export function completedToolRef(event: { type: string; data: unknown }): string | null {
  const data = event.data as Record<string, unknown> | null;
  return event.type === 'log' &&
    data?.message === 'tool_finished' &&
    data.ok === true &&
    typeof data.tool === 'string'
    ? data.tool
    : null;
}

export function buildTeamPromptEnvelope(params: {
  team: TeamDTO;
  role: TeamAgentRole;
  delegatedScopes: PermissionScope[];
  task: string;
}): string {
  const realScopes = params.delegatedScopes.filter((scope) => scope !== TEAM_DISPATCH_ONLY_SKILL);
  const scopeLine =
    realScopes.length > 0
      ? realScopes.join(', ')
      : 'none — do not call find_tools, call_tool, or any connector tool';
  return [
    `Team: ${params.team.name} (${params.team.id})`,
    `Role: ${params.role}`,
    `Delegated scopes: ${scopeLine}`,
    '',
    'Task:',
    params.task,
  ].join('\n');
}

export class TeamAgentRunBridge {
  private readonly teamsRepo = new TeamsRepository();

  async enqueue(params: TeamRunEnqueueParams): Promise<TeamRunEnqueueResult> {
    const conversationId = await createTeamDispatchConversation({
      agentId: params.agentId,
      userId: params.userId,
      orgId: params.team.orgId,
      teamId: params.team.id,
      teamRunId: params.teamRun.id,
      dispatchId: params.dispatchId ?? params.a2aTaskId ?? `supervisor-${Date.now()}`,
    });

    const envelope = buildTeamPromptEnvelope({
      team: params.team,
      role: params.role,
      delegatedScopes: params.skills,
      task: params.prompt,
    });

    const { runId } = await enqueueAgentRun({
      agentId: params.agentId,
      conversationId,
      userId: params.userId,
      orgId: params.team.orgId,
      prompt: envelope,
      skills: params.skills,
      inferenceModel: params.inferenceModel ?? null,
      reasoningEffort: params.reasoningEffort ?? null,
      useBrain: params.useBrain ?? false,
      teamRunId: params.teamRun.id,
      teamId: params.team.id,
      teamRole: params.role,
      sourceChannel: params.teamRun.sourceChannel ?? 'web',
    });

    if (params.a2aTaskId) {
      await this.teamsRepo.updateA2ATask(params.a2aTaskId, { agentRunId: runId });
    }

    await appendAgentRunLogEvent(
      runId,
      attachTrace(
        {
          message: 'team_dispatch',
          teamRunId: params.teamRun.id,
          teamId: params.team.id,
          teamRole: params.role,
          dispatchId: params.dispatchId ?? params.a2aTaskId ?? null,
          attempt: params.attempt ?? 1,
          stageOrder: params.stageOrder ?? null,
          nodeId: params.nodeId ?? params.dispatchId ?? params.a2aTaskId ?? params.role,
        },
        createTraceEnvelope({
          traceId: params.teamRun.id,
          spanId: `run:${runId}:dispatch`,
          parentSpanId: params.teamRun.id,
          executionId: runId,
          executionKind: 'agent_run',
          orgId: params.team.orgId,
          agentId: params.agentId,
          attempt: params.attempt ?? 1,
          ...(params.nodeId || params.dispatchId
            ? { nodeId: params.nodeId ?? params.dispatchId }
            : {}),
        }),
      ) as Record<string, unknown>,
    );

    return { runId, conversationId };
  }

  async waitAndBridgeEvents(params: {
    agentRunId: string;
    teamRun: TeamRunDTO;
    team: TeamDTO;
    agentId: string;
    timeoutMs: number;
    emit: RunEventEmitter;
  }): Promise<{
    status: AgentRunTerminalStatus;
    result: unknown;
    errorMessage: string | null;
    executedToolRefs: string[];
  }> {
    let lastSeq = -1;
    const executedToolRefs = new Set<string>();
    const cancelIfTeamStopped = async () => {
      const current = await this.teamsRepo.findRun(params.teamRun.id);
      if (current?.status === 'canceled' || current?.status === 'failed') {
        await cancelAgentRun(params.agentRunId, 'Team run stopped');
      }
    };
    const pollBridge = async () => {
      await cancelIfTeamStopped();
      const events = await listAgentRunEventsSince(params.agentRunId, lastSeq);
      for (const ev of events) {
        lastSeq = ev.seq;
        const toolRef = completedToolRef(ev);
        if (toolRef) executedToolRefs.add(toolRef);
        await this.mapAgentEventToTeam(params, ev);
      }
    };
    try {
      await pollBridge();
    } catch (err) {
      console.error('[TeamAgentRunBridge] initial event bridge error', err);
    }
    const bridgeInterval = setInterval(async () => {
      try {
        await pollBridge();
      } catch (err) {
        console.error('[TeamAgentRunBridge] event bridge error', err);
      }
    }, 400);

    let terminal: Awaited<ReturnType<typeof waitForAgentRunCompletion>>;
    try {
      terminal = await waitForAgentRunCompletion(params.agentRunId, params.timeoutMs);
    } finally {
      clearInterval(bridgeInterval);
      try {
        await pollBridge();
      } catch (err) {
        console.error('[TeamAgentRunBridge] final event bridge error', err);
      }
    }
    return { ...terminal, executedToolRefs: [...executedToolRefs] };
  }

  private async mapAgentEventToTeam(
    params: {
      teamRun: TeamRunDTO;
      team: TeamDTO;
      agentId: string;
      emit: RunEventEmitter;
    },
    ev: { seq: number; type: string; data: unknown },
  ): Promise<void> {
    const data = ev.data as Record<string, unknown> | null;
    if (ev.type === 'log') {
      const logMessage = typeof data?.message === 'string' ? data.message : null;

      // JIT approvals — same log messages as agent chat; surface in the team run timeline.
      if (logMessage === 'jit_approval_pending' || logMessage === 'capability_grant_pending') {
        const clean = { ...(data ?? {}), message: logMessage };
        await this.teamsRepo.appendEvent(
          params.teamRun.id,
          params.team.id,
          params.agentId,
          'scope_requested',
          clean,
        );
        params.emit('scope_requested', { agentId: params.agentId, ...clean });
        return;
      }
      if (
        logMessage === 'jit_approval_granted' ||
        logMessage === 'jit_approval_denied' ||
        logMessage === 'jit_approval_expired' ||
        logMessage === 'capability_grant_granted' ||
        logMessage === 'capability_grant_denied' ||
        logMessage === 'capability_grant_expired'
      ) {
        const decision =
          logMessage === 'jit_approval_granted' || logMessage === 'capability_grant_granted'
            ? 'approved'
            : logMessage === 'jit_approval_denied' || logMessage === 'capability_grant_denied'
              ? 'denied'
              : 'expired';
        const clean = { ...(data ?? {}), message: logMessage, decision };
        await this.teamsRepo.appendEvent(
          params.teamRun.id,
          params.team.id,
          params.agentId,
          'approval_granted',
          clean,
        );
        params.emit('approval_granted', { agentId: params.agentId, ...clean });
        return;
      }

      const tool = typeof data?.tool === 'string' ? data.tool : typeof data?.name === 'string' ? data.name : null;
      if (tool === 'brain.query' && data?.message === 'tool_finished') {
        const payload = { tool, ...(data ?? {}) };
        await this.teamsRepo.appendEvent(
          params.teamRun.id,
          params.team.id,
          params.agentId,
          'brain_queried',
          payload,
        );
        params.emit('brain_queried', { agentId: params.agentId, ...payload });
        return;
      }
      if (tool) {
        await this.teamsRepo.appendEvent(
          params.teamRun.id,
          params.team.id,
          params.agentId,
          'tool_called',
          { tool, ...(data ?? {}) },
        );
        params.emit('tool_called', { agentId: params.agentId, tool, data });
        return;
      }
      const thinkingLogMessages = new Set([
        'inference_tool_round',
        'inference_request',
        'agents3_step',
        'tool_loop_stuck_break',
        'orchestrator_fallback',
      ]);
      if (logMessage && thinkingLogMessages.has(logMessage)) {
        await this.teamsRepo.appendEvent(
          params.teamRun.id,
          params.team.id,
          params.agentId,
          'task_status_update',
          data ?? {},
        );
        params.emit('status', { agentId: params.agentId, ...(data ?? {}) });
      }
    } else if (ev.type === 'status') {
      await this.teamsRepo.appendEvent(
        params.teamRun.id,
        params.team.id,
        params.agentId,
        'task_status_update',
        data ?? {},
      );
      params.emit('status', { agentId: params.agentId, ...(data ?? {}) });
    }
  }

  /** Extract text content from AgentRun.result JSON. */
  static extractResultText(result: unknown): string {
    if (result == null) return '';
    if (typeof result === 'string') return result;
    if (typeof result === 'object') {
      const r = result as Record<string, unknown>;
      // A normalized team Result is already a structured object. Preserve the
      // entire envelope; returning only summary/findings would discard the
      // provenance and artifacts required by downstream validation.
      if ('summary' in r || 'findings' in r || 'provenance' in r || 'artifacts' in r) {
        return JSON.stringify(result);
      }
      if (typeof r.text === 'string') return r.text;
      if (typeof r.content === 'string') return r.content;
    }
    return JSON.stringify(result);
  }
}
