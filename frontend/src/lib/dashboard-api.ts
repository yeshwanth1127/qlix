import type { WorkspaceKind } from "./workspace";

const defaultBase = "http://localhost:4000";

function apiBase(): string {
  return (process.env.NEXT_PUBLIC_API_BASE_URL ?? defaultBase).replace(/\/$/, "");
}

export type AuditActionType = "READ" | "WRITE" | "AUTH";
export type AuditResultUi = "Success" | "Blocked" | "Flagged";

export interface DashboardAgentRow {
  readonly id: string;
  readonly name: string;
  readonly didShort: string;
  readonly actionsToday: number;
  readonly status: "online" | "idle" | "offline";
  readonly statusDetail: string;
}

export interface DashboardAuditEvent {
  readonly id: string;
  readonly timeIst: string;
  readonly agentName: string;
  readonly action: AuditActionType;
  readonly result: AuditResultUi;
  readonly description: string;
}

export type DashboardMetrics =
  | {
      readonly kind: "individual";
      readonly activeAgents: number;
      readonly agentsOnline: number;
      readonly actionsToday: number;
      readonly actionsVsYesterdayPercent: number | null;
      readonly credentialsValid: number;
    }
  | {
      readonly kind: "organization";
      readonly registeredAgents: number;
      readonly agentsActiveToday: number;
      readonly actionsThisWeek: number;
      readonly actionsWeekOverWeekPercent: number | null;
      readonly policyViolations: number;
    };

export interface DashboardHomeResponse {
  readonly workspaceKind: WorkspaceKind;
  readonly organization: {
    readonly id: string;
    readonly name: string;
    readonly slug: string;
    readonly workspaceKind: WorkspaceKind;
  };
  readonly user: {
    readonly id: string;
    readonly email: string;
    readonly displayName: string | null;
    readonly role: string;
  };
  readonly metrics: DashboardMetrics;
  readonly agents: DashboardAgentRow[];
  readonly auditEvents: DashboardAuditEvent[];
}

export async function getDashboardHome(): Promise<DashboardHomeResponse | null> {
  const response = await fetch(`${apiBase()}/api/v1/dashboard/home`, {
    credentials: "include",
  });
  if (response.status === 401) return null;
  if (!response.ok) return null;
  return response.json() as Promise<DashboardHomeResponse>;
}

export type AuditRiskLevel = "low" | "medium" | "high";

export interface AuditLogEvent {
  readonly id: string;
  readonly timestampMs: number;
  readonly timeIst: string;
  readonly dateIst: string;
  readonly actionType: string;
  readonly action: AuditActionType;
  readonly result: AuditResultUi;
  readonly riskLevel: AuditRiskLevel;
  readonly approvalStatus: string;
  readonly surface: string | null;
  readonly description: string;
}

export interface AuditAgentGroup {
  readonly agentId: string;
  readonly agentName: string;
  readonly didShort: string;
  readonly agentKind: string;
  readonly eventCount: number;
  readonly events: AuditLogEvent[];
}

export interface AuditLogResponse {
  readonly totalEvents: number;
  readonly limit: number;
  readonly truncated: boolean;
  readonly groups: AuditAgentGroup[];
}

export async function getAuditLog(limit = 1000): Promise<AuditLogResponse | null> {
  const url = new URL(`${apiBase()}/api/v1/dashboard/audit`);
  url.searchParams.set("limit", String(limit));
  const response = await fetch(url.toString(), { credentials: "include" });
  if (response.status === 401) return null;
  if (!response.ok) return null;
  return response.json() as Promise<AuditLogResponse>;
}
