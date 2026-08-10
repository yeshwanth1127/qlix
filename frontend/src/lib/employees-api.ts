import type { AgentDTO } from "./agents-api";
import type { ApiErrorBody } from "./auth-api";

const defaultBase = "http://localhost:4000";

function apiBase(): string {
  return (process.env.NEXT_PUBLIC_API_BASE_URL ?? defaultBase).replace(/\/$/, "");
}

async function parseJson<T>(response: Response): Promise<T | ApiErrorBody> {
  return response.json() as Promise<T | ApiErrorBody>;
}

export type EmployeeRoleSlug =
  | "sales-executive"
  | "accountant"
  | "receptionist"
  | "recruiter"
  | "customer-support"
  | "hr-manager";

export type ConnectorProvider =
  | "google"
  | "whatsapp_baileys"
  | "orbit"
  | "zoho"
  | "slack"
  | "discord"
  | "github"
  | "telegram";

export interface PlatformSuggestion {
  platformId: string;
  reason: string;
}

export interface RoleCatalogEntry {
  slug: EmployeeRoleSlug;
  version: string;
  status: string;
  label: string;
  mission: string;
  outcomes: Array<{
    id: string;
    title: string;
    doneLooksLike: string;
    available: boolean;
    limitation?: string;
  }>;
  connectorsRequired: ConnectorProvider[];
  connectorsOptional: ConnectorProvider[];
  knowledgeRequirements: Array<{ id: string; label: string; required: boolean }>;
  platformSuggestions: PlatformSuggestion[];
  hireable: boolean;
  hireMode: "full" | "limited" | "unavailable";
  limitationSummary?: string;
}

export interface PreflightResult {
  readiness: "ready" | "needs_connector" | "needs_capability" | "needs_knowledge";
  roleSlug: EmployeeRoleSlug;
  packVersion: string;
  hireMode: "full" | "limited" | "unavailable";
  resolvedScopes: string[];
  resolvedJitScopes: string[];
  resolvedRuntime: string;
  connectorsRequired: ConnectorProvider[];
  connectorsConnected: ConnectorProvider[];
  connectorsMissing: ConnectorProvider[];
  missingCapabilityScopes: string[];
  missingKnowledge: Array<{ id: string; label: string; required: boolean }>;
  selectedPlatformIds: string[];
  soonPlatformIds: string[];
  messages: string[];
}

export interface EmployeeEngagementDTO {
  id: string;
  agentId: string;
  workspaceOrgId: string;
  roleSlug: EmployeeRoleSlug;
  packVersion: string;
  packHash: string;
  status: "active" | "suspended" | "replaced" | "archived";
  hiredAt: string;
  agent: AgentDTO;
  packSnapshot: {
    label: string;
    mission: string;
    outcomes: RoleCatalogEntry["outcomes"];
    playbooks: Array<{ id: string; title: string; steps: string[] }>;
  };
}

export async function listEmployeeRoles(): Promise<RoleCatalogEntry[]> {
  const res = await fetch(`${apiBase()}/api/v1/employees/roles`, { credentials: "include" });
  const data = await parseJson<{ roles: RoleCatalogEntry[] }>(res);
  if (!res.ok) {
    const err = data as ApiErrorBody;
    throw new Error(err.error?.message ?? "Failed to load roles");
  }
  return (data as { roles: RoleCatalogEntry[] }).roles;
}

export async function getEmployeeRole(slug: string): Promise<{
  role: RoleCatalogEntry;
  manifest: Record<string, unknown>;
}> {
  const res = await fetch(`${apiBase()}/api/v1/employees/roles/${encodeURIComponent(slug)}`, {
    credentials: "include",
  });
  const data = await parseJson<{ role: RoleCatalogEntry; manifest: Record<string, unknown> }>(res);
  if (!res.ok) {
    const err = data as ApiErrorBody;
    throw new Error(err.error?.message ?? "Failed to load role");
  }
  return data as { role: RoleCatalogEntry; manifest: Record<string, unknown> };
}

export async function preflightEmployeeHire(
  roleSlug: string,
  selectedPlatformIds: string[] = [],
): Promise<PreflightResult> {
  const res = await fetch(`${apiBase()}/api/v1/employees/preflight`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roleSlug, selectedPlatformIds }),
  });
  const data = await parseJson<{ preflight: PreflightResult }>(res);
  if (!res.ok) {
    const err = data as ApiErrorBody;
    throw new Error(err.error?.message ?? "Preflight failed");
  }
  return (data as { preflight: PreflightResult }).preflight;
}

export async function listEmployeeEngagements(): Promise<EmployeeEngagementDTO[]> {
  const res = await fetch(`${apiBase()}/api/v1/employees`, { credentials: "include" });
  const data = await parseJson<{ engagements: EmployeeEngagementDTO[] }>(res);
  if (!res.ok) {
    const err = data as ApiErrorBody;
    throw new Error(err.error?.message ?? "Failed to load employees");
  }
  return (data as { engagements: EmployeeEngagementDTO[] }).engagements;
}

export async function hireEmployee(body: {
  roleSlug: string;
  name?: string;
  limitedMode?: boolean;
  selectedPlatformIds?: string[];
}): Promise<{ engagement: EmployeeEngagementDTO }> {
  const res = await fetch(`${apiBase()}/api/v1/employees/hire`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await parseJson<{ engagement: EmployeeEngagementDTO }>(res);
  if (!res.ok) {
    const err = data as ApiErrorBody;
    throw new Error(err.error?.message ?? "Hire failed");
  }
  return data as { engagement: EmployeeEngagementDTO };
}

export async function getEmployeeEngagement(id: string): Promise<EmployeeEngagementDTO> {
  const res = await fetch(`${apiBase()}/api/v1/employees/${encodeURIComponent(id)}`, {
    credentials: "include",
  });
  const data = await parseJson<{ engagement: EmployeeEngagementDTO }>(res);
  if (!res.ok) {
    const err = data as ApiErrorBody;
    throw new Error(err.error?.message ?? "Failed to load employee");
  }
  return (data as { engagement: EmployeeEngagementDTO }).engagement;
}

const CONNECTOR_LABELS: Record<ConnectorProvider, string> = {
  google: "Google",
  zoho: "Zoho CRM",
  whatsapp_baileys: "WhatsApp",
  orbit: "Orbit",
  slack: "Slack",
  discord: "Discord",
  github: "GitHub",
  telegram: "Telegram",
};

export function connectorLabel(provider: ConnectorProvider): string {
  return CONNECTOR_LABELS[provider] ?? provider;
}
