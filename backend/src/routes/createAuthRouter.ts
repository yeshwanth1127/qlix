import crypto from 'node:crypto';
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { AUTH_COOKIE_NAME, signAuthToken } from '../lib/authTokens.js';
import { sendAuthCookie, SESSION_MAX_AGE_SEC } from '../lib/authCookie.js';
import { hashInviteToken } from '../lib/inviteToken.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { prisma } from '../lib/prisma.js';
import { allocateOrganizationSlug } from '../lib/slug.js';
import { sessionUserPayload } from '../deviceVerification/deviceVerification.js';
import { authenticateUser, loadJwtSecret } from '../middleware/authenticateUser.js';

const signupSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(8).max(72),
  displayName: z.string().min(1).max(120).optional(),
  workspaceType: z.enum(['individual', 'organization']).optional().default('individual'),
  inviteToken: z.string().min(24).max(256).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(72),
});

const superAdminSignupSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(8).max(72),
  displayName: z.string().min(1).max(120).optional(),
  bootstrapPassword: z.string().min(1).max(512),
});

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function verifyBootstrapPassword(input: string, configured: string): boolean {
  try {
    const a = Buffer.from(input, 'utf8');
    const b = Buffer.from(configured, 'utf8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function clearAuthCookie(response: Response): void {
  response.clearCookie(AUTH_COOKIE_NAME, { path: '/', httpOnly: true, sameSite: 'lax' });
}

export function createAuthRouter(): Router {
  const router = Router();

  router.post('/signup', async (request: Request, response: Response) => {
    try {
      const body = signupSchema.parse(request.body);
      const email = normalizeEmail(body.email);
      const passwordHash = await hashPassword(body.password);

      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        response.status(409).json({
          error: { code: 'email_taken', message: 'An account with this email already exists' },
        });
        return;
      }

      const secret = loadJwtSecret();

      if (body.inviteToken) {
        if (body.workspaceType !== 'organization') {
          response.status(400).json({
            error: {
              code: 'invalid_invite_context',
              message: 'Invited sign-up requires workspace type organization',
            },
          });
          return;
        }

        const tokenHash = hashInviteToken(body.inviteToken);
        const invitation = await prisma.organizationInvitation.findFirst({
          where: {
            tokenHash,
            status: 'pending',
            expiresAt: { gt: new Date() },
          },
          include: { organization: true },
        });

        if (!invitation) {
          response.status(400).json({
            error: { code: 'invalid_invite', message: 'Invalid or expired invitation' },
          });
          return;
        }

        if (normalizeEmail(invitation.email) !== email) {
          response.status(400).json({
            error: {
              code: 'invite_email_mismatch',
              message: 'Sign-up email must match the invitation email',
            },
          });
          return;
        }

        if (invitation.organization.workspaceKind !== 'organization') {
          response.status(400).json({
            error: { code: 'invalid_invite', message: 'Invitation is not for an organization workspace' },
          });
          return;
        }

        const result = await prisma.$transaction(async (tx) => {
          const user = await tx.user.create({
            data: {
              orgId: invitation.orgId,
              email,
              displayName: body.displayName?.trim() ?? null,
              workspaceKind: 'organization',
              role: invitation.role,
              passwordHash,
            },
          });

          await tx.organizationInvitation.update({
            where: { id: invitation.id },
            data: { status: 'accepted' },
          });

          await tx.wallet.create({
            data: { userId: user.id, currency: 'USD', balance: 0 },
          });

          const token = signAuthToken(
            {
              sub: user.id,
              orgId: user.orgId,
              email: user.email,
              role: user.role,
            },
            secret,
            SESSION_MAX_AGE_SEC,
          );

          return { user, organization: invitation.organization, token };
        });

        sendAuthCookie(response, result.token);

        response.status(201).json({
          token: result.token,
          user: sessionUserPayload(result.user),
          organization: {
            id: result.organization.id,
            name: result.organization.name,
            slug: result.organization.slug,
            workspaceKind: result.organization.workspaceKind,
            plan: result.organization.plan,
          },
        });
        return;
      }

      const label =
        body.displayName?.trim() ||
        email.split('@')[0] ||
        'Workspace';
      const orgDisplayName =
        body.workspaceType === 'organization'
          ? `${label}'s Organization`
          : `${label}'s Workspace`;

      const slug = await allocateOrganizationSlug(async (s) => {
        const row = await prisma.organization.findUnique({ where: { slug: s } });
        return row !== null;
      }, orgDisplayName);

      const result = await prisma.$transaction(async (tx) => {
        const organization = await tx.organization.create({
          data: {
            name: orgDisplayName,
            slug,
            plan: 'free',
            workspaceKind: body.workspaceType,
          },
        });

        const user = await tx.user.create({
          data: {
            orgId: organization.id,
            email,
            displayName: body.displayName?.trim() ?? null,
            workspaceKind: body.workspaceType,
            role: 'owner',
            passwordHash,
          },
        });

        await tx.wallet.create({
          data: { userId: user.id, currency: 'USD', balance: 0 },
        });
        await tx.wallet.create({
          data: { orgId: organization.id, currency: 'USD', balance: 0 },
        });

        const token = signAuthToken(
          {
            sub: user.id,
            orgId: organization.id,
            email: user.email,
            role: user.role,
          },
          secret,
          SESSION_MAX_AGE_SEC,
        );

        return { user, organization, token };
      });

      sendAuthCookie(response, result.token);

      response.status(201).json({
        token: result.token,
        user: sessionUserPayload(result.user),
        organization: {
          id: result.organization.id,
          name: result.organization.name,
          slug: result.organization.slug,
          workspaceKind: result.organization.workspaceKind,
          plan: result.organization.plan,
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        response.status(400).json({
          error: { code: 'validation_error', message: 'Invalid input', details: error.flatten() },
        });
        return;
      }
      console.error('[auth/signup]', error);
      response.status(500).json({ error: { code: 'internal_error', message: 'Sign up failed' } });
    }
  });

  router.post('/super-admin/signup', async (request: Request, response: Response) => {
    try {
      const configured = process.env.SUPER_ADMIN_BOOTSTRAP_PASSWORD?.trim() ?? '';
      if (configured.length < 12) {
        response.status(503).json({
          error: {
            code: 'super_admin_bootstrap_disabled',
            message:
              'Super admin sign-up is disabled. Set SUPER_ADMIN_BOOTSTRAP_PASSWORD (min 12 characters) on the API server.',
          },
        });
        return;
      }

      const allowMultiple = process.env.SUPER_ADMIN_BOOTSTRAP_ALLOW_MULTIPLE === 'true';
      if (!allowMultiple) {
        const existingSuperAdmins = await prisma.user.count({ where: { isSuperAdmin: true } });
        if (existingSuperAdmins > 0) {
          response.status(403).json({
            error: {
              code: 'super_admin_bootstrap_closed',
              message:
                'A super admin already exists. Sign in on the main page, or set SUPER_ADMIN_BOOTSTRAP_ALLOW_MULTIPLE=true to allow additional bootstrap sign-ups.',
            },
          });
          return;
        }
      }

      const body = superAdminSignupSchema.parse(request.body);
      if (!verifyBootstrapPassword(body.bootstrapPassword, configured)) {
        response.status(401).json({
          error: { code: 'invalid_bootstrap_password', message: 'Invalid super admin access password' },
        });
        return;
      }

      const email = normalizeEmail(body.email);
      const passwordHash = await hashPassword(body.password);

      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        response.status(409).json({
          error: { code: 'email_taken', message: 'An account with this email already exists' },
        });
        return;
      }

      const secret = loadJwtSecret();
      const label =
        body.displayName?.trim() || email.split('@')[0] || 'Super admin';
      const orgDisplayName = `${label}'s Platform Admin`;

      const slug = await allocateOrganizationSlug(async (s) => {
        const row = await prisma.organization.findUnique({ where: { slug: s } });
        return row !== null;
      }, orgDisplayName);

      const result = await prisma.$transaction(async (tx) => {
        const organization = await tx.organization.create({
          data: {
            name: orgDisplayName,
            slug,
            plan: 'free',
            workspaceKind: 'organization',
          },
        });

        const user = await tx.user.create({
          data: {
            orgId: organization.id,
            email,
            displayName: body.displayName?.trim() ?? null,
            workspaceKind: 'organization',
            role: 'owner',
            passwordHash,
            isSuperAdmin: true,
          },
        });

        await tx.wallet.create({
          data: { userId: user.id, currency: 'USD', balance: 0 },
        });
        await tx.wallet.create({
          data: { orgId: organization.id, currency: 'USD', balance: 0 },
        });

        const token = signAuthToken(
          {
            sub: user.id,
            orgId: organization.id,
            email: user.email,
            role: user.role,
          },
          secret,
          SESSION_MAX_AGE_SEC,
        );

        return { user, organization, token };
      });

      sendAuthCookie(response, result.token);

      response.status(201).json({
        token: result.token,
        user: sessionUserPayload(result.user),
        organization: {
          id: result.organization.id,
          name: result.organization.name,
          slug: result.organization.slug,
          workspaceKind: result.organization.workspaceKind,
          plan: result.organization.plan,
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        response.status(400).json({
          error: { code: 'validation_error', message: 'Invalid input', details: error.flatten() },
        });
        return;
      }
      console.error('[auth/super-admin/signup]', error);
      response.status(500).json({ error: { code: 'internal_error', message: 'Super admin sign up failed' } });
    }
  });

  router.post('/login', async (request: Request, response: Response) => {
    try {
      const body = loginSchema.parse(request.body);
      const email = normalizeEmail(body.email);

      const user = await prisma.user.findUnique({
        where: { email },
        include: { organization: true },
      });

      if (!user || !user.isActive) {
        response.status(401).json({
          error: { code: 'invalid_credentials', message: 'Incorrect email or password' },
        });
        return;
      }

      const ok = await verifyPassword(body.password, user.passwordHash);
      if (!ok) {
        response.status(401).json({
          error: { code: 'invalid_credentials', message: 'Incorrect email or password' },
        });
        return;
      }

      const secret = loadJwtSecret();
      const token = signAuthToken(
        {
          sub: user.id,
          orgId: user.orgId,
          email: user.email,
          role: user.role,
        },
        secret,
        SESSION_MAX_AGE_SEC,
      );

      sendAuthCookie(response, token);

      response.json({
        token,
        user: sessionUserPayload(user),
        organization: {
          id: user.organization.id,
          name: user.organization.name,
          slug: user.organization.slug,
          workspaceKind: user.organization.workspaceKind,
          plan: user.organization.plan,
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        response.status(400).json({
          error: { code: 'validation_error', message: 'Invalid input', details: error.flatten() },
        });
        return;
      }
      console.error('[auth/login]', error);
      response.status(500).json({ error: { code: 'internal_error', message: 'Login failed' } });
    }
  });

  router.post('/logout', (_request: Request, response: Response) => {
    clearAuthCookie(response);
    response.status(204).send();
  });

  router.post('/refresh', authenticateUser(true), async (request: Request, response: Response) => {
    try {
      const auth = request.auth!;
      const user = await prisma.user.findUnique({
        where: { id: auth.userId },
        include: { organization: true },
      });
      if (!user || !user.isActive) {
        clearAuthCookie(response);
        response.status(401).json({ error: { code: 'unauthorized', message: 'Account not found' } });
        return;
      }

      const secret = loadJwtSecret();
      const token = signAuthToken(
        {
          sub: user.id,
          orgId: user.orgId,
          email: user.email,
          role: user.role,
        },
        secret,
        SESSION_MAX_AGE_SEC,
      );
      sendAuthCookie(response, token);
      response.json({
        token,
        user: sessionUserPayload(user),
        organization: {
          id: user.organization.id,
          name: user.organization.name,
          slug: user.organization.slug,
          workspaceKind: user.organization.workspaceKind,
          plan: user.organization.plan,
        },
      });
    } catch (error) {
      console.error('[auth/refresh]', error);
      response.status(500).json({ error: { code: 'internal_error', message: 'Refresh failed' } });
    }
  });

  router.get('/me', authenticateUser(true), async (request: Request, response: Response) => {
    try {
      const auth = request.auth!;
      const user = await prisma.user.findUnique({
        where: { id: auth.userId },
        include: { organization: true },
      });
      if (!user || !user.isActive) {
        clearAuthCookie(response);
        response.status(401).json({ error: { code: 'unauthorized', message: 'Account not found' } });
        return;
      }

      response.json({
        user: sessionUserPayload(user),
        organization: {
          id: user.organization.id,
          name: user.organization.name,
          slug: user.organization.slug,
          workspaceKind: user.organization.workspaceKind,
          plan: user.organization.plan,
        },
      });
    } catch (error) {
      console.error('[auth/me]', error);
      response.status(500).json({ error: { code: 'internal_error', message: 'Failed to load session' } });
    }
  });

  return router;
}
