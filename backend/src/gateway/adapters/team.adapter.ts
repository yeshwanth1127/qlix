import type { InboundMessage } from '../types.js';
import type { TeamRunInput } from '../../teams/teams.types.js';

/**
 * Build a gateway inbound for an @Team goal (web or WhatsApp).
 */
export function buildTeamInbound(input: {
  channel: 'web' | 'api' | 'whatsapp' | 'slack' | 'telegram';
  teamId: string;
  teamName: string;
  orgId: string;
  userId: string;
  email?: string;
  goal: string;
  connectorId?: string;
  peerId?: string;
  backendUrl?: string;
  /** Optional per-run model override (wired into team.config.defaultModel for this execution). */
  inferenceModel?: string | null;
  /** Optional per-run thinking share. */
  reasoningEffort?: string | null;
  /** Prior TeamRun this send continues (web follow-up). */
  continuesRunId?: string | null;
  inputs?: TeamRunInput[];
}): InboundMessage {
  return {
    channel: input.channel,
    orgId: input.orgId,
    userId: input.userId,
    email: input.email,
    peerId: input.peerId ?? input.userId,
    body: input.goal,
    deliveryTarget: {
      channel: input.channel,
      connectorId: input.connectorId ?? null,
      peerId: input.peerId ?? input.userId,
      label: input.teamName,
    },
    preResolved: {
      targetType: 'team',
      teamId: input.teamId,
      targetName: input.teamName,
      orgId: input.orgId,
      userId: input.userId,
      teamRole: input.channel === 'web' || input.channel === 'api' ? null : input.channel,
    },
    metadata: {
      teamId: input.teamId,
      teamName: input.teamName,
      ...(input.backendUrl ? { backendUrl: input.backendUrl } : {}),
      ...(input.inferenceModel ? { inferenceModel: input.inferenceModel } : {}),
      ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
      ...(input.continuesRunId ? { continuesRunId: input.continuesRunId } : {}),
      ...(input.inputs?.length ? { teamRunInputs: input.inputs } : {}),
    },
  };
}
