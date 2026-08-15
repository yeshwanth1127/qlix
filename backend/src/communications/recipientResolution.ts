import { createHash } from 'node:crypto';

export type CommunicationChannel = 'whatsapp' | 'sms' | 'phone' | 'email' | string;

export type CanonicalRecipient = {
  recipientId: string;
  displayName?: string;
  channel: CommunicationChannel;
  address: string;
  sourceRef: string;
  rowRef?: string;
};

export type RecipientAliasConfig = {
  displayName: string[];
  phone: string[];
  email: string[];
  genericAddress: string[];
};

export const DEFAULT_RECIPIENT_ALIASES: RecipientAliasConfig = {
  displayName: ['name', 'full name', 'contact name', 'lead name', 'customer name', 'student name'],
  phone: [
    'phone',
    'phone number',
    'phone no',
    'mobile',
    'mobile number',
    'mobile no',
    'contact number',
    'contact no',
    'whatsapp',
    'whatsapp number',
    'whatsapp no',
    'telephone',
    'tel',
    'recipient',
  ],
  email: ['email', 'email address', 'e-mail', 'mail', 'recipient email'],
  genericAddress: ['address', 'recipient', 'recipient address', 'destination', 'contact'],
};

export function canonicalFieldName(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '');
}

function aliasSet(values: string[]): Set<string> {
  return new Set(values.map(canonicalFieldName));
}

function fieldValue(record: Record<string, unknown>, aliases: string[]): unknown {
  const allowed = aliasSet(aliases);
  for (const [key, value] of Object.entries(record)) {
    if (allowed.has(canonicalFieldName(key))) return value;
  }
  return undefined;
}

function candidateRecords(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(candidateRecords);
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  return [record, ...Object.values(record).flatMap(candidateRecords)];
}

export function normalizeRecipientAddress(
  channel: CommunicationChannel,
  value: unknown,
): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (channel === 'email') {
    const email = raw.toLocaleLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
  }
  if (channel === 'whatsapp' || channel === 'sms' || channel === 'phone') {
    const digits = raw.replace(/\D/g, '');
    return digits.length >= 8 ? digits : null;
  }
  return raw;
}

function addressAliases(channel: CommunicationChannel, aliases: RecipientAliasConfig): string[] {
  if (channel === 'email') return aliases.email;
  if (channel === 'whatsapp' || channel === 'sms' || channel === 'phone') return aliases.phone;
  return aliases.genericAddress;
}

function stableRecipientId(input: {
  channel: CommunicationChannel;
  address: string;
  sourceRef: string;
  rowRef?: string;
}): string {
  const digest = createHash('sha256')
    .update(`${input.channel}\u0000${input.address}\u0000${input.sourceRef}\u0000${input.rowRef ?? ''}`)
    .digest('hex')
    .slice(0, 24);
  return `recipient_${digest}`;
}

/** Converts arbitrary connector/file records into one channel-neutral envelope. */
export function resolveCanonicalRecipients(input: {
  value: unknown;
  channel: CommunicationChannel;
  sourceRefs: string[];
  rowRefs?: string[];
  aliases?: Partial<RecipientAliasConfig>;
}): CanonicalRecipient[] {
  if (input.sourceRefs.length === 0) return [];
  const aliases: RecipientAliasConfig = {
    displayName: input.aliases?.displayName ?? DEFAULT_RECIPIENT_ALIASES.displayName,
    phone: input.aliases?.phone ?? DEFAULT_RECIPIENT_ALIASES.phone,
    email: input.aliases?.email ?? DEFAULT_RECIPIENT_ALIASES.email,
    genericAddress: input.aliases?.genericAddress ?? DEFAULT_RECIPIENT_ALIASES.genericAddress,
  };
  const rows = input.rowRefs ?? [];
  const resolved: CanonicalRecipient[] = [];
  const seen = new Set<string>();
  for (const [index, record] of candidateRecords(input.value).entries()) {
    const address = normalizeRecipientAddress(
      input.channel,
      fieldValue(record, addressAliases(input.channel, aliases)),
    );
    if (!address) continue;
    const displayNameRaw = fieldValue(record, aliases.displayName);
    const displayName = typeof displayNameRaw === 'string' ? displayNameRaw.trim() : undefined;
    const sourceRef = input.sourceRefs[0]!;
    const rowRef = rows[index] ?? (rows.length === 1 ? rows[0] : undefined);
    const key = `${input.channel}:${address}`;
    if (seen.has(key)) continue;
    seen.add(key);
    resolved.push({
      recipientId: stableRecipientId({ channel: input.channel, address, sourceRef, rowRef }),
      channel: input.channel,
      address,
      sourceRef,
      ...(rowRef ? { rowRef } : {}),
      ...(displayName ? { displayName } : {}),
    });
  }
  return resolved;
}

export function recipientAddressesEqual(
  channel: CommunicationChannel,
  left: unknown,
  right: unknown,
): boolean {
  const normalizedLeft = normalizeRecipientAddress(channel, left);
  const normalizedRight = normalizeRecipientAddress(channel, right);
  if (!normalizedLeft || !normalizedRight) return false;
  if (channel === 'whatsapp' || channel === 'sms' || channel === 'phone') {
    return (
      normalizedLeft === normalizedRight ||
      normalizedLeft.endsWith(normalizedRight) ||
      normalizedRight.endsWith(normalizedLeft)
    );
  }
  return normalizedLeft === normalizedRight;
}
