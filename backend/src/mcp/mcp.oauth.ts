/**
 * MCP OAuth 2.1 client (authorization-code + PKCE), acting on the org's behalf.
 *
 * Flow: discover the protected-resource + authorization-server metadata (RFC 9728 / 8414),
 * register a client if the server supports DCR (RFC 7591) — otherwise use a manually-configured
 * client — then run auth-code + PKCE, store the tokens encrypted, and refresh on demand. The
 * resulting access token is only ever used backend-side (discovery + proxy execution); it is
 * never returned to the browser or shipped to the runner.
 *
 * No import of mcp.service here (mcp.service imports this for token injection) — avoids a cycle.
 */
import crypto from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { McpRepository } from './mcp.repository.js';
import { discoverHttpServer, McpAuthRequiredError } from './mcpHttpClient.js';
import { assertSafeFetchUrl } from './ssrfGuard.js';
import type { McpServerSecret } from './mcp.types.js';

const repo = new McpRepository();

export class McpOAuthError extends Error {
  readonly code = 'mcp_oauth_error';
}

// ---- small crypto/PKCE helpers ----

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function genVerifier(): string {
  return base64url(crypto.randomBytes(32));
}
function challengeFor(verifier: string): string {
  return base64url(crypto.createHash('sha256').update(verifier).digest());
}
function genState(): string {
  return crypto.randomBytes(24).toString('hex');
}
function safeHost(u: string): string {
  try {
    return new URL(u).host;
  } catch {
    return 'endpoint';
  }
}

// ---- guarded HTTP helpers (all go through the SSRF guard) ----

async function fetchJsonGuarded(url: string, init?: RequestInit): Promise<any> {
  await assertSafeFetchUrl(url);
  let resp: Response;
  try {
    resp = await fetch(url, init);
  } catch (e) {
    throw new McpOAuthError(`Cannot reach ${safeHost(url)}: ${e instanceof Error ? e.message : String(e)}`);
  }
  const text = await resp.text();
  let json: any = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    /* non-JSON */
  }
  if (!resp.ok || json.error) {
    throw new McpOAuthError(json.error_description || json.error || `HTTP ${resp.status} from ${safeHost(url)}`);
  }
  return json;
}

/** Token/refresh request (form-encoded). Reads the error body for a useful message. */
async function postForm(url: string, form: Record<string, string>): Promise<any> {
  await assertSafeFetchUrl(url);
  let resp: Response;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(form).toString(),
    });
  } catch (e) {
    throw new McpOAuthError(`Cannot reach token endpoint: ${e instanceof Error ? e.message : String(e)}`);
  }
  const text = await resp.text();
  let json: any = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    /* non-JSON */
  }
  if (!resp.ok || json.error) {
    throw new McpOAuthError(`Token endpoint error: ${json.error_description || json.error || `HTTP ${resp.status}`}`);
  }
  return json;
}

function parseResourceMetadataUrl(header: string | null): string | null {
  if (!header) return null;
  const m = header.match(/resource_metadata="?([^",\s]+)"?/i);
  return m?.[1] ?? null;
}

async function fetchAsMetadata(issuer: string): Promise<any> {
  const base = issuer.replace(/\/$/, '');
  const origin = new URL(issuer).origin;
  const candidates = [
    `${base}/.well-known/oauth-authorization-server`,
    `${origin}/.well-known/oauth-authorization-server`,
    `${base}/.well-known/openid-configuration`,
    `${origin}/.well-known/openid-configuration`,
  ];
  for (const url of [...new Set(candidates)]) {
    try {
      return await fetchJsonGuarded(url);
    } catch {
      /* try the next well-known location */
    }
  }
  throw new McpOAuthError('Could not fetch authorization-server metadata');
}

