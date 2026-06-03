import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { decryptForAgentSecrets } from '../cloudRunners/agentSecrets.js';
import { JitTokenInvalidError, JitTokenRequiredError } from '../actions/actions.service.js';
import { roleCan } from '../lib/orgPermissions.js';
import { prisma } from '../lib/prisma.js';
import { authenticateUser } from '../middleware/authenticateUser.js';
import { ConnectorsRepository } from '../connectors/connectors.repository.js';
import {
  buildGoogleAuthUrl,
  encryptIntegrationSecret,
  exchangeGoogleCode,
  GoogleOAuthNotConfiguredError,
  mintGoogleOAuthState,
  verifyGoogleOAuthState,
} from '../connectors/googleOAuth.service.js';
import type { ConnectorAccountDTO, N8nIntegrationDTO } from '../connectors/connectors.types.js';
import {
  disconnectWhatsApp,
  pollLinkStatus,
  startWhatsAppLink,
  WhatsAppServiceNotConfiguredError,
} from '../connectors/whatsappConnector.service.js';

const repo = new ConnectorsRepository();

const n8nSettingsSchema = z.object({
  n8nBaseUrl: z.string().url().max(500),
  n8nWebhookSecret: z.string().min(8).max(512).optional(),
  n8nEmailReadPath: z.string().trim().min(1).max(200).optional(),
  n8nEmailSendPath: z.string().trim().min(1).max(200).optional(),
});

function frontendRedirect(path: string): string {
  const base = process.env.FRONTEND_URL?.trim() || 'http://localhost:3000';
  return `${base.replace(/\/$/, '')}${path}`;
}

async function canManageConnectors(request: Request): Promise<boolean> {
  const auth = request.auth!;
  const org = await prisma.organization.findUnique({
    where: { id: auth.orgId },
    select: { workspaceKind: true },
  });
  if (!org) return false;
  if (org.workspaceKind === 'individual') return true;
  return roleCan(auth.role, 'org_settings') || roleCan(auth.role, 'manage_brain');
}

