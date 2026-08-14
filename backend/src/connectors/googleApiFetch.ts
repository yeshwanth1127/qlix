/**
 * Shared Google REST fetch helper for Workspace product API clients.
 */

export class GoogleApiError extends Error {
  readonly code = 'google_api_failed';
  readonly status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.status = status;
  }
}

export async function googleApiFetch(
  accessToken: string,
  url: string,
  init?: RequestInit,
): Promise<Record<string, unknown>> {
  const resp = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const text = await resp.text();
  if (resp.status === 204 || !text) {
    if (!resp.ok) throw new GoogleApiError(`Google API ${resp.status}`, resp.status);
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
    throw new GoogleApiError(`Google API ${resp.status}: ${apiMsg}`, resp.status);
  }
  return body;
}
