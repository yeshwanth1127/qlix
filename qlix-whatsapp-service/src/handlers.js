import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as qlix from './qlix-client.js';
import { sendToConnector } from './sessionManager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(__dirname, '..', 'data', 'pending-approvals.json');

const APPROVE_WORDS = new Set(['yes', 'y', 'approve', 'ok', 'yep', 'yup', 'agreed', 'proceed', 'allow', 'sure', 'aye']);
const REJECT_WORDS = new Set(['no', 'n', 'reject', 'cancel', 'nope', 'deny', 'stop', 'decline']);

const BOT_ECHO_MARKERS = [
  'Qlix API error',
  'Multiple agents',
  'set a default agent in Connectors',
  'Which agent? You have:',
  'Queued —',
  '📋 *Qlix',
  '*Team run active*',
  'Added guidance to active team run',
  'No active team run',
  'No active worker',
  'Could not inject',
  'Canceled team run',
  'No pending approval',
  '✅ Approved',
  '❌ Rejected',
  '*Qlix agents*',
  'No agents registered',
  '🚀 *',
  '▶️ ',
  '🚨 ',
];

function isLikelyOutboundEcho(text) {
  const t = String(text).trim();
  if (!t) return true;
  return BOT_ECHO_MARKERS.some((m) => t.startsWith(m) || t.includes(m));
}

/** connectorId -> latest pending action_id */
const latestPendingByConnector = new Map();

/**
 * action_id -> { connector_id, agent_name, expires_at, timeout }.
 * Previously in-memory only — a sidecar restart mid-approval lost this map entirely,
 * so the user's later "yes"/"no" reply hit "No pending approval request." with no
 * recovery path. Now persisted to disk on every change and reloaded at boot.
 */
export const pendingApprovals = new Map();

function persist() {
  const rows = [...pendingApprovals.values()].map((e) => ({
    connector_id: e.connector_id,
    action_id: e.action_id,
    agent_name: e.agent_name,
    expires_at: e.expires_at,
  }));
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(rows), 'utf8');
  } catch (err) {
    console.warn('[qlix-whatsapp] failed to persist pending approvals:', err?.message ?? err);
  }
}

async function expireApproval(connectorId, actionId) {
  if (!pendingApprovals.has(actionId)) return;
  await qlix.resolveApproval(actionId, false, 'timeout');
  clearPendingApproval(actionId);
  await sendToConnector(connectorId, '⏱️ Approval timed out. Action cancelled.');
}

function scheduleAndStore(connectorId, actionId, agentName, expiresAt) {
  const remainingMs = Math.max(0, expiresAt - Date.now());

  const timeout = setTimeout(() => {
    expireApproval(connectorId, actionId).catch((err) =>
      console.warn(`[qlix-whatsapp] approval expiry failed actionId=${actionId}:`, err?.message ?? err),
    );
  }, remainingMs);
  timeout.unref?.();

  pendingApprovals.set(actionId, {
    connector_id: connectorId,
    action_id: actionId,
    agent_name: agentName,
    expires_at: expiresAt,
    timeout,
  });
  latestPendingByConnector.set(connectorId, actionId);
  persist();
}

/** Fresh registration — `ttlMs` is a duration (e.g. 5 minutes) from now. */
export function registerPendingApproval(connectorId, actionId, agentName, ttlMs) {
  scheduleAndStore(connectorId, actionId, agentName, Date.now() + ttlMs);
}

export function clearPendingApproval(actionId) {
  const entry = pendingApprovals.get(actionId);
  if (entry?.timeout) clearTimeout(entry.timeout);
  if (entry) {
    pendingApprovals.delete(actionId);
    if (latestPendingByConnector.get(entry.connector_id) === actionId) {
      latestPendingByConnector.delete(entry.connector_id);
    }
    persist();
  }
}

/** Call once at service boot — reschedules or immediately expires approvals a prior process left pending. */
export function resumePendingApprovals() {
  let rows;
  try {
    rows = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return;
  }
  if (!Array.isArray(rows) || rows.length === 0) return;
  console.log(`[qlix-whatsapp] resuming ${rows.length} pending approval(s) from disk`);
  for (const row of rows) {
    if (!row?.action_id || !row?.connector_id || typeof row.expires_at !== 'number') continue;
    scheduleAndStore(row.connector_id, row.action_id, row.agent_name ?? 'Agent', row.expires_at);
  }
}

async function reply(connectorId, text) {
  const body = String(text ?? '').trim();
  if (!body) return;
  await sendToConnector(connectorId, body);
}

