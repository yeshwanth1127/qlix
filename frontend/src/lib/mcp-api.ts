import type { ApiErrorBody } from "./auth-api";

const defaultBase = "http://localhost:4000";

function apiBase(): string {
  return (process.env.NEXT_PUBLIC_API_BASE_URL ?? defaultBase).replace(/\/$/, "");
}

export type McpTransport = "http" | "stdio";
export type McpAuthType = "none" | "header" | "oauth";
export type McpServerStatus = "connected" | "error" | "revoked" | "pending";
export type McpRiskLevel = "low" | "medium" | "high";
export type McpGovernance = "auto" | "jit" | "blocked";

export interface McpServerToolDTO {
  id: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown> | null;
  annotations: Record<string, unknown> | null;
  riskLevel: McpRiskLevel;
  defaultGovernance: McpGovernance;
  definitionHash: string;
  approvedHash: string | null;
  needsReapproval: boolean;
  approvedDescription: string | null;
  approvedInputSchema: Record<string, unknown> | null;
}

export interface McpServerAgentDTO {
  agentId: string;
  agentName: string;
  allowedTools: string[];
}

export interface McpServerDTO {
  id: string;
  orgId: string;
  slug: string;
  name: string;
  description: string;
  transport: McpTransport;
  endpointUrl: string | null;
  command: string | null;
  args: string[];
  authType: McpAuthType;
  hasSecret: boolean;
  status: McpServerStatus;
  protocolVersion: string | null;
  serverInfo: Record<string, unknown> | null;
  lastError: string | null;
  lastDiscoveredAt: string | null;
  enabled: boolean;
  oauthConnected: boolean;
  oauthScope: string | null;
  createdAt: string;
  updatedAt: string;
  tools?: McpServerToolDTO[];
}

export interface McpOAuthConfigInput {
  clientId?: string;
  clientSecret?: string;
  scope?: string;
  issuer?: string;
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  registrationEndpoint?: string;
  authParams?: string;
}

export interface AgentMcpBindingDTO {
  id: string;
  agentId: string;
  mcpServerId: string;
  serverSlug: string;
  serverName: string;
  allowedTools: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateMcpServerInput {
  name: string;
  description?: string;
  transport: McpTransport;
  endpointUrl?: string;
  command?: string;
  args?: string[];
  authType?: McpAuthType;
  headers?: Record<string, string>;
  env?: Record<string, string>;
}

export interface UpdateMcpServerInput {
  name?: string;
  description?: string;
  endpointUrl?: string;
  command?: string;
  args?: string[];
  /** Empty-string value removes that key; otherwise set/rotate it. Absent keys are preserved. */
  headers?: Record<string, string>;
  env?: Record<string, string>;
}

export interface McpSecretKeys {
  headers: string[];
  env: string[];
}

async function parseJson<T>(response: Response): Promise<T | ApiErrorBody> {
  const text = await response.text();
  if (!text) return {} as T;
  return JSON.parse(text) as T | ApiErrorBody;
}

function err(data: unknown, fallback: string): never {
  const message = (data as ApiErrorBody)?.error?.message ?? fallback;
  throw new Error(message);
}

export async function listMcpServers(): Promise<McpServerDTO[]> {
  const response = await fetch(`${apiBase()}/api/v1/mcp/servers`, { credentials: "include" });
  const data = await parseJson<{ servers: McpServerDTO[] }>(response);
  if (!response.ok) err(data, "Failed to load MCP servers");
  return (data as { servers: McpServerDTO[] }).servers;
}

export async function getMcpServer(id: string): Promise<McpServerDTO> {
  const response = await fetch(`${apiBase()}/api/v1/mcp/servers/${id}`, { credentials: "include" });
  const data = await parseJson<{ server: McpServerDTO }>(response);
  if (!response.ok) err(data, "Failed to load MCP server");
  return (data as { server: McpServerDTO }).server;
}

export async function createMcpServer(input: CreateMcpServerInput): Promise<McpServerDTO> {
  const response = await fetch(`${apiBase()}/api/v1/mcp/servers`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await parseJson<{ server: McpServerDTO }>(response);
  if (!response.ok) err(data, "Failed to register MCP server");
  return (data as { server: McpServerDTO }).server;
}

export async function updateMcpServer(id: string, input: UpdateMcpServerInput): Promise<McpServerDTO> {
  const response = await fetch(`${apiBase()}/api/v1/mcp/servers/${id}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await parseJson<{ server: McpServerDTO }>(response);
  if (!response.ok) err(data, "Failed to update MCP server");
  return (data as { server: McpServerDTO }).server;
}

export async function getMcpServerSecretKeys(id: string): Promise<McpSecretKeys> {
  const response = await fetch(`${apiBase()}/api/v1/mcp/servers/${id}/secret-keys`, {
    credentials: "include",
  });
  const data = await parseJson<McpSecretKeys>(response);
  if (!response.ok) err(data, "Failed to load secret keys");
  return data as McpSecretKeys;
}

export async function discoverMcpServer(id: string): Promise<McpServerDTO> {
  const response = await fetch(`${apiBase()}/api/v1/mcp/servers/${id}/discover`, {
    method: "POST",
    credentials: "include",
  });
  const data = await parseJson<{ server: McpServerDTO }>(response);
  if (!response.ok) err(data, "Discovery failed");
  return (data as { server: McpServerDTO }).server;
}

export async function deleteMcpServer(id: string): Promise<void> {
  const response = await fetch(`${apiBase()}/api/v1/mcp/servers/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!response.ok && response.status !== 204) err(await parseJson(response), "Failed to delete MCP server");
}

export async function setMcpToolGovernance(
  serverId: string,
  toolName: string,
  governance: McpGovernance,
): Promise<void> {
  const response = await fetch(
    `${apiBase()}/api/v1/mcp/servers/${serverId}/tools/${encodeURIComponent(toolName)}/governance`,
    {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ governance }),
    },
  );
  if (!response.ok) err(await parseJson(response), "Failed to set governance");
}

