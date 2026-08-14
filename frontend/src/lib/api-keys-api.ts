const defaultBase = "http://localhost:4000";

function apiBase(): string {
  return (process.env.NEXT_PUBLIC_API_BASE_URL ?? defaultBase).replace(/\/$/, "");
}

export const API_KEY_SCOPE_OPTIONS = [
  { id: "agents:read", label: "Agents — read" },
  { id: "agents:write", label: "Agents — write" },
  { id: "audit:read", label: "Audit — read" },
  { id: "credentials:read", label: "Credentials — read" },
  { id: "runs:write", label: "Agent runs — write" },
  { id: "teams:read", label: "Teams — read" },
  { id: "teams:write", label: "Teams — write" },
  { id: "brain:read", label: "AI Brain — read" },
  { id: "brain:write", label: "AI Brain — write" },
  { id: "builder:read", label: "AI Builder — read" },
  { id: "builder:write", label: "AI Builder — write" },
  { id: "jit:decide", label: "JIT — decide" },
  { id: "usage:read", label: "Usage — read" },
] as const;

export type ApiKeyScopeId = (typeof API_KEY_SCOPE_OPTIONS)[number]["id"];

export interface ApiKeyRow {
  readonly id: string;
  readonly label: string;
  readonly keyPrefix: string;
  readonly scopes: string[];
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
  readonly revokedAt: string | null;
}

export interface ListApiKeysResult {
  readonly keys: ApiKeyRow[];
  readonly availableScopes: string[];
  readonly canManage: boolean;
}

export async function listApiKeys(): Promise<ListApiKeysResult | null> {
  const response = await fetch(`${apiBase()}/api/v1/api-keys`, { credentials: "include" });
  if (!response.ok) return null;
  const data = (await response.json()) as ListApiKeysResult;
  return data;
}

export async function createApiKey(
  label: string,
  scopes: string[],
): Promise<{ ok: true; key: string; row: ApiKeyRow } | { ok: false; errorMessage: string }> {
  try {
    const response = await fetch(`${apiBase()}/api/v1/api-keys`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ label, scopes }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
      return { ok: false, errorMessage: body?.error?.message ?? "Could not create API key" };
    }
    const data = (await response.json()) as {
      id: string;
      label: string;
      key: string;
      keyPrefix: string;
      scopes: string[];
      createdAt: string;
    };
    return {
      ok: true,
      key: data.key,
      row: {
        id: data.id,
        label: data.label,
        keyPrefix: data.keyPrefix,
        scopes: data.scopes,
        createdAt: data.createdAt,
        lastUsedAt: null,
        revokedAt: null,
      },
    };
  } catch {
    return { ok: false, errorMessage: "Network error — check your connection" };
  }
}

export async function revokeApiKey(id: string): Promise<boolean> {
  const response = await fetch(`${apiBase()}/api/v1/api-keys/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "include",
  });
  return response.ok;
}

export function developerApiBaseUrl(): string {
  return apiBase();
}
