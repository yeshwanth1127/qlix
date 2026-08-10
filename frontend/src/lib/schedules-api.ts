import type { ApiErrorBody } from "./auth-api";

const defaultBase = "http://localhost:4000";

function apiBase(): string {
  return (process.env.NEXT_PUBLIC_API_BASE_URL ?? defaultBase).replace(/\/$/, "");
}

export type ScheduleType = "cron" | "once" | "interval";
export type ScheduleStatus = "active" | "paused" | "cancelled" | "completed";

export interface ScheduledEventDTO {
  id: string;
  orgId: string;
  agentId: string;
  createdByAgentId: string | null;
  createdByUserId: string | null;
  scheduleType: ScheduleType;
  cronExpression: string | null;
  onceAt: string | null;
  intervalSeconds: number | null;
  timezone: string;
  actionType: string;
  label: string | null;
  prompt: string;
  enabled: boolean;
  status: ScheduleStatus;
  lastEnqueuedAt: string | null;
  nextRunAt: string | null;
  runCount: number;
  maxRuns: number | null;
  lastError: string | null;
  source: string;
  createdAt: string;
  updatedAt: string;
  agentName?: string | null;
  agentStatus?: string | null;
}

export async function listSchedules(opts?: {
  agentId?: string;
  includeCancelled?: boolean;
}): Promise<ScheduledEventDTO[]> {
  const url = new URL(`${apiBase()}/api/v1/schedules`);
  if (opts?.agentId) url.searchParams.set("agentId", opts.agentId);
  if (opts?.includeCancelled) url.searchParams.set("includeCancelled", "1");
  const res = await fetch(url.toString(), { credentials: "include" });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new Error(body?.error?.message ?? "Failed to load schedules");
  }
  const data = (await res.json()) as { schedules: ScheduledEventDTO[] };
  return data.schedules ?? [];
}

export async function updateSchedule(
  id: string,
  patch: {
    enabled?: boolean;
    status?: "active" | "paused";
    prompt?: string;
    cronExpression?: string;
    label?: string | null;
  },
): Promise<ScheduledEventDTO> {
  const res = await fetch(`${apiBase()}/api/v1/schedules/${encodeURIComponent(id)}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new Error(body?.error?.message ?? "Failed to update schedule");
  }
  const data = (await res.json()) as { schedule: ScheduledEventDTO };
  return data.schedule;
}

export async function cancelSchedule(id: string): Promise<ScheduledEventDTO> {
  const res = await fetch(`${apiBase()}/api/v1/schedules/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new Error(body?.error?.message ?? "Failed to cancel schedule");
  }
  const data = (await res.json()) as { schedule: ScheduledEventDTO };
  return data.schedule;
}