export async function resolveApprovalForConnector(connectorId, approved) {
  const actionId = latestPendingByConnector.get(connectorId);
  if (!actionId) {
    console.log(`[qlix-whatsapp] approval: no pending approval found for connector=${connectorId}`);
    await reply(connectorId, 'No pending approval request.');
    return;
  }
  const entry = pendingApprovals.get(actionId);
  const agentName = entry?.agent_name ?? 'Agent';

  console.log(
    `[qlix-whatsapp] approval: resolving actionId=${actionId} connector=${connectorId} approved=${approved} entry=${entry ? 'found' : 'not-in-map'}`,
  );

  const err = await qlix.resolveApproval(actionId, approved, approved ? null : 'user_rejected');
  if (err) {
    console.log(`[qlix-whatsapp] approval: resolve failed actionId=${actionId} error=${err}`);
    await reply(connectorId, `⚠️ ${err}`);
    return;
  }

  clearPendingApproval(actionId);
  console.log(`[qlix-whatsapp] approval: resolved successfully actionId=${actionId} approved=${approved}`);
  if (approved) {
    await reply(connectorId, `✅ Approved. ${agentName} is proceeding.`);
  } else {
    await reply(connectorId, '❌ Rejected. Action cancelled.');
  }
}

function jidLocalPart(jid) {
  return jid.split('@')[0].split(':')[0] ?? '';
}

/** True when remoteJid is the linked account (phone / learned self-chat), not an arbitrary contact. */
export function isSelfChat(ownerJid, remoteJid, allowedSelfJids = []) {
  if (!ownerJid || !remoteJid) return false;
  const ownerSet = new Set([ownerJid, ...allowedSelfJids].filter(Boolean));
  if (ownerSet.has(remoteJid)) return true;
  const remoteLocal = jidLocalPart(remoteJid);
  for (const o of ownerSet) {
    const ownerLocal = jidLocalPart(o);
    if (ownerLocal.length > 0 && ownerLocal === remoteLocal) return true;
  }
  return false;
}

function previewText(text) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  return t.length > 80 ? `${t.slice(0, 80)}…` : t;
}

export async function handleInboundMessage(connectorId, ownerJid, remoteJid, text, allowedSelfJids = []) {
  if (!isSelfChat(ownerJid, remoteJid, allowedSelfJids)) {
    console.log(
      `[qlix-whatsapp] inbound dropped (not-self-chat) connector=${connectorId} remote=${remoteJid}`,
    );
    return;
  }
  if (isLikelyOutboundEcho(text)) {
    console.log(
      `[qlix-whatsapp] inbound dropped (echo) connector=${connectorId} preview="${previewText(text)}"`,
    );
    return;
  }

  console.log(
    `[qlix-whatsapp] inbound forwarding connector=${connectorId} preview="${previewText(text)}"`,
  );

  const lower = text.toLowerCase().trim();

  // Check for exact word match or if message starts with approval word
  function matchesApprovalWords(msg, wordSet) {
    if (wordSet.has(msg)) return true;
    // Check if message starts with any approval word followed by punctuation/space
    for (const word of wordSet) {
      if (msg === word || msg.startsWith(word + ' ') || msg.startsWith(word + '!') || msg.startsWith(word + '.') || msg.startsWith(word + ',')) {
        return true;
      }
    }
    return false;
  }

  if (matchesApprovalWords(lower, APPROVE_WORDS)) {
    console.log(
      `[qlix-whatsapp] approval match found: connector=${connectorId} text="${text}" lower="${lower}" pending=${latestPendingByConnector.has(connectorId)}`,
    );
    await resolveApprovalForConnector(connectorId, true);
    return;
  }
  if (matchesApprovalWords(lower, REJECT_WORDS)) {
    console.log(
      `[qlix-whatsapp] rejection match found: connector=${connectorId} text="${text}" lower="${lower}" pending=${latestPendingByConnector.has(connectorId)}`,
    );
    await resolveApprovalForConnector(connectorId, false);
    return;
  }
  if (lower.startsWith('!status')) {
    const replyText = await qlix.sendInbound(connectorId, '!status');
    await reply(connectorId, typeof replyText === 'string' ? replyText : String(replyText));
    return;
  }
  if (lower === '!cancel' || lower.startsWith('!stop team')) {
    const replyText = await qlix.sendInbound(connectorId, text);
    await reply(connectorId, typeof replyText === 'string' ? replyText : String(replyText));
    return;
  }
  if (lower.startsWith('!stop')) {
    const name = text.slice(5).trim();
    if (!name) {
      await reply(connectorId, 'Usage: !stop <agent_name>');
      return;
    }
    const replyText = await qlix.stopAgent(connectorId, name);
    await reply(connectorId, typeof replyText === 'string' ? replyText : String(replyText));
    return;
  }

  const replyText = await qlix.sendInbound(connectorId, text);
  console.log(
    `[qlix-whatsapp] inbound replied connector=${connectorId} replyPreview="${previewText(replyText)}"`,
  );
  await reply(connectorId, typeof replyText === 'string' ? replyText : String(replyText));
}
