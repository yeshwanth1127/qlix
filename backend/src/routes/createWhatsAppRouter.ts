import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { assertInternalServiceSecret } from '../middleware/assertInternalServiceSecret.js';
import { ConnectorsRepository } from '../connectors/connectors.repository.js';
import {
  formatAgentsStatus,
  handleWhatsAppInbound,
  stopAgentByName,
} from '../whatsapp/whatsappChannel.service.js';

const repo = new ConnectorsRepository();

const inboundBody = z.object({
  connector_id: z.string().uuid(),
  text: z.string().trim().min(1).max(20_000),
  remote_jid: z.string().trim().min(3).max(120).optional(),
  from_contact: z.boolean().optional(),
});

const linkedBody = z.object({
  owner_jid: z.string().min(5).max(120),
});

export function createWhatsAppRouter(): Router {
  const router = Router();
  router.use(assertInternalServiceSecret);

  router.post('/inbound', async (request: Request, response: Response) => {
    const parsed = inboundBody.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: { code: 'invalid_body', message: 'connector_id and text required' } });
      return;
    }
    try {
      const result = await handleWhatsAppInbound(parsed.data.connector_id, parsed.data.text, {
        remoteJid: parsed.data.remote_jid ?? null,
        fromContact: parsed.data.from_contact === true,
      });
      response.json({
        ok: true,
        reply: result.reply,
        message: result.reply,
        deliver_to: result.deliverTo,
        contact_jid: result.contactJid ?? null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Inbound failed';
      // Always 200 + reply text so the sidecar does not post "Qlix API error (400): …" into self-chat.
      response.status(200).json({
        ok: true,
        reply: message,
        message,
        deliver_to: 'self',
        contact_jid: null,
      });
    }
  });

  router.get('/agents/status', async (request: Request, response: Response) => {
    const connectorId = typeof request.query.connector_id === 'string' ? request.query.connector_id : '';
    if (!connectorId) {
      response.status(400).json({ error: { code: 'invalid_query', message: 'connector_id required' } });
      return;
    }
    try {
      const text = await formatAgentsStatus(connectorId);
      response.json({ ok: true, text });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Status failed';
      response.status(500).json({ error: { code: 'status_failed', message } });
    }
  });

  router.post('/agents/:name/stop', async (request: Request, response: Response) => {
    const connectorId =
      typeof request.query.connector_id === 'string'
        ? request.query.connector_id
        : typeof request.body?.connector_id === 'string'
          ? request.body.connector_id
          : '';
    const name = String(request.params.name ?? '').trim();
    if (!connectorId || !name) {
      response.status(400).json({ error: { code: 'invalid_request', message: 'connector_id and name required' } });
      return;
    }
    try {
      const message = await stopAgentByName(connectorId, name);
      response.json({ ok: true, message });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Stop failed';
      response.status(500).json({ error: { code: 'stop_failed', message: msg } });
    }
  });

  router.get('/auto-reply/armed', async (request: Request, response: Response) => {
    const connectorId = typeof request.query.connector_id === 'string' ? request.query.connector_id : '';
    const remoteJid = typeof request.query.remote_jid === 'string' ? request.query.remote_jid : '';
    if (!connectorId || !remoteJid) {
      response.status(400).json({
        error: { code: 'invalid_query', message: 'connector_id and remote_jid required' },
      });
      return;
    }
    try {
      const { isContactArmed } = await import('../whatsapp/whatsappAutoReply.service.js');
      const armed = await isContactArmed(connectorId, remoteJid);
      response.json({ ok: true, armed });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Armed check failed';
      response.status(500).json({ error: { code: 'armed_check_failed', message } });
    }
  });

  return router;
}

export function createInternalRouter(): Router {
  const router = Router();
  router.use(assertInternalServiceSecret);

  const alertBody = z.object({
    message: z.string().trim().min(1).max(4000),
    source: z.string().trim().max(120).optional(),
  });

  router.post('/alerts', async (request: Request, response: Response) => {
    const parsed = alertBody.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: { code: 'invalid_body', message: 'message required' } });
      return;
    }
    const { handleInternalAlert } = await import('../whatsapp/whatsappChannel.service.js');
    await handleInternalAlert(parsed.data.message, parsed.data.source);
    response.json({ ok: true });
  });

  router.post('/whatsapp/:connectorId/logged-out', async (request: Request, response: Response) => {
    const connectorId = request.params.connectorId;
    if (!connectorId) {
      response.status(400).json({ error: { code: 'invalid_id', message: 'connectorId required' } });
      return;
    }
    try {
      await repo.markWhatsAppDisconnected(connectorId);
      response.json({ ok: true });
    } catch (err) {
      console.error('[whatsapp] logged-out', err);
      response.status(500).json({ error: { code: 'update_failed', message: 'Failed to record disconnect' } });
    }
  });

  router.post('/whatsapp/:connectorId/linked', async (request: Request, response: Response) => {
    const parsed = linkedBody.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: { code: 'invalid_body', message: 'owner_jid required' } });
      return;
    }
    const connectorId = request.params.connectorId;
    if (!connectorId) {
      response.status(400).json({ error: { code: 'invalid_id', message: 'connectorId required' } });
      return;
    }
    try {
      const phone = parsed.data.owner_jid.replace(/@.*/, '');
      await repo.markWhatsAppConnected({
        connectorId,
        ownerJid: parsed.data.owner_jid,
        phoneDisplay: phone,
      });
      response.json({ ok: true });
    } catch (err) {
      console.error('[whatsapp] linked', err);
      response.status(500).json({ error: { code: 'link_failed', message: 'Failed to save link' } });
    }
  });

  return router;
}
