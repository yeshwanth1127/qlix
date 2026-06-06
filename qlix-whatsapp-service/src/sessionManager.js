import makeWASocket, { DisconnectReason, useMultiFileAuthState } from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as qlix from './qlix-client.js';
import {
  clearPendingApproval,
  handleInboundMessage,
  isSelfChat,
  registerPendingApproval,
} from './handlers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_ROOT = path.join(__dirname, '..', 'auth_info');

const BAILEYS_LOG_LEVEL =
  process.env.BAILEYS_LOG_LEVEL ??
  (process.env.NODE_ENV === 'production' ? 'silent' : 'silent');

const logger = pino({ level: BAILEYS_LOG_LEVEL });

/** @type {Map<string, SessionEntry>} */
const sessions = new Map();

/**
 * @typedef {Object} SessionEntry
 * @property {string} connectorId
 * @property {import('@whiskeysockets/baileys').WASocket|null} sock
 * @property {boolean} connected
 * @property {string|null} qr
 * @property {string|null} ownerJid
 * @property {string|null} ownerPhoneJid
 * @property {number} reconnectAttempts
 */

/** Deliver only to the QR-linked account (creds / sock.user), never a contact. */
function resolveDeliveryJids(entry) {
  const jids = [];
  if (entry.ownerPhoneJid) jids.push(entry.ownerPhoneJid);
  const credsPhone = phoneJidFromUserId(entry.sock?.authState?.creds?.me?.id);
  if (credsPhone) jids.push(credsPhone);
  const sockPhone = phoneJidFromUserId(entry.sock?.user?.id);
  if (sockPhone) jids.push(sockPhone);
  if (entry.ownerJid?.endsWith('@lid')) jids.push(entry.ownerJid);
  return [...new Set(jids.filter(Boolean))];
}

function phoneJidFromUserId(userId) {
  if (!userId || !userId.includes('@s.whatsapp.net')) return null;
  const local = userId.split('@')[0].split(':')[0];
  return local ? `${local}@s.whatsapp.net` : null;
}

/** Strip the device suffix (e.g. ":77") from an @lid: "162027775520975:77@lid" -> "162027775520975@lid". */
function normalizeLid(jid) {
  if (!jid || !jid.endsWith('@lid')) return null;
  const local = jid.split('@')[0].split(':')[0];
  return local ? `${local}@lid` : null;
}

/** Only the logged-in account (QR-linked), never a contact's remoteJid. */
function rememberSelfJid(entry, jid) {
  if (!jid) return;
  entry.knownSelfJids.add(jid);
  if (jid.endsWith('@lid')) {
    entry.ownerLid = jid;
    // Store the normalized @lid (without device suffix) — this is what self-chat messages use.
    const normalized = normalizeLid(jid);
    if (normalized) {
      entry.ownerLidNormalized = normalized;
      entry.knownSelfJids.add(normalized);
      console.log(`[qlix-whatsapp] captured ownerLid: ${jid} (normalized=${normalized}) for connector=${entry.connectorId}`);
    }
  }
  const phone = phoneJidFromUserId(jid);
  if (phone) entry.ownerPhoneJid = phone;
}

function captureOwnerJids(entry, userId) {
  if (!userId) return;
  entry.ownerJid = userId;
  rememberSelfJid(entry, userId);
  const me = entry.sock?.authState?.creds?.me;
  if (me?.id) rememberSelfJid(entry, me.id);
  // Capture the account's own @lid (used by "Message yourself" self-chat).
  if (me?.lid) rememberSelfJid(entry, me.lid);
}

const QLIX_ECHO_MARKERS = [
  'Qlix API error',
  'Multiple agents',
  'set a default agent in Connectors',
  'Which agent? You have:',
  '📋 *Qlix',
  'Queued —',
  '🤖 *Qlix',
  '⚠️ ',
  '✅ Approved',
  '❌ Rejected',
  'No pending approval',
  'No active team run',
  '*Team run active*',
  '🚀 *',
  '▶️ ',
  'ℹ️ ',
];

