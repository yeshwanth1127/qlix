import makeWASocket, { DisconnectReason, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import { migratePlaintextAuthDir, useEncryptedMultiFileAuthState } from './encryptedAuthState.js';
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

const VERSION_TTL_MS = 60 * 60 * 1000;
/** @type {number[]|null} */
let cachedBaileysVersion = null;
let cachedBaileysVersionAt = 0;
/** @type {string|null} */
let lastBaileysVersionError = null;

const CONNECTOR_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidConnectorId(connectorId) {
  return CONNECTOR_ID_RE.test(String(connectorId ?? ''));
}

async function getBaileysVersion(forceRefresh = false) {
  if (
    !forceRefresh &&
    cachedBaileysVersion &&
    Date.now() - cachedBaileysVersionAt < VERSION_TTL_MS
  ) {
    return cachedBaileysVersion;
  }
  try {
    const { version } = await fetchLatestBaileysVersion();
    cachedBaileysVersion = version;
    cachedBaileysVersionAt = Date.now();
    lastBaileysVersionError = null;
    return version;
  } catch (err) {
    lastBaileysVersionError = err instanceof Error ? err.message : String(err);
    throw err;
  }
}

/** Fail fast at process start if WA Web version cannot be resolved (QR linking requires this). */
export async function ensureBaileysVersionReady() {
  const version = await getBaileysVersion(true);
  if (!Array.isArray(version) || version.length < 3) {
    throw new Error('fetchLatestBaileysVersion returned an invalid version tuple');
  }
  console.log(
    `[qlix-whatsapp] Baileys WA Web version ${version.join('.')} (required for QR linking)`,
  );
  return version;
}

/** Exposed for /health — ops can detect stale/missing version before users hit a blank QR. */
export function getBaileysVersionHealth() {
  return {
    baileys_version_ok: Boolean(cachedBaileysVersion?.length),
    baileys_version: cachedBaileysVersion ? cachedBaileysVersion.join('.') : null,
    baileys_version_fetched_at: cachedBaileysVersionAt
      ? new Date(cachedBaileysVersionAt).toISOString()
      : null,
    baileys_version_error: lastBaileysVersionError,
  };
}

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

/** Normalize any PN jid to bare user@s.whatsapp.net (drop device suffix). Never invent a PN from @lid. */
function normalizePnJid(jid) {
  if (!jid || typeof jid !== 'string') return null;
  if (jid.endsWith('@lid') || jid.endsWith('@g.us')) return null;
  if (jid.includes('@s.whatsapp.net')) {
    return phoneJidFromUserId(jid);
  }
  if (jid.endsWith('@hosted') || jid.includes('@hosted')) {
    const digits = normalizePhoneDigits(jid.split('@')[0].split(':')[0]);
    return jidFromPhoneDigits(digits);
  }
  // Bare numeric PN from Baileys LID mapping.
  if (/^\d{8,15}$/.test(jid)) return jidFromPhoneDigits(jid);
  return null;
}

function rememberLidPnMapping(entry, lidJid, pnJid) {
  if (!entry.lidToPn) entry.lidToPn = new Map();
  if (!entry.pnToLid) entry.pnToLid = new Map();
  const lid = normalizeLid(lidJid);
  const pn = normalizePnJid(pnJid);
  if (!lid || !pn) return;
  entry.lidToPn.set(lid, pn);
  entry.pnToLid.set(pn, lid);
}

/**
 * Contact chats often arrive as @lid while waits are armed on phone JIDs.
 * Collect remoteJid + Baileys alt keys + Signal LID↔PN mapping candidates.
 */
async function collectContactArmedCandidates(entry, msg, remoteJid) {
  const candidates = [];
  const push = (raw) => {
    if (!raw || typeof raw !== 'string') return;
    const jid = raw.trim();
    if (!jid || candidates.includes(jid)) return;
    candidates.push(jid);
    const pn = normalizePnJid(jid);
    if (pn && !candidates.includes(pn)) candidates.push(pn);
    const lid = normalizeLid(jid);
    if (lid && !candidates.includes(lid)) candidates.push(lid);
  };

  push(remoteJid);
  push(msg?.key?.remoteJidAlt);
  push(msg?.key?.participantAlt);

  const lids = candidates.filter((j) => j.endsWith('@lid')).map((j) => normalizeLid(j)).filter(Boolean);
  for (const lid of lids) {
    const cached = entry.lidToPn?.get(lid);
    if (cached) push(cached);
    try {
      const mapped = await entry.sock?.signalRepository?.lidMapping?.getPNForLID?.(lid);
      if (mapped) {
        rememberLidPnMapping(entry, lid, mapped);
        push(mapped);
      }
    } catch (err) {
      console.warn(
        `[qlix-whatsapp] getPNForLID failed for ${lid}:`,
        err?.message ?? err,
      );
    }
  }

  // If we only have a phone jid so far, also try reverse mapping for completeness.
  const pns = candidates
    .map((j) => normalizePnJid(j))
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i);
  for (const pn of pns) {
    const cachedLid = entry.pnToLid?.get(pn);
    if (cachedLid) push(cachedLid);
  }

  return candidates;
}

