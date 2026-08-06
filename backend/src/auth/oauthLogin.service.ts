import jwt from 'jsonwebtoken';
import { loadJwtSecret } from '../middleware/authenticateUser.js';
import { hashInviteToken } from '../lib/inviteToken.js';
import { prisma } from '../lib/prisma.js';
import { allocateOrganizationSlug } from '../lib/slug.js';
import { signAuthToken } from '../lib/authTokens.js';
import { SESSION_MAX_AGE_SEC } from '../lib/authCookie.js';
import { trialSubscriptionCreateData, TRIAL_PLAN_NAME } from '../billings/lib/trialSubscription.js';

export type OAuthLoginProvider = 'google' | 'github';

export class OAuthLoginNotConfiguredError extends Error {
  readonly code = 'oauth_not_configured';
  constructor(provider: OAuthLoginProvider) {
    super(`${provider} login OAuth is not configured`);
    this.name = 'OAuthLoginNotConfiguredError';
  }
}

export class OAuthLoginError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'OAuthLoginError';
    this.code = code;
  }
}

export interface OAuthLoginStateClaims {
  provider: OAuthLoginProvider;
  workspaceType: 'individual' | 'organization';
  inviteToken?: string;
  next?: string;
}

export interface OAuthProfile {
  providerAccountId: string;
  email: string;
  displayName: string | null;
  emailVerified: boolean;
}

interface ProviderClientConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';
const GITHUB_AUTH_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_USER_URL = 'https://api.github.com/user';
const GITHUB_EMAILS_URL = 'https://api.github.com/user/emails';

const LOGIN_SCOPES_GOOGLE = 'openid email profile';
const LOGIN_SCOPES_GITHUB = 'read:user user:email';

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function googleLoginConfig(): ProviderClientConfig {
  const clientId = process.env.AUTH_GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.AUTH_GOOGLE_CLIENT_SECRET?.trim();
  const redirectUri = process.env.AUTH_GOOGLE_REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !redirectUri) {
    throw new OAuthLoginNotConfiguredError('google');
  }
  return { clientId, clientSecret, redirectUri };
}

function githubLoginConfig(): ProviderClientConfig {
  const clientId = process.env.AUTH_GITHUB_CLIENT_ID?.trim();
  const clientSecret = process.env.AUTH_GITHUB_CLIENT_SECRET?.trim();
  const redirectUri = process.env.AUTH_GITHUB_REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !redirectUri) {
    throw new OAuthLoginNotConfiguredError('github');
  }
  return { clientId, clientSecret, redirectUri };
}

export function isOAuthLoginProvider(value: string): value is OAuthLoginProvider {
  return value === 'google' || value === 'github';
}

export function mintOAuthLoginState(claims: OAuthLoginStateClaims): string {
  const secret = loadJwtSecret();
  return jwt.sign(
    {
      qlixOAuth: 'login',
      provider: claims.provider,
      workspaceType: claims.workspaceType,
      ...(claims.inviteToken ? { inviteToken: claims.inviteToken } : {}),
      ...(claims.next ? { next: claims.next } : {}),
    },
    secret,
    { expiresIn: 600, issuer: 'qlix-backend', algorithm: 'HS256' },
  );
}

export function verifyOAuthLoginState(state: string): OAuthLoginStateClaims {
  const secret = loadJwtSecret();
  const decoded = jwt.verify(state, secret, { issuer: 'qlix-backend', algorithms: ['HS256'] });
  if (typeof decoded !== 'object' || decoded === null) {
    throw new OAuthLoginError('invalid_state', 'Invalid OAuth state');
  }
  const record = decoded as Record<string, unknown>;
  if (record.qlixOAuth !== 'login') {
    throw new OAuthLoginError('invalid_state', 'Invalid OAuth state purpose');
  }
  if (record.provider !== 'google' && record.provider !== 'github') {
    throw new OAuthLoginError('invalid_state', 'Invalid OAuth provider in state');
  }
  const workspaceType =
    record.workspaceType === 'organization' ? 'organization' : 'individual';
  const inviteToken =
    typeof record.inviteToken === 'string' && record.inviteToken.length > 0
      ? record.inviteToken
      : undefined;
  const next = typeof record.next === 'string' && record.next.startsWith('/') ? record.next : undefined;
  return {
    provider: record.provider,
    workspaceType,
    inviteToken,
    next,
  };
}

export function buildOAuthAuthorizeUrl(provider: OAuthLoginProvider, state: string): string {
  if (provider === 'google') {
    const { clientId, redirectUri } = googleLoginConfig();
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: LOGIN_SCOPES_GOOGLE,
      access_type: 'online',
      prompt: 'select_account',
      state,
    });
    return `${GOOGLE_AUTH_URL}?${params.toString()}`;
  }

  const { clientId, redirectUri } = githubLoginConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: LOGIN_SCOPES_GITHUB,
    state,
  });
  return `${GITHUB_AUTH_URL}?${params.toString()}`;
}