function rememberOutbound(entry, text) {
  const normalized = String(text).trim().slice(0, 800);
  if (!normalized) return;
  if (!entry.recentOutbound) entry.recentOutbound = [];
  entry.recentOutbound.push({ text: normalized, at: Date.now() });
  entry.lastOutboundAt = Date.now();
  const cutoff = Date.now() - 3600_000;
  entry.recentOutbound = entry.recentOutbound.filter((r) => r.at > cutoff).slice(-40);
}

function rememberOutboundMessageId(entry, msgKey) {
  const id = msgKey?.id;
  if (!id) return;
  if (!entry.recentOutboundIds) entry.recentOutboundIds = new Set();
  entry.recentOutboundIds.add(id);
  if (entry.recentOutboundIds.size > 300) {
    const keep = [...entry.recentOutboundIds].slice(-150);
    entry.recentOutboundIds = new Set(keep);
  }
}

function isOurOutboundMessageId(entry, msgKey) {
  const id = msgKey?.id;
  return Boolean(id && entry.recentOutboundIds?.has(id));
}

function isEchoOfOurOutbound(entry, text) {
  const t = String(text).trim();
  if (!t) return true;
  if (QLIX_ECHO_MARKERS.some((m) => t.includes(m))) return true;
  if (!entry.recentOutbound?.length) return false;
  return entry.recentOutbound.some(
    (r) =>
      r.text === t ||
      (t.length > 20 && r.text.startsWith(t.slice(0, 40))) ||
      (r.text.length > 20 && t.startsWith(r.text.slice(0, 40))),
  );
}

/** Only the QR-linked account's self-chat — never random @lid contacts. */
function isAllowedInboundChat(entry, remoteJid, fromMe) {
  const phone = entry.ownerPhoneJid;
  const selfRemote = entry.selfChatRemoteJid;

  // Already remembered self-chat
  if (selfRemote && remoteJid === selfRemote) return true;

  // Phone number match
  if (phone && remoteJid === phone) return true;

  // ONLY accept @lid if it matches the account's OWN @lid (from creds.me.lid).
  // This is the critical privacy check — other contacts also use @lid addresses.
  if (remoteJid.endsWith('@lid')) {
    const normalized = normalizeLid(remoteJid);
    return (
      remoteJid === entry.ownerLid ||
      (normalized != null && normalized === entry.ownerLidNormalized)
    );
  }

  // fromMe messages from the account
  if (fromMe) {
    if (phone && phoneJidFromUserId(remoteJid) === phone) return true;
    if (entry.ownerLid && remoteJid === entry.ownerLid) return true;
  }

  return false;
}

function allowedSelfJidsForEntry(entry) {
  return [entry.selfChatRemoteJid, entry.ownerPhoneJid, entry.ownerLid].filter(Boolean);
}

function ownerJidForInbound(entry) {
  return entry.ownerPhoneJid ?? entry.ownerJid ?? entry.sock?.user?.id ?? null;
}

function authDir(connectorId) {
  const safe = connectorId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(AUTH_ROOT, safe);
}

function backoffMs(attempt) {
  return Math.min(30_000, 1000 * 2 ** attempt);
}

async function notifyLinked(connectorId, ownerJid) {
  await qlix.notifyLinked(connectorId, ownerJid);
}

export function getSession(connectorId) {
  return sessions.get(connectorId) ?? null;
}

export function listSessions() {
  return [...sessions.values()].map((s) => ({
    connectorId: s.connectorId,
    connected: s.connected,
    ownerJid: s.ownerJid,
  }));
}

