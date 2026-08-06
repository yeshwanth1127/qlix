const defaultBase = "http://localhost:4000";

function apiBase(): string {
  return (process.env.NEXT_PUBLIC_API_BASE_URL ?? defaultBase).replace(/\/$/, "");
}

export interface AiBrainScopeInfo {
  readonly defaultL3L5: boolean;
  readonly connectorsDeferred: boolean;
}

export type AiBrainHosting = "cloud" | "local";

export interface AiBrainStatusResponse {
  readonly scope: AiBrainScopeInfo;
  readonly brain: {
    readonly id: string;
    readonly didShort: string;
    readonly name: string;
    readonly agentKind: string;
    readonly runtime: AiBrainHosting;
    readonly status: string;
    readonly cloudProvisioningStatus: string | null;
    readonly cloudLastHeartbeatAt: string | null;
    readonly cloudProvisioningError: string | null;
    readonly permissionScopes: readonly string[];
    readonly queryModel: string;
  } | null;
  readonly knowledge: {
    readonly collections: readonly {
      readonly id: string;
      readonly name: string;
      readonly description: string;
      readonly retentionDays: number | null;
      readonly documentCount: number;
    }[];
  };
}

export interface AiBrainPolicySignalsResponse {
  readonly violations: readonly {
    readonly id: string;
    readonly actionType: string;
    readonly status: string;
    readonly timestampMs: number;
    readonly preview: string;
  }[];
  readonly blockedCount: number;
  readonly auditNote: string;
}

async function parseJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

export interface AiBrainKnowledgeDocumentRow {
  readonly id: string;
  readonly collectionId: string;
  readonly collectionName: string;
  readonly title: string;
  readonly ingestStatus: string;
  readonly sourceUri: string | null;
  readonly createdAt: string;
  readonly chunkCount: number;
}

export interface AiBrainKnowledgeDocumentDetail {
  readonly id: string;
  readonly title: string;
  readonly bodyText: string;
  readonly updatedAt: string;
}

export async function getAiBrainKnowledgeDocuments(): Promise<
  { ok: true; documents: readonly AiBrainKnowledgeDocumentRow[] } | { ok: false; message: string }
> {
  const res = await fetch(`${apiBase()}/api/v1/ai-brain/documents`, {
    method: "GET",
    credentials: "include",
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    return { ok: false, message: body?.error?.message ?? "Failed to load knowledge documents" };
  }
  const json = (await res.json().catch(() => null)) as { documents?: AiBrainKnowledgeDocumentRow[] } | null;
  return { ok: true, documents: json?.documents ?? [] };
}

export async function getAiBrainKnowledgeDocument(
  documentId: string,
): Promise<{ ok: true; document: AiBrainKnowledgeDocumentDetail } | { ok: false; message: string }> {
  const res = await fetch(`${apiBase()}/api/v1/ai-brain/documents/${encodeURIComponent(documentId)}`, {
    credentials: "include",
  });
  const json = (await res.json().catch(() => null)) as {
    document?: AiBrainKnowledgeDocumentDetail;
    error?: { message?: string };
  } | null;
  if (!res.ok || !json?.document) {
    return { ok: false, message: json?.error?.message ?? "Failed to load document" };
  }
  return { ok: true, document: json.document };
}

export async function updateAiBrainKnowledgeDocument(
  documentId: string,
  body: { title: string; bodyText: string },
): Promise<{ ok: true; chunkCount: number; updatedAt: string } | { ok: false; message: string }> {
  const res = await fetch(`${apiBase()}/api/v1/ai-brain/documents/${encodeURIComponent(documentId)}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as {
    chunkCount?: number;
    updatedAt?: string;
    error?: { message?: string };
  } | null;
  if (!res.ok || json?.chunkCount === undefined || !json.updatedAt) {
    return { ok: false, message: json?.error?.message ?? "Failed to update document" };
  }
  return { ok: true, chunkCount: json.chunkCount, updatedAt: json.updatedAt };
}

/** OpenRouter `GET /models` entries — `id` is exactly what OpenRouter accepts in API calls. */
export interface OpenRouterCatalogModelOption {
  readonly id: string;
  readonly name: string;
  readonly contextLength: number | null;
  /** Canonical value for PATCH /ai-brain/model (e.g. `openrouter/openai/gpt-4o-mini`). */
  readonly qlixModelId: string;
}

/** Live catalog from OpenRouter (server-proxied). */
export async function getOpenRouterModelCatalog(): Promise<
  { ok: true; models: readonly OpenRouterCatalogModelOption[] } | { ok: false; message: string }
> {
  const res = await fetch(`${apiBase()}/api/v1/inference/openrouter-models`, {
    method: "GET",
    credentials: "include",
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    return { ok: false, message: body?.error?.message ?? "Failed to load models from OpenRouter" };
  }
  const json = (await res.json().catch(() => null)) as { models?: OpenRouterCatalogModelOption[] } | null;
  return { ok: true, models: json?.models ?? [] };
}

export async function deleteAiBrainDocument(
  documentId: string,
): Promise<{ ok: true } | { ok: false; message: string; notFound?: boolean; forbidden?: boolean }> {
  const res = await fetch(`${apiBase()}/api/v1/ai-brain/documents/${encodeURIComponent(documentId)}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (res.status === 204) return { ok: true };
  const body = (await res.json().catch(() => null)) as { error?: { message?: string; code?: string } } | null;
  const message = body?.error?.message ?? "Failed to delete document";
  if (res.status === 404) return { ok: false, message, notFound: true };
  if (res.status === 403) return { ok: false, message, forbidden: true };
  return { ok: false, message };
}

export async function getAiBrainStatus(): Promise<{ ok: true; data: AiBrainStatusResponse } | { ok: false; message: string }> {
  const res = await fetch(`${apiBase()}/api/v1/ai-brain/status`, {
    method: "GET",
    credentials: "include",
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    return { ok: false, message: body?.error?.message ?? "Failed to load AI Brain status" };
  }
  const data = await parseJson<AiBrainStatusResponse>(res);
  return { ok: true, data };
}

export async function ensureAiBrainAgent(
  hosting: AiBrainHosting = "cloud",
): Promise<{ ok: true; brainId: string } | { ok: false; message: string; forbidden?: boolean }> {
  const res = await fetch(`${apiBase()}/api/v1/ai-brain/ensure-agent`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hosting }),
  });
  const body = (await res.json().catch(() => null)) as { brain?: { id: string }; error?: { message?: string; code?: string } } | null;
  if (!res.ok) {
    return {
      ok: false,
      message: body?.error?.message ?? "Failed to provision brain agent",
      forbidden: body?.error?.code === "forbidden_brain",
    };
  }
  const id = body?.brain?.id;
  if (!id) return { ok: false, message: "Invalid server response" };
  return { ok: true, brainId: id };
}

