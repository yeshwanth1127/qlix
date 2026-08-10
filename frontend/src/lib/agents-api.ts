import type { ApiErrorBody } from "./auth-api";

const defaultBase = "http://localhost:4000";

function apiBase(): string {
  return (process.env.NEXT_PUBLIC_API_BASE_URL ?? defaultBase).replace(/\/$/, "");
}

export type PermissionScope =
  | "web.read"
  | "web.click"
  | "web.transaction"
  | "web.research"
  | "system.file_read"
  | "system.file_write"
  | "system.gui_control"
  | "finance.spend_50"
  | "finance.spend_100"
  | "brain.query"
  | "brain.knowledge_read"
  | "email.read"
  | "email.send"
  | "whatsapp.send"
  | "whatsapp.read"
  | "whatsapp.contact_send"
  | "social.read"
  | "social.publish"
  | "crm.read"
  | "crm.write"
  | "crm.delete"
  | "slack.read"
  | "slack.send";

export const ALL_PERMISSION_SCOPES: PermissionScope[] = [
  "web.read",
  "web.research",
  "web.click",
  "web.transaction",
  "system.file_read",
  "system.file_write",
  "system.gui_control",
  "finance.spend_50",
  "finance.spend_100",
  "brain.query",
  "brain.knowledge_read",
  "email.read",
  "email.send",
  "whatsapp.send",
  "whatsapp.read",
  "whatsapp.contact_send",
  "social.read",
  "social.publish",
  "crm.read",
  "crm.write",
  "crm.delete",
  "slack.read",
  "slack.send",
];

export const FORCE_JIT_SCOPES: PermissionScope[] = [
  "web.transaction",
  "system.file_write",
  "system.gui_control",
  "finance.spend_50",
  "finance.spend_100",
  "email.send",
  "social.publish",
  "crm.write",
  "crm.delete",
  "slack.send",
  "whatsapp.contact_send",
];

export const PERMISSION_SCOPE_LABELS: Record<PermissionScope, string> = {
  "web.read": "Read web pages",
  "web.research": "Web research (platform APIs)",
  "web.click": "Click on web pages",
  "web.transaction": "Submit web forms / transactions",
  "system.file_read": "Read local files",
  "system.file_write": "Write local files",
  "system.gui_control": "Control desktop apps (screen automation)",
  "finance.spend_50": "Spend up to $50",
  "finance.spend_100": "Spend up to $100",
  "brain.query": "Query company AI brain",
  "brain.knowledge_read": "Read org knowledge indexed for the brain",
  "email.read": "Read connected Gmail inbox",
  "email.send": "Send email via connected Gmail",
  "whatsapp.send": "Send files to your linked WhatsApp",
  "whatsapp.read": "Read WhatsApp contact chats",
  "whatsapp.contact_send": "Message WhatsApp contacts",
  "social.read": "Read Orbit social channels & posts",
  "social.publish": "Publish / schedule posts via Orbit",
  "crm.read": "Read CRM records",
  "crm.write": "Create / update CRM records",
  "crm.delete": "Delete CRM records",
  "slack.read": "Read Slack channels & messages",
  "slack.send": "Write to Slack (post, channels, DMs)",
};

export type AgentRuntime = "cloud" | "local" | "hybrid";

/** Where inference runs when `runtime` is `local`. Null when `runtime` is `cloud`. */
export type LocalInferenceMode = "local_llm" | "cloud_api";

/** Where LLM calls go: straight to local engine (`direct`) or via Qlix backend (`proxy`). */
export type LlmMode = "direct" | "proxy";
export type LlmProvider = "exora" | "openrouter";

export type AgentKind = "standard" | "org_brain";

