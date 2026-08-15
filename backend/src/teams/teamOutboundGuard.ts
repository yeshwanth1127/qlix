import type {
  PendingWaitOutbound,
  TeamMailboxMessageDTO,
  TeamRunDTO,
} from './teams.types.js';
import {
  normalizeRecipientAddress,
  recipientAddressesEqual,
  resolveCanonicalRecipients,
} from '../communications/recipientResolution.js';

export class TeamOutboundProvenanceError extends Error {
  readonly code = 'team_outbound_provenance_blocked';
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
      ? envelope.provenance.recordRefs.filter((ref): ref is string => typeof ref === 'string')
      : [];
    const trustedRefs = refs.filter((ref) => authoritativeRefs.has(ref));
    if (trustedRefs.length === 0 || rows.length === 0) continue;
    for (const recipient of resolveCanonicalRecipients({
      value: envelope.data,
      channel: 'whatsapp',
      sourceRefs: trustedRefs,
      rowRefs: rows,
    })) {
      contacts.push({
        phone: recipient.address,
        ...(recipient.displayName ? { name: recipient.displayName } : {}),
      });
    }
  }
  return contacts;
}

export function assertTeamOutboundAllowed(
  run: TeamRunDTO,
  mailbox: TeamMailboxMessageDTO[],
  outbound: Pick<PendingWaitOutbound, 'recipient' | 'jid' | 'phone' | 'name'>,
): { phone: string; name?: string } {
  const targetPhone = normalizeRecipientAddress(
    'whatsapp',
    outbound.phone || outbound.jid || outbound.recipient,
  );
  const requestedRecipient = outbound.recipient.trim();
  const recipientLooksLikePhoneOrJid =
    /^\+?\d[\d\s().-]{6,}$/.test(requestedRecipient) ||
    /^\d+(?::\d+)?@(?:s\.whatsapp\.net|lid)$/i.test(requestedRecipient);
  // `outbound.name` comes from WhatsApp contact metadata and may be a local
  // nickname that legitimately differs from the authoritative source name.
  // Only validate a name when the caller actually selected the recipient by name.
  const requestedName = recipientLooksLikePhoneOrJid
    ? ''
    : requestedRecipient.toLocaleLowerCase();
  const contacts = validatedOutboundContacts(run, mailbox);
  const match = contacts.find((contact) =>
    recipientAddressesEqual('whatsapp', contact.phone, targetPhone),
  );
  if (!targetPhone || !match) {
    throw new TeamOutboundProvenanceError(
      `Blocked recipient ${outbound.recipient}: not present in authoritative Result data`,
    );
  }
  if (
    requestedName &&
    match.name &&
    requestedName !== match.name.toLocaleLowerCase()
  ) {
    throw new TeamOutboundProvenanceError(
      `Blocked recipient ${outbound.recipient}: name/phone mapping differs from source data`,
    );
  }
  return match;
}