export async function getAiBrainPolicySignals(): Promise<
  { ok: true; data: AiBrainPolicySignalsResponse } | { ok: false; message: string }
> {
  const res = await fetch(`${apiBase()}/api/v1/ai-brain/policy-signals`, {
    credentials: "include",
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    return { ok: false, message: body?.error?.message ?? "Failed to load policy signals" };
  }
  const data = await parseJson<AiBrainPolicySignalsResponse>(res);
  return { ok: true, data };
}

export async function postAiBrainSimulatePolicy(violation: boolean): Promise<{ ok: boolean; message?: string }> {
  const res = await fetch(`${apiBase()}/api/v1/ai-brain/simulate-policy`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ violation }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    return { ok: false, message: body?.error?.message ?? "Simulation failed" };
  }
  return { ok: true };
}

export async function postAiBrainConsoleOpen(): Promise<void> {
  try {
    await fetch(`${apiBase()}/api/v1/ai-brain/telemetry/console-open`, {
      method: "POST",
      credentials: "include",
    });
  } catch {
    /* best-effort */
  }
}

export async function createAiBrainCollection(body: {
  name: string;
  description?: string;
  retentionDays?: number | null;
}): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  const res = await fetch(`${apiBase()}/api/v1/ai-brain/collections`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as { id?: string; error?: { message?: string } } | null;
  if (!res.ok) {
    return { ok: false, message: json?.error?.message ?? "Failed to create collection" };
  }
  if (!json?.id) return { ok: false, message: "Invalid response" };
  return { ok: true, id: json.id };
}

export interface AiBrainQueryCitation {
  readonly collectionId: string;
  readonly collectionName: string;
  readonly documentId: string;
  readonly documentTitle: string;
  readonly chunkOrdinal: number;
  readonly excerpt: string;
}

export interface AiBrainQueryResponse {
  readonly answer: string;
  readonly citations: readonly AiBrainQueryCitation[];
}

export interface AiBrainConversationRow {
  readonly id: string;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly messageCount: number;
}

export interface AiBrainConversationMessage {
  readonly id: string;
  readonly role: "user" | "brain";
  readonly content: string;
  readonly citations: readonly AiBrainQueryCitation[];
  readonly createdAt: string;
}

export async function getAiBrainConversations(): Promise<
  { ok: true; conversations: readonly AiBrainConversationRow[] } | { ok: false; message: string }
> {
  const res = await fetch(`${apiBase()}/api/v1/ai-brain/conversations`, { credentials: "include" });
  const json = (await res.json().catch(() => null)) as {
    conversations?: AiBrainConversationRow[];
    error?: { message?: string };
  } | null;
  if (!res.ok) return { ok: false, message: json?.error?.message ?? "Failed to load recent chats" };
  return { ok: true, conversations: json?.conversations ?? [] };
}

