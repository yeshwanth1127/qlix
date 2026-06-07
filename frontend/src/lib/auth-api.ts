import type { WorkspaceKind } from "./workspace";

const defaultBase = "http://localhost:4000";

function apiBase(): string {
  return (process.env.NEXT_PUBLIC_API_BASE_URL ?? defaultBase).replace(/\/$/, "");
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
    /** Matches `organizations.plan` (e.g. free, starter, pro, enterprise). */
    plan: string;
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
