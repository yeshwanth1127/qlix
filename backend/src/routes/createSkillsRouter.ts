import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { authenticateUser } from '../middleware/authenticateUser.js';
import { requireSubscriptionAccess } from '../middleware/requireSubscriptionAccess.js';
import {
  approveOrgSkill,
  listOrgSkills,
  promoteRunToSkill,
} from '../skills/orgSkills.service.js';

const promoteSchema = z.object({
  runId: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
});

export function createSkillsRouter(): Router {
  const router = Router();

  router.get('/', authenticateUser(true), requireSubscriptionAccess, async (req: Request, res: Response) => {
    const orgId = req.auth!.orgId;
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const skills = await listOrgSkills(orgId, status);
    res.json({ skills });
  });

  router.post(
    '/promote',
    authenticateUser(true),
    requireSubscriptionAccess,
    async (req: Request, res: Response) => {
      const parsed = promoteSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: { code: 'invalid_body', message: 'runId and name required' } });
        return;
      }
      try {
        const skill = await promoteRunToSkill({
          orgId: req.auth!.orgId,
          userId: req.auth!.userId,
          ...parsed.data,
        });
        res.status(201).json({ skill });
      } catch (err) {
        const e = err as { code?: string; status?: number; message?: string };
        res.status(e.status ?? 500).json({
          error: { code: e.code ?? 'promote_failed', message: e.message ?? 'Failed to promote' },
        });
      }
    },
  );

  router.post(
    '/:skillId/approve',
    authenticateUser(true),
    requireSubscriptionAccess,
    async (req: Request, res: Response) => {
      const role = req.auth!.role;
      if (role !== 'owner' && role !== 'admin') {
        res.status(403).json({ error: { code: 'forbidden', message: 'Admin required' } });
        return;
      }
      try {
        await approveOrgSkill({
          orgId: req.auth!.orgId,
          skillId: String(req.params.skillId),
          userId: req.auth!.userId,
        });
        res.json({ ok: true });
      } catch (err) {
        const e = err as { code?: string; status?: number; message?: string };
        res.status(e.status ?? 500).json({
          error: { code: e.code ?? 'approve_failed', message: e.message ?? 'Failed to approve' },
        });
      }
    },
  );

  return router;
}