export interface AgentDTO {
  id: string;
  userId: string;
  orgId: string | null;
  did: string;
  publicKey: string;
  name: string;
  description?: string | null;
  status: string;
  runtime: AgentRuntime;
  model: string;
  localInferenceMode: LocalInferenceMode | null;
  llmMode: LlmMode;
  llmProvider: LlmProvider;
  permissionScopes: PermissionScope[];
  jitScopes: PermissionScope[];
  alwaysScopes: PermissionScope[];
  webauthnCredentialId: string | null;
  keypairDeliveredAt: string | null;
  lastConnectedAt: string | null;
  lastActive: string | null;
  createdAt: string;
  cloudProvisioningStatus: string | null;
  cloudRunnerId: string | null;
  cloudLastHeartbeatAt: string | null;
  cloudProvisioningError?: string | null;
  hybridLastHeartbeatAt?: string | null;
  agentKind?: AgentKind;
  toolProfile?: "minimal" | "coding" | "full";
}

export interface VerifiableCredentialDTO {
  id: string;
  agentId: string;
  agentDid: string;
  type: "identity" | "scope" | "jit";
  issuerDid: string;
  subjectDid: string;
  claims: unknown;
  signature: string;
  issuedAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
}

import type { HybridClientPlatform } from "./hybrid-platform";

export type { HybridClientPlatform } from "./hybrid-platform";

export interface CreateAgentBody {
  name: string;
  description?: string | null;
  permissionScopes: PermissionScope[];
  jitScopes: PermissionScope[];
  runtime: AgentRuntime;
  model: string;
  llmMode: LlmMode;
  llmProvider: LlmProvider;
  localInferenceMode: LocalInferenceMode | null;
  orgId: string | null;
  /** Hybrid only: OS launcher to bundle in the starter ZIP. */
  clientPlatform?: HybridClientPlatform;
}

/** Matches backend `SdkAgentPathsHint` — where to save `agent.json` and how to point the SDK at it. */
export interface SdkAgentPathsHint {
  envVarName: "QLIX_AGENT_FILE";
  suggestedDownloadFilename: string;
  instructions: string;
  posixExample: string;
  windowsCmdExample: string;
  windowsPwshExample: string;
}

/** One-click folder for hybrid agents (unzip + double-click launcher). */
export interface HybridStarterPack {
  filename: string;
  base64: string;
}

export interface CreateAgentResponse {
  agent: AgentDTO;
  credentials: VerifiableCredentialDTO[];
  /** Canonical JSON for `QLIX_AGENT_FILE` / Python SDK `load_identity`. */
  sdkAgentFile: Record<string, unknown>;
  sdkAgentPaths: SdkAgentPathsHint;
  /** Present when runtime is hybrid — ZIP with agent.json and Start Qlix Agent launcher. */
  hybridStarterPack?: HybridStarterPack;
}

export interface RuntimeStatusResponse {
  runtime: AgentRuntime;
  provisioningStatus: string | null;
  runnerId: string | null;
  lastHeartbeatAt: string | null;
  heartbeatFresh: boolean;
  lastConnectedAt: string | null;
  status: string;
  provisioningError?: string | null;
  inferenceReady?: boolean;
  inferenceError?: string | null;
}

/**
 * Must satisfy backend `assertModelAllowed`: default env allows models starting with `openrouter/`.
 * The inference proxy strips one `openrouter/` prefix before calling OpenRouter’s API (see `openrouterClient.ts`).
 * Auto is first — Qlix routes ≤ billable tier (standard by default; economy on Spark/Ignition).
 */
export const QLIX_AUTO_MODEL = "openrouter/qlix/auto" as const;
export const EXORA_AUTO_MODEL = "exora/qlix/auto" as const;

export const CLOUD_MODELS = [
  QLIX_AUTO_MODEL,
  "openrouter/google/gemini-2.5-flash-lite",
  "openrouter/openai/gpt-4o-mini",
  "openrouter/openai/gpt-4o",
  "openrouter/anthropic/claude-sonnet-4.6",
  "openrouter/google/gemini-2.5-flash",
  "openrouter/qwen/qwen-2.5-72b-instruct",
] as const;

