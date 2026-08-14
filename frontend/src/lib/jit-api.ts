const defaultBase = "http://localhost:4000";

function apiBase(): string {
  return (process.env.NEXT_PUBLIC_API_BASE_URL ?? defaultBase).replace(/\/$/, "");
}

export type JitDecideResult =
  | { ok: true; status: "approved" | "denied" | "expired" }
  | { ok: false; errorMessage: string };

/** Approve or deny a pending JIT request from the dashboard chat UI. */
export async function decideJit(jitRequestId: string, approved: boolean): Promise<JitDecideResult> {
  try {
    const res = await fetch(`${apiBase()}/api/v1/jit/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ jitRequestId, approved }),
    });
    const body = (await res.json().catch(() => null)) as
      | { status?: "approved" | "denied" | "expired"; error?: { message?: string } }
      | null;
    if (!res.ok) {
      return { ok: false, errorMessage: body?.error?.message ?? `Failed (${res.status})` };
    }
    return { ok: true, status: body?.status ?? "approved" };
  } catch {
    return { ok: false, errorMessage: "Network error — check your connection" };
  }
}

/** A durable "approve once per session" grant (e.g. email.send for a whole conversation). */
export interface ConversationGrantDTO {
  id: string;
  conversationId: string;
  agentId: string;
  agentName: string | null;
  scope: string;
  createdAt: string;
  expiresAt: string | null;
}

/** Pending JIT approval surfaced when the live run stream missed the approval card. */
export interface PendingJitDTO {
  jitRequestId: string;
  agentId: string;
  scope: string;
  scopeLabel: string;
  context: string;
  runId: string | null;
  conversationId: string | null;
  requestedAt: string;
}

export async function listPendingJit(
  conversationId: string,
  agentId: string,
): Promise<PendingJitDTO[]> {
  const params = new URLSearchParams({ conversationId, agentId });
  const res = await fetch(`${apiBase()}/api/v1/jit/pending?${params}`, { credentials: "include" });
  const body = (await res.json().catch(() => null)) as
    | { pending?: PendingJitDTO[]; error?: { message?: string } }
    | null;
  if (!res.ok) return [];
  return body?.pending ?? [];
}

export async function listJitGrants(): Promise<ConversationGrantDTO[]> {
  const res = await fetch(`${apiBase()}/api/v1/jit/grants`, { credentials: "include" });
  const body = (await res.json().catch(() => null)) as
    | { grants?: ConversationGrantDTO[]; error?: { message?: string } }
    | null;
  if (!res.ok) throw new Error(body?.error?.message ?? "Failed to load session approvals");
  return body?.grants ?? [];
}

export async function revokeJitGrant(grantId: string): Promise<void> {
  const res = await fetch(`${apiBase()}/api/v1/jit/grants/${grantId}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? "Failed to revoke session approval");
  }
}

/** Scopes where one approval covers the rest of the conversation. */
export const SESSION_CHAT_JIT_SCOPES = new Set([
  "email.send",
  "drive.write",
  "docs.write",
  "sheets.write",
  "slides.write",
  "forms.write",
  "calendar.write",
  "meet.manage",
  "social.publish",
  "crm.write",
  "crm.delete",
  "whatsapp.contact_send",
  "slack.send",
  "notion.write",
]);

export function isSessionChatJitScope(scope: string | undefined): boolean {
  return Boolean(scope && SESSION_CHAT_JIT_SCOPES.has(scope));
}

/** Human label for a scope id shown in the session-approvals list. */
export function jitScopeLabel(scope: string): string {
  const labels: Record<string, string> = {
    "email.send": "Send email",
    "email.read": "Read email",
    "drive.write": "Write to Drive",
    "drive.read": "Read Drive",
    "docs.write": "Write a Doc",
    "docs.read": "Read Docs",
    "sheets.write": "Write a Sheet",
    "sheets.read": "Read Sheets",
    "slides.write": "Write Slides",
    "slides.read": "Read Slides",
    "forms.write": "Write a Form",
    "forms.read": "Read Forms",
    "calendar.write": "Change Calendar",
    "calendar.read": "Read Calendar",
    "meet.manage": "Manage Meet",
    "social.publish": "Publish to social",
    "social.read": "Read social",
    "crm.write": "Update CRM",
    "crm.delete": "Delete CRM records",
    "crm.read": "Read CRM",
    "slack.send": "Write to Slack",
    "slack.read": "Read Slack",
    "notion.write": "Write to Notion",
    "notion.read": "Read Notion",
    "whatsapp.contact_send": "Message WhatsApp contacts",
    "whatsapp.read": "Read WhatsApp chats",
    "whatsapp.send": "Send files to WhatsApp",
    "web.transaction": "Web transaction",
    "system.file_write": "Write files",
  };
  return labels[scope] ?? scope;
}
