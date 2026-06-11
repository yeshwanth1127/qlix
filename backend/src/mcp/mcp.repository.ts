import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { decryptForAgentSecrets, encryptForAgentSecrets } from '../cloudRunners/agentSecrets.js';
import {
  computeDefinitionHash,
  deriveGovernance,
  deriveRiskLevel,
} from './mcp.governance.js';
import type {
  AgentMcpBindingDTO,
  DiscoveredTool,
  McpAuthType,
  McpGovernance,
  McpRiskLevel,
  McpRuntimeServer,
  McpServerDTO,
  McpServerSecret,
  McpServerStatus,
  McpServerToolDTO,
  McpTransport,
} from './mcp.types.js';

type McpServerRow = Prisma.McpServerGetPayload<{ include: { tools: true } }>;
type McpServerToolRow = Prisma.McpServerToolGetPayload<{}>;

function toToolDto(row: McpServerToolRow): McpServerToolDTO {
  const approved = (row.approvedDefinition as { description?: string; inputSchema?: unknown } | null) ?? null;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    inputSchema: (row.inputSchema as Record<string, unknown> | null) ?? null,
    annotations: (row.annotations as Record<string, unknown> | null) ?? null,
    riskLevel: row.riskLevel as McpRiskLevel,
    defaultGovernance: row.defaultGovernance as McpGovernance,
    definitionHash: row.definitionHash,
    approvedHash: row.approvedHash,
    needsReapproval: row.approvedHash !== null && row.approvedHash !== row.definitionHash,
    approvedDescription: typeof approved?.description === 'string' ? approved.description : null,
    approvedInputSchema: (approved?.inputSchema as Record<string, unknown> | null) ?? null,
  };
}

/** The slice of a tool definition we snapshot at approval time, for drift diffing. */
function definitionSnapshot(tool: DiscoveredTool): Prisma.InputJsonValue {
  return {
    description: tool.description,
    inputSchema: (tool.inputSchema ?? null) as Prisma.InputJsonValue,
  };
}

/**
 * Merge a secret-patch into the current map: a provided key with a value sets/rotates it,
 * a provided key with an empty string removes it, an absent key is left untouched. This lets
 * the edit UI rotate one credential without re-sending (or ever seeing) the others.
 */
function mergeSecretMap(
  current: Record<string, string>,
  patch: Record<string, string> | undefined,
): Record<string, string> {
  if (!patch) return current;
  const out = { ...current };
  for (const [k, v] of Object.entries(patch)) {
    if (v === '') delete out[k];
    else out[k] = v;
  }
  return out;
}

function toServerDto(row: McpServerRow): McpServerDTO {
  return {
    id: row.id,
    orgId: row.orgId,
    slug: row.slug,
    name: row.name,
    description: row.description,
    transport: row.transport as McpTransport,
    endpointUrl: row.endpointUrl,
    command: row.command,
    args: row.args,
    authType: row.authType as McpAuthType,
    hasSecret: row.secretEnc !== null,
    status: row.status as McpServerStatus,
    protocolVersion: row.protocolVersion,
    serverInfo: (row.serverInfo as Record<string, unknown> | null) ?? null,
    lastError: row.lastError,
    lastDiscoveredAt: row.lastDiscoveredAt ? row.lastDiscoveredAt.toISOString() : null,
    enabled: row.enabled,
    oauthConnected: row.oauthConnected,
    oauthScope: row.oauthScope,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    tools: (row.tools ?? []).map(toToolDto),
  };
}