export const EXORA_MODELS = [
  "exora/exora-general",
  "exora/exora-coder",
  EXORA_AUTO_MODEL,
] as const;

export const LOCAL_MODELS = ["qwen3:8b", "llama3.1:8b", "mistral:7b"] as const;

export type ModelCatalogEntry = {
  id: string;
  name: string;
  contextLength: number | null;
  qlixModelId: string;
};
export type OpenRouterCatalogEntry = ModelCatalogEntry;

export type ModelSelectOption = {
  id: string;
  label: string;
  /** Catalog display name (e.g. "Anthropic: Claude Sonnet 4.6"), when known. */
  name?: string;
  /** Catalog context window in tokens, when known. */
  contextLength?: number | null;
};

export type ModelSelectGroup = {
  label: string;
  provider: LlmProvider;
  options: ModelSelectOption[];
};

const EXORA_DISPLAY_ORDER = [
  "exora/exora-general",
  "exora/exora-coder",
  EXORA_AUTO_MODEL,
] as const;

/** Infer provider from a canonical qlix model id. */
export function llmProviderFromModelId(modelId: string): LlmProvider {
  return modelId.toLowerCase().startsWith("exora/") ? "exora" : "openrouter";
}

export function formatModelOptionLabel(modelId: string): string {
  const lower = modelId.toLowerCase();
  if (lower.endsWith("/qlix/auto")) return "Auto (Qlix picks ≤ your plan)";
  if (lower === "exora/exora-general" || lower === "exora-general") return "General";
  if (lower === "exora/exora-coder" || lower === "exora-coder") return "Coder";
  return modelId.replace(/^(openrouter|exora)\//i, "");
}

function sortExoraModelIds(ids: Iterable<string>): string[] {
  const unique = [...new Set([...ids].map((id) => id.trim()).filter(Boolean))];
  const preferred = EXORA_DISPLAY_ORDER.filter((id) =>
    unique.some((u) => u.toLowerCase() === id.toLowerCase()),
  );
  const preferredSet = new Set(preferred.map((id) => id.toLowerCase()));
  const rest = unique
    .filter((id) => !preferredSet.has(id.toLowerCase()))
    .sort((a, b) => a.localeCompare(b));
  return [...preferred, ...rest];
}

/**
 * Build optgroups:
 *   Exora → General, Coder, qlix/auto (+ any other Exora catalog models)
 *   All models → OpenRouter catalog / curated list
 */
export function buildProxyModelGroups(input: {
  exoraCatalog?: readonly ModelCatalogEntry[];
  openrouterCatalog?: readonly ModelCatalogEntry[];
  includeExora?: boolean;
  includeOpenrouter?: boolean;
  selectedModel?: string;
}): ModelSelectGroup[] {
  const includeExora = input.includeExora !== false;
  const includeOpenrouter = input.includeOpenrouter !== false;
  const groups: ModelSelectGroup[] = [];

  /** Catalog metadata by canonical id, so the picker can show real names + context windows. */
  const meta = new Map<string, ModelCatalogEntry>();
  for (const entry of [...(input.exoraCatalog ?? []), ...(input.openrouterCatalog ?? [])]) {
    meta.set(entry.qlixModelId.toLowerCase(), entry);
  }
  const toOption = (id: string): ModelSelectOption => {
    const entry = meta.get(id.toLowerCase());
    return {
      id,
      label: formatModelOptionLabel(id),
      ...(entry?.name ? { name: entry.name } : {}),
      ...(entry?.contextLength != null ? { contextLength: entry.contextLength } : {}),
    };
  };

  if (includeExora) {
    const fromCatalog = (input.exoraCatalog ?? []).map((e) => e.qlixModelId);
    const ids = sortExoraModelIds([
      ...EXORA_MODELS,
      ...fromCatalog,
      ...(input.selectedModel && llmProviderFromModelId(input.selectedModel) === "exora"
        ? [input.selectedModel]
        : []),
    ]);
    if (ids.length) {
      groups.push({
        label: "Exora",
        provider: "exora",
        options: ids.map(toOption),
      });
    }
  }

  if (includeOpenrouter) {
    const curated = [...CLOUD_MODELS];
    const fromCatalog = (input.openrouterCatalog ?? []).map((e) => e.qlixModelId);
    const ids = [
      ...new Set([
        ...curated,
        ...fromCatalog,
        ...(input.selectedModel && llmProviderFromModelId(input.selectedModel) === "openrouter"
          ? [input.selectedModel]
          : []),
      ]),
    ];
    if (ids.length) {
      groups.push({
        label: "All models",
        provider: "openrouter",
        options: ids.map(toOption),
      });
    }
  }

  return groups;
}

/** Match backend provider-aware model normalization. */
export function normalizeQlixInferenceModelId(
  raw: string,
  provider: LlmProvider = "openrouter",
): string {
  const t = raw.trim();
  if (!t) return t;
  if (/^(openrouter|exora)\//i.test(t)) return t;
  return `${provider}/${t}`;
}

async function asJson<T>(res: Response): Promise<T> {
  return res.json() as Promise<T>;
}

async function asError(
  res: Response,
  fallback: string,
): Promise<{ message: string; code: string | null }> {
  const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
  return {
    message: body?.error?.message ?? `${fallback} (${res.status})`,
    code: body?.error?.code ?? null,
  };
}

export async function fetchOpenRouterCatalog(): Promise<
  { ok: true; models: OpenRouterCatalogEntry[] } | { ok: false; errorMessage: string }
> {
  const res = await fetch(`${apiBase()}/api/v1/inference/openrouter-models`, { credentials: "include" });
  if (!res.ok) {
    const e = await asError(res, "Failed to load models");
    return { ok: false, errorMessage: e.message };
  }
  const body = (await res.json()) as { models?: OpenRouterCatalogEntry[] };
  return { ok: true, models: body.models ?? [] };
}

export async function fetchModelCatalog(
  provider: LlmProvider,
): Promise<
  { ok: true; models: ModelCatalogEntry[] } | { ok: false; errorMessage: string }
> {
  const res = await fetch(
    `${apiBase()}/api/v1/inference/models?provider=${encodeURIComponent(provider)}`,
    { credentials: "include" },
  );
  if (!res.ok) {
    const e = await asError(res, "Failed to load models");
    return { ok: false, errorMessage: e.message };
  }
  const body = (await res.json()) as { models?: ModelCatalogEntry[] };
  return { ok: true, models: body.models ?? [] };
}

export interface InferenceCapabilities {
  defaultProvider: LlmProvider;
  providers: Record<LlmProvider, { enabled: boolean }>;
}

export async function fetchInferenceCapabilities(): Promise<InferenceCapabilities | null> {
  const res = await fetch(`${apiBase()}/api/v1/inference/capabilities`, {
    credentials: "include",
  });
  if (!res.ok) return null;
  return res.json() as Promise<InferenceCapabilities>;
}

export type CreateAgentResult =
  | { ok: true; data: CreateAgentResponse }
  | { ok: false; errorMessage: string; code: string | null };

/** @deprecated Passkey step-up is no longer required; kept for older callers. */
export const DEVICE_STEP_UP_HEADER = "X-QLIX-Device-Step-Up";

export async function createAgent(body: CreateAgentBody, _stepUpToken?: string): Promise<CreateAgentResult> {
  const res = await fetch(`${apiBase()}/api/v1/agents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const e = await asError(res, "Failed to create agent");
    return { ok: false, errorMessage: e.message, code: e.code };
  }
  return { ok: true, data: await asJson<CreateAgentResponse>(res) };
}

export async function listAgents(orgId: string | null): Promise<AgentDTO[] | null> {
  const url = new URL(`${apiBase()}/api/v1/agents`);
  if (orgId) url.searchParams.set("orgId", orgId);
  const res = await fetch(url.toString(), { credentials: "include" });
  if (!res.ok) return null;
  const body = (await res.json()) as { agents: AgentDTO[] };
  return body.agents;
}

export async function getAgent(
  id: string,
): Promise<{ agent: AgentDTO; credentials: VerifiableCredentialDTO[] } | null> {
  const res = await fetch(`${apiBase()}/api/v1/agents/${encodeURIComponent(id)}`, {
    credentials: "include",
  });
  if (!res.ok) return null;
  return res.json() as Promise<{ agent: AgentDTO; credentials: VerifiableCredentialDTO[] }>;
}

export async function getRuntimeStatus(agentId: string): Promise<RuntimeStatusResponse | null> {
  try {
    const res = await fetch(`${apiBase()}/api/v1/agents/${encodeURIComponent(agentId)}/runtime-status`, {
      credentials: "include",
    });
    if (!res.ok) return null;
    return (await res.json()) as RuntimeStatusResponse;
  } catch {
    // Backend restarting, offline, or network blip — callers poll again.
    return null;
  }
}

export type RestartCloudRunnerResult =
  | { readonly ok: true; readonly status?: string }
  | { readonly ok: false; readonly message: string };

export async function restartCloudRunner(agentId: string): Promise<RestartCloudRunnerResult> {
  const base = apiBase();
  const url = `${base}/api/v1/agents/${encodeURIComponent(agentId)}/cloud/restart`;
  try {
    const res = await fetch(url, {
      method: "POST",
      credentials: "include",
    });
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      status?: string;
      error?: { message?: string };
    } | null;
    if (res.ok) {
      return { ok: true, status: body?.status };
    }
    return {
      ok: false,
      message: body?.error?.message ?? `Restart failed (${res.status})`,
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    const unreachable =
      err instanceof TypeError ||
      /failed to fetch|networkerror|load failed/i.test(detail);
    return {
      ok: false,
      message: unreachable
        ? `Could not reach the API at ${base}. Confirm the backend is running and NEXT_PUBLIC_API_BASE_URL matches it.`
        : detail || "Network error while restarting the runner",
    };
  }
}

export type ReissueHybridStarterResult =
  | {
      readonly ok: true;
      readonly hybridStarterPack: { readonly filename: string; readonly base64: string };
    }
  | { readonly ok: false; readonly message: string };

function detectClientPlatform(): "windows" | "macos" | "linux" | undefined {
  if (typeof navigator === "undefined") return undefined;
  const ua = (navigator.userAgent || "").toLowerCase();
  if (ua.includes("win")) return "windows";
  if (ua.includes("mac")) return "macos";
  if (ua.includes("linux")) return "linux";
  return undefined;
}

export async function reissueHybridStarterPack(agentId: string): Promise<ReissueHybridStarterResult> {
  const base = apiBase();
  const url = `${base}/api/v1/agents/${encodeURIComponent(agentId)}/hybrid/reissue-starter`;
  try {
    const res = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientPlatform: detectClientPlatform() }),
    });
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      hybridStarterPack?: { filename: string; base64: string };
      error?: { message?: string };
    } | null;
    if (res.ok && body?.hybridStarterPack) {
      return { ok: true, hybridStarterPack: body.hybridStarterPack };
    }
    return {
      ok: false,
      message: body?.error?.message ?? `Re-issue failed (${res.status})`,
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { ok: false, message: detail || "Network error while re-issuing starter pack" };
  }
}

export async function clearCloudRunnerProvisioning(agentId: string): Promise<RestartCloudRunnerResult> {
  const base = apiBase();
  const url = `${base}/api/v1/agents/${encodeURIComponent(agentId)}/cloud/clear-provisioning`;
  try {
    const res = await fetch(url, {
      method: "POST",
      credentials: "include",
    });
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      message?: string;
      error?: { message?: string };
    } | null;
    if (res.ok) {
      return { ok: true, status: body?.message };
    }
    return {
      ok: false,
      message: body?.error?.message ?? `Failed to clear status (${res.status})`,
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      message: detail || "Network error",
    };
  }
}

export async function getCloudRunnerLogs(agentId: string, tail = 200): Promise<string | null> {
  const url = new URL(`${apiBase()}/api/v1/agents/${encodeURIComponent(agentId)}/cloud/logs`);
  url.searchParams.set("tail", String(tail));
  const res = await fetch(url.toString(), { credentials: "include" });
  if (!res.ok) return null;
  const body = (await res.json()) as { logs?: string };
  return typeof body.logs === "string" ? body.logs : null;
}

export async function clearConversationMessages(agentId: string, conversationId: string): Promise<boolean> {
  const res = await fetch(
    `${apiBase()}/api/v1/agents/${encodeURIComponent(agentId)}/conversations/${encodeURIComponent(conversationId)}/messages`,
    {
      method: "DELETE",
      credentials: "include",
    },
  );
  return res.ok;
}

export type ChatAttachmentDTO = {
  id: string;
  fileName: string;
  mimeType: string;
  url: string;
  sizeBytes: number;
  textPreview?: string;
};

export type ConversationMessageDTO = {
  id: string;
  role: string;
  content: string;
  attachments?: ChatAttachmentDTO[] | null;
  createdAt?: string;
};

export async function fetchConversationMessages(
  agentId: string,
  conversationId: string,
): Promise<ConversationMessageDTO[] | null> {
  const res = await fetch(
    `${apiBase()}/api/v1/agents/${encodeURIComponent(agentId)}/conversations/${encodeURIComponent(conversationId)}/messages`,
    { credentials: "include" },
  );
  if (!res.ok) return null;
  const body = (await res.json()) as { messages?: ConversationMessageDTO[] };
  return body.messages ?? null;
}

export async function confirmDownload(agentId: string): Promise<boolean> {
  const res = await fetch(
    `${apiBase()}/api/v1/agents/${encodeURIComponent(agentId)}/confirm-download`,
    { method: "PATCH", credentials: "include" },
  );
  return res.ok;
}

export type DeleteAgentResult =
  | { ok: true }
  | { ok: false; errorMessage: string; code: string | null };

/** Deletes the agent and cascaded rows (VCs, audit rows for this agent). Requires typing the agent name. */
export async function updateAgentDescription(
  agentId: string,
  description: string | null,
): Promise<{ ok: true; agent: AgentDTO } | { ok: false; error: string }> {
  const res = await fetch(`${apiBase()}/api/v1/agents/${encodeURIComponent(agentId)}/description`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as ApiErrorBody | null;
    return { ok: false, error: err?.error?.message ?? "Failed to update description" };
  }
  const data = (await res.json()) as { agent: AgentDTO };
  return { ok: true, agent: data.agent };
}

export async function updateAgentInference(
  agentId: string,
  llmProvider: LlmProvider,
  model: string,
): Promise<{ ok: true; agent: AgentDTO } | { ok: false; error: string }> {
  const res = await fetch(
    `${apiBase()}/api/v1/agents/${encodeURIComponent(agentId)}/inference`,
    {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ llmProvider, model }),
    },
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as ApiErrorBody | null;
    return { ok: false, error: err?.error?.message ?? "Failed to update inference settings" };
  }
  const data = (await res.json()) as { agent: AgentDTO };
  return { ok: true, agent: data.agent };
}

export interface ScopeCatalogEntry {
  id: string;
  label: string;
  description: string;
  forceJit: boolean;
}

export async function fetchScopeCatalog(orgId: string | null): Promise<ScopeCatalogEntry[] | null> {
  const url = new URL(`${apiBase()}/api/v1/agents/scope-catalog`);
  if (orgId) url.searchParams.set("orgId", orgId);
  const res = await fetch(url.toString(), { credentials: "include" });
  if (!res.ok) return null;
  const data = (await res.json()) as { scopes: ScopeCatalogEntry[] };
  return data.scopes ?? [];
}

export async function updateAgentScopes(
  agentId: string,
  permissionScopes: string[],
  jitScopes?: string[],
): Promise<{ ok: true; agent: AgentDTO } | { ok: false; error: string }> {
  const res = await fetch(`${apiBase()}/api/v1/agents/${encodeURIComponent(agentId)}/scopes`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ permissionScopes, jitScopes }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as ApiErrorBody | null;
    return { ok: false, error: err?.error?.message ?? "Failed to update scopes" };
  }
  const data = (await res.json()) as { agent: AgentDTO };
  return { ok: true, agent: data.agent };
}

export async function deleteAllAgents(): Promise<{ ok: boolean; deleted?: number; errorMessage?: string }> {
  const res = await fetch(`${apiBase()}/api/v1/agents`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ confirm: "DELETE_ALL" }),
  });
  if (res.ok) {
    const data = (await res.json()) as { ok: boolean; deleted: number };
    return { ok: true, deleted: data.deleted };
  }
  const e = await asError(res, "Failed to delete all agents");
  return { ok: false, errorMessage: e.message };
}

export async function deleteAgent(agentId: string, confirmName: string): Promise<DeleteAgentResult> {
  const res = await fetch(`${apiBase()}/api/v1/agents/${encodeURIComponent(agentId)}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ confirmName }),
  });
  if (res.status === 204) return { ok: true };
  const e = await asError(res, "Failed to delete agent");
  return { ok: false, errorMessage: e.message, code: e.code };
}