async function fetchJson(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const resp = await fetch(url, init);
  const text = await resp.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    body = { raw: text };
  }
  if (!resp.ok) {
    throw new OAuthLoginError(
      'provider_error',
      `OAuth provider error ${resp.status}: ${text.slice(0, 300)}`,
    );
  }
  return body;
}

async function exchangeGoogleCode(code: string): Promise<OAuthProfile> {
  const { clientId, clientSecret, redirectUri } = googleLoginConfig();
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });
  const tokenResp = await fetchJson(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const accessToken = String(tokenResp.access_token ?? '');
  if (!accessToken) {
    throw new OAuthLoginError('token_exchange_failed', 'Google did not return an access token');
  }

  const info = await fetchJson(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const email = typeof info.email === 'string' ? normalizeEmail(info.email) : '';
  const providerAccountId = typeof info.id === 'string' ? info.id : String(info.id ?? '');
  if (!email || !providerAccountId) {
    throw new OAuthLoginError('email_required', 'Google account did not provide a usable email');
  }
  const emailVerified = info.verified_email === true || info.email_verified === true;
  if (!emailVerified) {
    throw new OAuthLoginError('email_unverified', 'Google email is not verified');
  }
  const displayName =
    typeof info.name === 'string' && info.name.trim() ? info.name.trim() : null;
  return { providerAccountId, email, displayName, emailVerified: true };
}

async function exchangeGithubCode(code: string): Promise<OAuthProfile> {
  const { clientId, clientSecret, redirectUri } = githubLoginConfig();
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
  });
  const tokenResp = await fetchJson(GITHUB_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  });
  const accessToken = String(tokenResp.access_token ?? '');
  if (!accessToken) {
    throw new OAuthLoginError('token_exchange_failed', 'GitHub did not return an access token');
  }

  const user = await fetchJson(GITHUB_USER_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Qlix',
    },
  });
  const providerAccountId = String(user.id ?? '');
  if (!providerAccountId || providerAccountId === 'undefined') {
    throw new OAuthLoginError('provider_error', 'GitHub did not return a user id');
  }

  let email =
    typeof user.email === 'string' && user.email.trim()
      ? normalizeEmail(user.email)
      : '';
  let emailVerified = Boolean(email);

  if (!email) {
    const emailsResp = await fetch(GITHUB_EMAILS_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Qlix',
      },
    });
    const emailsText = await emailsResp.text();
    if (!emailsResp.ok) {
      throw new OAuthLoginError(
        'email_required',
        'Could not read GitHub email addresses for this account',
      );
    }
    let emails: Array<Record<string, unknown>> = [];
    try {
      emails = JSON.parse(emailsText) as Array<Record<string, unknown>>;
    } catch {
      emails = [];
    }
    const primaryVerified = emails.find(
      (row) => row.primary === true && row.verified === true && typeof row.email === 'string',
    );
    const anyVerified = emails.find(
      (row) => row.verified === true && typeof row.email === 'string',
    );
    const chosen = primaryVerified ?? anyVerified;
    if (chosen && typeof chosen.email === 'string') {
      email = normalizeEmail(chosen.email);
      emailVerified = true;
    }
  }

  if (!email || !emailVerified) {
    throw new OAuthLoginError(
      'email_required',
      'GitHub account has no verified email. Add a verified email on GitHub and try again.',
    );
  }

  const displayName =
    (typeof user.name === 'string' && user.name.trim() ? user.name.trim() : null) ??
    (typeof user.login === 'string' && user.login.trim() ? user.login.trim() : null);

  return { providerAccountId, email, displayName, emailVerified: true };
}

export async function exchangeOAuthCode(
  provider: OAuthLoginProvider,
  code: string,
): Promise<OAuthProfile> {
  if (provider === 'google') return exchangeGoogleCode(code);
  return exchangeGithubCode(code);
}

export interface OAuthSessionResult {
  token: string;
  workspaceKind: 'individual' | 'organization';
  isSuperAdmin: boolean;
  next?: string;
}

/**
 * Find or create a user for the OAuth profile, link OAuthAccount, and return a session JWT.
 */
