const defaultBase = "http://localhost:4000";

function apiBase(): string {
  return (process.env.NEXT_PUBLIC_API_BASE_URL ?? defaultBase).replace(/\/$/, "");
}

export interface BillingServiceUsageRow {
  readonly serviceKey: string;
  readonly displayName: string;
  readonly unitPrice: string;
  readonly mtdSuccesses: number;
  readonly mtdSpend: string;
}

export interface BillingOverviewResponse {
  readonly organization: { id: string; name: string; plan: string };
  readonly billingCycle: string;
  readonly wallet: { balance: string; currency: string };
  readonly plan: { name: string };
  readonly services: BillingServiceUsageRow[];
  readonly unlistedServices?: BillingServiceUsageRow[];
  readonly monthToDate: {
    successfulEvents: number;
    failedEvents: number;
    spend: string;
  };
}

export interface BillingEventsResponse {
  readonly billingCycle: string;
  readonly nextCursor: string | null;
  readonly events: Array<{
    id: string;
    eventType: string;
    amountCharged: string;
    occurredAt: string;
    userId: string;
    agentId: string | null;
    apiEndpoint: string | null;
    httpStatusCode: number | null;
    responseTimeMs: number | null;
  }>;
}

export interface BillingStatementsResponse {
  readonly statements: Array<{
    id: string;
    billingCycle: string;
    status: string;
    finalizedAt: string | null;
    total: string;
    createdAt: string;
  }>;
}

export interface BillingStatementDetailResponse {
  readonly statement: {
    id: string;
    billingCycle: string;
    status: string;
    finalizedAt: string | null;
    subtotal: string;
    total: string;
    createdAt: string;
    updatedAt: string;
  };
  readonly lineItems: Array<{
    id: string;
    eventType: string;
    description: string | null;
    quantity: number;
    unitPrice: string;
    amount: string;
  }>;
}

async function getJson<T>(path: string): Promise<T | null> {
  const response = await fetch(`${apiBase()}${path}`, { credentials: "include" });
  if (response.status === 401) return null;
  if (!response.ok) return null;
  return response.json() as Promise<T>;
}

export async function getBillingOverview(): Promise<BillingOverviewResponse | null> {
  return getJson<BillingOverviewResponse>("/api/v1/billing/overview");
}

export async function getBillingEvents(input?: {
  billingCycle?: string;
  eventType?: string;
  cursor?: string;
  take?: number;
}): Promise<BillingEventsResponse | null> {
  const qs = new URLSearchParams();
  if (input?.billingCycle) qs.set("billingCycle", input.billingCycle);
  if (input?.eventType) qs.set("eventType", input.eventType);
  if (input?.cursor) qs.set("cursor", input.cursor);
  if (input?.take) qs.set("take", String(input.take));
  const suffix = qs.size ? `?${qs.toString()}` : "";
  return getJson<BillingEventsResponse>(`/api/v1/billing/events${suffix}`);
}

export async function getBillingStatements(): Promise<BillingStatementsResponse | null> {
  return getJson<BillingStatementsResponse>("/api/v1/billing/statements");
}

export async function getBillingStatementDetail(billingCycle: string): Promise<BillingStatementDetailResponse | null> {
  return getJson<BillingStatementDetailResponse>(`/api/v1/billing/statements/${encodeURIComponent(billingCycle)}`);
}

