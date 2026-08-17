import type { PermissionScope } from '../agents/agents.types.js';
import {
  cancelAgentRun,
  createTeamDispatchConversation,
  enqueueAgentRun,
  listAgentRunEventsSince,
  waitForAgentRunCompletion,
  type AgentRunTerminalStatus,
} from '../agentChat/agentRunService.js';
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

const URL_IN_TEXT = /https?:\/\/[^\s"'<>)\]]+/g;

/**
 * Harvest every URL an agent event carries, wherever it sits in the payload. Tools report
 * sources in different shapes, so this walks the whole event rather than naming any one field —
 * a new tool needs no change here. Over-collecting is the safe direction: these URLs only ever
 * permit a citation, never reject one.
 */
export function collectToolUrls(data: unknown, into: Set<string>, depth = 0): Set<string> {
  if (depth > 6 || into.size > 500) return into;
  if (typeof data === 'string') {
    for (const match of data.match(URL_IN_TEXT) ?? []) into.add(match);
    return into;
  }
  if (Array.isArray(data)) {
    for (const item of data) collectToolUrls(item, into, depth + 1);
    return into;
  }
  if (data && typeof data === 'object') {
    for (const value of Object.values(data as Record<string, unknown>)) {
      collectToolUrls(value, into, depth + 1);
    }
  }
  return into;
}

/** Always-on runner tools. None of them change anything outside the run. */
const META_TOOLS = new Set(['think', 'done', 'find_tools', 'call_tool', 'delegate_task', 'brain_query']);

/** Connector tools that only look something up. Everything else is assumed to change state. */
const READ_ONLY_TOOL_RE =
  /(^|_)(read|get|list|search|query|describe|status|history|find|fetch|download|preview|check)(_|$)/i;

/**
 * The name of a tool call that did something outside this run, or null.
 *
 * Unknown tool names count as acting on purpose: a stage is failed for having called nothing at
 * all, and mistaking a new tool for a lookup would fail a run that did its job.
 */
export function actingToolCall(data: unknown): string | null {
  const record = data as Record<string, unknown> | null;
  if (!record || record.message !== 'tool_finished' || record.ok !== true) return null;
  const tool =
    typeof record.tool === 'string' ? record.tool : typeof record.name === 'string' ? record.name : null;
  if (!tool || META_TOOLS.has(tool) || READ_ONLY_TOOL_RE.test(tool)) return null;
  return tool;
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
    /** Every URL a tool returned during this run, for grounding cited sources. */
    toolUrls: Set<string>;
    /** Tools that succeeded and changed something outside the run, e.g. a message that went out. */
    actingTools: Set<string>;
  }> {
    let lastSeq = -1;
    const toolUrls = new Set<string>();
    const actingTools = new Set<string>();
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
        collectToolUrls(ev.data, toolUrls);
        const acted = actingToolCall(ev.data);
        if (acted) actingTools.add(acted);
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
      const outcome = await waitForAgentRunCompletion(params.agentRunId, params.timeoutMs);
      return { ...outcome, toolUrls, actingTools };
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
      const logMessage = typeof data?.message === 'string' ? data.message : null;

      // JIT approvals — same log messages as agent chat; surface in the team run timeline.
      if (logMessage === 'jit_approval_pending') {
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
        logMessage === 'jit_approval_expired'
      ) {
        const decision =
          logMessage === 'jit_approval_granted'
            ? 'approved'
            : logMessage === 'jit_approval_denied'
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
      if (typeof r.text === 'string') return r.text;
      if (typeof r.content === 'string') return r.content;
      if (typeof r.summary === 'string') return r.summary;
      if (typeof r.findings === 'string') return r.findings;
    }
    return JSON.stringify(result);
  }
}
