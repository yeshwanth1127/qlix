import type { WorkspaceKind } from "./workspace";

const defaultBase = "http://localhost:4000";

function apiBase(): string {
  return (process.env.NEXT_PUBLIC_API_BASE_URL ?? defaultBase).replace(/\/$/, "");
}

export type SubscriptionStatus = "trialing" | "active" | "expired" | "canceled" | "past_due";
export type SubscriptionAccess = "allowed" | "required";

export interface OrgSubscriptionInfo {
  status: SubscriptionStatus;
  planName: string;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  /** `required` means the console should redirect to Subscriptions. */
  access: SubscriptionAccess;
}

export interface AuthSuccessResponse {
  user: {
    id: string;
    email: string;
    displayName: string | null;
    role: string;
    orgId: string;
    workspaceKind: WorkspaceKind;
    isSuperAdmin: boolean;
    /** True for auto-provisioned exploration accounts (claimable via /auth/claim). */
    isGuest: boolean;
    /** True when passkey enrollment is complete (derived server-side). */
    deviceVerified: boolean;
    /** True when the account is exempt from billing (no wallet debits). Derived server-side. */
    billingExempt: boolean;
  };
  organization: {
    id: string;
    name: string;
    slug: string;
    workspaceKind: WorkspaceKind;
    /** Matches `organizations.plan` (e.g. trial, free, starter). */
    plan: string;
    subscription: OrgSubscriptionInfo;
    /** Plugin ids enabled from the dashboard's Plugins page — drives which optional nav items show up. */
    enabledPluginIds: string[];
  };
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}

export async function postLogin(input: { email: string; password: string }): Promise<{
  ok: boolean;
  status: number;
  data?: AuthSuccessResponse;
  errorMessage?: string;
}> {
  try {
    const response = await fetch(`${apiBase()}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(input),
    });

    const status = response.status;
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
      return {
        ok: false,
        status,
        errorMessage: body?.error?.message ?? "Login failed",
      };
    }
    const data = (await response.json()) as AuthSuccessResponse;
    return { ok: true, status, data };
  } catch {
    return { ok: false, status: 0, errorMessage: "Network error — check your connection" };
  }
}

export async function postSignup(input: {
  email: string;
  password: string;
  displayName?: string;
  workspaceType: "individual" | "organization";
  inviteToken?: string;
}): Promise<{
  ok: boolean;
  status: number;
  data?: AuthSuccessResponse;
  errorMessage?: string;
}> {
  try {
    const response = await fetch(`${apiBase()}/api/v1/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(input),
    });

    const status = response.status;
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
      return {
        ok: false,
        status,
        errorMessage: body?.error?.message ?? "Sign up failed",
      };
    }
    const data = (await response.json()) as AuthSuccessResponse;
    return { ok: true, status, data };
  } catch {
    return { ok: false, status: 0, errorMessage: "Network error — check your connection" };
  }
}

export async function postSuperAdminSignup(input: {
  email: string;
  password: string;
  displayName?: string;
  bootstrapPassword: string;
}): Promise<{
  ok: boolean;
  status: number;
  data?: AuthSuccessResponse;
  errorMessage?: string;
}> {
  const response = await fetch(`${apiBase()}/api/v1/auth/super-admin/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
  });

  const status = response.status;
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
    return {
      ok: false,
      status,
      errorMessage: body?.error?.message ?? "Super admin sign up failed",
    };
  }
  const data = (await response.json()) as AuthSuccessResponse;
  return { ok: true, status, data };
}

/** Auto-creates a guest exploration account and sets the session cookie. */
export async function postGuestSession(): Promise<{
  ok: boolean;
  data?: AuthSuccessResponse;
  errorMessage?: string;
}> {
  try {
    const response = await fetch(`${apiBase()}/api/v1/auth/guest`, {
      method: "POST",
      credentials: "include",
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
      return { ok: false, errorMessage: body?.error?.message ?? "Could not start a guest session" };
    }
    const data = (await response.json()) as AuthSuccessResponse;
    return { ok: true, data };
  } catch {
    return { ok: false, errorMessage: "Network error — check your connection" };
  }
}

/** Converts the current guest account into a real account (same data, no migration). */
export async function postClaimAccount(input: {
  email: string;
  password: string;
  displayName?: string;
}): Promise<{
  ok: boolean;
  data?: AuthSuccessResponse;
  errorMessage?: string;
}> {
  try {
    const response = await fetch(`${apiBase()}/api/v1/auth/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
      return { ok: false, errorMessage: body?.error?.message ?? "Could not create your account" };
    }
    const data = (await response.json()) as AuthSuccessResponse;
    return { ok: true, data };
  } catch {
    return { ok: false, errorMessage: "Network error — check your connection" };
  }
}

export async function postChangePassword(input: {
  currentPassword: string;
  newPassword: string;
}): Promise<{ ok: boolean; errorMessage?: string }> {
  try {
    const response = await fetch(`${apiBase()}/api/v1/auth/change-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
      return { ok: false, errorMessage: body?.error?.message ?? "Could not change password" };
    }
    return { ok: true };
  } catch {
    return { ok: false, errorMessage: "Network error — check your connection" };
  }
}

export async function postSessionRefresh(): Promise<AuthSuccessResponse | null> {
  const response = await fetch(`${apiBase()}/api/v1/auth/refresh`, {
    method: "POST",
    credentials: "include",
  });
  if (response.status === 401) return null;
  if (!response.ok) return null;
  return response.json() as Promise<AuthSuccessResponse>;
}

export async function postLogout(): Promise<void> {
  await fetch(`${apiBase()}/api/v1/auth/logout`, {
    method: "POST",
    credentials: "include",
  });
}

export async function getSession(): Promise<AuthSuccessResponse | null> {
  try {
    const response = await fetch(`${apiBase()}/api/v1/auth/me`, {
      credentials: "include",
    });
    if (response.status === 401) return null;
    if (!response.ok) return null;
    return response.json() as Promise<AuthSuccessResponse>;
  } catch {
    return null;
  }
}

export type OAuthLoginProvider = "google" | "github";

/** Full-page redirect URL to begin Google / GitHub sign-in on the API. */
export function oauthStartUrl(
  provider: OAuthLoginProvider,
  opts?: {
    workspaceType?: "individual" | "organization";
    invite?: string | null;
    next?: string;
  },
): string {
  const params = new URLSearchParams();
  if (opts?.workspaceType) params.set("workspaceType", opts.workspaceType);
  if (opts?.invite?.trim()) params.set("invite", opts.invite.trim());
  if (opts?.next?.startsWith("/")) params.set("next", opts.next);
  const q = params.toString();
  return `${apiBase()}/api/v1/auth/oauth/${provider}/start${q ? `?${q}` : ""}`;
}

/** Human-readable messages for `?error=` codes returned by the OAuth callback. */
export function oauthErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  switch (code) {
    case "oauth_not_configured":
      return "Social sign-in is not configured on this server.";
    case "oauth_denied":
      return "Sign-in was cancelled.";
    case "oauth_failed":
    case "missing_code":
    case "invalid_state":
    case "provider_error":
    case "token_exchange_failed":
      return "Social sign-in failed. Please try again.";
    case "email_required":
    case "email_unverified":
      return "Your provider account must have a verified email address.";
    case "invite_email_mismatch":
      return "Sign in with the email address that received the invitation.";
    case "invalid_invite":
    case "invalid_invite_context":
      return "This invitation is invalid or expired.";
    case "account_inactive":
      return "This account is inactive.";
    case "unknown_provider":
      return "Unsupported sign-in provider.";
    default:
      return "Social sign-in failed. Please try again.";
  }
}