export async function upsertOAuthUserSession(
  provider: OAuthLoginProvider,
  profile: OAuthProfile,
  options: {
    workspaceType: 'individual' | 'organization';
    inviteToken?: string;
    next?: string;
  },
): Promise<OAuthSessionResult> {
  const secret = loadJwtSecret();
  const email = normalizeEmail(profile.email);

  const existingLink = await prisma.oAuthAccount.findUnique({
    where: {
      provider_providerAccountId: {
        provider,
        providerAccountId: profile.providerAccountId,
      },
    },
    include: { user: true },
  });

  if (existingLink) {
    if (!existingLink.user.isActive) {
      throw new OAuthLoginError('account_inactive', 'This account is inactive');
    }
    const token = signAuthToken(
      {
        sub: existingLink.user.id,
        orgId: existingLink.user.orgId,
        email: existingLink.user.email,
        role: existingLink.user.role,
      },
      secret,
      SESSION_MAX_AGE_SEC,
    );
    return {
      token,
      workspaceKind:
        existingLink.user.workspaceKind === 'organization' ? 'organization' : 'individual',
      isSuperAdmin: existingLink.user.isSuperAdmin,
      next: options.next,
    };
  }

  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    if (!existingUser.isActive) {
      throw new OAuthLoginError('account_inactive', 'This account is inactive');
    }
    await prisma.oAuthAccount.create({
      data: {
        userId: existingUser.id,
        provider,
        providerAccountId: profile.providerAccountId,
        email,
      },
    });
    const token = signAuthToken(
      {
        sub: existingUser.id,
        orgId: existingUser.orgId,
        email: existingUser.email,
        role: existingUser.role,
      },
      secret,
      SESSION_MAX_AGE_SEC,
    );
    return {
      token,
      workspaceKind:
        existingUser.workspaceKind === 'organization' ? 'organization' : 'individual',
      isSuperAdmin: existingUser.isSuperAdmin,
      next: options.next,
    };
  }

  // New user — invite or fresh workspace.
  if (options.inviteToken) {
    if (options.workspaceType !== 'organization') {
      throw new OAuthLoginError(
        'invalid_invite_context',
        'Invited sign-up requires workspace type organization',
      );
    }
    const tokenHash = hashInviteToken(options.inviteToken);
    const invitation = await prisma.organizationInvitation.findFirst({
      where: {
        tokenHash,
        status: 'pending',
        expiresAt: { gt: new Date() },
      },
      include: { organization: true },
    });
    if (!invitation) {
      throw new OAuthLoginError('invalid_invite', 'Invalid or expired invitation');
    }
    if (normalizeEmail(invitation.email) !== email) {
      throw new OAuthLoginError(
        'invite_email_mismatch',
        'OAuth email must match the invitation email',
      );
    }
    if (invitation.organization.workspaceKind !== 'organization') {
      throw new OAuthLoginError('invalid_invite', 'Invitation is not for an organization workspace');
    }

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          orgId: invitation.orgId,
          email,
          displayName: profile.displayName,
          workspaceKind: 'organization',
          role: invitation.role,
          passwordHash: null,
        },
      });
      await tx.organizationInvitation.update({
        where: { id: invitation.id },
        data: { status: 'accepted' },
      });
      await tx.wallet.create({
        data: { userId: user.id, currency: 'USD', balance: 0 },
      });
      await tx.oAuthAccount.create({
        data: {
          userId: user.id,
          provider,
          providerAccountId: profile.providerAccountId,
          email,
        },
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
      return { user, token };
    });

    return {
      token: result.token,
      workspaceKind: 'organization',
      isSuperAdmin: false,
      next: options.next,
    };
  }

  const workspaceType = options.workspaceType;
  const label = profile.displayName?.trim() || email.split('@')[0] || 'Workspace';
  const orgDisplayName =
    workspaceType === 'organization' ? `${label}'s Organization` : `${label}'s Workspace`;

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
        workspaceKind: workspaceType,
      },
    });
    const user = await tx.user.create({
      data: {
        orgId: organization.id,
        email,
        displayName: profile.displayName,
        workspaceKind: workspaceType,
        role: 'owner',
        passwordHash: null,
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
    await tx.oAuthAccount.create({
      data: {
        userId: user.id,
        provider,
        providerAccountId: profile.providerAccountId,
        email,
      },
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
    return { user, token, workspaceType };
  });

  return {
    token: result.token,
    workspaceKind: result.workspaceType,
    isSuperAdmin: false,
    next: options.next,
  };
}

export function consoleHomePathForOAuth(
  workspaceKind: 'individual' | 'organization',
  isSuperAdmin: boolean,
): string {
  if (isSuperAdmin) return '/admin/overview';
  return workspaceKind === 'individual' ? '/individual/agent-builder' : '/organization/agent-builder';
}

export function frontendAuthRedirect(path: string): string {
  const base = process.env.FRONTEND_URL?.trim() || 'http://localhost:3000';
  return `${base.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
}
