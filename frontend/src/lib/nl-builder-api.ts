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