export async function approveMcpTool(serverId: string, toolName: string): Promise<void> {
  const response = await fetch(
    `${apiBase()}/api/v1/mcp/servers/${serverId}/tools/${encodeURIComponent(toolName)}/approve`,
    { method: "POST", credentials: "include" },
  );
  if (!response.ok) err(await parseJson(response), "Failed to approve tool");
}

export async function setMcpOAuthConfig(serverId: string, config: McpOAuthConfigInput): Promise<void> {
  const response = await fetch(`${apiBase()}/api/v1/mcp/servers/${serverId}/oauth/config`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  if (!response.ok) err(await parseJson(response), "Failed to save OAuth config");
}

export async function startMcpOAuth(serverId: string): Promise<string> {
  const response = await fetch(`${apiBase()}/api/v1/mcp/servers/${serverId}/oauth/start`, {
    method: "POST",
    credentials: "include",
  });
  const data = await parseJson<{ authorizationUrl: string }>(response);
  if (!response.ok) err(data, "Failed to start OAuth");
  return (data as { authorizationUrl: string }).authorizationUrl;
}

export async function disconnectMcpOAuth(serverId: string): Promise<void> {
  const response = await fetch(`${apiBase()}/api/v1/mcp/servers/${serverId}/oauth/disconnect`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) err(await parseJson(response), "Failed to disconnect");
}

export async function listMcpServerAgents(serverId: string): Promise<McpServerAgentDTO[]> {
  const response = await fetch(`${apiBase()}/api/v1/mcp/servers/${serverId}/agents`, {
    credentials: "include",
  });
  const data = await parseJson<{ agents: McpServerAgentDTO[] }>(response);
  if (!response.ok) err(data, "Failed to load affected agents");
  return (data as { agents: McpServerAgentDTO[] }).agents;
}

export async function listAgentMcpBindings(agentId: string): Promise<AgentMcpBindingDTO[]> {
  const response = await fetch(`${apiBase()}/api/v1/mcp/agents/${agentId}/bindings`, {
    credentials: "include",
  });
  const data = await parseJson<{ bindings: AgentMcpBindingDTO[] }>(response);
  if (!response.ok) err(data, "Failed to load bindings");
  return (data as { bindings: AgentMcpBindingDTO[] }).bindings;
}

export async function setAgentMcpBinding(
  agentId: string,
  serverId: string,
  allowedTools: string[],
): Promise<AgentMcpBindingDTO[]> {
  const response = await fetch(`${apiBase()}/api/v1/mcp/agents/${agentId}/bindings/${serverId}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ allowedTools }),
  });
  const data = await parseJson<{ bindings: AgentMcpBindingDTO[] }>(response);
  if (!response.ok) err(data, "Failed to save binding");
  return (data as { bindings: AgentMcpBindingDTO[] }).bindings;
}

export async function deleteAgentMcpBinding(agentId: string, serverId: string): Promise<void> {
  const response = await fetch(`${apiBase()}/api/v1/mcp/agents/${agentId}/bindings/${serverId}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!response.ok && response.status !== 204) err(await parseJson(response), "Failed to delete binding");
}