export type ActiveRunSource = "whatsapp" | "team" | "dashboard";

export interface ActiveAgentRunDTO {
  id: string;
  agentId: string;
  agentName: string;
  agentRuntime: AgentRuntime;
  status: string;
  prompt: string;
  useBrain: boolean;
  source: ActiveRunSource;
  teamRole: string | null;
  teamRunId: string | null;
  createdAt: string;
  startedAt: string | null;
}

export async function listActiveRuns(orgId: string | null): Promise<ActiveAgentRunDTO[] | null> {
  const url = new URL(`${apiBase()}/api/v1/agents/active-runs`);
  if (orgId) url.searchParams.set("orgId", orgId);
  const res = await fetch(url.toString(), { credentials: "include" });
  if (!res.ok) return null;
  const body = (await res.json()) as { runs: ActiveAgentRunDTO[] };
  return body.runs;
}

export interface AgentRunHistoryEventDTO {
  seq: number;
  type: string;
  data: unknown;
}

export interface AgentRunHistoryDTO extends ActiveAgentRunDTO {
  finishedAt: string | null;
  errorMessage: string | null;
  events: AgentRunHistoryEventDTO[];
}

export async function listRunHistory(
  orgId: string | null,
  limit = 30,
): Promise<AgentRunHistoryDTO[] | null> {
  const url = new URL(`${apiBase()}/api/v1/agents/run-history`);
  if (orgId) url.searchParams.set("orgId", orgId);
  url.searchParams.set("limit", String(limit));
  const res = await fetch(url.toString(), { credentials: "include" });
  if (!res.ok) return null;
  const body = (await res.json()) as { runs: AgentRunHistoryDTO[] };
  return body.runs;
}

export async function stopAgentRun(agentId: string, runId: string): Promise<boolean> {
  const res = await fetch(
    `${apiBase()}/api/v1/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}/stop`,
    { method: "POST", credentials: "include" },
  );
  return res.ok;
}

export async function updateAgentToolProfile(
  agentId: string,
  toolProfile: "minimal" | "coding" | "full",
): Promise<AgentDTO | null> {
  const res = await fetch(
    `${apiBase()}/api/v1/agents/${encodeURIComponent(agentId)}/tool-profile`,
    {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toolProfile }),
    },
  );
  if (!res.ok) return null;
  const body = (await res.json()) as { agent: AgentDTO };
  return body.agent;
}
