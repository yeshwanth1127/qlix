import { Router } from 'express';
import { authenticateUser, loadJwtSecret } from '../middleware/authenticateUser.js';
import { mintAgentCreateStepUpToken } from '../lib/authTokens.js';

export function createMobileRouter(): Router {
  const router = Router();

  // Native mobile clients run in a sandboxed environment with no browser CSRF
  // surface. Mint the agent-create step-up token directly from the authenticated
  // session so the mobile app can call agent/team creation endpoints.
  router.post('/step-up', authenticateUser, (req, res) => {
    const token = mintAgentCreateStepUpToken(req.auth!.userId, loadJwtSecret());
    res.json({ stepUpToken: token });
  });

  return router;
}