export function createConnectorsRouter(): Router {
  const router = Router();

  router.get('/', authenticateUser(true), async (request: Request, response: Response) => {
    try {
      const auth = request.auth!;
      const connectors = await repo.listForOrg(auth.orgId);
      const settings = await repo.getN8nSettings(auth.orgId);
      const n8n: N8nIntegrationDTO = {
        configured: Boolean(settings?.n8nBaseUrl && settings?.n8nWebhookSecretEnc),
        n8nBaseUrl: settings?.n8nBaseUrl ?? null,
        n8nEmailReadPath: settings?.n8nEmailReadPath ?? '/webhook/qlix-email-read',
        n8nEmailSendPath: settings?.n8nEmailSendPath ?? '/webhook/qlix-email-send',
      };
      response.json({ connectors, n8n });
    } catch (err) {
      console.error('[connectors] list', err);
      response.status(500).json({ error: { code: 'connectors_list_failed', message: 'Failed to list connectors' } });
    }
  });

  router.post('/google/start', authenticateUser(true), async (request: Request, response: Response) => {
    try {
      if (!(await canManageConnectors(request))) {
        response.status(403).json({ error: { code: 'forbidden', message: 'Not allowed to manage connectors' } });
        return;
      }
      const auth = request.auth!;
      const state = mintGoogleOAuthState(auth.userId, auth.orgId);
      const url = buildGoogleAuthUrl(state);
      response.json({ url });
    } catch (err) {
      if (err instanceof GoogleOAuthNotConfiguredError) {
        response.status(503).json({ error: { code: err.code, message: err.message } });
        return;
      }
      console.error('[connectors] google/start', err);
      response.status(500).json({ error: { code: 'oauth_start_failed', message: 'Failed to start Google OAuth' } });
    }
  });

  router.get('/google/callback', async (request: Request, response: Response) => {
    const code = typeof request.query.code === 'string' ? request.query.code : '';
    const state = typeof request.query.state === 'string' ? request.query.state : '';
    const oauthError = typeof request.query.error === 'string' ? request.query.error : '';

    if (oauthError) {
      response.redirect(frontendRedirect(`/individual/connectors?error=${encodeURIComponent(oauthError)}`));
      return;
    }
    if (!code || !state) {
      response.redirect(frontendRedirect('/individual/connectors?error=missing_code'));
      return;
    }

    try {
      const { userId, orgId } = verifyGoogleOAuthState(state);
      const tokens = await exchangeGoogleCode(code);
      const connector: ConnectorAccountDTO = await repo.upsertGoogle({ orgId, userId, tokens });

      const org = await prisma.organization.findUnique({
        where: { id: orgId },
        select: { workspaceKind: true },
      });
      const prefix = org?.workspaceKind === 'organization' ? '/organization' : '/individual';
      response.redirect(
        frontendRedirect(`${prefix}/connectors?connected=google&email=${encodeURIComponent(connector.emailAddress ?? '')}`),
      );
    } catch (err) {
      console.error('[connectors] google/callback', err);
      response.redirect(frontendRedirect(`/individual/connectors?error=oauth_failed`));
    }
  });

  router.delete('/google', authenticateUser(true), async (request: Request, response: Response) => {
    try {
      if (!(await canManageConnectors(request))) {
        response.status(403).json({ error: { code: 'forbidden', message: 'Not allowed to manage connectors' } });
        return;
      }
      await repo.delete(request.auth!.orgId, 'google');
      response.status(204).send();
    } catch (err) {
      console.error('[connectors] google/delete', err);
      response.status(500).json({ error: { code: 'connector_delete_failed', message: 'Failed to disconnect Google' } });
    }
  });

  router.put('/integrations/n8n', authenticateUser(true), async (request: Request, response: Response) => {
    const n8nPartialSchema = z.object({
      n8nBaseUrl: z.string().url().max(500),
      n8nWebhookSecret: z.string().min(8).max(512).optional(),
      n8nEmailReadPath: z.string().trim().min(1).max(200).optional(),
      n8nEmailSendPath: z.string().trim().min(1).max(200).optional(),
    });
    const parsed = n8nPartialSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid n8n settings' } });
      return;
    }
    try {
      const auth = request.auth!;
      if (!roleCan(auth.role, 'org_settings')) {
        response.status(403).json({ error: { code: 'forbidden', message: 'Org admin required for n8n settings' } });
        return;
      }
      const existing = await repo.getN8nSettings(auth.orgId);
      const secretEnc =
        parsed.data.n8nWebhookSecret?.trim()
          ? encryptIntegrationSecret(parsed.data.n8nWebhookSecret.trim())
          : existing?.n8nWebhookSecretEnc;
      if (!secretEnc) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'n8nWebhookSecret is required on first setup' } });
        return;
      }
      await repo.updateN8nSettings(auth.orgId, {
        n8nBaseUrl: parsed.data.n8nBaseUrl,
        n8nWebhookSecretEnc: secretEnc,
        n8nEmailReadPath: parsed.data.n8nEmailReadPath,
        n8nEmailSendPath: parsed.data.n8nEmailSendPath,
      });
      response.json({ ok: true });
    } catch (err) {
      console.error('[connectors] n8n/settings', err);
      response.status(500).json({ error: { code: 'n8n_settings_failed', message: 'Failed to save n8n settings' } });
    }
  });

  router.post('/whatsapp/link', authenticateUser(true), async (request: Request, response: Response) => {
    try {
      if (!(await canManageConnectors(request))) {
        response.status(403).json({ error: { code: 'forbidden', message: 'Not allowed to manage connectors' } });
        return;
      }
      const auth = request.auth!;
      const status = await startWhatsAppLink(auth.orgId, auth.userId);
      response.json(status);
    } catch (err) {
      if (err instanceof WhatsAppServiceNotConfiguredError) {
        response.status(503).json({ error: { code: err.code, message: err.message } });
        return;
      }
      console.error('[connectors] whatsapp/link', err);
      response.status(500).json({
        error: { code: 'whatsapp_link_failed', message: err instanceof Error ? err.message : 'Link failed' },
      });
    }
  });

  router.get('/whatsapp/status', authenticateUser(true), async (request: Request, response: Response) => {
    try {
      const auth = request.auth!;
      const existing = await repo.findByOrgProvider(auth.orgId, 'whatsapp_baileys');
      if (!existing) {
        response.json({ status: 'revoked', connectorId: null, qr: null, phone: null, ownerJid: null });
        return;
      }
      if (existing.status === 'pending_qr') {
        const status = await pollLinkStatus(existing.id);
        response.json(status);
        return;
      }
      const { startWhatsAppSession, getWhatsAppSessionStatus } = await import(
        '../connectors/whatsappServiceClient.js'
      );
      await startWhatsAppSession(existing.id).catch((err) => {
        console.warn('[connectors] whatsapp resume on status:', err);
      });
      const live = await getWhatsAppSessionStatus(existing.id);
      response.json({
        connectorId: existing.id,
        status: existing.status,
        qr: live.qr,
        phone: existing.emailAddress,
        ownerJid: live.ownerJid ?? existing.whatsappOwnerJid,
      });
    } catch (err) {
      console.error('[connectors] whatsapp/status', err);
      response.status(500).json({ error: { code: 'whatsapp_status_failed', message: 'Failed to get status' } });
    }
  });

  const whatsappDefaultsSchema = z.object({
    agentId: z.string().min(1).nullable().optional(),
    teamId: z.string().min(1).nullable().optional(),
  });

  router.patch('/whatsapp/defaults', authenticateUser(true), async (request: Request, response: Response) => {
    const parsed = whatsappDefaultsSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid defaults body' } });
      return;
    }
    try {
      if (!(await canManageConnectors(request))) {
        response.status(403).json({ error: { code: 'forbidden', message: 'Not allowed to manage connectors' } });
        return;
      }
      const auth = request.auth!;
      const existing = await repo.findByOrgProvider(auth.orgId, 'whatsapp_baileys');
      if (!existing || existing.status !== 'connected') {
        response.status(404).json({ error: { code: 'not_connected', message: 'Link WhatsApp first' } });
        return;
      }
      let connector = existing;
      if (parsed.data.agentId !== undefined) {
        connector = await repo.setWhatsAppDefaultAgent(existing.id, parsed.data.agentId);
      }
      if (parsed.data.teamId !== undefined) {
        if (parsed.data.teamId) {
          const team = await prisma.team.findFirst({
            where: { id: parsed.data.teamId, orgId: auth.orgId },
          });
          if (!team) {
            response.status(404).json({ error: { code: 'team_not_found', message: 'Team not found' } });
            return;
          }
        }
        connector = await repo.setWhatsAppDefaultTeam(existing.id, parsed.data.teamId);
      }
      response.json({ connector });
    } catch (err) {
      console.error('[connectors] whatsapp/defaults', err);
      response.status(500).json({
        error: { code: 'whatsapp_defaults_failed', message: 'Failed to update WhatsApp defaults' },
      });
    }
  });

  router.delete('/whatsapp', authenticateUser(true), async (request: Request, response: Response) => {
    try {
      if (!(await canManageConnectors(request))) {
        response.status(403).json({ error: { code: 'forbidden', message: 'Not allowed to manage connectors' } });
        return;
      }
      await disconnectWhatsApp(request.auth!.orgId);
      response.status(204).send();
    } catch (err) {
      console.error('[connectors] whatsapp/delete', err);
      response.status(500).json({
        error: { code: 'whatsapp_disconnect_failed', message: 'Failed to disconnect WhatsApp' },
      });
    }
  });

  router.get('/integrations/n8n', authenticateUser(true), async (request: Request, response: Response) => {
    try {
      const settings = await repo.getN8nSettings(request.auth!.orgId);
      const n8n: N8nIntegrationDTO = {
        configured: Boolean(settings?.n8nBaseUrl && settings?.n8nWebhookSecretEnc),
        n8nBaseUrl: settings?.n8nBaseUrl ?? null,
        n8nEmailReadPath: settings?.n8nEmailReadPath ?? '/webhook/qlix-email-read',
        n8nEmailSendPath: settings?.n8nEmailSendPath ?? '/webhook/qlix-email-send',
      };
      response.json({ n8n });
    } catch (err) {
      response.status(500).json({ error: { code: 'n8n_get_failed', message: 'Failed to load n8n settings' } });
    }
  });

  return router;
}

/** Decrypt n8n secret for internal use (email proxy). */
export function decryptN8nSecret(encrypted: string): string {
  return decryptForAgentSecrets(encrypted);
}
