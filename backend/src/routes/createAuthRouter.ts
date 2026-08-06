import crypto from 'node:crypto';
import { Router } from 'express';
import type { Request, Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { AUTH_COOKIE_NAME, signAuthToken } from '../lib/authTokens.js';
import { buildAuthCookieOptions, sendAuthCookie, SESSION_MAX_AGE_SEC } from '../lib/authCookie.js';
import { hashInviteToken } from '../lib/inviteToken.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { prisma } from '../lib/prisma.js';
import { allocateOrganizationSlug } from '../lib/slug.js';
import { sessionUserPayload } from '../deviceVerification/deviceVerification.js';
import { authenticateUser, loadJwtSecret } from '../middleware/authenticateUser.js';
import { sessionOrganizationPayload } from '../billings/lib/subscriptionAccess.js';
import { trialSubscriptionCreateData, TRIAL_PLAN_NAME } from '../billings/lib/trialSubscription.js';
import {
  buildOAuthAuthorizeUrl,
  consoleHomePathForOAuth,
  exchangeOAuthCode,
  frontendAuthRedirect,
  isOAuthLoginProvider,
  mintOAuthLoginState,
  OAuthLoginError,
  OAuthLoginNotConfiguredError,
  upsertOAuthUserSession,
  verifyOAuthLoginState,
} from '../auth/oauthLogin.service.js';

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

const claimSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(8).max(72),
  displayName: z.string().min(1).max(120).optional(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(72),
  newPassword: z.string().min(8).max(72),
});

const GUEST_EMAIL_DOMAIN = 'guest.qlix.local';

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
  // Must mirror the flags used when the cookie was set (esp. `secure`), or browsers won't clear it.
  const { maxAge: _maxAge, ...options } = buildAuthCookieOptions();
  response.clearCookie(AUTH_COOKIE_NAME, options);
}

/** Rate limiter factory for auth endpoints (per-IP). Protects against credential brute force and
 *  mass account creation. Tunable via AUTH_RATE_LIMIT_DISABLED=1 for controlled load tests only. */
function authRateLimiter(limit: number, windowMs = 15 * 60 * 1000) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: () => process.env.AUTH_RATE_LIMIT_DISABLED === '1',
    message: {
      error: { code: 'rate_limited', message: 'Too many attempts. Please try again in a few minutes.' },
    },
  });
}

