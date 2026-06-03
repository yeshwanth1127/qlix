import type { WorkspaceKind } from "./workspace";

const defaultBase = "http://localhost:4000";

function apiBase(): string {
  return (process.env.NEXT_PUBLIC_API_BASE_URL ?? defaultBase).replace(/\/$/, "");
}

export interface PassportRow {
  readonly agentId: string;
  readonly name: string;
  readonly did: string;
  readonly didShort: string;
  readonly publicKeyFull: string;
  readonly publicKeyShort: string;
  readonly status: string;
  readonly credentialsIssued: number;
  readonly createdAt: string;
  readonly lastActiveAt: string | null;
}

export interface PassportsOverviewResponse {
  readonly workspaceKind: WorkspaceKind;
  readonly organization: {
    readonly id: string;
    readonly name: string;
    readonly slug: string;
  };
  readonly passports: readonly PassportRow[];
}

export async function getPassportsOverview(): Promise<PassportsOverviewResponse | null> {
  const response = await fetch(`${apiBase()}/api/v1/passports`, {
    credentials: "include",
  });
  if (response.status === 401) return null;
  if (!response.ok) return null;
  return response.json() as Promise<PassportsOverviewResponse>;
}