export async function createAiBrainConversation(): Promise<
  { ok: true; conversation: AiBrainConversationRow } | { ok: false; message: string }
> {
  const res = await fetch(`${apiBase()}/api/v1/ai-brain/conversations`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const json = (await res.json().catch(() => null)) as {
    conversation?: AiBrainConversationRow;
    error?: { message?: string };
  } | null;
  if (!res.ok || !json?.conversation) {
    return { ok: false, message: json?.error?.message ?? "Failed to create chat" };
  }
  return { ok: true, conversation: json.conversation };
}

export async function getAiBrainConversationMessages(conversationId: string): Promise<
  { ok: true; messages: readonly AiBrainConversationMessage[] } | { ok: false; message: string }
> {
  const res = await fetch(
    `${apiBase()}/api/v1/ai-brain/conversations/${encodeURIComponent(conversationId)}/messages`,
    { credentials: "include" },
  );
  const json = (await res.json().catch(() => null)) as {
    messages?: AiBrainConversationMessage[];
    error?: { message?: string };
  } | null;
  if (!res.ok) return { ok: false, message: json?.error?.message ?? "Failed to load chat" };
  return { ok: true, messages: json?.messages ?? [] };
}

export async function deleteAiBrainConversation(conversationId: string): Promise<{ ok: boolean; message?: string }> {
  const res = await fetch(`${apiBase()}/api/v1/ai-brain/conversations/${encodeURIComponent(conversationId)}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (res.ok) return { ok: true };
  const json = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  return { ok: false, message: json?.error?.message ?? "Failed to delete chat" };
}

export async function queryAiBrain(
  question: string,
  conversationId?: string,
): Promise<{ ok: true; data: AiBrainQueryResponse } | { ok: false; message: string }> {
  const res = await fetch(`${apiBase()}/api/v1/ai-brain/query`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question,
      ...(conversationId ? { conversationId } : {}),
    }),
  });
  const json = (await res.json().catch(() => null)) as { answer?: string; citations?: AiBrainQueryCitation[]; error?: { message?: string } } | null;
  if (!res.ok) {
    return { ok: false, message: json?.error?.message ?? "Query failed" };
  }
  if (!json?.answer) return { ok: false, message: "Invalid response" };
  return { ok: true, data: { answer: json.answer, citations: json.citations ?? [] } };
}

export async function updateAiBrainModel(
  model: string,
): Promise<{ ok: true; model: string } | { ok: false; message: string }> {
  const res = await fetch(`${apiBase()}/api/v1/ai-brain/model`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model }),
  });
  const json = (await res.json().catch(() => null)) as { ok?: boolean; model?: string; error?: { message?: string } } | null;
  if (!res.ok) {
    return { ok: false, message: json?.error?.message ?? "Failed to update model" };
  }
  if (!json?.model) return { ok: false, message: "Invalid response" };
  return { ok: true, model: json.model };
}

export async function ingestAiBrainDocument(
  collectionId: string,
  body: { title: string; bodyText: string; sourceUri?: string | null },
): Promise<{ ok: true; id: string; chunkCount: number } | { ok: false; message: string }> {
  const res = await fetch(`${apiBase()}/api/v1/ai-brain/collections/${encodeURIComponent(collectionId)}/documents`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as {
    id?: string;
    chunkCount?: number;
    error?: { message?: string };
  } | null;
  if (!res.ok) {
    return { ok: false, message: json?.error?.message ?? "Failed to ingest document" };
  }
  if (!json?.id || json.chunkCount === undefined) return { ok: false, message: "Invalid response" };
  return { ok: true, id: json.id, chunkCount: json.chunkCount };
}

/** Upload a supported document/data file; the server extracts normalized searchable text. */
export async function ingestAiBrainDocumentFromFile(
  collectionId: string,
  file: File,
  title?: string,
): Promise<{ ok: true; id: string; chunkCount: number } | { ok: false; message: string }> {
  const fd = new FormData();
  fd.append("file", file);
  if (title?.trim()) fd.append("title", title.trim());
  const res = await fetch(
    `${apiBase()}/api/v1/ai-brain/collections/${encodeURIComponent(collectionId)}/documents/upload`,
    {
      method: "POST",
      credentials: "include",
      body: fd,
    },
  );
  const json = (await res.json().catch(() => null)) as {
    id?: string;
    chunkCount?: number;
    error?: { message?: string };
  } | null;
  if (!res.ok) {
    return { ok: false, message: json?.error?.message ?? "Failed to upload document" };
  }
  if (!json?.id || json.chunkCount === undefined) return { ok: false, message: "Invalid response" };
  return { ok: true, id: json.id, chunkCount: json.chunkCount };
}