export function createAuthRouter(): Router {
  const router = Router();

  // Tight limits on brute-forceable / resource-creating endpoints.
  const loginLimiter = authRateLimiter(10);
  const signupLimiter = authRateLimiter(10);
  const guestLimiter = authRateLimiter(5);
  const bootstrapLimiter = authRateLimiter(5, 60 * 60 * 1000);
  const changePasswordLimiter = authRateLimiter(10);

  router.post('/signup', signupLimiter, async (request: Request, response: Response) => {
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
          organization: await sessionOrganizationPayload(result.organization, {
            email: result.user.email,
            isSuperAdmin: Boolean((result.user as { isSuperAdmin?: boolean }).isSuperAdmin),
          }),
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
            plan: TRIAL_PLAN_NAME,
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
        await tx.orgSubscription.create({
          data: trialSubscriptionCreateData(organization.id),
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
        organization: await sessionOrganizationPayload(result.organization, {
          email: result.user.email,
          isSuperAdmin: Boolean((result.user as { isSuperAdmin?: boolean }).isSuperAdmin),
        }),
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

  router.post('/super-admin/signup', bootstrapLimiter, async (request: Request, response: Response) => {
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
            plan: TRIAL_PLAN_NAME,
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
        await tx.orgSubscription.create({
          data: trialSubscriptionCreateData(organization.id),
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
        organization: await sessionOrganizationPayload(result.organization, {
          email: result.user.email,
          isSuperAdmin: Boolean((result.user as { isSuperAdmin?: boolean }).isSuperAdmin),
        }),
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

  // ── Guest exploration accounts ─────────────────────────────────────────────
  // Auto-provisions a real user + individual workspace so the whole platform
  // (agents, scopes, JIT, dashboard, wallet) works before sign-up. The account
  // is flagged `isGuest` and can be claimed later via /claim — same row, so no
  // data migration is needed.
  router.post('/guest', guestLimiter, async (_request: Request, response: Response) => {
    try {
      const secret = loadJwtSecret();
      const guestId = crypto.randomBytes(6).toString('hex');
      const email = `guest-${guestId}@${GUEST_EMAIL_DOMAIN}`;
      // Random throwaway password — guests authenticate only via their session
      // cookie; password login becomes possible after claiming the account.
      const passwordHash = await hashPassword(crypto.randomBytes(24).toString('base64url'));

      const orgDisplayName = `Guest Workspace ${guestId.slice(0, 4)}`;
      const slug = await allocateOrganizationSlug(async (s) => {
        const row = await prisma.organization.findUnique({ where: { slug: s } });
        return row !== null;
      }, orgDisplayName);

      const result = await prisma.$transaction(async (tx) => {
        const organization = await tx.organization.create({
          data: {
            name: orgDisplayName,
            slug,
            plan: TRIAL_PLAN_NAME,
            workspaceKind: 'individual',
          },
        });

        const user = await tx.user.create({
          data: {
            orgId: organization.id,
            email,
            displayName: 'Explorer',
            workspaceKind: 'individual',
            role: 'owner',
            passwordHash,
            isGuest: true,
          },
        });

        await tx.wallet.create({
          data: { userId: user.id, currency: 'USD', balance: 0 },
        });
        await tx.wallet.create({
          data: { orgId: organization.id, currency: 'USD', balance: 0 },
        });
        await tx.orgSubscription.create({
          data: trialSubscriptionCreateData(organization.id),
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
        organization: await sessionOrganizationPayload(result.organization, {
          email: result.user.email,
          isSuperAdmin: Boolean((result.user as { isSuperAdmin?: boolean }).isSuperAdmin),
        }),
      });
    } catch (error) {
      console.error('[auth/guest]', error);
      response.status(500).json({ error: { code: 'internal_error', message: 'Guest session failed' } });
    }
  });

  // Converts the current guest account into a real account in place — agents,
  // conversations, history, and wallets all stay attached to the same user row.
  router.post('/claim', authenticateUser(true), async (request: Request, response: Response) => {
    try {
      const body = claimSchema.parse(request.body);
      const auth = request.auth!;
      const email = normalizeEmail(body.email);

      if (email.endsWith(`@${GUEST_EMAIL_DOMAIN}`)) {
        response.status(400).json({
          error: { code: 'invalid_email', message: 'Choose a real email address for your account' },
        });
        return;
      }

      const user = await prisma.user.findUnique({
        where: { id: auth.userId },
        include: { organization: true },
      });
      if (!user || !user.isActive) {
        response.status(401).json({ error: { code: 'unauthorized', message: 'Account not found' } });
        return;
      }
      if (!user.isGuest) {
        response.status(400).json({
          error: { code: 'not_a_guest', message: 'This account is already a full account' },
        });
        return;
      }

      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        response.status(409).json({
          error: { code: 'email_taken', message: 'An account with this email already exists' },
        });
        return;
      }

      const passwordHash = await hashPassword(body.password);
      const label = body.displayName?.trim() || email.split('@')[0] || 'Workspace';
      const orgDisplayName = `${label}'s Workspace`;
      const slug = await allocateOrganizationSlug(async (s) => {
        const row = await prisma.organization.findUnique({ where: { slug: s } });
        return row !== null;
      }, orgDisplayName);

      const secret = loadJwtSecret();
      const result = await prisma.$transaction(async (tx) => {
        const updatedUser = await tx.user.update({
          where: { id: user.id },
          data: {
            email,
            passwordHash,
            displayName: body.displayName?.trim() ?? label,
            isGuest: false,
          },
        });

        const organization = await tx.organization.update({
          where: { id: user.orgId },
          data: { name: orgDisplayName, slug },
        });

        const token = signAuthToken(
          {
            sub: updatedUser.id,
            orgId: organization.id,
            email: updatedUser.email,
            role: updatedUser.role,
          },
          secret,
          SESSION_MAX_AGE_SEC,
        );

        return { user: updatedUser, organization, token };
      });

      sendAuthCookie(response, result.token);

      response.json({
        token: result.token,
        user: sessionUserPayload(result.user),
        organization: await sessionOrganizationPayload(result.organization, {
          email: result.user.email,
          isSuperAdmin: Boolean((result.user as { isSuperAdmin?: boolean }).isSuperAdmin),
        }),
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        response.status(400).json({
          error: { code: 'validation_error', message: 'Invalid input', details: error.flatten() },
        });
        return;
      }
      console.error('[auth/claim]', error);
      response.status(500).json({ error: { code: 'internal_error', message: 'Claim failed' } });
    }
  });

  router.post('/login', loginLimiter, async (request: Request, response: Response) => {
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

      if (!user.passwordHash) {
        response.status(401).json({
          error: {
            code: 'invalid_credentials',
            message: 'Incorrect email or password',
          },
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
        organization: await sessionOrganizationPayload(user.organization, {
          email: user.email,
          isSuperAdmin: user.isSuperAdmin,
        }),
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
        organization: await sessionOrganizationPayload(user.organization, {
          email: user.email,
          isSuperAdmin: user.isSuperAdmin,
        }),
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
        organization: await sessionOrganizationPayload(user.organization, {
          email: user.email,
          isSuperAdmin: user.isSuperAdmin,
        }),
      });
    } catch (error) {
      console.error('[auth/me]', error);
      response.status(500).json({ error: { code: 'internal_error', message: 'Failed to load session' } });
    }
  });

  router.post(
    '/change-password',
    changePasswordLimiter,
    authenticateUser(true),
    async (request: Request, response: Response) => {
      try {
        const auth = request.auth!;
        const parsed = changePasswordSchema.safeParse(request.body);
        if (!parsed.success) {
          response.status(400).json({
            error: { code: 'invalid_body', message: 'currentPassword and newPassword (min 8 chars) are required' },
          });
          return;
        }
        const { currentPassword, newPassword } = parsed.data;

        const user = await prisma.user.findUnique({ where: { id: auth.userId } });
        if (!user || !user.isActive) {
          response.status(401).json({ error: { code: 'unauthorized', message: 'Account not found' } });
          return;
        }

        if (!user.passwordHash) {
          response.status(400).json({
            error: {
              code: 'password_not_set',
              message: 'This account uses social sign-in and has no password to change',
            },
          });
          return;
        }

        const ok = await verifyPassword(currentPassword, user.passwordHash);
        if (!ok) {
          response.status(400).json({
            error: { code: 'invalid_current_password', message: 'Current password is incorrect' },
          });
          return;
        }

        const passwordHash = await hashPassword(newPassword);
        await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });

        response.json({ ok: true });
      } catch (error) {
        console.error('[auth/change-password]', error);
        response.status(500).json({ error: { code: 'internal_error', message: 'Failed to change password' } });
      }
    },
  );

  // ── Google / GitHub OAuth login (authorization-code; separate from Gmail connector OAuth) ──
  const oauthStartLimiter = authRateLimiter(20);

  router.get('/oauth/:provider/start', oauthStartLimiter, (request: Request, response: Response) => {
    try {
      const providerRaw = String(request.params.provider ?? '');
      if (!isOAuthLoginProvider(providerRaw)) {
        response.status(404).json({
          error: { code: 'unknown_provider', message: 'Supported providers: google, github' },
        });
        return;
      }

      const workspaceType =
        request.query.workspaceType === 'organization' ? 'organization' : 'individual';
      const inviteRaw = typeof request.query.invite === 'string' ? request.query.invite.trim() : '';
      const inviteToken = inviteRaw.length >= 24 ? inviteRaw : undefined;
      const nextRaw = typeof request.query.next === 'string' ? request.query.next.trim() : '';
      const next = nextRaw.startsWith('/') && !nextRaw.startsWith('//') ? nextRaw : undefined;

      if (inviteToken && workspaceType !== 'organization') {
        response.redirect(
          frontendAuthRedirect('/sign-in?error=invalid_invite_context&mode=sign-up&workspace=organization'),
        );
        return;
      }

      const state = mintOAuthLoginState({
        provider: providerRaw,
        workspaceType: inviteToken ? 'organization' : workspaceType,
        inviteToken,
        next,
      });
      const url = buildOAuthAuthorizeUrl(providerRaw, state);
      response.redirect(url);
    } catch (error) {
      if (error instanceof OAuthLoginNotConfiguredError) {
        response.redirect(frontendAuthRedirect(`/sign-in?error=${encodeURIComponent(error.code)}`));
        return;
      }
      console.error('[auth/oauth/start]', error);
      response.redirect(frontendAuthRedirect('/sign-in?error=oauth_failed'));
    }
  });

  router.get('/oauth/:provider/callback', async (request: Request, response: Response) => {
    const providerRaw = String(request.params.provider ?? '');
    const fail = (code: string) => {
      response.redirect(frontendAuthRedirect(`/sign-in?error=${encodeURIComponent(code)}`));
    };

    try {
      if (!isOAuthLoginProvider(providerRaw)) {
        fail('unknown_provider');
        return;
      }

      const oauthError = typeof request.query.error === 'string' ? request.query.error : '';
      if (oauthError) {
        fail(oauthError === 'access_denied' ? 'oauth_denied' : 'oauth_failed');
        return;
      }

      const code = typeof request.query.code === 'string' ? request.query.code : '';
      const state = typeof request.query.state === 'string' ? request.query.state : '';
      if (!code || !state) {
        fail('missing_code');
        return;
      }

      const claims = verifyOAuthLoginState(state);
      if (claims.provider !== providerRaw) {
        fail('invalid_state');
        return;
      }

      const profile = await exchangeOAuthCode(providerRaw, code);
      const session = await upsertOAuthUserSession(providerRaw, profile, {
        workspaceType: claims.workspaceType,
        inviteToken: claims.inviteToken,
        next: claims.next,
      });

      sendAuthCookie(response, session.token);

      const dest =
        session.next && session.next.startsWith('/') && !session.next.startsWith('//')
          ? session.next
          : consoleHomePathForOAuth(session.workspaceKind, session.isSuperAdmin);
      response.redirect(frontendAuthRedirect(dest));
    } catch (error) {
      if (error instanceof OAuthLoginNotConfiguredError) {
        fail(error.code);
        return;
      }
      if (error instanceof OAuthLoginError) {
        fail(error.code);
        return;
      }
      console.error('[auth/oauth/callback]', error);
      fail('oauth_failed');
    }
  });

  return router;
}
