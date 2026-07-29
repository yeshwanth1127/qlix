import type { PermissionScope } from '../agents/agents.types.js';
import {
  ensureTeamConversation,
  enqueueAgentRun,
  listAgentRunEventsSince,
  waitForAgentRunCompletion,
  type AgentRunTerminalStatus,
} from '../agentChat/agentRunService.js';
import type { TeamAgentRole, TeamDTO, TeamRunDTO } from './teams.types.js';
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
  useBrain?: boolean;
  inferenceModel?: string | null;
}

export interface TeamRunEnqueueResult {
  runId: string;
  conversationId: string;
}

export function buildTeamPromptEnvelope(params: {
  team: TeamDTO;
  role: TeamAgentRole;
  delegatedScopes: PermissionScope[];
  task: string;
}): string {
  const scopeLine =
    params.delegatedScopes.length > 0
      ? params.delegatedScopes.join(', ')
      : 'none';
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
    const conversationId = await ensureTeamConversation({
      agentId: params.agentId,
      userId: params.userId,
      orgId: params.team.orgId,
      teamId: params.team.id,
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
      useBrain: params.useBrain ?? false,
      teamRunId: params.teamRun.id,
      teamId: params.team.id,
      teamRole: params.role,
    });

    if (params.a2aTaskId) {
      await this.teamsRepo.updateA2ATask(params.a2aTaskId, { agentRunId: runId });
    }

    return { runId, conversationId };
  }

  async waitAndBridgeEvents(params: {
    agentRunId: string;
    teamRun: TeamRunDTO;
    team: TeamDTO;
    agentId: string;
    timeoutMs: number;
    emit: RunEventEmitter;
  }): Promise<{ status: AgentRunTerminalStatus; result: unknown; errorMessage: string | null }> {
    let lastSeq = -1;
    const pollBridge = async () => {
      const events = await listAgentRunEventsSince(params.agentRunId, lastSeq);
      for (const ev of events) {
        lastSeq = ev.seq;
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

    try {
      return await waitForAgentRunCompletion(params.agentRunId, params.timeoutMs);
    } finally {
      clearInterval(bridgeInterval);
      try {
        await pollBridge();
      } catch (err) {
        console.error('[TeamAgentRunBridge] final event bridge error', err);
      }
    }
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
      const logMessage = typeof data?.message === 'string' ? data.message : null;
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
      if (typeof r.text === 'string') return r.text;
      if (typeof r.content === 'string') return r.content;
      if (typeof r.summary === 'string') return r.summary;
      if (typeof r.findings === 'string') return r.findings;
    }
    return JSON.stringify(result);
  }
}
