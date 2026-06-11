/**
 * MCP (Model Context Protocol) registry types.
 *
 * An MCP server is registered per-org. Its tools are consumed by agents under full
 * Qlix governance: each call flows through `/api/v1/actions/start` + `/complete`
 * (signed, hash-chained audit ledger) and, when a tool is marked `jit`, requires a
 * human-approved JIT token. Scopes use the namespace `mcp.<slug>.<tool>`.
 */

export type McpTransport = 'http' | 'stdio';
export type McpAuthType = 'none' | 'header' | 'oauth';
export type McpServerStatus = 'connected' | 'error' | 'revoked' | 'pending';
export type McpRiskLevel = 'low' | 'medium' | 'high';
/** `auto` = runs without approval, `jit` = requires human approval, `blocked` = never offered. */
export type McpGovernance = 'auto' | 'jit' | 'blocked';

/** OAuth token set + confidential client secret. Stored encrypted, never sent to the browser. */
export interface McpOAuthTokens {
  /** Absent between DCR (which yields only clientSecret) and the first token exchange. */
  accessToken?: string;
  refreshToken?: string;
  /** Absolute expiry (ms epoch). Absent ⇒ treated as already expired (force refresh/reauth). */
  expiresAtMs?: number;
  tokenType?: string;
  /** Confidential client secret from DCR or manual config (public clients omit it). */
  clientSecret?: string;
}

/** Decrypted secret material for connecting to an MCP server. Never returned to the browser. */
export interface McpServerSecret {
  /** Extra HTTP headers for `http` transport (e.g. `{ "Authorization": "Bearer ..." }`). */
  headers?: Record<string, string>;
  /** Extra environment variables for `stdio` transport. */
  env?: Record<string, string>;
  /** OAuth tokens + client secret (authType `oauth`). */
  oauth?: McpOAuthTokens;
}

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
  /** True when the advertised definition no longer matches the approved one (tool-poisoning guard). */
  needsReapproval: boolean;
  /** Snapshot of the approved definition, for rendering a drift diff. Null until first approval. */
  approvedDescription: string | null;
  approvedInputSchema: Record<string, unknown> | null;
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
  /** True when secret material is stored (the secret itself is never returned). */
  hasSecret: boolean;
  status: McpServerStatus;
  protocolVersion: string | null;
  serverInfo: Record<string, unknown> | null;
  lastError: string | null;
  lastDiscoveredAt: string | null;
  enabled: boolean;
  /** OAuth connection state (authType `oauth`): true once a token is held. */
  oauthConnected: boolean;
  oauthScope: string | null;
  createdAt: string;
  updatedAt: string;
  tools?: McpServerToolDTO[];
}

/** What an agent is allowed to use on a server (bound via the agent detail UI). */
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

/** Per-server runtime config handed to the runner when a run is claimed. */
export interface McpRuntimeServer {
  slug: string;
  transport: McpTransport;
  /**
   * `proxy` — the runner calls the Qlix backend to execute (http servers; secrets/tokens stay
   * on the backend). `local` — the runner executes directly (stdio subprocesses).
   */
  mode: 'proxy' | 'local';
  endpointUrl: string | null;
  command: string | null;
  args: string[];
  headers: Record<string, string>;
  env: Record<string, string>;
  /** Tool names the agent may call, or `['*']` for all. */
  allowedTools: string[];
  /** Cached tool catalog (may be empty for stdio servers discovered at runtime). */
  tools: Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown> | null;
    governance: McpGovernance;
  }>;
}

/** A tool definition as advertised by an MCP server's `tools/list`. */
export interface DiscoveredTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown> | null;
  annotations: Record<string, unknown> | null;
}

export interface DiscoveryResult {
  protocolVersion: string | null;
  serverInfo: Record<string, unknown> | null;
  tools: DiscoveredTool[];
}
