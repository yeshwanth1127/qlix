import type {
  PendingWaitOutbound,
  TeamMailboxMessageDTO,
  TeamRunDTO,
} from './teams.types.js';

export class TeamOutboundProvenanceError extends Error {
  readonly code = 'team_outbound_provenance_blocked';
}

function digits(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '');
}

function recordField(record: Record<string, unknown>, names: RegExp): unknown {
  for (const [key, value] of Object.entries(record)) {
    if (names.test(key)) return value;
  }
  return undefined;
}

function phonesEqual(left: string, right: string): boolean {
  if (!left || !right || left.length < 8 || right.length < 8) return false;
  return left === right || left.endsWith(right) || right.endsWith(left);
}

function collectContactRecords(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) =>
      item && typeof item === 'object' && !Array.isArray(item)
        ? [item as Record<string, unknown>, ...collectContactRecords(item)]
        : collectContactRecords(item),
    );
  }
  if (!value || typeof value !== 'object') return [];
  return Object.values(value as Record<string, unknown>).flatMap(collectContactRecords);
}

export function validatedOutboundContacts(
  run: TeamRunDTO,
  mailbox: TeamMailboxMessageDTO[],
): Array<{ phone: string; name?: string }> {
  const authoritativeRefs = new Set(
    run.inputs.filter((input) => input.purpose === 'authoritative_input').map((input) => input.ref),
  );
  const contacts: Array<{ phone: string; name?: string }> = [];
  for (const message of mailbox) {
    if (message.status !== 'completed' || !message.payload || typeof message.payload !== 'object') continue;
    const envelope = message.payload as {
      data?: unknown;
      provenance?: { inputRefs?: unknown; recordRefs?: unknown };
    };
    const refs = Array.isArray(envelope.provenance?.inputRefs)
      ? envelope.provenance.inputRefs.filter((ref): ref is string => typeof ref === 'string')
      : [];
    const rows = Array.isArray(envelope.provenance?.recordRefs)
      ? envelope.provenance.recordRefs
      : [];
    if (!refs.some((ref) => authoritativeRefs.has(ref)) || rows.length === 0) continue;
    for (const record of collectContactRecords(envelope.data)) {
      const phone = digits(recordField(record, /^(phone|mobile|recipient|whatsapp)$/i));
      if (!phone) continue;
      const nameRaw = recordField(record, /^name$/i);
      const name = typeof nameRaw === 'string' ? nameRaw.trim() : undefined;
      contacts.push({ phone, ...(name ? { name } : {}) });
    }
  }
  return contacts;
}

export function assertTeamOutboundAllowed(
  run: TeamRunDTO,
  mailbox: TeamMailboxMessageDTO[],
  outbound: Pick<PendingWaitOutbound, 'recipient' | 'jid' | 'phone' | 'name'>,
): void {
  const targetPhone = digits(outbound.phone || outbound.jid || outbound.recipient);
  const targetName = (outbound.name || outbound.recipient || '').trim().toLocaleLowerCase();
  const contacts = validatedOutboundContacts(run, mailbox);
  const match = contacts.find((contact) => phonesEqual(contact.phone, targetPhone));
  if (!targetPhone || !match) {
    throw new TeamOutboundProvenanceError(
      `Blocked recipient ${outbound.recipient}: not present in authoritative Result data`,
    );
  }
  const targetLooksLikePhone = /^\+?\d[\d\s().-]{6,}$/.test(targetName);
  if (
    targetName &&
    match.name &&
    !targetLooksLikePhone &&
    targetName !== match.name.toLocaleLowerCase()
  ) {
    throw new TeamOutboundProvenanceError(
      `Blocked recipient ${outbound.recipient}: name/phone mapping differs from source data`,
    );
  }
}