export class McpRepository {
  async listForOrg(orgId: string): Promise<McpServerDTO[]> {
    const rows = await prisma.mcpServer.findMany({
      where: { orgId },
      include: { tools: { orderBy: { name: 'asc' } } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toServerDto);
  }

  async getForOrg(orgId: string, id: string): Promise<McpServerDTO | null> {
    const row = await prisma.mcpServer.findFirst({
      where: { id, orgId },
      include: { tools: { orderBy: { name: 'asc' } } },
    });
    return row ? toServerDto(row) : null;
  }

  async slugTaken(orgId: string, slug: string): Promise<boolean> {
    const existing = await prisma.mcpServer.findUnique({
      where: { orgId_slug: { orgId, slug } },
      select: { id: true },
    });
    return existing !== null;
  }

  async create(input: {
    orgId: string;
    createdByUserId: string;
    slug: string;
    name: string;
    description: string;
    transport: McpTransport;
    endpointUrl: string | null;
    command: string | null;
    args: string[];
    authType: McpAuthType;
    secret: McpServerSecret | null;
  }): Promise<McpServerDTO> {
    const row = await prisma.mcpServer.create({
      data: {
        orgId: input.orgId,
        createdByUserId: input.createdByUserId,
        slug: input.slug,
        name: input.name,
        description: input.description,
        transport: input.transport,
        endpointUrl: input.endpointUrl,
        command: input.command,
        args: input.args,
        authType: input.authType,
        secretEnc: input.secret ? encryptForAgentSecrets(JSON.stringify(input.secret)) : null,
        status: 'pending',
      },
      include: { tools: true },
    });
    return toServerDto(row);
  }

  /** Load the decrypted secret for a server (server-side use only). */
  async loadSecret(id: string): Promise<McpServerSecret> {
    const row = await prisma.mcpServer.findUnique({ where: { id }, select: { secretEnc: true } });
    if (!row?.secretEnc) return {};
    try {
      return JSON.parse(decryptForAgentSecrets(row.secretEnc)) as McpServerSecret;
    } catch {
      return {};
    }
  }

  /** Re-encrypt and persist a server's full secret blob (headers/env/oauth). */
  async writeSecret(id: string, secret: McpServerSecret): Promise<void> {
    const hasAny =
      Boolean(secret.headers && Object.keys(secret.headers).length) ||
      Boolean(secret.env && Object.keys(secret.env).length) ||
      Boolean(secret.oauth);
    await prisma.mcpServer.update({
      where: { id },
      data: { secretEnc: hasAny ? encryptForAgentSecrets(JSON.stringify(secret)) : null },
    });
  }

  /** Persist discovered/registered OAuth metadata (only provided fields change). */
  async setOAuthMetadata(
    id: string,
    meta: {
      issuer?: string;
      authorizationEndpoint?: string;
      tokenEndpoint?: string;
      registrationEndpoint?: string | null;
      resource?: string;
      clientId?: string;
      scope?: string;
      authParams?: string;
    },
  ): Promise<void> {
    await prisma.mcpServer.update({
      where: { id },
      data: {
        oauthIssuer: meta.issuer,
        oauthAuthorizationEndpoint: meta.authorizationEndpoint,
        oauthTokenEndpoint: meta.tokenEndpoint,
        oauthRegistrationEndpoint: meta.registrationEndpoint ?? undefined,
        oauthResource: meta.resource,
        oauthClientId: meta.clientId,
        oauthScope: meta.scope,
        oauthAuthParams: meta.authParams,
      },
    });
  }

  async setOAuthConnected(id: string, connected: boolean): Promise<void> {
    await prisma.mcpServer.update({
      where: { id },
      data: { oauthConnected: connected, ...(connected ? { status: 'pending', lastError: null } : {}) },
    });
  }

  /** Disconnect OAuth: drop the stored tokens and flip the connected flag. */
  async clearOAuthTokens(id: string): Promise<void> {
    const secret = await this.loadSecret(id);
    delete secret.oauth;
    await this.writeSecret(id, secret);
    await prisma.mcpServer.update({ where: { id }, data: { oauthConnected: false } });
  }

  async setStatus(id: string, status: McpServerStatus, lastError: string | null): Promise<void> {
    await prisma.mcpServer.update({ where: { id }, data: { status, lastError } });
  }

  async delete(orgId: string, id: string): Promise<void> {
    await prisma.mcpServer.deleteMany({ where: { id, orgId } });
  }

  /** The header/env *key* names of a server's stored secret (never the values). */
  async secretKeys(id: string): Promise<{ headers: string[]; env: string[] }> {
    const secret = await this.loadSecret(id);
    return { headers: Object.keys(secret.headers ?? {}), env: Object.keys(secret.env ?? {}) };
  }

  /**
   * Patch a server in place (preserving its agent bindings). Only provided fields change;
   * secrets are merged per {@link mergeSecretMap}. Returns null if not found in the org, and
   * a `connectionChanged` flag so the caller can decide whether to re-discover.
   */
  async update(
    orgId: string,
    id: string,
    patch: {
      name?: string;
      description?: string;
      endpointUrl?: string;
      command?: string;
      args?: string[];
      headers?: Record<string, string>;
      env?: Record<string, string>;
    },
  ): Promise<{ server: McpServerDTO; connectionChanged: boolean } | null> {
    const existing = await prisma.mcpServer.findFirst({
      where: { id, orgId },
      select: { id: true, transport: true, endpointUrl: true, command: true, args: true },
    });
    if (!existing) return null;

    const isHttp = existing.transport === 'http';
    const secretTouched = patch.headers !== undefined || patch.env !== undefined;

    const data: Prisma.McpServerUpdateInput = {};
    if (patch.name !== undefined) data.name = patch.name;
    if (patch.description !== undefined) data.description = patch.description;
    if (isHttp && patch.endpointUrl !== undefined) data.endpointUrl = patch.endpointUrl;
    if (!isHttp && patch.command !== undefined) data.command = patch.command;
    if (!isHttp && patch.args !== undefined) data.args = patch.args;

    if (secretTouched) {
      const current = await this.loadSecret(id);
      const headers = mergeSecretMap(current.headers ?? {}, patch.headers);
      const env = mergeSecretMap(current.env ?? {}, patch.env);
      const merged: McpServerSecret = {};
      if (Object.keys(headers).length) merged.headers = headers;
      if (Object.keys(env).length) merged.env = env;
      const hasSecret = Boolean(merged.headers || merged.env);
      data.secretEnc = hasSecret ? encryptForAgentSecrets(JSON.stringify(merged)) : null;
      data.authType = merged.headers ? 'header' : 'none';
    }

    const connectionChanged =
      (isHttp && patch.endpointUrl !== undefined && patch.endpointUrl !== existing.endpointUrl) ||
      (!isHttp && patch.command !== undefined && patch.command !== existing.command) ||
      (!isHttp && patch.args !== undefined && JSON.stringify(patch.args) !== JSON.stringify(existing.args)) ||
      secretTouched;

    // Re-connecting may succeed/fail differently — return to 'pending' until re-discovered.
    if (connectionChanged) {
      data.status = 'pending';
      data.lastError = null;
    }

    const row = await prisma.mcpServer.update({
      where: { id },
      data,
      include: { tools: { orderBy: { name: 'asc' } } },
    });
    return { server: toServerDto(row), connectionChanged };
  }

  /**
   * Replace the cached tool catalog from a discovery pass. Preserves `approvedHash`
   * for tools that still exist so the tool-poisoning guard keeps working across refreshes.
   */
  async upsertCatalog(params: {
    serverId: string;
    protocolVersion: string | null;
    serverInfo: Record<string, unknown> | null;
    tools: DiscoveredTool[];
  }): Promise<void> {
    const { serverId, tools } = params;
    await prisma.$transaction(async (tx) => {
      const existing = await tx.mcpServerTool.findMany({ where: { mcpServerId: serverId } });
      const existingByName = new Map(existing.map((t) => [t.name, t]));
      const seen = new Set<string>();

      for (const tool of tools) {
        seen.add(tool.name);
        const risk = deriveRiskLevel(tool.annotations);
        const governance = deriveGovernance(risk);
        const definitionHash = computeDefinitionHash(tool);
        const prev = existingByName.get(tool.name);
        await tx.mcpServerTool.upsert({
          where: { mcpServerId_name: { mcpServerId: serverId, name: tool.name } },
          create: {
            mcpServerId: serverId,
            name: tool.name,
            description: tool.description,
            inputSchema: (tool.inputSchema ?? undefined) as Prisma.InputJsonValue | undefined,
            annotations: (tool.annotations ?? undefined) as Prisma.InputJsonValue | undefined,
            riskLevel: risk,
            defaultGovernance: governance,
            definitionHash,
            // Trust-on-first-use: the definition seen at first discovery is auto-approved,
            // so a tool is usable immediately. The guard then bites on any *later* change —
            // `needsReapproval` flips and `runtimeServersForAgent` stops delivering it.
            approvedHash: definitionHash,
            approvedDefinition: definitionSnapshot(tool),
          },
          update: {
            description: tool.description,
            inputSchema: (tool.inputSchema ?? undefined) as Prisma.InputJsonValue | undefined,
            annotations: (tool.annotations ?? undefined) as Prisma.InputJsonValue | undefined,
            riskLevel: risk,
            definitionHash,
            // Keep an existing admin approval so post-approval drift is detected; heal legacy
            // rows that predate TOFU (approvedHash === null) by approving the current definition.
            approvedHash: prev?.approvedHash ?? definitionHash,
            // Preserve the approved snapshot for an already-approved tool (so drift can be
            // diffed against it); for legacy/never-approved rows, snapshot the current one.
            approvedDefinition: prev?.approvedHash
              ? ((prev.approvedDefinition ?? definitionSnapshot(tool)) as Prisma.InputJsonValue)
              : definitionSnapshot(tool),
            // keep prev.defaultGovernance (admin choice) intact
          },
        });
      }

      // Drop tools the server no longer advertises.
      const stale = existing.filter((t) => !seen.has(t.name)).map((t) => t.id);
      if (stale.length > 0) {
        await tx.mcpServerTool.deleteMany({ where: { id: { in: stale } } });
      }

      await tx.mcpServer.update({
        where: { id: serverId },
        data: {
          protocolVersion: params.protocolVersion,
          serverInfo: (params.serverInfo ?? undefined) as Prisma.InputJsonValue | undefined,
          lastDiscoveredAt: new Date(),
          status: 'connected',
          lastError: null,
        },
      });
    });
  }

  async setToolGovernance(
    serverId: string,
    toolName: string,
    governance: McpGovernance,
  ): Promise<void> {
    await prisma.mcpServerTool.updateMany({
      where: { mcpServerId: serverId, name: toolName },
      data: { defaultGovernance: governance },
    });
  }

  /** Approve the current advertised definition (clears the re-approval banner). */
  async approveTool(serverId: string, toolName: string): Promise<void> {
    const tool = await prisma.mcpServerTool.findFirst({
      where: { mcpServerId: serverId, name: toolName },
      select: { id: true, definitionHash: true, description: true, inputSchema: true },
    });
    if (!tool) return;
    await prisma.mcpServerTool.update({
      where: { id: tool.id },
      data: {
        approvedHash: tool.definitionHash,
        // Re-snapshot so future drift is diffed against what the admin just approved.
        approvedDefinition: {
          description: tool.description,
          inputSchema: (tool.inputSchema ?? null) as Prisma.InputJsonValue,
        },
      },
    });
  }

  // ---- Agent bindings ----

  async listBindingsForAgent(agentId: string): Promise<AgentMcpBindingDTO[]> {
    const rows = await prisma.agentMcpBinding.findMany({
      where: { agentId },
      include: { server: { select: { slug: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id,
      agentId: r.agentId,
      mcpServerId: r.mcpServerId,
      serverSlug: r.server.slug,
      serverName: r.server.name,
      allowedTools: r.allowedTools,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  async upsertBinding(params: {
    agentId: string;
    mcpServerId: string;
    allowedTools: string[];
  }): Promise<void> {
    await prisma.agentMcpBinding.upsert({
      where: { agentId_mcpServerId: { agentId: params.agentId, mcpServerId: params.mcpServerId } },
      create: {
        agentId: params.agentId,
        mcpServerId: params.mcpServerId,
        allowedTools: params.allowedTools,
      },
      update: { allowedTools: params.allowedTools },
    });
  }

  async deleteBinding(agentId: string, mcpServerId: string): Promise<void> {
    await prisma.agentMcpBinding.deleteMany({ where: { agentId, mcpServerId } });
  }

  /** Agents bound to a server, with the tools each is allowed — the blast radius of a change. */
  async agentsForServer(
    serverId: string,
  ): Promise<Array<{ agentId: string; agentName: string; allowedTools: string[] }>> {
    const bindings = await prisma.agentMcpBinding.findMany({
      where: { mcpServerId: serverId },
      include: { agent: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return bindings.map((b) => ({
      agentId: b.agentId,
      agentName: b.agent.name,
      allowedTools: b.allowedTools,
    }));
  }

  /**
   * Assemble the runtime MCP config for an agent: every enabled, bound server with
   * decrypted connection secrets and the catalog the runner needs to offer tools.
   */
  async runtimeServersForAgent(agentId: string): Promise<McpRuntimeServer[]> {
    const bindings = await prisma.agentMcpBinding.findMany({
      where: { agent: { id: agentId }, server: { enabled: true, status: { not: 'revoked' } } },
      include: { server: { include: { tools: true } } },
    });

    const out: McpRuntimeServer[] = [];
    for (const binding of bindings) {
      const server = binding.server;
      const secret = await this.loadSecret(server.id);
      const allowAll = binding.allowedTools.includes('*');
      const allowed = new Set(binding.allowedTools);
      const tools = server.tools
        .filter((t) => allowAll || allowed.has(t.name))
        .filter((t) => t.defaultGovernance !== 'blocked')
        // Tool-poisoning gate: only deliver a tool whose currently-advertised definition
        // matches the approved one. A drifted (or never-approved) tool is withheld from the
        // runner entirely until an admin re-approves it — the guard is enforced, not cosmetic.
        .filter((t) => t.approvedHash !== null && t.approvedHash === t.definitionHash)
        .map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: (t.inputSchema as Record<string, unknown> | null) ?? null,
          governance: t.defaultGovernance as McpGovernance,
        }));

      // http servers execute via the backend proxy — their secrets/OAuth tokens never reach the
      // runner. Only stdio (local subprocess) servers run on the runner and need env shipped.
      const isHttp = server.transport === 'http';
      out.push({
        slug: server.slug,
        transport: server.transport as McpTransport,
        mode: isHttp ? 'proxy' : 'local',
        endpointUrl: isHttp ? null : server.endpointUrl,
        command: server.command,
        args: server.args,
        headers: {},
        env: isHttp ? {} : secret.env ?? {},
        allowedTools: binding.allowedTools,
        tools,
      });
    }
    return out;
  }

  /**
   * Resolve + authorize a proxy tool call: the agent must be bound to the (http) server, and the
   * tool must be allowed, not blocked, and approved (poisoning gate). Returns the connection
   * target with static headers; OAuth servers get their bearer token from mcp.oauth separately.
   */
  async proxyTargetForAgent(
    agentId: string,
    slug: string,
    tool: string,
  ): Promise<{
    serverId: string;
    endpointUrl: string;
    authType: McpAuthType;
    allowed: boolean;
    headers: Record<string, string>;
  } | null> {
    const binding = await prisma.agentMcpBinding.findFirst({
      where: { agentId, server: { slug, enabled: true, status: { not: 'revoked' } } },
      include: { server: { include: { tools: true } } },
    });
    if (!binding) return null;
    const server = binding.server;
    if (server.transport !== 'http' || !server.endpointUrl) return null;

    const allowAll = binding.allowedTools.includes('*');
    const t = server.tools.find((x) => x.name === tool);
    const allowed =
      t !== undefined &&
      (allowAll || binding.allowedTools.includes(tool)) &&
      t.defaultGovernance !== 'blocked' &&
      t.approvedHash !== null &&
      t.approvedHash === t.definitionHash;

    const secret = await this.loadSecret(server.id);
    return {
      serverId: server.id,
      endpointUrl: server.endpointUrl,
      authType: server.authType as McpAuthType,
      allowed,
      headers: secret.headers ?? {},
    };
  }
}
