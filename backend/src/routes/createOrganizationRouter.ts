import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { sendAuthCookie, SESSION_MAX_AGE_SEC } from '../lib/authCookie.js';
import { generateInvitePlainToken, hashInviteToken } from '../lib/inviteToken.js';
import { roleCan, normalizeOrgRole } from '../lib/orgPermissions.js';
import { prisma } from '../lib/prisma.js';
import { signAuthToken } from '../lib/authTokens.js';
import { authenticateUser, loadJwtSecret } from '../middleware/authenticateUser.js';

const INVITE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

const createInvitationSchema = z.object({
  email: z.string().email().max(320),
  role: z.enum(['admin', 'member']),
});

const patchMemberSchema = z.object({
  role: z.enum(['admin', 'member']),
});

async function ensureOrganizationWorkspace(
  response: Response,
  orgId: string,
): Promise<{ ok: true } | { ok: false }> {
  const org = await prisma.organization.findUnique({ where: { id: orgId } });
  if (!org || org.workspaceKind !== 'organization') {
    response.status(403).json({
      error: { code: 'forbidden', message: 'Organization workspace required' },
    });
    return { ok: false };
  }
  return { ok: true };
}

export function createOrganizationRouter(): Router {
  const router = Router();

  router.get('/members', authenticateUser(true), async (request: Request, response: Response) => {
    try {
      const auth = request.auth!;
      if (!roleCan(auth.role, 'list_members')) {
        response.status(403).json({ error: { code: 'forbidden', message: 'Not allowed to list members' } });
        return;
      }
      const gate = await ensureOrganizationWorkspace(response, auth.orgId);
      if (!gate.ok) return;

      const [users, invitations] = await Promise.all([
        prisma.user.findMany({
          where: { orgId: auth.orgId },
          select: {
            id: true,
            email: true,
            displayName: true,
            role: true,
            isActive: true,
            createdAt: true,
          },
          orderBy: [{ createdAt: 'asc' }],
        }),
        prisma.organizationInvitation.findMany({
          where: {
            orgId: auth.orgId,
            status: 'pending',
            expiresAt: { gt: new Date() },
          },
          select: {
            id: true,
            email: true,
            role: true,
            expiresAt: true,
            createdAt: true,
            invitedByUserId: true,
          },
          orderBy: { createdAt: 'desc' },
        }),
      ]);

      response.json({ members: users, invitations });
    } catch (error) {
      console.error('[organization/members]', error);
      response.status(500).json({ error: { code: 'internal_error', message: 'Failed to list members' } });
    }
  });

  router.post('/invitations', authenticateUser(true), async (request: Request, response: Response) => {
    try {
      const auth = request.auth!;
      if (!roleCan(auth.role, 'manage_invitations')) {
        response.status(403).json({ error: { code: 'forbidden', message: 'Not allowed to create invitations' } });
        return;
      }
      const gate = await ensureOrganizationWorkspace(response, auth.orgId);
      if (!gate.ok) return;

      const body = createInvitationSchema.parse(request.body);
      const email = body.email.trim().toLowerCase();

      const existingUser = await prisma.user.findFirst({
        where: { orgId: auth.orgId, email },
      });
      if (existingUser) {
        response.status(409).json({
          error: { code: 'already_member', message: 'A user with this email is already in the organization' },
        });
        return;
      }

      const pending = await prisma.organizationInvitation.findFirst({
        where: { orgId: auth.orgId, email, status: 'pending', expiresAt: { gt: new Date() } },
      });
      if (pending) {
        response.status(409).json({
          error: { code: 'invite_pending', message: 'An active invitation already exists for this email' },
        });
        return;
      }

      const plainToken = generateInvitePlainToken();
      const tokenHash = hashInviteToken(plainToken);
      const expiresAt = new Date(Date.now() + INVITE_EXPIRY_MS);

      const invitation = await prisma.organizationInvitation.create({
        data: {
          orgId: auth.orgId,
          email,
          role: body.role,
          tokenHash,
          expiresAt,
          invitedByUserId: auth.userId,
          status: 'pending',
        },
      });

      response.status(201).json({
        invitation: {
          id: invitation.id,
          email: invitation.email,
          role: invitation.role,
          expiresAt: invitation.expiresAt.toISOString(),
        },
        inviteToken: plainToken,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        response.status(400).json({
          error: { code: 'validation_error', message: 'Invalid input', details: error.flatten() },
        });
        return;
      }
      console.error('[organization/invitations]', error);
      response.status(500).json({ error: { code: 'internal_error', message: 'Failed to create invitation' } });
    }
  });

  router.delete('/invitations/:id', authenticateUser(true), async (request: Request, response: Response) => {
    try {
      const auth = request.auth!;
      if (!roleCan(auth.role, 'manage_invitations')) {
        response.status(403).json({ error: { code: 'forbidden', message: 'Not allowed to revoke invitations' } });
        return;
      }
      const gate = await ensureOrganizationWorkspace(response, auth.orgId);
      if (!gate.ok) return;

      const id = request.params.id;
      if (!id) {
        response.status(400).json({ error: { code: 'validation_error', message: 'Missing invitation id' } });
        return;
      }

      const invitation = await prisma.organizationInvitation.findFirst({
        where: { id, orgId: auth.orgId, status: 'pending' },
      });
      if (!invitation) {
        response.status(404).json({ error: { code: 'not_found', message: 'Invitation not found' } });
        return;
      }

      await prisma.organizationInvitation.update({
        where: { id: invitation.id },
        data: { status: 'revoked' },
      });
      response.status(204).send();
    } catch (error) {
      console.error('[organization/invitations/:id]', error);
      response.status(500).json({ error: { code: 'internal_error', message: 'Failed to revoke invitation' } });
    }
  });

  router.patch('/members/:userId', authenticateUser(true), async (request: Request, response: Response) => {
    try {
      const auth = request.auth!;
      if (!roleCan(auth.role, 'change_member_roles')) {
        response.status(403).json({ error: { code: 'forbidden', message: 'Not allowed to change roles' } });
        return;
      }
      const gate = await ensureOrganizationWorkspace(response, auth.orgId);
      if (!gate.ok) return;

      const targetId = request.params.userId;
      if (!targetId) {
        response.status(400).json({ error: { code: 'validation_error', message: 'Missing user id' } });
        return;
      }

      const body = patchMemberSchema.parse(request.body);

      const target = await prisma.user.findFirst({
        where: { id: targetId, orgId: auth.orgId },
      });
      if (!target) {
        response.status(404).json({ error: { code: 'not_found', message: 'User not found in organization' } });
        return;
      }

      if (normalizeOrgRole(target.role) === 'owner') {
        response.status(403).json({
          error: { code: 'forbidden', message: 'Organization owner role cannot be changed here' },
        });
        return;
      }

      if (normalizeOrgRole(auth.role) === 'admin' && normalizeOrgRole(target.role) === 'admin') {
        response.status(403).json({
          error: { code: 'forbidden', message: 'Admins cannot change another admin role' },
        });
        return;
      }

      const updated = await prisma.user.update({
        where: { id: target.id },
        data: { role: body.role },
        select: {
          id: true,
          email: true,
          displayName: true,
          role: true,
          isActive: true,
          createdAt: true,
        },
      });

      if (auth.userId === target.id) {
        const secret = loadJwtSecret();
        const token = signAuthToken(
          {
            sub: updated.id,
            orgId: auth.orgId,
            email: updated.email,
            role: updated.role,
          },
          secret,
          SESSION_MAX_AGE_SEC,
        );
        sendAuthCookie(response, token);
      }

      response.json({ member: updated });
    } catch (error) {
      if (error instanceof z.ZodError) {
        response.status(400).json({
          error: { code: 'validation_error', message: 'Invalid input', details: error.flatten() },
        });
        return;
      }
      console.error('[organization/members/:userId]', error);
      response.status(500).json({ error: { code: 'internal_error', message: 'Failed to update member' } });
    }
  });

  router.delete('/members/:userId', authenticateUser(true), async (request: Request, response: Response) => {
    try {
      const auth = request.auth!;
      if (!roleCan(auth.role, 'deactivate_members')) {
        response.status(403).json({ error: { code: 'forbidden', message: 'Not allowed to remove members' } });
        return;
      }
      const gate = await ensureOrganizationWorkspace(response, auth.orgId);
      if (!gate.ok) return;

      const targetId = request.params.userId;
      if (!targetId) {
        response.status(400).json({ error: { code: 'validation_error', message: 'Missing user id' } });
        return;
      }

      if (targetId === auth.userId) {
        response.status(400).json({
          error: { code: 'invalid_operation', message: 'You cannot deactivate your own account from here' },
        });
        return;
      }

      const target = await prisma.user.findFirst({
        where: { id: targetId, orgId: auth.orgId },
      });
      if (!target) {
        response.status(404).json({ error: { code: 'not_found', message: 'User not found in organization' } });
        return;
      }

      if (normalizeOrgRole(target.role) === 'owner') {
        response.status(403).json({
          error: { code: 'forbidden', message: 'Cannot deactivate an organization owner' },
        });
        return;
      }

      if (normalizeOrgRole(auth.role) === 'admin' && normalizeOrgRole(target.role) === 'admin') {
        response.status(403).json({
          error: { code: 'forbidden', message: 'Admins cannot deactivate another admin' },
        });
        return;
      }

      const ownerCount = await prisma.user.count({
        where: { orgId: auth.orgId, role: 'owner', isActive: true },
      });
      if (ownerCount < 1) {
        response.status(500).json({ error: { code: 'internal_error', message: 'Invariant: no active owner' } });
        return;
      }

      await prisma.user.update({
        where: { id: target.id },
        data: { isActive: false },
      });

      response.status(204).send();
    } catch (error) {
      console.error('[organization/members/:userId delete]', error);
      response.status(500).json({ error: { code: 'internal_error', message: 'Failed to remove member' } });
    }
  });

  return router;
}
