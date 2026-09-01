import type { PermissionScope } from "./agents-api";
import type { ApiErrorBody } from "./auth-api";

const defaultBase = "http://localhost:4000";
function apiBase(): string {
  return (process.env.NEXT_PUBLIC_API_BASE_URL ?? defaultBase).replace(/\/$/, "");
}

// ── Types mirrored from backend nlTypes.ts ────────────────────────────────

export interface NLAgentSpec {
  name: string;
  description: string;
  permissionScopes: PermissionScope[];
  jitScopes: PermissionScope[];
  runtime: "cloud" | "hybrid" | "local";
  model: string;
  llmMode: "proxy" | "direct";
  localInferenceMode: "local_llm" | "cloud_api" | null;
  rationale: string;
}

export interface NLWorkerSpec extends NLAgentSpec {
  role: string;
  stageOrder: number;
}

export interface NLTeamSpec {
  name: string;
  description: string;
  supervisor: NLAgentSpec;
  workers: NLWorkerSpec[];
  config: {
    maxParallelWorkers: number;
    subtaskTimeoutMs: number;
    retryPolicy: "none" | "once" | "twice";
  };
}

export type AgentCreationPlan =
  | { type: "single"; agent: NLAgentSpec; rationale: string }
  | { type: "team"; team: NLTeamSpec; rationale: string };

// ── API calls ─────────────────────────────────────────────────────────────

export interface BuilderHistoryEntry {
  id: string;
  prompt: string;
  createdAt: string;
}

export async function fetchBuilderHistory(): Promise<BuilderHistoryEntry[]> {
  try {
    const res = await fetch(`${apiBase()}/api/v1/nl-builder/history`, {
      credentials: "include",
    });
    if (!res.ok) return [];
    const body = (await res.json().catch(() => null)) as { entries?: BuilderHistoryEntry[] } | null;
    return body?.entries ?? [];
  } catch {
    return [];
  }
}

export async function saveBuilderPrompt(prompt: string): Promise<void> {
  try {
    await fetch(`${apiBase()}/api/v1/nl-builder/history`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ prompt }),
    });
  } catch {
    // best-effort
  }
}

// ── Builder chat sessions (full history) ───────────────────────────────────

export interface NlBuilderSessionSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  createdAgentIds: string[];
  teamId: string | null;
}

export interface NlBuilderSessionDetail extends NlBuilderSessionSummary {
  transcript: unknown[];
  phase?: BuilderPhase;
  stateVersion?: number;
  requirements?: BuilderRequirementsState;
  readiness?: BuilderReadinessState;
  rollingSummary?: string;
}

export type BuilderPhase =
  | "discovering"
  | "ready"
  | "planning"
  | "reviewing"
  | "creating"
  | "completed"
  | "archived";

export interface BuilderRequirementFact {
  key: string;
  category: string;
  value: unknown;
  confidence: number;
  sourceMessageId: string;
}

export interface BuilderRequirementsState {
  facts: BuilderRequirementFact[];
  unresolved: Array<{ key: string; question: string; blocking: boolean }>;
  assumptions: string[];
}

export interface BuilderReadinessState {
  score: number;
  canPlan: boolean;
  blocking: string[];
}

export interface BuilderTurnResult {
  message: { role: "assistant"; content: string };
  phase: BuilderPhase;
  requirements: BuilderRequirementsState;
  readiness: BuilderReadinessState;
  plan: AgentCreationPlan | null;
  planId: string | null;
  planningBrief: string | null;
  stateVersion: number;
}

export async function listBuilderSessions(): Promise<NlBuilderSessionSummary[]> {
  try {
    const res = await fetch(`${apiBase()}/api/v1/nl-builder/sessions`, {
      credentials: "include",
    });
    if (!res.ok) return [];
    const body = (await res.json().catch(() => null)) as { sessions?: NlBuilderSessionSummary[] } | null;
    return body?.sessions ?? [];
  } catch {
    return [];
  }
}