/** Reconnect Baileys for every connector that still has saved auth on disk. */
export async function resumeSavedSessions() {
  if (!fs.existsSync(AUTH_ROOT)) return;
  const dirs = fs.readdirSync(AUTH_ROOT, { withFileTypes: true }).filter((d) => d.isDirectory());
  for (const dirent of dirs) {
    const connectorId = dirent.name;
    try {
      await startSession(connectorId);
      console.log(`[qlix-whatsapp] resuming saved session ${connectorId}…`);
    } catch (err) {
      console.warn(
        `[qlix-whatsapp] resume failed ${connectorId}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}

export async function startSession(connectorId) {
  if (sessions.has(connectorId)) {
    const existing = sessions.get(connectorId);
    if (existing?.sock) return existing;
  }

  const dir = authDir(connectorId);
  fs.mkdirSync(dir, { recursive: true });

  const entry = {
    connectorId,
    sock: null,
    connected: false,
    qr: null,
    ownerJid: null,
    ownerPhoneJid: null,
    ownerLid: null,
    /** Account's own @lid with device suffix stripped (e.g. "162027775520975@lid"). */
    ownerLidNormalized: null,
    /** Remote JID for "Message yourself" (learned from fromMe sends). */
    selfChatRemoteJid: null,
    knownSelfJids: new Set(),
    /** Recent texts we sent — used to ignore echo loops in self-chat. */
    recentOutbound: [],
    recentOutboundIds: new Set(),
    lastOutboundAt: 0,
    inboundLock: false,
    lastInboundKey: '',
    lastInboundAt: 0,
    reconnectAttempts: 0,
  };
  sessions.set(connectorId, entry);

  const { state, saveCreds } = await useMultiFileAuthState(dir);

  const connect = async () => {
    if (entry.sock) {
      try {
        entry.sock.end(undefined);
      } catch {
        // ignore
      }
    }

    entry.sock = makeWASocket({
      auth: state,
      logger,
      printQRInTerminal: false,
    });

    entry.sock.ev.on('creds.update', async () => {
      await saveCreds();
      const mePhone = phoneJidFromUserId(entry.sock?.authState?.creds?.me?.id);
      if (mePhone) entry.ownerPhoneJid = mePhone;
    });

    entry.sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        entry.qr = qr;
        if (process.env.NODE_ENV !== 'production') {
          console.log(`[qlix-whatsapp] QR for ${connectorId}`);
          qrcode.generate(qr, { small: true });
        }
      }

      if (connection === 'open') {
        entry.connected = true;
        entry.qr = null;
        entry.reconnectAttempts = 0;
        const jid = entry.sock?.user?.id;
        if (jid) {
          captureOwnerJids(entry, jid);
          await notifyLinked(connectorId, jid);
        }
        console.log(
          `[qlix-whatsapp] connected ${connectorId} owner=${entry.ownerJid} phone=${entry.ownerPhoneJid ?? 'n/a'} lid=${entry.ownerLid ?? 'none'} knownJids=${[...entry.knownSelfJids].join(',')}`,
        );
      }

      if (connection === 'close') {
        entry.connected = false;
        const statusCode =
          lastDisconnect?.error?.output?.statusCode ?? DisconnectReason.unknown;

        if (statusCode === DisconnectReason.loggedOut) {
          console.error(`[qlix-whatsapp] logged out ${connectorId}`);
          fs.rmSync(dir, { recursive: true, force: true });
          sessions.delete(connectorId);
          return;
        }

        entry.reconnectAttempts += 1;
        const delay = backoffMs(entry.reconnectAttempts - 1);
        setTimeout(() => connect().catch(console.error), delay);
      }
    });

    entry.sock.ev.on('messages.upsert', async ({ messages, type }) => {
      // Only real-time messages — never history sync (append) or unknown types.
      if (type !== 'notify') return;

      for (const msg of messages) {
        if (!msg.message) continue;
        if (isOurOutboundMessageId(entry, msg.key)) continue;

        const remoteJid = msg.key.remoteJid || '';
        if (remoteJid.endsWith('@g.us')) continue;
        if (msg.message.protocolMessage || msg.message.senderKeyDistributionMessage) continue;

        const text =
          msg.message.conversation ||
          msg.message.extendedTextMessage?.text ||
          msg.message.buttonsResponseMessage?.selectedDisplayText ||
          '';
        const trimmed = text.trim();
        if (!trimmed) {
          continue;
        }

        const selfJid = ownerJidForInbound(entry);
        if (!selfJid) continue;

        const now = Date.now();

        // Single authoritative gate: only the QR-linked account's own self-chat is allowed.
        // This rejects all other contacts (including their @lid addresses).
        if (!isAllowedInboundChat(entry, remoteJid, Boolean(msg.key.fromMe))) {
          continue;
        }

        if (msg.key.fromMe) {
          const phone = entry.ownerPhoneJid;
          if (phone && (remoteJid === phone || phoneJidFromUserId(remoteJid) === phone)) {
            entry.selfChatRemoteJid = remoteJid;
          }
        }

        if (isEchoOfOurOutbound(entry, trimmed)) {
          continue;
        }

        const dedupeKey = `${msg.key.id ?? ''}:${trimmed.slice(0, 120)}`;
        if (entry.lastInboundKey === dedupeKey && now - entry.lastInboundAt < 3000) continue;
        entry.lastInboundKey = dedupeKey;
        entry.lastInboundAt = now;

        if (entry.inboundLock) continue;
        entry.inboundLock = true;
        try {
          console.log(
            `[qlix-whatsapp] inbound connector=${connectorId} fromMe=${Boolean(msg.key.fromMe)} remote=${remoteJid}`,
          );
          await handleInboundMessage(
            connectorId,
            selfJid,
            remoteJid,
            trimmed,
            allowedSelfJidsForEntry(entry),
          );
        } finally {
          entry.inboundLock = false;
        }
      }
    });
  };

  await connect();
  return entry;
}

export async function stopSession(connectorId) {
  const entry = sessions.get(connectorId);
  if (entry?.sock) {
    try {
      entry.sock.end(undefined);
    } catch {
      // ignore
    }
  }
  sessions.delete(connectorId);
  const dir = authDir(connectorId);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function isSessionConnected(connectorId) {
  return sessions.get(connectorId)?.connected === true;
}

export async function sendToConnector(connectorId, text) {
  const entry = sessions.get(connectorId);
  if (!entry?.connected || !entry.sock) {
    return { ok: false, error: 'WhatsApp not connected' };
  }
  const targets = resolveDeliveryJids(entry);
  if (targets.length === 0) {
    return { ok: false, error: 'Owner JID not known yet' };
  }
  let lastError = 'Send failed';
  const selfChatJid = entry.selfChatRemoteJid ?? entry.ownerLid;
  const ordered =
    selfChatJid && targets.includes(selfChatJid)
      ? [selfChatJid, ...targets.filter((j) => j !== selfChatJid)]
      : targets;

  for (const jid of ordered) {
    try {
      const sent = await entry.sock.sendMessage(jid, { text });
      rememberOutbound(entry, text);
      rememberOutboundMessageId(entry, sent?.key);
      console.log(`[qlix-whatsapp] sent connector=${connectorId} to=${jid}`);
      return { ok: true, timestamp: new Date().toISOString(), jid };
    } catch (err) {
      lastError = err.message || lastError;
      console.warn(`[qlix-whatsapp] send failed connector=${connectorId} to=${jid}:`, lastError);
    }
  }
  return { ok: false, error: lastError };
}

export async function sendDocumentToConnector(connectorId, filePath, fileName, mimetype) {
  const entry = sessions.get(connectorId);
  if (!entry?.connected || !entry.sock) {
    return { ok: false, error: 'WhatsApp not connected' };
  }
  const targets = resolveDeliveryJids(entry);
  if (targets.length === 0) {
    return { ok: false, error: 'Owner JID not known yet' };
  }

  let buffer;
  try {
    buffer = fs.readFileSync(filePath);
  } catch (err) {
    return { ok: false, error: `Cannot read file: ${err.message}` };
  }

  const selfChatJid = entry.selfChatRemoteJid ?? entry.ownerLid;
  const ordered =
    selfChatJid && targets.includes(selfChatJid)
      ? [selfChatJid, ...targets.filter((j) => j !== selfChatJid)]
      : targets;

  let lastError = 'Send failed';
  for (const jid of ordered) {
    try {
      const sent = await entry.sock.sendMessage(jid, {
        document: buffer,
        mimetype,
        fileName,
      });
      rememberOutboundMessageId(entry, sent?.key);
      console.log(`[qlix-whatsapp] sent document connector=${connectorId} to=${jid} file=${fileName}`);
      return { ok: true, timestamp: new Date().toISOString(), jid };
    } catch (err) {
      lastError = err.message || lastError;
      console.warn(`[qlix-whatsapp] send document failed connector=${connectorId} to=${jid}:`, lastError);
    }
  }
  return { ok: false, error: lastError };
}

export function getSessionStatus(connectorId) {
  const entry = sessions.get(connectorId);
  if (!entry) {
    return { connected: false, qr: null, ownerJid: null };
  }
  return {
    connected: entry.connected,
    qr: entry.qr,
    ownerJid: entry.ownerJid,
  };
}

export { registerPendingApproval, clearPendingApproval };
