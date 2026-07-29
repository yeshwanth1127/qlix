/**
 * HTTP client for Orbit (Postiz Public API).
 * Docs: https://docs.postiz.com/public-api
 */

export class OrbitApiError extends Error {
  readonly code = 'orbit_api_error';
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface OrbitCredentials {
  apiKey: string;
  baseUrl: string;
}

function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/$/, '');
}

/** Public API root for self-hosted Orbit/Postiz: `{base}/api/public/v1` */
export function orbitPublicApiRoot(baseUrl: string): string {
  const base = normalizeBaseUrl(baseUrl);
  if (base.endsWith('/api/public/v1') || base.endsWith('/public/v1')) return base;
  if (base.endsWith('/api')) return `${base}/public/v1`;
  return `${base}/api/public/v1`;
}

export function defaultOrbitBaseUrl(): string {
  return normalizeBaseUrl(process.env.ORBIT_BASE_URL?.trim() || 'http://10.0.0.1:4007');
}

async function orbitFetch(
  creds: OrbitCredentials,
  path: string,
  init?: RequestInit,
): Promise<unknown> {
  const url = `${orbitPublicApiRoot(creds.baseUrl)}${path.startsWith('/') ? path : `/${path}`}`;
  const headers = new Headers(init?.headers);
  headers.set('Authorization', creds.apiKey);
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const resp = await fetch(url, { ...init, headers });
  const text = await resp.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = { raw: text.slice(0, 500) };
    }
  }
  if (!resp.ok) {
    const msg =
      typeof body === 'object' && body && 'message' in body
        ? String((body as { message: unknown }).message)
        : text.slice(0, 300) || `Orbit API ${resp.status}`;
    throw new OrbitApiError(msg, resp.status);
  }
  return body;
}

/** Verify API key by listing integrations. */
export async function verifyOrbitCredentials(creds: OrbitCredentials): Promise<{ ok: true; channelCount: number }> {
  const body = await orbitFetch(creds, '/integrations');
  const list = Array.isArray(body) ? body : (body as { integrations?: unknown[] })?.integrations;
  const channelCount = Array.isArray(list) ? list.length : 0;
  return { ok: true, channelCount };
}

export async function orbitListIntegrations(creds: OrbitCredentials): Promise<unknown> {
  return orbitFetch(creds, '/integrations');
}

export async function orbitListPosts(
  creds: OrbitCredentials,
  query?: { startDate?: string; endDate?: string },
): Promise<unknown> {
  const params = new URLSearchParams();
  if (query?.startDate) params.set('startDate', query.startDate);
  if (query?.endDate) params.set('endDate', query.endDate);
  const qs = params.toString();
  return orbitFetch(creds, `/posts${qs ? `?${qs}` : ''}`);
}

export async function orbitCreatePosts(creds: OrbitCredentials, payload: unknown): Promise<unknown> {
  return orbitFetch(creds, '/posts', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function orbitDeletePost(creds: OrbitCredentials, postId: string): Promise<unknown> {
  return orbitFetch(creds, `/posts/${encodeURIComponent(postId)}`, { method: 'DELETE' });
}

export async function orbitAnalytics(
  creds: OrbitCredentials,
  integrationId: string,
): Promise<unknown> {
  return orbitFetch(creds, `/analytics/${encodeURIComponent(integrationId)}`);
}

/** OAuth providers users can connect from Qlix (Orbit Public API `/social/{id}`). */
export const ORBIT_OAUTH_PROVIDERS = [
  'facebook',
  'instagram',
  'instagram-standalone',
  'x',
  'linkedin',
  'linkedin-page',
  'threads',
  'youtube',
  'tiktok',
] as const;

export type OrbitOauthProvider = (typeof ORBIT_OAUTH_PROVIDERS)[number];

export function isOrbitOauthProvider(id: string): id is OrbitOauthProvider {
  return (ORBIT_OAUTH_PROVIDERS as readonly string[]).includes(id);
}

/** Returns Meta/X/… OAuth URL to redirect the browser (channel connect). */
export async function orbitGetSocialConnectUrl(
  creds: OrbitCredentials,
  integration: string,
  refreshIntegrationId?: string,
): Promise<string> {
  const qs = refreshIntegrationId
    ? `?refresh=${encodeURIComponent(refreshIntegrationId)}`
    : '';
  const body = await orbitFetch(creds, `/social/${encodeURIComponent(integration)}${qs}`);
  const url =
    typeof body === 'object' && body && 'url' in body
      ? String((body as { url: unknown }).url)
      : '';
  if (!url.startsWith('https://') && !url.startsWith('http://')) {
    throw new OrbitApiError('Orbit did not return a valid OAuth URL', 502);
  }
  return url;
}

export interface OrbitChannelDTO {
  id: string;
  name: string;
  identifier: string;
  picture: string | null;
  disabled: boolean;
  profile: string | null;
}

export async function orbitListChannels(creds: OrbitCredentials): Promise<OrbitChannelDTO[]> {
  const body = await orbitListIntegrations(creds);
  const list = Array.isArray(body) ? body : [];
  return list.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: String(r.id ?? ''),
      name: String(r.name ?? r.profile ?? r.identifier ?? 'Channel'),
      identifier: String(r.identifier ?? ''),
      picture: r.picture != null ? String(r.picture) : null,
      disabled: Boolean(r.disabled),
      profile: r.profile != null ? String(r.profile) : null,
    };
  });
}

export async function orbitDeleteChannel(creds: OrbitCredentials, integrationId: string): Promise<void> {
  await orbitFetch(creds, `/integrations/${encodeURIComponent(integrationId)}`, {
    method: 'DELETE',
  });
}
