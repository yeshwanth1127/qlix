import express from 'express';
import { pendingApprovals, registerPendingApproval } from './handlers.js';
import * as qlix from './qlix-client.js';
import {
  getSessionStatus,
  isSessionConnected,
  listSessions,
  sendDocumentToConnector,
  sendToConnector,
  startSession,
  stopSession,
} from './sessionManager.js';
import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';

const MIME_MAP = {
  '.pdf':  'application/pdf',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls':  'application/vnd.ms-excel',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc':  'application/msword',
  '.csv':  'text/csv',
  '.txt':  'text/plain',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
};

const SERVICE_SECRET = process.env.SERVICE_SECRET || '';
const APPROVAL_TTL_MS = 5 * 60 * 1000;
const startedAt = Date.now();

function timingSafeEqualStr(a, b) {
  const ab = Buffer.from(String(a), 'utf8');
  const bb = Buffer.from(String(b), 'utf8');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function requireSecret(req, res, next) {
  if (!SERVICE_SECRET) {
    res.status(503).json({ ok: false, error: 'Service secret not configured' });
    return;
  }
  const secret = req.header('X-Service-Secret');
  if (!secret || !timingSafeEqualStr(secret, SERVICE_SECRET)) {
    res.status(401).json({ ok: false, error: 'Unauthorized' });
    return;
  }
  next();
}

/**
 * Documents to send must live under an allowlisted staging directory (the backend writes them to
 * the OS temp dir before calling us). This stops a caller from exfiltrating arbitrary host files
 * (e.g. `/etc/passwd`, `backend/.env`) over WhatsApp via a crafted `file_path`.
 */
const DOC_ALLOWED_ROOTS = (process.env.WHATSAPP_DOC_ALLOWED_DIRS?.trim()
  ? process.env.WHATSAPP_DOC_ALLOWED_DIRS.split(',').map((d) => d.trim()).filter(Boolean)
  : [os.tmpdir()]
).map((d) => path.resolve(d));

function isPathWithinAllowedRoots(filePath) {
  const resolved = path.resolve(filePath);
  return DOC_ALLOWED_ROOTS.some((root) => resolved === root || resolved.startsWith(root + path.sep));
}

// Neutralize WhatsApp markdown / control chars in agent-supplied text so a crafted agent name or
// context can't spoof the approval prompt's structure or inject misleading formatting.
function sanitizeField(value, max = 300) {
  return String(value ?? '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/[*_~`]/g, '')
    .replace(/[\u0000-\u001f]/g, '')
    .slice(0, max)
    .trim();
}

function formatApprovalMessage({ context, action_id, scope, agent_name }) {
  return (
    `🤖 *Qlix — approval required*\n\n` +
    `Agent: ${sanitizeField(agent_name, 120)}\n` +
    `Scope: ${sanitizeField(scope, 120)}\n` +
    `Action: ${sanitizeField(context, 500)}\n\n` +
    `Reply with: *yes*, *approve*, *ok*, *yep*, etc. to approve\n` +
    `Or reply with: *no*, *reject*, *cancel*, *nope*, etc. to reject.\n` +
    `This request expires in 5 minutes.\n\n` +
    `ID: ${action_id}`
  );
}

export function createApiRouter() {
  const router = express.Router();
  router.use(express.json());
  router.use(requireSecret);

  router.get('/health', (_req, res) => {
    const active = listSessions().filter((s) => s.connected).length;
    res.json({
      ok: true,
      connected: active > 0,
      active_sessions: active,
      total_sessions: listSessions().length,
      pending_approvals: pendingApprovals.size,
      uptime: Math.floor((Date.now() - startedAt) / 1000),
    });
  });

  router.post('/sessions/:connectorId/start', async (req, res) => {
    const connectorId = req.params.connectorId;
    try {
      await startSession(connectorId);
      res.json({ ok: true, connectorId });
    } catch (err) {
      console.error('[qlix-whatsapp] start session', err);
      res.status(500).json({ ok: false, error: err.message || 'Start failed' });
    }
  });

  router.get('/sessions/:connectorId/status', async (req, res) => {
    const connectorId = req.params.connectorId;
    let status = getSessionStatus(connectorId);
    if (!status.connected) {
      try {
        await startSession(connectorId);
        status = getSessionStatus(connectorId);
      } catch (err) {
        console.warn(`[qlix-whatsapp] auto-resume ${connectorId}:`, err?.message ?? err);
      }
    }
    res.json({ ok: true, ...status });
  });

  router.delete('/sessions/:connectorId', async (req, res) => {
    await stopSession(req.params.connectorId);
    res.json({ ok: true });
  });

  router.post('/send', async (req, res) => {
    const connectorId = req.body?.connector_id;
    const message = req.body?.message;
    if (!connectorId || typeof message !== 'string' || !message.trim()) {
      res.status(400).json({ ok: false, error: 'connector_id and message required' });
      return;
    }
    if (!isSessionConnected(connectorId)) {
      res.status(503).json({ ok: false, error: 'WhatsApp not connected' });
      return;
    }
    const result = await sendToConnector(connectorId, message);
    if (result.ok) {
      console.log(`[qlix-whatsapp] /send ok connector=${connectorId} jid=${result.jid ?? 'unknown'}`);
    } else {
      console.warn(`[qlix-whatsapp] /send failed connector=${connectorId}:`, result.error);
    }
    res.status(result.ok ? 200 : 503).json(result);
  });

  router.post('/send-notification', async (req, res) => {
    const connectorId = req.body?.connector_id;
    const message = req.body?.message;
    const level = req.body?.level || 'info';
    if (!connectorId || typeof message !== 'string' || !message.trim()) {
      res.status(400).json({ ok: false, error: 'connector_id and message required' });
      return;
    }
    const prefix =
      level === 'error' ? '🚨 ' : level === 'warning' ? '⚠️ ' : 'ℹ️ ';
    const result = await sendToConnector(connectorId, prefix + message);
    res.status(result.ok ? 200 : 503).json(result.ok ? { ok: true } : result);
  });

  router.post('/send-approval', async (req, res) => {
    const { connector_id, context, action_id, scope, agent_name } = req.body ?? {};
    if (!connector_id || !action_id || !scope || !agent_name) {
      res.status(400).json({
        ok: false,
        error: 'connector_id, action_id, scope, agent_name required',
      });
      return;
    }
    if (!isSessionConnected(connector_id)) {
      res.status(503).json({ ok: false, error: 'WhatsApp not connected' });
      return;
    }

    const text = formatApprovalMessage({
      context: context ?? '',
      action_id,
      scope,
      agent_name,
    });
    const sendResult = await sendToConnector(connector_id, text);
    if (!sendResult.ok) {
      res.status(503).json(sendResult);
      return;
    }

    registerPendingApproval(connector_id, action_id, agent_name, APPROVAL_TTL_MS);
    res.json({ ok: true, action_id });
  });

  router.post('/send-document', async (req, res) => {
    const { connector_id, file_path, file_name, mimetype } = req.body ?? {};
    if (!connector_id || typeof file_path !== 'string' || !file_path.trim()) {
      res.status(400).json({ ok: false, error: 'connector_id and file_path required' });
      return;
    }
    // Reject path traversal / arbitrary host-file reads before touching the filesystem.
    if (!isPathWithinAllowedRoots(file_path)) {
      res.status(400).json({ ok: false, error: 'file_path is outside the allowed directory' });
      return;
    }
    try {
      const stat = await fs.stat(file_path);
      if (!stat.isFile()) {
        res.status(400).json({ ok: false, error: 'file_path is not a regular file' });
        return;
      }
    } catch {
      res.status(404).json({ ok: false, error: 'file not found' });
      return;
    }
    if (!isSessionConnected(connector_id)) {
      res.status(503).json({ ok: false, error: 'WhatsApp not connected' });
      return;
    }
    const ext = path.extname(file_path).toLowerCase();
    const resolvedMime = mimetype || MIME_MAP[ext] || 'application/octet-stream';
    const resolvedName = file_name || path.basename(file_path);
    const result = await sendDocumentToConnector(connector_id, file_path, resolvedName, resolvedMime);
    res.status(result.ok ? 200 : 503).json(result);
  });

  return router;
}
