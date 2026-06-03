import { deliverTextToWorkspaceWhatsApp } from '../whatsapp/whatsappChannel.service.js';
import { goalRequestsWhatsAppDelivery } from '../whatsapp/whatsappDeliveryIntent.js';
import type { TeamDTO, TeamRunDTO, TeamRunEventType } from './teams.types.js';

const WHATSAPP_BODY_MAX = 1500;

function truncate(text: string): string {
  return text.length > WHATSAPP_BODY_MAX ? `${text.slice(0, WHATSAPP_BODY_MAX)}…` : text;
}

function shouldNotify(run: TeamRunDTO): boolean {
  return run.sourceChannel === 'whatsapp' || run.replyChannel === 'whatsapp';
}

/** Dedupe progress pings per run (subtaskId or step key). */
const sentKeys = new Map<string, Set<string>>();

function markSent(runId: string, key: string): boolean {
  let keys = sentKeys.get(runId);
  if (!keys) {
    keys = new Set();
    sentKeys.set(runId, keys);
  }
  if (keys.has(key)) return false;
  keys.add(key);
  return true;
}

export function clearNotifierState(runId: string): void {
  sentKeys.delete(runId);
}

export async function notifyTeamChannelProgress(
  run: TeamRunDTO,
  team: TeamDTO,
  eventType: TeamRunEventType,
  payload: Record<string, unknown>,
): Promise<void> {
  if (!shouldNotify(run)) return;

  let body: string | null = null;
  let dedupeKey: string | null = null;

  switch (eventType) {
    case 'run_started':
      body = `🚀 *${team.name}* started`;
      dedupeKey = 'run_started';
      break;
    case 'supervisor_step': {
      if (payload.step !== 'decompose') break;
      const subtasks = payload.subtasks as Array<{ agentName?: string; goal?: string }> | undefined;
      if (!Array.isArray(subtasks) || subtasks.length === 0) break;
      const names = subtasks
        .map((s) => s.agentName ?? 'worker')
        .slice(0, 6)
        .join(' → ');
      body = `📋 Plan (${subtasks.length} stages): ${names}`;
      dedupeKey = 'decompose';
      break;
    }
    case 'task_delegated': {
      const agentName = (payload.agentName as string | undefined) ?? 'Worker';
      const goal = (payload.goal as string | undefined) ?? '';
      const subtaskId = (payload.subtaskId as string | undefined) ?? agentName;
      body = `▶️ ${agentName}: ${goal.slice(0, 120)}${goal.length > 120 ? '…' : ''}`;
      dedupeKey = `delegated:${subtaskId}`;
      break;
    }
    case 'subtask_completed': {
      const agentName = (payload.agentName as string | undefined) ?? 'Worker';
      const status = (payload.status as string | undefined) ?? 'completed';
      const subtaskId = (payload.subtaskId as string | undefined) ?? agentName;
      body =
        status === 'failed'
          ? `⚠️ ${agentName} failed — continuing pipeline`
          : `✅ ${agentName} done`;
      dedupeKey = `completed:${subtaskId}`;
      break;
    }
    default:
      break;
  }

  if (!body || !dedupeKey || !markSent(run.id, dedupeKey)) return;

  void deliverTextToWorkspaceWhatsApp(team.orgId, {
    title: team.name,
    body: truncate(body),
  }).catch((err) => {
    console.warn('[TeamChannelNotifier] progress ping failed', err);
  });
}

export function teamRunShouldReplyWhatsApp(run: TeamRunDTO, goal: string): boolean {
  if (run.sourceChannel === 'whatsapp' || run.replyChannel === 'whatsapp') return true;
  return goalRequestsWhatsAppDelivery(goal);
}
