import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { roleCan } from '../lib/orgPermissions.js';
import { authenticateUser } from '../middleware/authenticateUser.js';
import { assertRunnerAuth, RunnerUnauthorizedError } from '../agentChat/runnerAuth.js';
import { McpRepository } from '../mcp/mcp.repository.js';
import { mcpService, McpValidationError } from '../mcp/mcp.service.js';
import { mcpOAuth, McpOAuthError } from '../mcp/mcp.oauth.js';
import { callHttpTool } from '../mcp/mcpHttpClient.js';
import { slugify } from '../mcp/mcp.governance.js';
import type { McpAuthType, McpGovernance, McpTransport } from '../mcp/mcp.types.js';

/** Where the OAuth provider redirects back to. Fixed per request origin so it matches DCR. */
function oauthRedirectUri(request: Request): string {
  const configured = process.env.MCP_OAUTH_REDIRECT_URI;
  if (configured) return configured;
  const proto = (request.headers['x-forwarded-proto'] as string) || request.protocol;
  return `${proto}://${request.get('host')}/api/v1/mcp/oauth/callback`;
}

/** Minimal HTML that notifies the opener (the connectors page) and closes the popup. */
function oauthPopupHtml(payload: { ok: boolean; message?: string }): string {
  const json = JSON.stringify({ type: 'qlix-mcp-oauth', ...payload });
  return `<!doctype html><meta charset="utf-8"><title>Qlix</title><body style="font-family:system-ui;background:#0b0b0f;color:#ddd;padding:24px">
<p>${payload.ok ? 'Connected. You can close this window.' : 'Connection failed.'}</p>
<script>try{window.opener&&window.opener.postMessage(${json},'*')}catch(e){}setTimeout(function(){window.close()},400)</script>
</body>`;
}

const repo = new McpRepository();

async function canManageMcp(request: Request): Promise<boolean> {
  const auth = request.auth!;
  const org = await prisma.organization.findUnique({
    where: { id: auth.orgId },
    select: { workspaceKind: true },
  });
  if (!org) return false;
  if (org.workspaceKind === 'individual') return true;
  return roleCan(auth.role, 'org_settings') || roleCan(auth.role, 'manage_brain');
}

async function assertAgentInOrg(agentId: string, orgId: string): Promise<boolean> {
  const agent = await prisma.agent.findFirst({ where: { id: agentId, orgId }, select: { id: true } });
  return agent !== null;
}

const headerRecord = z.record(z.string(), z.string()).optional();

const createSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(500).optional(),
    transport: z.enum(['http', 'stdio']),
    endpointUrl: z.string().url().max(2000).optional(),
    command: z.string().trim().max(500).optional(),
    args: z.array(z.string().max(500)).max(50).optional(),
    authType: z.enum(['none', 'header', 'oauth']).optional(),
    headers: headerRecord,
    env: z.record(z.string(), z.string()).optional(),
  })
  .refine((d) => (d.transport === 'http' ? Boolean(d.endpointUrl) : Boolean(d.command)), {
    message: 'http transport requires endpointUrl; stdio transport requires command',
  });

const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    description: z.string().trim().max(500).optional(),
    endpointUrl: z.string().url().max(2000).optional(),
    command: z.string().trim().max(500).optional(),
    args: z.array(z.string().max(500)).max(50).optional(),
    // Empty-string value = remove that key; otherwise set/rotate it. Absent keys are kept.
    headers: z.record(z.string(), z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'No fields to update' });

const governanceSchema = z.object({ governance: z.enum(['auto', 'jit', 'blocked']) });
const bindingSchema = z.object({
  allowedTools: z.array(z.string().min(1).max(128)).max(200),
});

// Manual OAuth client config (providers without dynamic registration).
const oauthConfigSchema = z.object({
  clientId: z.string().trim().max(512).optional(),
  clientSecret: z.string().max(2048).optional(),
  scope: z.string().trim().max(1024).optional(),
  issuer: z.string().url().max(2000).optional(),
  authorizationEndpoint: z.string().url().max(2000).optional(),
  tokenEndpoint: z.string().url().max(2000).optional(),
  registrationEndpoint: z.string().url().max(2000).optional(),
  /** Extra authorization-request params as `k=v&k2=v2` (e.g. `access_type=offline&prompt=consent`). */
  authParams: z.string().max(500).optional(),
});

// Runner → backend proxy execution of one MCP tool call.
const proxyCallSchema = z.object({
  agentId: z.string().min(1),
  server: z.string().min(1),
  tool: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()).optional(),
});

