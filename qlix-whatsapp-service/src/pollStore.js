import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(__dirname, '..', 'data', 'poll-creations.json');

const POLL_NAME_MAX = 255;
const POLL_OPTION_MAX = 100;
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 12;
const MAX_STORED_POLLS = 400;

/** @type {Map<string, object>} */
const polls = new Map();

function pollKey(connectorId, messageId) {
  return `${connectorId}:${messageId}`;
}

function persist() {
  const rows = [...polls.values()].map((row) => ({
    connectorId: row.connectorId,
    id: row.id,
    remoteJid: row.remoteJid,
    message: row.message,
    createdAt: row.createdAt,
    forwarded: row.forwarded ?? {},
  }));
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(rows), 'utf8');
  } catch (err) {
    console.warn('[qlix-whatsapp] failed to persist poll creations:', err?.message ?? err);
  }
}

function load() {
  let rows;
  try {
    rows = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return;
  }
  if (!Array.isArray(rows)) return;
  for (const row of rows) {
    if (!row?.connectorId || !row?.id || !row?.message) continue;
    polls.set(pollKey(row.connectorId, row.id), {
      connectorId: row.connectorId,
      id: row.id,
      remoteJid: row.remoteJid ?? null,
      message: row.message,
      createdAt: row.createdAt ?? Date.now(),
      forwarded: row.forwarded && typeof row.forwarded === 'object' ? row.forwarded : {},
    });
  }
  if (polls.size > 0) {
    console.log(`[qlix-whatsapp] loaded ${polls.size} poll creation(s) from disk`);
  }
}

load();

export function validatePollPayload(input) {
  const name = String(input?.name ?? '').trim();
  if (!name) return { ok: false, error: 'poll name is required' };
  if (name.length > POLL_NAME_MAX) {
    return { ok: false, error: `poll name too long (max ${POLL_NAME_MAX} chars)` };
  }

  const rawValues = Array.isArray(input?.values) ? input.values : [];
  const seen = new Set();
  const values = [];
  for (const raw of rawValues) {
    const option = String(raw ?? '').trim();
    if (!option) continue;
    if (option.length > POLL_OPTION_MAX) {
      return { ok: false, error: `poll option too long (max ${POLL_OPTION_MAX} chars)` };
    }
    const key = option.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    values.push(option);
  }
  if (values.length < MIN_OPTIONS) {
    return { ok: false, error: `poll needs at least ${MIN_OPTIONS} options` };
  }
  if (values.length > MAX_OPTIONS) {
    return { ok: false, error: `poll allows at most ${MAX_OPTIONS} options` };
  }

  let selectableCount = Number(input?.selectableCount ?? 1);
  if (!Number.isFinite(selectableCount)) selectableCount = 1;
  selectableCount = Math.max(1, Math.min(values.length, Math.floor(selectableCount)));

  return { ok: true, name, values, selectableCount };
}

function serializeMessageSecret(message) {
  if (!message || typeof message !== 'object') return message;
  const secret = message.messageContextInfo?.messageSecret;
  if (!secret || typeof secret === 'string') return message;
  let b64 = null;
  if (Buffer.isBuffer(secret) || secret instanceof Uint8Array) {
    b64 = Buffer.from(secret).toString('base64');
  } else if (secret?.type === 'Buffer' && Array.isArray(secret.data)) {
    b64 = Buffer.from(secret.data).toString('base64');
  } else if (Array.isArray(secret)) {
    b64 = Buffer.from(secret).toString('base64');
  }
  if (!b64) return message;
  return {
    ...message,
    messageContextInfo: {
      ...(message.messageContextInfo ?? {}),
      messageSecret: b64,
    },
  };
}

export function rememberPollCreation(input) {
  const id = String(input?.id ?? '').trim();
  const connectorId = String(input?.connectorId ?? '').trim();
  if (!id || !connectorId || !input?.message) return;
  polls.set(pollKey(connectorId, id), {
    connectorId,
    id,
    remoteJid: input.remoteJid ?? null,
    message: serializeMessageSecret(input.message),
    createdAt: Date.now(),
    forwarded: {},
  });
  if (polls.size > MAX_STORED_POLLS) {
    const oldest = [...polls.entries()].sort((a, b) => (a[1].createdAt ?? 0) - (b[1].createdAt ?? 0))[0];
    if (oldest) polls.delete(oldest[0]);
  }
  persist();
}

export function getPollCreation(connectorId, messageId) {
  if (!connectorId || !messageId) return null;
  return polls.get(pollKey(connectorId, messageId)) ?? null;
}

export function getPollMessageForKey(connectorId, key) {
  const id = key?.id;
  if (!id) return null;
  const row = getPollCreation(connectorId, id);
  return row?.message ?? null;
}

export function shouldForwardPollVote(connectorId, messageId, voterKey, fingerprint) {
  const row = getPollCreation(connectorId, messageId);
  if (!row) return false;
  const prev = row.forwarded?.[voterKey];
  if (prev === fingerprint) return false;
  row.forwarded = { ...(row.forwarded ?? {}), [voterKey]: fingerprint };
  persist();
  return true;
}

export function formatPollVoteText(selected) {
  const names = (selected ?? []).map((s) => String(s).trim()).filter(Boolean);
  if (names.length === 0) return '';
  return names.join(', ');
}
