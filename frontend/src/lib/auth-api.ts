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
