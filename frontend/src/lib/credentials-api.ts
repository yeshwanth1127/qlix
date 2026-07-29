const defaultBase = "http://localhost:4000";

function apiBase(): string {
  return (process.env.NEXT_PUBLIC_API_BASE_URL ?? defaultBase).replace(/\/$/, "");
}

export interface CredentialRow {
  readonly id: string;
  readonly agentId: string | null;
  readonly agentName: string;
  readonly agentDid: string;
  readonly type: string;
  readonly issuedAt: string;
  readonly expiresAt: string | null;
  readonly revokedAt: string | null;
}

export interface CredentialsResponse {
  readonly platform: {
    readonly did: string;
    readonly publicKey: string;
  };
  readonly credentials: readonly CredentialRow[];
}

export async function getCredentials(): Promise<CredentialsResponse | null> {
  const response = await fetch(`${apiBase()}/api/v1/credentials`, {
    credentials: "include",
  });
  if (!response.ok) return null;
  return response.json() as Promise<CredentialsResponse>;
}
