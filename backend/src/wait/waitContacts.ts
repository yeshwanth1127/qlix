import { TeamsRepository } from '../teams/teams.repository.js';
import type { TeamRunCheckpoint } from '../teams/teams.types.js';
import { normalizeContactJid } from '../whatsapp/whatsappAutoReply.service.js';

export type WaitContactRecord = {
  name?: string | null;
  phone?: string | null;
  recipient?: string | null;
};

export function upsertWaitContactInCheckpoint(
  checkpoint: TeamRunCheckpoint,
  input: { jid: string; name?: string | null; phone?: string | null; recipient?: string | null },
): TeamRunCheckpoint {
  const key = normalizeContactJid(input.jid);
  const prev = checkpoint.waitContacts?.[key];
  const next: WaitContactRecord = {
    name: input.name?.trim() || prev?.name || null,
    phone: input.phone?.trim() || prev?.phone || null,
    recipient: input.recipient?.trim() || prev?.recipient || null,
  };
  return {
    ...checkpoint,
    waitContacts: {
      ...(checkpoint.waitContacts ?? {}),
      [key]: next,
    },
  };
}

export function lookupWaitContact(
  checkpoint: TeamRunCheckpoint | null | undefined,
  jid: string,
): WaitContactRecord | null {
  if (!checkpoint?.waitContacts) return null;
  const key = normalizeContactJid(jid);
  return checkpoint.waitContacts[key] ?? null;
}

export async function persistWaitContact(input: {
  teamRunId: string;
  jid: string;
  name?: string | null;
  phone?: string | null;
  recipient?: string | null;
}): Promise<void> {
  const repo = new TeamsRepository();
  const run = await repo.findRun(input.teamRunId);
  if (!run) return;
  const existing = (run.checkpointJson ?? null) as TeamRunCheckpoint | null;
  const base: TeamRunCheckpoint =
    existing ??
    ({
      plan: [],
      completedResults: [],
      nextStageIndex: 0,
      waitTriggerIds: [],
      waitReason: '',
    } satisfies TeamRunCheckpoint);
  const next = upsertWaitContactInCheckpoint(base, input);
  await repo.updateRunStatus(run.id, run.status, { checkpointJson: next });
}