/** Discover OAuth metadata from a server: 401 → RFC 9728 resource metadata → RFC 8414 AS metadata. */
async function discoverOAuthMetadata(endpointUrl: string): Promise<{
  issuer: string;
  resource: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint: string | null;
  scope: string;
}> {
  let resourceMetaUrl: string | null = null;
  try {
    await discoverHttpServer({ url: endpointUrl });
  } catch (e) {
    if (e instanceof McpAuthRequiredError) resourceMetaUrl = parseResourceMetadataUrl(e.wwwAuthenticate);
    // other errors: server may be reachable but not advertise via 401 — fall through to guesses
  }

  let authServers: string[] = [];
  let resource = endpointUrl;
  const tryResourceMeta = async (u: string) => {
    const meta = await fetchJsonGuarded(u);
    if (Array.isArray(meta.authorization_servers)) authServers = meta.authorization_servers;
    if (typeof meta.resource === 'string') resource = meta.resource;
  };

  if (resourceMetaUrl) {
    try {
      await tryResourceMeta(resourceMetaUrl);
    } catch {
      /* fall through */
    }
  }
  if (authServers.length === 0) {
    try {
      await tryResourceMeta(`${new URL(endpointUrl).origin}/.well-known/oauth-protected-resource`);
    } catch {
      /* fall through */
    }
  }

  const issuer = authServers[0] ?? new URL(endpointUrl).origin;
  const as = await fetchAsMetadata(issuer);
  if (!as.authorization_endpoint || !as.token_endpoint) {
    throw new McpOAuthError('Authorization-server metadata is missing required endpoints');
  }
  return {
    issuer,
    resource,
    authorizationEndpoint: String(as.authorization_endpoint),
    tokenEndpoint: String(as.token_endpoint),
    registrationEndpoint: as.registration_endpoint ? String(as.registration_endpoint) : null,
    scope: Array.isArray(as.scopes_supported) ? as.scopes_supported.join(' ') : '',
  };
}

async function registerClient(
  registrationEndpoint: string,
  redirectUri: string,
  scope: string,
): Promise<{ clientId: string; clientSecret?: string }> {
  const meta = await fetchJsonGuarded(registrationEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_name: 'Qlix',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'client_secret_post',
      ...(scope ? { scope } : {}),
    }),
  });
  if (!meta.client_id) throw new McpOAuthError('Dynamic client registration returned no client_id');
  return { clientId: String(meta.client_id), clientSecret: meta.client_secret ? String(meta.client_secret) : undefined };
}

/** Merge a token-endpoint response into the stored secret and persist it. */
async function persistTokens(serverId: string, secret: McpServerSecret, tok: any): Promise<string> {
  const accessToken = String(tok.access_token);
  secret.oauth = {
    ...(secret.oauth ?? {}),
    accessToken,
    refreshToken: tok.refresh_token ? String(tok.refresh_token) : secret.oauth?.refreshToken,
    expiresAtMs: typeof tok.expires_in === 'number' ? Date.now() + tok.expires_in * 1000 : undefined,
    tokenType: tok.token_type ? String(tok.token_type) : 'Bearer',
  };
  await repo.writeSecret(serverId, secret);
  return accessToken;
}