/**
 * Returns the JID to forward to Qlix when any candidate is armed.
 * Prefers the phone (@s.whatsapp.net) form so WaitTrigger / auto-reply rows match.
 */
async function resolveArmedContactJid(entry, connectorId, msg, remoteJid) {
  const candidates = await collectContactArmedCandidates(entry, msg, remoteJid);
  for (const candidate of candidates) {
    let armed = false;
    try {
      armed = await qlix.isAutoReplyArmed(connectorId, candidate);
    } catch {
      armed = false;
    }
    if (!armed) continue;
    const pn =
      normalizePnJid(candidate) ||
      (candidate.endsWith('@lid') ? entry.lidToPn?.get(normalizeLid(candidate)) : null);
    return {
      armedJid: pn || candidate,
      remoteJid,
      candidates,
    };
  }

  // Reverse path: inbound @lid often has no reverse mapping yet. Compare against
  // LIDs for every phone currently armed on this connector.
  if (remoteJid.endsWith('@lid')) {
    const inboundLid = normalizeLid(remoteJid);
    try {
      const armedPhones = await qlix.listArmedContacts(connectorId);
      for (const phone of armedPhones) {
        const pn = normalizePnJid(phone) || phone;
        let lid = entry.pnToLid?.get(pn) || null;
        if (!lid) {
          try {
            lid = await entry.sock?.signalRepository?.lidMapping?.getLIDForPN?.(pn);
            if (lid) rememberLidPnMapping(entry, lid, pn);
          } catch {
            lid = null;
          }
        }
        if (inboundLid && lid && normalizeLid(lid) === inboundLid) {
          candidates.push(pn);
          return { armedJid: pn, remoteJid, candidates };
        }
      }
    } catch (err) {
      console.warn(
        `[qlix-whatsapp] armed-contacts reverse lookup failed connector=${connectorId}:`,
        err?.message ?? err,
      );
    }
  }

  return { armedJid: null, remoteJid, candidates };
}

const MUTED_JIDS_TTL_MS = 5_000;

async function getMutedContactJids(entry, connectorId) {
  if (
    entry.mutedJids instanceof Set &&
    typeof entry.mutedJidsAt === 'number' &&
    Date.now() - entry.mutedJidsAt < MUTED_JIDS_TTL_MS
  ) {
    return entry.mutedJids;
  }
  try {
    const { muted } = await qlix.listArmedAndMutedContacts(connectorId);
    entry.mutedJids = new Set(
      (Array.isArray(muted) ? muted : []).map((j) => String(j).trim().toLowerCase()).filter(Boolean),
    );
  } catch {
    entry.mutedJids = entry.mutedJids instanceof Set ? entry.mutedJids : new Set();
  }
  entry.mutedJidsAt = Date.now();
  return entry.mutedJids;
}

function phoneLocalFromJid(jid) {
  if (!jid || typeof jid !== 'string') return '';
  const pn = normalizePnJid(jid);
  return (pn || jid).split('@')[0]?.split(':')[0] ?? '';
}

