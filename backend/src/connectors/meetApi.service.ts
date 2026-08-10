/**
 * Google Meet REST v2 client. Pure functions — scope/JIT/audit live in meetTool.service.
 * Uses meetings.space.created (create/manage spaces created by this app).
 */
const MEET_API_BASE = 'https://meet.googleapis.com/v2';

export class MeetApiError extends Error {
  readonly code = 'meet_api_failed';
  readonly status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.status = status;
  }
}

async function meetFetch(
  accessToken: string,
  path: string,
  init?: RequestInit,
): Promise<Record<string, unknown>> {
  const resp = await fetch(`${MEET_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const text = await resp.text();
  if (resp.status === 204 || !text) {
    if (!resp.ok) throw new MeetApiError(`Meet API ${resp.status}`, resp.status);
    return {};
  }
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    body = { raw: text.slice(0, 4000) };
  }
  if (!resp.ok) {
    const apiMsg =
      (body.error as { message?: string } | undefined)?.message ?? text.slice(0, 300);
    throw new MeetApiError(`Meet API ${resp.status}: ${apiMsg}`, resp.status);
  }
  return body;
}

export interface MeetSpaceSummary {
  name: string;
  meetingUri: string;
  meetingCode: string;
}

function toSpace(raw: Record<string, unknown>): MeetSpaceSummary {
  return {
    name: String(raw.name ?? ''),
    meetingUri: String(raw.meetingUri ?? ''),
    meetingCode: String(raw.meetingCode ?? ''),
  };
}

/** Create a new Meet space and return the join URL. */
export async function meetCreateSpace(params: {
  accessToken: string;
}): Promise<MeetSpaceSummary> {
  const result = await meetFetch(params.accessToken, '/spaces', {
    method: 'POST',
    body: JSON.stringify({}),
  });
  return toSpace(result);
}

/** Get a space by resource name (`spaces/xxx`) or meeting code. */
export async function meetGetSpace(params: {
  accessToken: string;
  name: string;
}): Promise<MeetSpaceSummary> {
  const name = params.name.trim();
  const path = name.startsWith('spaces/')
    ? `/${name}`
    : `/spaces/${encodeURIComponent(name)}`;
  const result = await meetFetch(params.accessToken, path);
  return toSpace(result);
}

/** End the active conference in a space (does not delete the space resource). */
export async function meetEndActiveConference(params: {
  accessToken: string;
  name: string;
}): Promise<{ name: string; status: 'ended' }> {
  let name = params.name.trim();
  if (!name.startsWith('spaces/')) name = `spaces/${name}`;
  await meetFetch(params.accessToken, `/${name}:endActiveConference`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  return { name, status: 'ended' };
}