export const mcpOAuth = {
  /** Build the provider authorization URL (discovering metadata / registering a client as needed). */
  async beginAuthorization(input: {
    orgId: string;
    serverId: string;
    userId: string;
    redirectUri: string;
  }): Promise<{ authorizationUrl: string }> {
    const server = await prisma.mcpServer.findFirst({ where: { id: input.serverId, orgId: input.orgId } });
    if (!server) throw new McpOAuthError('Server not found');
    if (server.transport !== 'http' || !server.endpointUrl) {
      throw new McpOAuthError('OAuth is only available for HTTP MCP servers');
    }

    let authorizationEndpoint = server.oauthAuthorizationEndpoint;
    let tokenEndpoint = server.oauthTokenEndpoint;
    let registrationEndpoint = server.oauthRegistrationEndpoint;
    let resource = server.oauthResource;
    let scope = server.oauthScope;
    let clientId = server.oauthClientId;

    if (!authorizationEndpoint || !tokenEndpoint) {
      const meta = await discoverOAuthMetadata(server.endpointUrl);
      authorizationEndpoint = meta.authorizationEndpoint;
      tokenEndpoint = meta.tokenEndpoint;
      registrationEndpoint = meta.registrationEndpoint;
      resource = resource || meta.resource;
      scope = scope || meta.scope;
      await repo.setOAuthMetadata(input.serverId, {
        issuer: meta.issuer,
        authorizationEndpoint,
        tokenEndpoint,
        registrationEndpoint,
        resource: resource ?? undefined,
        scope: scope ?? undefined,
      });
    }

    if (!clientId) {
      if (!registrationEndpoint) {
        throw new McpOAuthError(
          'No client ID configured and the server does not support dynamic registration. Add a client ID in the server settings.',
        );
      }
      const reg = await registerClient(registrationEndpoint, input.redirectUri, scope ?? '');
      clientId = reg.clientId;
      await repo.setOAuthMetadata(input.serverId, { clientId });
      if (reg.clientSecret) {
        const secret = await repo.loadSecret(input.serverId);
        secret.oauth = { ...(secret.oauth ?? {}), clientSecret: reg.clientSecret };
        await repo.writeSecret(input.serverId, secret);
      }
    }

    const codeVerifier = genVerifier();
    const state = genState();
    await prisma.mcpOAuthSession.create({
      data: {
        mcpServerId: input.serverId,
        state,
        codeVerifier,
        redirectUri: input.redirectUri,
        createdByUserId: input.userId,
        expiresAtMs: BigInt(Date.now() + 10 * 60 * 1000),
      },
    });

    const url = new URL(authorizationEndpoint);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', input.redirectUri);
    url.searchParams.set('code_challenge', challengeFor(codeVerifier));
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('state', state);
    if (scope) url.searchParams.set('scope', scope);
    if (resource) url.searchParams.set('resource', resource);
    // Provider-specific extras (Google: access_type=offline&prompt=consent for a refresh token).
    if (server.oauthAuthParams) {
      for (const [k, v] of new URLSearchParams(server.oauthAuthParams)) {
        if (!url.searchParams.has(k)) url.searchParams.set(k, v);
      }
    }
    return { authorizationUrl: url.toString() };
  },

  /** Handle the provider redirect: exchange the code for tokens. Returns the server to discover. */
  async handleCallback(input: { state: string; code: string }): Promise<{ serverId: string; orgId: string }> {
    const session = await prisma.mcpOAuthSession.findUnique({ where: { state: input.state } });
    if (!session) throw new McpOAuthError('Invalid or expired authorization state');
    // Single-use: consume immediately whatever happens next.
    await prisma.mcpOAuthSession.delete({ where: { id: session.id } }).catch(() => {});
    if (Number(session.expiresAtMs) < Date.now()) throw new McpOAuthError('Authorization expired — please retry');

    const server = await prisma.mcpServer.findUnique({ where: { id: session.mcpServerId } });
    if (!server || !server.oauthTokenEndpoint || !server.oauthClientId) {
      throw new McpOAuthError('Server OAuth configuration is incomplete');
    }

    const secret = await repo.loadSecret(server.id);
    const form: Record<string, string> = {
      grant_type: 'authorization_code',
      code: input.code,
      redirect_uri: session.redirectUri,
      client_id: server.oauthClientId,
      code_verifier: session.codeVerifier,
    };
    if (server.oauthResource) form.resource = server.oauthResource;
    if (secret.oauth?.clientSecret) form.client_secret = secret.oauth.clientSecret;

    const tok = await postForm(server.oauthTokenEndpoint, form);
    await persistTokens(server.id, secret, tok);
    await repo.setOAuthConnected(server.id, true);
    return { serverId: server.id, orgId: server.orgId };
  },

  /** Return a valid access token for a connected server, refreshing if it's near expiry. */
  async ensureFreshToken(serverId: string): Promise<string> {
    const server = await prisma.mcpServer.findUnique({ where: { id: serverId } });
    if (!server) throw new McpOAuthError('Server not found');
    const secret = await repo.loadSecret(serverId);
    const oauth = secret.oauth;
    if (!oauth?.accessToken) {
      throw new McpOAuthError('Server is not connected — connect the OAuth account first');
    }

    const fresh = oauth.expiresAtMs && oauth.expiresAtMs - 60_000 > Date.now();
    if (fresh) return oauth.accessToken;

    if (!oauth.refreshToken || !server.oauthTokenEndpoint || !server.oauthClientId) {
      throw new McpOAuthError('Access token expired and cannot be refreshed — reconnect the OAuth account');
    }
    const form: Record<string, string> = {
      grant_type: 'refresh_token',
      refresh_token: oauth.refreshToken,
      client_id: server.oauthClientId,
    };
    if (server.oauthResource) form.resource = server.oauthResource;
    if (oauth.clientSecret) form.client_secret = oauth.clientSecret;
    const tok = await postForm(server.oauthTokenEndpoint, form);
    return persistTokens(serverId, secret, tok);
  },

  /** Authorization header for a connected server (used by discovery + proxy execution). */
  async bearerHeader(serverId: string): Promise<Record<string, string>> {
    const token = await this.ensureFreshToken(serverId);
    return { Authorization: `Bearer ${token}` };
  },

  async disconnect(orgId: string, serverId: string): Promise<void> {
    const server = await prisma.mcpServer.findFirst({ where: { id: serverId, orgId }, select: { id: true } });
    if (!server) throw new McpOAuthError('Server not found');
    await repo.clearOAuthTokens(serverId);
  },
};