export async function createBuilderSession(title?: string): Promise<NlBuilderSessionDetail | null> {
  try {
    const res = await fetch(`${apiBase()}/api/v1/nl-builder/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(title ? { title } : {}),
    });
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as { session?: NlBuilderSessionDetail } | null;
    return body?.session ?? null;
  } catch {
    return null;
  }
}

export async function getBuilderSession(sessionId: string): Promise<NlBuilderSessionDetail | null> {
  try {
    const res = await fetch(`${apiBase()}/api/v1/nl-builder/sessions/${encodeURIComponent(sessionId)}`, {
      credentials: "include",
    });
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as { session?: NlBuilderSessionDetail } | null;
    return body?.session ?? null;
  } catch {
    return null;
  }
}

export async function updateBuilderSession(
  sessionId: string,
  patch: {
    title?: string;
    transcript?: unknown[];
    createdAgentIds?: string[];
    teamId?: string | null;
  },
): Promise<NlBuilderSessionDetail | null> {
  try {
    const res = await fetch(`${apiBase()}/api/v1/nl-builder/sessions/${encodeURIComponent(sessionId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(patch),
    });
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as { session?: NlBuilderSessionDetail } | null;
    return body?.session ?? null;
  } catch {
    return null;
  }
}

export async function deleteBuilderSession(sessionId: string): Promise<boolean> {
  try {
    const res = await fetch(`${apiBase()}/api/v1/nl-builder/sessions/${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
      credentials: "include",
    });
    return res.ok || res.status === 204;
  } catch {
    return false;
  }
}

type BuilderMessageFailure = { ok: false; errorMessage: string; status?: number };

function builderMessageError(res: Response, body: ApiErrorBody | null): BuilderMessageFailure {
  const contentType = res.headers.get("content-type") ?? "";
  if (res.status === 404 && !contentType.includes("application/json")) {
    return {
      ok: false,
      status: res.status,
      errorMessage:
        "Builder conversation API is unavailable — the backend may need a rebuild and restart.",
    };
  }
  return {
    ok: false,
    status: res.status,
    errorMessage: body?.error?.message ?? `Builder conversation failed (${res.status})`,
  };
}

export async function sendBuilderMessage(
  sessionId: string,
  content: string,
  model?: string,
  intent: "message" | "redesign" = "message",
): Promise<{ ok: true; data: BuilderTurnResult } | BuilderMessageFailure> {
  try {
    const res = await fetch(
      `${apiBase()}/api/v1/nl-builder/sessions/${encodeURIComponent(sessionId)}/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          content,
          intent,
          ...(model ? { model } : {}),
        }),
      },
    );
    const contentType = res.headers.get("content-type") ?? "";
    const body = contentType.includes("application/json")
      ? ((await res.json().catch(() => null)) as (BuilderTurnResult & ApiErrorBody) | null)
      : null;
    if (!res.ok) {
      return builderMessageError(res, body);
    }
    if (!body?.message) {
      return { ok: false, status: res.status, errorMessage: "Server returned an empty builder response" };
    }
    return { ok: true, data: body };
  } catch {
    return { ok: false, errorMessage: "Network error — check your connection" };
  }
}

/** Creates a session when needed and retries once when the server cannot find it. */
export async function sendBuilderTurn(input: {
  sessionId: string | null;
  content: string;
  model?: string;
  intent?: "message" | "redesign";
  title?: string;
}): Promise<
  | { ok: true; data: BuilderTurnResult; sessionId: string }
  | BuilderMessageFailure
> {
  let sessionId = input.sessionId;
  if (!sessionId) {
    const created = await createBuilderSession(input.title);
    if (!created) {
      return { ok: false, errorMessage: "Could not start the builder conversation" };
    }
    sessionId = created.id;
  }

  let result = await sendBuilderMessage(
    sessionId,
    input.content,
    input.model,
    input.intent ?? "message",
  );
  if (!result.ok && result.status === 404) {
    const created = await createBuilderSession(input.title);
    if (!created) return result;
    sessionId = created.id;
    result = await sendBuilderMessage(
      sessionId,
      input.content,
      input.model,
      input.intent ?? "message",
    );
  }

  if (!result.ok) return result;
  return { ok: true, data: result.data, sessionId };
}

type ParseResult =
  | { ok: true; plan: AgentCreationPlan }
  | { ok: false; errorMessage: string };

export async function nlParsePrompt(prompt: string, model: string): Promise<ParseResult> {
  try {
    const res = await fetch(`${apiBase()}/api/v1/agents/nl-parse`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ prompt, model }),
    });
    const body = (await res.json().catch(() => null)) as { plan?: AgentCreationPlan } & ApiErrorBody | null;
    if (!res.ok) {
      return { ok: false, errorMessage: body?.error?.message ?? `Parse failed (${res.status})` };
    }
    if (!body?.plan) {
      return { ok: false, errorMessage: "Server returned no plan" };
    }
    return { ok: true, plan: body.plan };
  } catch {
    return { ok: false, errorMessage: "Network error — check your connection" };
  }
}
