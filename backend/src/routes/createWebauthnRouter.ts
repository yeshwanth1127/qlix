import { Router } from 'express';
import type { Request, Response } from 'express';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import type { WebAuthnEnvironment } from '../config/loadEnvironmentConfig.js';
import { mintAgentCreateStepUpToken } from '../lib/authTokens.js';
import { authenticateUser, loadJwtSecret } from '../middleware/authenticateUser.js';
import { WebAuthnService } from '../webauthn/webauthn.service.js';

export function createWebauthnRouter(webAuthnConfig: WebAuthnEnvironment): Router {
  const router = Router();
  const service = new WebAuthnService(webAuthnConfig);

  router.post('/register/start', authenticateUser(true), async (request: Request, response: Response) => {
    try {
      const userId = request.auth!.userId;
      const options = await service.generateRegistrationOptions(userId);
      response.json({ options });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      if (message === 'User not found') {
        response.status(404).json({ error: { code: 'not_found', message: 'User not found' } });
        return;
      }
      response.status(500).json({
        error: { code: 'webauthn_start_failed', message: 'Failed to generate registration options' },
      });
    }
  });

  router.post('/register/verify', authenticateUser(true), async (request: Request, response: Response) => {
    try {
      const userId = request.auth!.userId;
      const credential = request.body?.credential as RegistrationResponseJSON | undefined;
      if (!credential || typeof credential !== 'object') {
        response.status(400).json({
          error: { code: 'invalid_body', message: 'Missing credential in request body' },
        });
        return;
      }

      const verified = await service.verifyRegistration(userId, credential);
      if (!verified) {
        response.status(400).json({
          error: { code: 'webauthn_verify_failed', message: 'Registration could not be verified' },
        });
        return;
      }

      const secret = loadJwtSecret();
      const stepUpToken = mintAgentCreateStepUpToken(userId, secret);
      response.json({ deviceVerified: true, stepUpToken });
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (message.includes('Challenge not found')) {
        response.status(400).json({
          error: { code: 'webauthn_challenge_expired', message: 'Registration session expired; start again' },
        });
        return;
      }
      response.status(500).json({
        error: { code: 'webauthn_verify_error', message: 'Verification error' },
      });
    }
  });

  router.post('/authenticate/start', authenticateUser(true), async (request: Request, response: Response) => {
    try {
      const userId = request.auth!.userId;
      const options = await service.generateAuthenticationOptions(userId);
      response.json({ options });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      if (message === 'No passkey registered for this user') {
        response.status(400).json({
          error: { code: 'webauthn_no_passkey', message: 'Register a passkey before authenticating' },
        });
        return;
      }
      response.status(500).json({
        error: { code: 'webauthn_auth_start_failed', message: 'Failed to start authentication' },
      });
    }
  });

  router.post('/authenticate/verify', authenticateUser(true), async (request: Request, response: Response) => {
    try {
      const userId = request.auth!.userId;
      const assertion = request.body?.credential as AuthenticationResponseJSON | undefined;
      if (!assertion || typeof assertion !== 'object') {
        response.status(400).json({
          error: { code: 'invalid_body', message: 'Missing credential in request body' },
        });
        return;
      }

      const verified = await service.verifyAuthentication(userId, assertion);
      if (!verified) {
        response.status(400).json({
          error: { code: 'webauthn_auth_verify_failed', message: 'Authentication could not be verified' },
        });
        return;
      }

      const secret = loadJwtSecret();
      const stepUpToken = mintAgentCreateStepUpToken(userId, secret);
      response.json({ ok: true, stepUpToken });
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (message.includes('Challenge not found')) {
        response.status(400).json({
          error: { code: 'webauthn_challenge_expired', message: 'Authentication session expired; start again' },
        });
        return;
      }
      response.status(500).json({
        error: { code: 'webauthn_auth_verify_error', message: 'Authentication verification error' },
      });
    }
  });

  return router;
}
