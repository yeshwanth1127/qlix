const defaultBase = "http://localhost:4000";

function apiBase(): string {
  return (process.env.NEXT_PUBLIC_API_BASE_URL ?? defaultBase).replace(/\/$/, "");
}

async function getJson<T>(path: string): Promise<T | null> {
  const response = await fetch(`${apiBase()}${path}`, { credentials: "include" });
  if (response.status === 401) return null;
  if (!response.ok) return null;
  return response.json() as Promise<T>;
}

async function postJson<T>(path: string, body: unknown): Promise<{ ok: boolean; status: number; data?: T }> {
  const response = await fetch(`${apiBase()}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const status = response.status;
  if (!response.ok) return { ok: false, status };
  const data = (await response.json().catch(() => null)) as T | null;
  return { ok: true, status, ...(data ? { data } : null) };
}

export interface AdminBillingMetricsResponse {
  readonly billingCycle: string;
  readonly successesThisMonth: number;
  readonly revenueThisMonth: string;
  readonly avgPerSuccess: string;
  readonly failedAttemptsThisMonth: number;
  readonly homepageUniqueVisitors: number;
  readonly activeUsers: number;
  readonly registeredAgents: number;
  readonly activeAgents: number;
}

export interface AdminBillingOrgsResponse {
  readonly billingCycle: string;
  readonly nextCursor: string | null;
  readonly organizations: Array<{
    id: string;
    name: string;
    slug: string;
    plan: string;
    wallet: { balance: string; currency: string };
    monthToDate: { successes: number; spend: string };
    createdAt: string;
  }>;
}

export interface AdminBillingEventsResponse {
  readonly billingCycle: string;
  readonly nextCursor: string | null;
  readonly events: Array<{
    id: string;
    occurredAt: string;
    org: { id: string; name: string };
    userId: string;
    agentId: string | null;
    eventType: string;
    amountCharged: string;
    apiEndpoint: string | null;
    httpStatusCode: number | null;
    responseTimeMs: number | null;
  }>;
}

export async function getAdminBillingMetrics(): Promise<AdminBillingMetricsResponse | null> {
  return getJson<AdminBillingMetricsResponse>("/api/v1/admin/billing/metrics");
}

export async function getAdminBillingOrgs(input?: { cursor?: string; take?: number }): Promise<AdminBillingOrgsResponse | null> {
  const qs = new URLSearchParams();
  if (input?.cursor) qs.set("cursor", input.cursor);
  if (input?.take) qs.set("take", String(input.take));
  const suffix = qs.size ? `?${qs.toString()}` : "";
  return getJson<AdminBillingOrgsResponse>(`/api/v1/admin/billing/orgs${suffix}`);
}

export async function getAdminBillingEvents(input?: {
  billingCycle?: string;
  orgId?: string;
  eventType?: string;
  cursor?: string;
  take?: number;
}): Promise<AdminBillingEventsResponse | null> {
  const qs = new URLSearchParams();
  if (input?.billingCycle) qs.set("billingCycle", input.billingCycle);
  if (input?.orgId) qs.set("orgId", input.orgId);
  if (input?.eventType) qs.set("eventType", input.eventType);
  if (input?.cursor) qs.set("cursor", input.cursor);
  if (input?.take) qs.set("take", String(input.take));
  const suffix = qs.size ? `?${qs.toString()}` : "";
  return getJson<AdminBillingEventsResponse>(`/api/v1/admin/billing/events${suffix}`);
}

export async function postAdminSetPlan(orgId: string, plan: string) {
  return postJson<{ organization: { id: string; plan: string } }>(`/api/v1/admin/billing/orgs/${encodeURIComponent(orgId)}/plan`, {
    plan,
  });
}

export async function postAdminCredit(orgId: string, amount: string, reason?: string) {
  return postJson<{ wallet: { balance: string; currency: string } }>(`/api/v1/admin/billing/orgs/${encodeURIComponent(orgId)}/credit`, {
    amount,
    ...(reason ? { reason } : null),
  });
}

export async function postAdminRateOverride(input: {
  orgId: string;
  eventType: string;
  unitPrice: string;
  effectiveFrom?: string;
  effectiveTo?: string;
}) {
  return postJson<{ override: { id: string } }>(`/api/v1/admin/billing/orgs/${encodeURIComponent(input.orgId)}/rates`, {
    eventType: input.eventType,
    unitPrice: input.unitPrice,
    ...(input.effectiveFrom ? { effectiveFrom: input.effectiveFrom } : null),
    ...(input.effectiveTo ? { effectiveTo: input.effectiveTo } : null),
  });
}

export async function postAdminTriggerRollup(input?: { mode?: "daily" | "monthly" | "both"; date?: string; billingCycle?: string }) {
  return postJson<Record<string, unknown>>("/api/v1/admin/billing/trigger-rollup", input ?? {});
}

