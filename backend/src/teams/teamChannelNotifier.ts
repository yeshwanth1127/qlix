import { goalRequestsWhatsAppDelivery } from '../whatsapp/whatsappDeliveryIntent.js';
import type { TeamDTO, TeamRunDTO, TeamRunEventType } from './teams.types.js';

/** Cleared when a run ends; progress pings are no longer sent to WhatsApp. */
const sentKeys = new Map<string, Set<string>>();

export function clearNotifierState(runId: string): void {
  sentKeys.delete(runId);
}

/**
 * Mid-run team progress is UI-only. Self-chat WhatsApp is reserved for:
 * final team synthesis, JIT approvals, whatsapp_send, and inbound self-chat acks.
 */
export async function notifyTeamChannelProgress(
  _run: TeamRunDTO,
  _team: TeamDTO,
  _eventType: TeamRunEventType,
  _payload: Record<string, unknown>,
): Promise<void> {
  return;
}

export function teamRunShouldReplyWhatsApp(run: TeamRunDTO, goal: string): boolean {
  if (run.sourceChannel === 'whatsapp' || run.replyChannel === 'whatsapp') return true;
  return goalRequestsWhatsAppDelivery(goal);
}