export function createMcpRouter(): Router {
  const router = Router();

  // ---- Servers ----

  router.get('/servers', authenticateUser(true), async (request: Request, response: Response) => {
    try {
      const servers = await repo.listForOrg(request.auth!.orgId);
      response.json({ servers });
    } catch (err) {
      console.error('[mcp] list servers', err);
      response.status(500).json({ error: { code: 'mcp_list_failed', message: 'Failed to list MCP servers' } });
    }
  });

  router.post('/servers', authenticateUser(true), async (request: Request, response: Response) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: { code: 'invalid_body', message: parsed.error.issues[0]?.message ?? 'Invalid body' } });
      return;
    }
    try {
      if (!(await canManageMcp(request))) {
        response.status(403).json({ error: { code: 'forbidden', message: 'Not allowed to manage MCP servers' } });
        return;
      }
      const auth = request.auth!;
      const d = parsed.data;
      let slug = slugify(d.name);
      if (!slug) {
        response.status(400).json({ error: { code: 'invalid_body', message: 'Name must contain letters or digits' } });
        return;
      }
      // De-dupe slug within org.
      let suffix = 2;
      while (await repo.slugTaken(auth.orgId, slug)) {
        slug = `${slugify(d.name)}-${suffix++}`;
      }

      const authType: McpAuthType = d.authType ?? (d.headers && Object.keys(d.headers).length > 0 ? 'header' : 'none');
      const hasSecret = Boolean((d.headers && Object.keys(d.headers).length) || (d.env && Object.keys(d.env).length));

      const created = await repo.create({
        orgId: auth.orgId,
        createdByUserId: auth.userId,
        slug,
        name: d.name,
        description: d.description ?? '',
        transport: d.transport as McpTransport,
        endpointUrl: d.transport === 'http' ? d.endpointUrl ?? null : null,
        command: d.transport === 'stdio' ? d.command ?? null : null,
        args: d.transport === 'stdio' ? d.args ?? [] : [],
        authType,
        secret: hasSecret ? { headers: d.headers, env: d.env } : null,
      });

      // Best-effort discovery (http only); never fail the create on a discovery error.
      let server = created;
      try {
        server = await mcpService.discover(auth.orgId, created.id);
      } catch (err) {
        server = (await repo.getForOrg(auth.orgId, created.id)) ?? created;
        if (!(err instanceof McpValidationError)) console.error('[mcp] discover on create', err);
      }
      response.status(201).json({ server });
    } catch (err) {
      console.error('[mcp] create server', err);
      response.status(500).json({ error: { code: 'mcp_create_failed', message: 'Failed to register MCP server' } });
    }
  });

  router.get('/servers/:id', authenticateUser(true), async (request: Request, response: Response) => {
    try {
      const server = await repo.getForOrg(request.auth!.orgId, request.params.id);
      if (!server) {
        response.status(404).json({ error: { code: 'not_found', message: 'MCP server not found' } });
        return;
      }
      response.json({ server });
    } catch (err) {
      console.error('[mcp] get server', err);
      response.status(500).json({ error: { code: 'mcp_get_failed', message: 'Failed to load MCP server' } });
    }
  });

  // Edit a server in place (rotate secrets, change endpoint/command) without losing bindings.
  router.patch('/servers/:id', authenticateUser(true), async (request: Request, response: Response) => {
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: { code: 'invalid_body', message: parsed.error.issues[0]?.message ?? 'Invalid body' } });
      return;
    }
    try {
      if (!(await canManageMcp(request))) {
        response.status(403).json({ error: { code: 'forbidden', message: 'Not allowed to manage MCP servers' } });
        return;
      }
      const result = await repo.update(request.auth!.orgId, request.params.id, parsed.data);
      if (!result) {
        response.status(404).json({ error: { code: 'not_found', message: 'MCP server not found' } });
        return;
      }
      // Re-discover http servers when the connection (endpoint/secret) changed; best-effort.
      let server = result.server;
      if (server.transport === 'http' && result.connectionChanged) {
        try {
          server = await mcpService.discover(request.auth!.orgId, server.id);
        } catch (err) {
          server = (await repo.getForOrg(request.auth!.orgId, server.id)) ?? server;
          if (!(err instanceof McpValidationError)) console.error('[mcp] discover on update', err);
        }
      }
      response.json({ server });
    } catch (err) {
      console.error('[mcp] update server', err);
      response.status(500).json({ error: { code: 'mcp_update_failed', message: 'Failed to update MCP server' } });
    }
  });

  // The key names (never values) of a server's stored secret, so the edit UI can show them masked.
  router.get('/servers/:id/secret-keys', authenticateUser(true), async (request: Request, response: Response) => {
    try {
      if (!(await canManageMcp(request))) {
        response.status(403).json({ error: { code: 'forbidden', message: 'Not allowed to manage MCP servers' } });
        return;
      }
      const server = await repo.getForOrg(request.auth!.orgId, request.params.id);
      if (!server) {
        response.status(404).json({ error: { code: 'not_found', message: 'MCP server not found' } });
        return;
      }
      response.json(await repo.secretKeys(server.id));
    } catch (err) {
      console.error('[mcp] secret keys', err);
      response.status(500).json({ error: { code: 'mcp_secret_keys_failed', message: 'Failed to load secret keys' } });
    }
  });

  router.post('/servers/:id/discover', authenticateUser(true), async (request: Request, response: Response) => {
    try {
      if (!(await canManageMcp(request))) {
        response.status(403).json({ error: { code: 'forbidden', message: 'Not allowed to manage MCP servers' } });
        return;
      }
      const server = await mcpService.discover(request.auth!.orgId, request.params.id);
      response.json({ server });
    } catch (err) {
      if (err instanceof McpValidationError) {
        response.status(400).json({ error: { code: err.code, message: err.message } });
        return;
      }
      console.error('[mcp] discover', err);
      response.status(500).json({ error: { code: 'mcp_discover_failed', message: 'Discovery failed' } });
    }
  });

  router.delete('/servers/:id', authenticateUser(true), async (request: Request, response: Response) => {
    try {
      if (!(await canManageMcp(request))) {
        response.status(403).json({ error: { code: 'forbidden', message: 'Not allowed to manage MCP servers' } });
        return;
      }
      // Capture bound agents so we can drop their mcp.* scopes after deletion.
      const bindings = await prisma.agentMcpBinding.findMany({
        where: { mcpServerId: request.params.id, server: { orgId: request.auth!.orgId } },
        select: { agentId: true },
      });
      await repo.delete(request.auth!.orgId, request.params.id);
      for (const b of bindings) await mcpService.syncAgentScopes(b.agentId);
      response.status(204).send();
    } catch (err) {
      console.error('[mcp] delete server', err);
      response.status(500).json({ error: { code: 'mcp_delete_failed', message: 'Failed to delete MCP server' } });
    }
  });

  // ---- Per-tool governance / approval ----

  router.put('/servers/:id/tools/:name/governance', authenticateUser(true), async (request: Request, response: Response) => {
    const parsed = governanceSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: { code: 'invalid_body', message: 'governance must be auto|jit|blocked' } });
      return;
    }
    try {
      if (!(await canManageMcp(request))) {
        response.status(403).json({ error: { code: 'forbidden', message: 'Not allowed to manage MCP servers' } });
        return;
      }
      const server = await repo.getForOrg(request.auth!.orgId, request.params.id);
      if (!server) {
        response.status(404).json({ error: { code: 'not_found', message: 'MCP server not found' } });
        return;
      }
      await repo.setToolGovernance(server.id, request.params.name, parsed.data.governance as McpGovernance);
      // Re-sync any agents bound to this server so jit/permission scopes reflect the change.
      const bindings = await prisma.agentMcpBinding.findMany({ where: { mcpServerId: server.id }, select: { agentId: true } });
      for (const b of bindings) await mcpService.syncAgentScopes(b.agentId);
      response.json({ ok: true });
    } catch (err) {
      console.error('[mcp] set governance', err);
      response.status(500).json({ error: { code: 'mcp_governance_failed', message: 'Failed to set governance' } });
    }
  });

  router.post('/servers/:id/tools/:name/approve', authenticateUser(true), async (request: Request, response: Response) => {
    try {
      if (!(await canManageMcp(request))) {
        response.status(403).json({ error: { code: 'forbidden', message: 'Not allowed to manage MCP servers' } });
        return;
      }
      const server = await repo.getForOrg(request.auth!.orgId, request.params.id);
      if (!server) {
        response.status(404).json({ error: { code: 'not_found', message: 'MCP server not found' } });
        return;
      }
      await repo.approveTool(server.id, request.params.name);
      response.json({ ok: true });
    } catch (err) {
      console.error('[mcp] approve tool', err);
      response.status(500).json({ error: { code: 'mcp_approve_failed', message: 'Failed to approve tool' } });
    }
  });

  // Agents affected by a server (blast radius for governance/drift changes).
  router.get('/servers/:id/agents', authenticateUser(true), async (request: Request, response: Response) => {
    try {
      const server = await repo.getForOrg(request.auth!.orgId, request.params.id);
      if (!server) {
        response.status(404).json({ error: { code: 'not_found', message: 'MCP server not found' } });
        return;
      }
      const agents = await repo.agentsForServer(server.id);
      response.json({ agents });
    } catch (err) {
      console.error('[mcp] list server agents', err);
      response.status(500).json({ error: { code: 'mcp_agents_failed', message: 'Failed to list agents' } });
    }
  });

  // ---- Agent bindings ----

  router.get('/agents/:agentId/bindings', authenticateUser(true), async (request: Request, response: Response) => {
    try {
      if (!(await assertAgentInOrg(request.params.agentId, request.auth!.orgId))) {
        response.status(404).json({ error: { code: 'not_found', message: 'Agent not found' } });
        return;
      }
      const bindings = await repo.listBindingsForAgent(request.params.agentId);
      response.json({ bindings });
    } catch (err) {
      console.error('[mcp] list bindings', err);
      response.status(500).json({ error: { code: 'mcp_bindings_failed', message: 'Failed to list bindings' } });
    }
  });

  router.put('/agents/:agentId/bindings/:serverId', authenticateUser(true), async (request: Request, response: Response) => {
    const parsed = bindingSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: { code: 'invalid_body', message: 'allowedTools must be an array of tool names' } });
      return;
    }
    try {
      if (!(await canManageMcp(request))) {
        response.status(403).json({ error: { code: 'forbidden', message: 'Not allowed to manage MCP servers' } });
        return;
      }
      const auth = request.auth!;
      if (!(await assertAgentInOrg(request.params.agentId, auth.orgId))) {
        response.status(404).json({ error: { code: 'not_found', message: 'Agent not found' } });
        return;
      }
      const server = await repo.getForOrg(auth.orgId, request.params.serverId);
      if (!server) {
        response.status(404).json({ error: { code: 'not_found', message: 'MCP server not found' } });
        return;
      }
      await repo.upsertBinding({
        agentId: request.params.agentId,
        mcpServerId: server.id,
        allowedTools: parsed.data.allowedTools,
      });
      await mcpService.syncAgentScopes(request.params.agentId);
      const bindings = await repo.listBindingsForAgent(request.params.agentId);
      response.json({ bindings });
    } catch (err) {
      console.error('[mcp] upsert binding', err);
      response.status(500).json({ error: { code: 'mcp_binding_failed', message: 'Failed to save binding' } });
    }
  });

  router.delete('/agents/:agentId/bindings/:serverId', authenticateUser(true), async (request: Request, response: Response) => {
    try {
      if (!(await canManageMcp(request))) {
        response.status(403).json({ error: { code: 'forbidden', message: 'Not allowed to manage MCP servers' } });
        return;
      }
      if (!(await assertAgentInOrg(request.params.agentId, request.auth!.orgId))) {
        response.status(404).json({ error: { code: 'not_found', message: 'Agent not found' } });
        return;
      }
      await repo.deleteBinding(request.params.agentId, request.params.serverId);
      await mcpService.syncAgentScopes(request.params.agentId);
      response.status(204).send();
    } catch (err) {
      console.error('[mcp] delete binding', err);
      response.status(500).json({ error: { code: 'mcp_binding_delete_failed', message: 'Failed to delete binding' } });
    }
  });

  // ---- OAuth (authType = 'oauth') ----

  // Manual client config for providers without dynamic client registration.
  router.put('/servers/:id/oauth/config', authenticateUser(true), async (request: Request, response: Response) => {
    const parsed = oauthConfigSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid OAuth config' } });
      return;
    }
    try {
      if (!(await canManageMcp(request))) {
        response.status(403).json({ error: { code: 'forbidden', message: 'Not allowed to manage MCP servers' } });
        return;
      }
      const server = await repo.getForOrg(request.auth!.orgId, request.params.id);
      if (!server) {
        response.status(404).json({ error: { code: 'not_found', message: 'MCP server not found' } });
        return;
      }
      const d = parsed.data;
      await repo.setOAuthMetadata(server.id, {
        clientId: d.clientId,
        scope: d.scope,
        issuer: d.issuer,
        authorizationEndpoint: d.authorizationEndpoint,
        tokenEndpoint: d.tokenEndpoint,
        registrationEndpoint: d.registrationEndpoint,
        authParams: d.authParams,
      });
      if (d.clientSecret !== undefined) {
        const secret = await repo.loadSecret(server.id);
        secret.oauth = { ...(secret.oauth ?? {}), clientSecret: d.clientSecret };
        await repo.writeSecret(server.id, secret);
      }
      response.json({ ok: true });
    } catch (err) {
      console.error('[mcp] oauth config', err);
      response.status(500).json({ error: { code: 'oauth_config_failed', message: 'Failed to save OAuth config' } });
    }
  });

  // Begin authorization: returns the provider URL for the frontend to open in a popup.
  router.post('/servers/:id/oauth/start', authenticateUser(true), async (request: Request, response: Response) => {
    try {
      if (!(await canManageMcp(request))) {
        response.status(403).json({ error: { code: 'forbidden', message: 'Not allowed to manage MCP servers' } });
        return;
      }
      const { authorizationUrl } = await mcpOAuth.beginAuthorization({
        orgId: request.auth!.orgId,
        serverId: request.params.id,
        userId: request.auth!.userId,
        redirectUri: oauthRedirectUri(request),
      });
      response.json({ authorizationUrl });
    } catch (err) {
      if (err instanceof McpOAuthError) {
        response.status(400).json({ error: { code: err.code, message: err.message } });
        return;
      }
      console.error('[mcp] oauth start', err);
      response.status(500).json({ error: { code: 'oauth_start_failed', message: 'Failed to start OAuth' } });
    }
  });

  // Provider redirect target (unauthenticated — trust comes from the single-use `state`).
  router.get('/oauth/callback', async (request: Request, response: Response) => {
    const state = String(request.query.state ?? '');
    const code = String(request.query.code ?? '');
    const providerError = request.query.error ? String(request.query.error) : '';
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (providerError) {
      response.status(400).send(oauthPopupHtml({ ok: false, message: providerError }));
      return;
    }
    if (!state || !code) {
      response.status(400).send(oauthPopupHtml({ ok: false, message: 'Missing code or state' }));
      return;
    }
    try {
      const { serverId, orgId } = await mcpOAuth.handleCallback({ state, code });
      // Token stored; pull the catalog now that we can authenticate. Best-effort.
      try {
        await mcpService.discover(orgId, serverId);
      } catch {
        /* discovery can be retried from the UI */
      }
      response.send(oauthPopupHtml({ ok: true }));
    } catch (err) {
      response.status(400).send(oauthPopupHtml({ ok: false, message: err instanceof Error ? err.message : 'OAuth failed' }));
    }
  });

  router.post('/servers/:id/oauth/disconnect', authenticateUser(true), async (request: Request, response: Response) => {
    try {
      if (!(await canManageMcp(request))) {
        response.status(403).json({ error: { code: 'forbidden', message: 'Not allowed to manage MCP servers' } });
        return;
      }
      await mcpOAuth.disconnect(request.auth!.orgId, request.params.id);
      response.json({ ok: true });
    } catch (err) {
      console.error('[mcp] oauth disconnect', err);
      response.status(500).json({ error: { code: 'oauth_disconnect_failed', message: 'Failed to disconnect' } });
    }
  });

  // ---- Runner → backend proxy execution (http servers; secrets/tokens stay on the backend) ----

  router.post('/proxy/call', async (request: Request, response: Response) => {
    const parsed = proxyCallSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid proxy call' } });
      return;
    }
    const { agentId, server: slug, tool } = parsed.data;
    const args = (parsed.data.arguments ?? {}) as Record<string, unknown>;
    try {
      await assertRunnerAuth(agentId, request);
    } catch (e) {
      if (e instanceof RunnerUnauthorizedError) {
        response.status(401).json({ error: { code: 'unauthorized', message: e.message } });
        return;
      }
      throw e;
    }
    try {
      const target = await repo.proxyTargetForAgent(agentId, slug, tool);
      if (!target) {
        response.status(404).json({ error: { code: 'not_bound', message: 'Server not bound to this agent' } });
        return;
      }
      if (!target.allowed) {
        response.status(403).json({ error: { code: 'tool_not_allowed', message: 'Tool not allowed, blocked, or pending re-approval' } });
        return;
      }
      const headers = target.authType === 'oauth' ? await mcpOAuth.bearerHeader(target.serverId) : target.headers;
      const result = await callHttpTool({ url: target.endpointUrl, headers, tool, arguments: args });
      response.json({ isError: result.isError, content: result.content });
    } catch (err) {
      response.status(502).json({ error: { code: 'proxy_failed', message: err instanceof Error ? err.message : 'proxy call failed' } });
    }
  });

  return router;
}
