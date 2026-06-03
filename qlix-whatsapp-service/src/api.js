import express from 'express';
import {
  clearPendingApproval,
  pendingApprovals,
  registerPendingApproval,
} from './handlers.js';
import * as qlix from './qlix-client.js';
import {
  getSessionStatus,
  isSessionConnected,
  listSessions,
  sendToConnector,
  startSession,
  stopSession,
} from './sessionManager.js';

const SERVICE_SECRET = process.env.SERVICE_SECRET || '';
const APPROVAL_TTL_MS = 5 * 60 * 1000;
const startedAt = Date.now();

function requireSecret(req, res, next) {
  const secret = req.header('X-Service-Secret');
  if (!secret || secret !== SERVICE_SECRET) {
    res.status(401).json({ ok: false, error: 'Unauthorized' });
    return;
  }
  next();
}

function formatApprovalMessage({ context, action_id, scope, agent_name }) {
  return (
    `🤖 *Qlix — approval required*\n\n` +
    `Agent: ${agent_name}\n` +
    `Scope: ${scope}\n` +
    `Action: ${context}\n\n` +
    `Reply *yes* to approve or *no* to reject.\n` +
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

    const timeout = setTimeout(async () => {
      if (!pendingApprovals.has(action_id)) return;
      await qlix.resolveApproval(action_id, false, 'timeout');
      clearPendingApproval(action_id);
      await sendToConnector(connector_id, '⏱️ Approval timed out. Action cancelled.');
    }, APPROVAL_TTL_MS);

    registerPendingApproval(connector_id, action_id, agent_name, timeout);
    res.json({ ok: true, action_id });
  });

  return router;
}