/** True when remoteJid (phone or @lid) matches a post-ack muted lead. */
export function isRemoteJidMuted(entry, remoteJid, mutedSet) {
  if (!mutedSet?.size || !remoteJid) return false;
  const lower = String(remoteJid).trim().toLowerCase();
  if (mutedSet.has(lower)) return true;
  const pn = normalizePnJid(remoteJid);
  if (pn && mutedSet.has(pn.toLowerCase())) return true;
  const lid = normalizeLid(remoteJid);
  if (lid) {
    if (mutedSet.has(lid.toLowerCase())) return true;
    const mappedPn = entry.lidToPn?.get(lid);
    if (mappedPn && mutedSet.has(String(mappedPn).toLowerCase())) return true;
  }
  if (pn) {
    const mappedLid = entry.pnToLid?.get(pn);
    if (mappedLid && mutedSet.has(String(mappedLid).toLowerCase())) return true;
  }
  const remoteLocal = phoneLocalFromJid(remoteJid);
  if (remoteLocal.length < 8) return false;
  for (const muted of mutedSet) {
    const mutedLocal = phoneLocalFromJid(muted);
    if (!mutedLocal) continue;
    if (
      mutedLocal === remoteLocal ||
      mutedLocal.endsWith(remoteLocal) ||
      remoteLocal.endsWith(mutedLocal)
    ) {
      return true;
    }
  }
  return false;
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

/**
 * Outbound sends had no throttling at all — a bulk operation (e.g. lead outreach) could
 * fire many messages back-to-back and trip WhatsApp's own anti-spam limits. This enforces
 * a minimum spacing between sends, per connector, queuing bursts instead of dropping them.
 */
const MIN_SEND_INTERVAL_MS = Number(process.env.WHATSAPP_MIN_SEND_INTERVAL_MS || 1100);
const sendQueues = new Map();
const lastSentAt = new Map();

function throttledSend(connectorId, fn) {
  const prev = sendQueues.get(connectorId) ?? Promise.resolve();
  const next = prev.then(async () => {
    const last = lastSentAt.get(connectorId) ?? 0;
    const wait = Math.max(0, MIN_SEND_INTERVAL_MS - (Date.now() - last));
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastSentAt.set(connectorId, Date.now());
    return fn();
  });
  sendQueues.set(
    connectorId,
    next.catch(() => {}),
  );
  return next;
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
    if (!isValidConnectorId(connectorId)) {
      console.warn(`[qlix-whatsapp] skipping non-connector auth dir: ${connectorId}`);
      continue;
    }
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
  if (!isValidConnectorId(connectorId)) {
    throw new Error(`Invalid connector id: ${connectorId}`);
  }
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
    /** Phonebook contacts learned from Baileys sync + inbound push names. */
    contacts: new Map(),
    /** Learned LID (privacy) → phone JID mappings for contact wait matching. */
    lidToPn: new Map(),
    pnToLid: new Map(),
    /** Post-ack muted phone JIDs (sidecar skip forward + buffer). */
    mutedJids: new Set(),
    mutedJidsAt: 0,
    /** Recent 1:1 chat messages buffered for agent read tools. */
    messagesByJid: new Map(),
    inboundLock: false,
    lastInboundKey: '',
    lastInboundAt: 0,
    reconnectAttempts: 0,
  };
  sessions.set(connectorId, entry);

  await migratePlaintextAuthDir(dir).catch((err) =>
    console.warn(`[qlix-whatsapp] auth-dir encryption migration failed for ${connectorId}:`, err?.message ?? err),
  );
  const { state, saveCreds } = await useEncryptedMultiFileAuthState(dir);

  const connect = async () => {
    if (entry.sock) {
      try {
        entry.sock.end(undefined);
      } catch {
        // ignore
      }
    }

    // WA Web rejects stale version tuples (405) before emitting a QR — always pass fetchLatestBaileysVersion().
    entry.sock = makeWASocket({
      auth: state,
      logger,
      version: await getBaileysVersion(),
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
          // Previously silent (console.error only) — the dashboard's Connectors page kept
          // showing "connected" forever even though WhatsApp had actually unlinked the device.
          await qlix.notifyLoggedOut(connectorId).catch((err) =>
            console.error(`[qlix-whatsapp] failed to report logout for ${connectorId}:`, err?.message ?? err),
          );
          return;
        }

        entry.reconnectAttempts += 1;
        // Stale WA Web version often surfaces as 405 before any QR is emitted.
        if (statusCode === 405) {
          cachedBaileysVersion = null;
          cachedBaileysVersionAt = 0;
        }
        const delay = backoffMs(entry.reconnectAttempts - 1);
        setTimeout(() => connect().catch(console.error), delay);
      }
    });

    entry.sock.ev.on('contacts.upsert', (contacts) => {
      if (!Array.isArray(contacts)) return;
      for (const c of contacts) rememberContact(entry, c);
    });
    entry.sock.ev.on('contacts.update', (updates) => {
      if (!Array.isArray(updates)) return;
      for (const c of updates) rememberContact(entry, c);
    });
    entry.sock.ev.on('messaging-history.set', async ({ contacts: histContacts, messages: histMessages }) => {
      if (Array.isArray(histContacts)) {
        for (const c of histContacts) rememberContact(entry, c);
      }
      if (Array.isArray(histMessages)) {
        const mutedSet = await getMutedContactJids(entry, connectorId);
        for (const m of histMessages) {
          const remote = m?.key?.remoteJid;
          if (remote && isRemoteJidMuted(entry, remote, mutedSet)) continue;
          rememberChatMessage(entry, m);
        }
      }
    });

    entry.sock.ev.on('messages.upsert', async ({ messages, type }) => {
      // Buffer messages for agent read tools (notify + append history).
      if (type === 'notify' || type === 'append') {
        const mutedSet = await getMutedContactJids(entry, connectorId);
        for (const msg of messages ?? []) {
          const remote = msg?.key?.remoteJid;
          if (remote && isRemoteJidMuted(entry, remote, mutedSet)) continue;
          rememberChatMessage(entry, msg);
        }
      }
      // Only real-time messages trigger agent runs — never history sync.
      if (type !== 'notify') return;

      for (const msg of messages) {
        if (!msg.message) continue;
        if (isOurOutboundMessageId(entry, msg.key)) continue;

        const remoteJid = msg.key.remoteJid || '';
        if (remoteJid.endsWith('@g.us')) continue;
        if (msg.message.protocolMessage || msg.message.senderKeyDistributionMessage) continue;

        const text = extractMessageText(msg);
        const trimmed = text.trim();
        if (!trimmed) {
          continue;
        }

        const selfJid = ownerJidForInbound(entry);
        if (!selfJid) continue;

        const now = Date.now();
        const fromMe = Boolean(msg.key.fromMe);

        // Self-chat: trigger agent runs. Contact chats: only when auto-reply / team wait is armed.
        // Contact replies often arrive as @lid while waits are armed on phone JIDs — resolve both.
        const selfChat = isAllowedInboundChat(entry, remoteJid, fromMe);
        let contactArmed = false;
        let forwardJid = remoteJid;
        if (!selfChat && !fromMe) {
          const armed = await resolveArmedContactJid(entry, connectorId, msg, remoteJid);
          contactArmed = Boolean(armed.armedJid);
          if (contactArmed) {
            forwardJid = armed.armedJid;
          } else {
            console.log(
              `[qlix-whatsapp] inbound skipped (not-armed) connector=${connectorId} remote=${remoteJid} candidates=${armed.candidates.join(',') || 'none'}`,
            );
          }
        }
        if (!selfChat && !contactArmed) {
          continue;
        }

        if (fromMe) {
          const phone = entry.ownerPhoneJid;
          if (phone && (remoteJid === phone || phoneJidFromUserId(remoteJid) === phone)) {
            entry.selfChatRemoteJid = remoteJid;
          }
          // Outbound contact messages are buffered above; do not treat as inbound commands.
          if (!selfChat) continue;
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
            `[qlix-whatsapp] inbound connector=${connectorId} fromMe=${fromMe} remote=${remoteJid} forward=${forwardJid} contactArmed=${contactArmed}`,
          );
          await handleInboundMessage(
            connectorId,
            selfJid,
            forwardJid,
            trimmed,
            allowedSelfJidsForEntry(entry),
            { fromContact: contactArmed && !selfChat },
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

const MAX_CONTACTS = 5000;
const MAX_CHATS_WITH_MESSAGES = 300;
const MAX_MESSAGES_PER_CHAT = 80;

function digitsOnly(value) {
  return String(value ?? '').replace(/\D/g, '');
}

function normalizePhoneDigits(value) {
  const d = digitsOnly(value);
  return d || null;
}

function jidFromPhoneDigits(digits) {
  if (!digits || digits.length < 8) return null;
  return `${digits}@s.whatsapp.net`;
}

function rememberContact(entry, contact) {
  if (!entry.contacts) entry.contacts = new Map();
  const jid = contact?.id || contact?.jid;
  if (!jid || typeof jid !== 'string') return;
  if (jid.endsWith('@g.us') || jid === 'status@broadcast') return;
  const phone = normalizePhoneDigits(jid.split('@')[0].split(':')[0]);
  const name =
    (typeof contact.name === 'string' && contact.name.trim()) ||
    (typeof contact.notify === 'string' && contact.notify.trim()) ||
    (typeof contact.verifiedName === 'string' && contact.verifiedName.trim()) ||
    null;
  const prev = entry.contacts.get(jid) ?? {};
  entry.contacts.set(jid, {
    jid,
    phone: phone ?? prev.phone ?? null,
    name: name ?? prev.name ?? null,
    notify: typeof contact.notify === 'string' ? contact.notify : prev.notify ?? null,
  });
  if (entry.contacts.size > MAX_CONTACTS) {
    const first = entry.contacts.keys().next().value;
    if (first) entry.contacts.delete(first);
  }
}

function extractMessageText(msg) {
  if (!msg?.message) return '';
  return (
    msg.message.conversation ||
    msg.message.extendedTextMessage?.text ||
    msg.message.imageMessage?.caption ||
    msg.message.videoMessage?.caption ||
    msg.message.documentMessage?.caption ||
    msg.message.buttonsResponseMessage?.selectedDisplayText ||
    msg.message.listResponseMessage?.title ||
    ''
  );
}

function rememberChatMessage(entry, msg) {
  if (!entry.messagesByJid) entry.messagesByJid = new Map();
  const remoteJid = msg?.key?.remoteJid;
  if (!remoteJid || typeof remoteJid !== 'string') return;
  if (remoteJid.endsWith('@g.us') || remoteJid === 'status@broadcast') return;
  const text = extractMessageText(msg).trim();
  if (!text) return;
  const row = {
    id: msg.key?.id ?? null,
    fromMe: Boolean(msg.key?.fromMe),
    text: text.slice(0, 4000),
    timestamp: Number(msg.messageTimestamp ?? 0) * 1000 || Date.now(),
    pushName: typeof msg.pushName === 'string' ? msg.pushName : null,
  };
  const list = entry.messagesByJid.get(remoteJid) ?? [];
  if (row.id && list.some((m) => m.id === row.id)) return;
  list.push(row);
  if (list.length > MAX_MESSAGES_PER_CHAT) list.splice(0, list.length - MAX_MESSAGES_PER_CHAT);
  entry.messagesByJid.set(remoteJid, list);
  if (entry.messagesByJid.size > MAX_CHATS_WITH_MESSAGES) {
    const first = entry.messagesByJid.keys().next().value;
    if (first) entry.messagesByJid.delete(first);
  }
  // Learn contact name from pushName on inbound.
  if (!row.fromMe && row.pushName) {
    rememberContact(entry, { id: remoteJid, notify: row.pushName });
  }
}

function contactMatchesQuery(contact, query) {
  if (!query) return true;
  const q = query.toLowerCase().trim();
  if (!q) return true;
  const qDigits = digitsOnly(q);
  const hay = [contact.name, contact.notify, contact.phone, contact.jid]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (hay.includes(q)) return true;
  if (qDigits && contact.phone && contact.phone.includes(qDigits)) return true;
  return false;
}

export function listContacts(connectorId, query = '', limit = 50) {
  const entry = sessions.get(connectorId);
  if (!entry?.connected) return { ok: false, error: 'WhatsApp not connected' };
  const max = Math.min(100, Math.max(1, Number(limit) || 50));
  const all = [...(entry.contacts?.values() ?? [])];
  const filtered = all.filter((c) => contactMatchesQuery(c, query));
  filtered.sort((a, b) => String(a.name || a.phone || a.jid).localeCompare(String(b.name || b.phone || b.jid)));
  return {
    ok: true,
    contacts: filtered.slice(0, max).map((c) => ({
      jid: c.jid,
      phone: c.phone,
      name: c.name || c.notify || null,
    })),
    total_matched: filtered.length,
  };
}

/**
 * Resolve a human-facing recipient (phone, jid, or contact name) to a WhatsApp JID.
 * Never returns the linked account's own JIDs — use /send for self-chat delivery.
 */
export async function resolveRecipientJid(connectorId, recipient) {
  const entry = sessions.get(connectorId);
  if (!entry?.connected || !entry.sock) {
    return { ok: false, error: 'WhatsApp not connected' };
  }
  const raw = String(recipient ?? '').trim();
  if (!raw) return { ok: false, error: 'recipient is required' };

  const selfLocals = new Set(
    [...(entry.knownSelfJids ?? [])]
      .map((j) => String(j).split('@')[0].split(':')[0])
      .filter(Boolean),
  );
  if (entry.ownerPhoneJid) {
    selfLocals.add(entry.ownerPhoneJid.split('@')[0].split(':')[0]);
  }

  let jid = null;
  let matchedName = null;

  if (raw.includes('@')) {
    jid = raw;
  } else {
    const digits = normalizePhoneDigits(raw);
    if (digits && digits.length >= 8 && /^[\d\s+\-()]+$/.test(raw.replace(/\s/g, ''))) {
      jid = jidFromPhoneDigits(digits);
    } else {
      const contacts = [...(entry.contacts?.values() ?? [])];
      const q = raw.toLowerCase();
      const exact = contacts.filter(
        (c) =>
          (c.name && c.name.toLowerCase() === q) ||
          (c.notify && c.notify.toLowerCase() === q),
      );
      const partial = contacts.filter((c) => contactMatchesQuery(c, raw));
      const pick = exact[0] ?? (partial.length === 1 ? partial[0] : null);
      if (!pick && partial.length > 1) {
        return {
          ok: false,
          error: `Multiple contacts match "${raw}". Be more specific or use a phone number.`,
          matches: partial.slice(0, 8).map((c) => ({
            name: c.name || c.notify || null,
            phone: c.phone,
            jid: c.jid,
          })),
        };
      }
      if (!pick) {
        return {
          ok: false,
          error: `No contact found for "${raw}". Use whatsapp_list_contacts or pass a phone number with country code.`,
        };
      }
      jid = pick.jid;
      matchedName = pick.name || pick.notify || null;
    }
  }

  if (!jid) return { ok: false, error: 'Could not resolve recipient' };
  if (jid.endsWith('@g.us')) {
    return { ok: false, error: 'Group chats are not supported for agent messaging yet' };
  }

  const local = jid.split('@')[0].split(':')[0];
  if (selfLocals.has(local)) {
    return {
      ok: false,
      error: 'Recipient is your own linked WhatsApp. Use self-chat delivery (whatsapp_send) instead.',
    };
  }

  // Confirm the number is on WhatsApp when we have a phone JID.
  if (jid.endsWith('@s.whatsapp.net') && typeof entry.sock.onWhatsApp === 'function') {
    try {
      const results = await entry.sock.onWhatsApp(local);
      const hit = Array.isArray(results) ? results.find((r) => r?.exists) : null;
      if (!hit) {
        return { ok: false, error: `Phone ${local} is not registered on WhatsApp` };
      }
      if (typeof hit.jid === 'string' && hit.jid) jid = hit.jid;
    } catch (err) {
      console.warn('[qlix-whatsapp] onWhatsApp lookup failed:', err?.message ?? err);
    }
  }

  const contact = entry.contacts?.get(jid);
  return {
    ok: true,
    jid,
    phone: normalizePhoneDigits(jid.split('@')[0].split(':')[0]),
    name: matchedName || contact?.name || contact?.notify || null,
  };
}

export async function sendToRecipient(connectorId, recipient, text) {
  const entry = sessions.get(connectorId);
  if (!entry?.connected || !entry.sock) {
    return { ok: false, error: 'WhatsApp not connected' };
  }
  const message = String(text ?? '').trim();
  if (!message) return { ok: false, error: 'message is required' };
  if (message.length > 4000) return { ok: false, error: 'message too long (max 4000 chars)' };

  const resolved = await resolveRecipientJid(connectorId, recipient);
  if (!resolved.ok) return resolved;

  return throttledSend(connectorId, async () => {
    try {
      const sent = await entry.sock.sendMessage(resolved.jid, { text: message });
      rememberOutboundMessageId(entry, sent?.key);
      rememberChatMessage(entry, {
        key: { remoteJid: resolved.jid, fromMe: true, id: sent?.key?.id },
        message: { conversation: message },
        messageTimestamp: Math.floor(Date.now() / 1000),
      });
      // Warm LID↔PN cache so inbound @lid replies can match phone-armed waits.
      try {
        const lid = await entry.sock?.signalRepository?.lidMapping?.getLIDForPN?.(resolved.jid);
        if (lid) rememberLidPnMapping(entry, lid, resolved.jid);
      } catch (err) {
        console.warn(
          `[qlix-whatsapp] getLIDForPN failed for ${resolved.jid}:`,
          err?.message ?? err,
        );
      }
      console.log(
        `[qlix-whatsapp] sent-to-contact connector=${connectorId} to=${resolved.jid} name=${resolved.name ?? 'n/a'}`,
      );
      return {
        ok: true,
        jid: resolved.jid,
        phone: resolved.phone,
        name: resolved.name,
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      return { ok: false, error: err?.message || 'Send failed' };
    }
  });
}

export function getChatMessages(connectorId, recipient, limit = 30) {
  const entry = sessions.get(connectorId);
  if (!entry?.connected) return { ok: false, error: 'WhatsApp not connected' };
  const max = Math.min(80, Math.max(1, Number(limit) || 30));

  // Resolve synchronously from contacts / phone / jid (no onWhatsApp needed for read).
  const raw = String(recipient ?? '').trim();
  if (!raw) return { ok: false, error: 'recipient is required' };

  let jid = null;
  let name = null;
  if (raw.includes('@')) {
    jid = raw;
  } else {
    const digits = normalizePhoneDigits(raw);
    if (digits && digits.length >= 8 && /^[\d\s+\-()]+$/.test(raw.replace(/\s/g, ''))) {
      jid = jidFromPhoneDigits(digits);
    } else {
      const contacts = [...(entry.contacts?.values() ?? [])];
      const q = raw.toLowerCase();
      const exact = contacts.filter(
        (c) =>
          (c.name && c.name.toLowerCase() === q) ||
          (c.notify && c.notify.toLowerCase() === q),
      );
      const partial = contacts.filter((c) => contactMatchesQuery(c, raw));
      const pick = exact[0] ?? (partial.length === 1 ? partial[0] : null);
      if (!pick && partial.length > 1) {
        return {
          ok: false,
          error: `Multiple contacts match "${raw}". Be more specific or use a phone number.`,
          matches: partial.slice(0, 8).map((c) => ({
            name: c.name || c.notify || null,
            phone: c.phone,
            jid: c.jid,
          })),
        };
      }
      if (!pick) {
        // Fall back: search message map keys' contact names
        return {
          ok: false,
          error: `No contact/chat found for "${raw}". Messages are available after chats sync while WhatsApp is linked.`,
        };
      }
      jid = pick.jid;
      name = pick.name || pick.notify || null;
    }
  }

  // Also try LID aliases: match by phone local part across stored chats.
  let list = entry.messagesByJid?.get(jid) ?? [];
  if (list.length === 0 && jid?.endsWith('@s.whatsapp.net')) {
    const phone = jid.split('@')[0];
    for (const [key, msgs] of entry.messagesByJid?.entries() ?? []) {
      if (key.includes(phone)) {
        jid = key;
        list = msgs;
        break;
      }
    }
  }

  const contact = entry.contacts?.get(jid);
  const slice = list.slice(-max);
  return {
    ok: true,
    jid,
    name: name || contact?.name || contact?.notify || null,
    phone: contact?.phone || normalizePhoneDigits(jid?.split('@')[0] ?? ''),
    messages: slice.map((m) => ({
      id: m.id,
      from_me: m.fromMe,
      text: m.text,
      timestamp: new Date(m.timestamp).toISOString(),
      push_name: m.pushName,
    })),
    note:
      slice.length === 0
        ? 'No recent messages buffered for this chat yet. Open the chat on your phone or wait for new messages while WhatsApp stays linked.'
        : undefined,
  };
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
  const selfChatJid = entry.selfChatRemoteJid ?? entry.ownerLid;
  const ordered =
    selfChatJid && targets.includes(selfChatJid)
      ? [selfChatJid, ...targets.filter((j) => j !== selfChatJid)]
      : targets;

  return throttledSend(connectorId, async () => {
    let lastError = 'Send failed';
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
  });
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

  return throttledSend(connectorId, async () => {
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
  });
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
