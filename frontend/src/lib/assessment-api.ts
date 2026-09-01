const defaultBase = "http://localhost:4000";

function apiBase(): string {
  return (process.env.NEXT_PUBLIC_API_BASE_URL ?? defaultBase).replace(/\/$/, "");
}

export const STUDENT_PROJECT_RECIPE_ID = "student_project_assessment.v1";

export interface ChecklistItemDTO {
  id: string;
  text: string;
}

export interface WorkSessionDTO {
  id: string;
  orgId: string;
  recipeId: string;
  subjectUserId: string | null;
  subjectRef: string;
  status: string;
  teamId: string | null;
  frameworkId: string | null;
  reviewProcessId: string | null;
  metadata: Record<string, unknown>;
  consentGrantedAt: string | null;
  startedAt: string;
  submittedAt: string | null;
  closedAt: string | null;
  projectDescription: string | null;
  expectedStack: string[];
  windowStartsAt: string | null;
  windowEndsAt: string | null;
  aiUsagePolicy: string | null;
  checklist: ChecklistItemDTO[];
  requiredDeliverables: string[];
}

export interface DeviceCodeDTO {
  code: string;
  expiresAt: string;
}

export interface DeviceGrantDTO {
  id: string;
  deviceLabel: string;
  workspaceRoot: string;
  expiresAt: string;
  revokedAt: string | null;
  lastSeenAt: string | null;
  createdAt: string;
}

export type EvidenceKind =
  | "file_snapshot"
  | "git_event"
  | "terminal_event"
  | "dependency_event"
  | "test_result"
  | "build_result"
  | "lint_result"
  | "ai_prompt"
  | "artifact_upload"
  | "manual_note";

export interface EvidenceRecordDTO {
  id: string;
  sessionId: string;
  kind: EvidenceKind;
  source: string;
  occurredAt: string;
  payload: Record<string, unknown>;
  contentRef: string | null;
  redacted: boolean;
  ingestedAt: string;
}

async function jsonOrNull<T>(res: Response): Promise<T | null> {
  if (!res.ok) return null;
  return (await res.json()) as T;
}

export async function listSessions(): Promise<WorkSessionDTO[] | null> {
  const res = await fetch(`${apiBase()}/api/v1/assessment/sessions`, { credentials: "include" });
  const body = await jsonOrNull<{ sessions: WorkSessionDTO[] }>(res);
  return body?.sessions ?? null;
}

export async function getSession(
  id: string,
): Promise<{ session: WorkSessionDTO; deviceGrants: DeviceGrantDTO[] } | null> {
  const res = await fetch(`${apiBase()}/api/v1/assessment/sessions/${encodeURIComponent(id)}`, {
    credentials: "include",
  });
  return jsonOrNull<{ session: WorkSessionDTO; deviceGrants: DeviceGrantDTO[] }>(res);
}

export async function listEvidence(sessionId: string): Promise<EvidenceRecordDTO[] | null> {
  const res = await fetch(`${apiBase()}/api/v1/assessment/sessions/${encodeURIComponent(sessionId)}/evidence`, {
    credentials: "include",
  });
  const body = await jsonOrNull<{ evidence: EvidenceRecordDTO[] }>(res);
  return body?.evidence ?? null;
}

export async function getArtifact(
  sessionId: string,
  evidenceId: string,
): Promise<EvidenceRecordDTO | null> {
  const res = await fetch(
    `${apiBase()}/api/v1/assessment/sessions/${encodeURIComponent(sessionId)}/evidence/${encodeURIComponent(evidenceId)}/artifact`,
    { credentials: "include" },
  );
  const body = await jsonOrNull<{ artifact: EvidenceRecordDTO }>(res);
  return body?.artifact ?? null;
}

export async function createSession(input: {
  subjectRef: string;
  recipeId?: string;
  projectDescription?: string;
  expectedStack?: string[];
  windowStartsAt?: string;
  windowEndsAt?: string;
  aiUsagePolicy?: string;
  checklist?: ChecklistItemDTO[];
  requiredDeliverables?: string[];
}): Promise<WorkSessionDTO | null> {
  const res = await fetch(`${apiBase()}/api/v1/assessment/sessions`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipeId: input.recipeId ?? STUDENT_PROJECT_RECIPE_ID,
      subjectRef: input.subjectRef,
      projectDescription: input.projectDescription || undefined,
      expectedStack: input.expectedStack?.length ? input.expectedStack : undefined,
      windowStartsAt: input.windowStartsAt || undefined,
      windowEndsAt: input.windowEndsAt || undefined,
      aiUsagePolicy: input.aiUsagePolicy || undefined,
      checklist: input.checklist?.length ? input.checklist : undefined,
      requiredDeliverables: input.requiredDeliverables?.length ? input.requiredDeliverables : undefined,
    }),
  });
  const body = await jsonOrNull<{ session: WorkSessionDTO }>(res);
  return body?.session ?? null;
}

export async function generateDeviceCode(sessionId: string): Promise<DeviceCodeDTO | null> {
  const res = await fetch(`${apiBase()}/api/v1/assessment/sessions/${encodeURIComponent(sessionId)}/device-code`, {
    method: "POST",
    credentials: "include",
  });
  return jsonOrNull<DeviceCodeDTO>(res);
}

export function extensionDownloadUrl(): string {
  return `${apiBase()}/api/v1/assessment/extension/download`;
}
