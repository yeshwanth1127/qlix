/**
 * Minimal MCP client over Streamable HTTP, used by the backend to (a) discover a server's
 * tool catalog and (b) — for proxy-mode execution — call tools on the org's behalf with a
 * backend-held credential (static header or refreshed OAuth token).
 *
 * Handles both `application/json` and `text/event-stream` responses and the
 * `Mcp-Session-Id` header, per the MCP Streamable HTTP spec.
 */
import type { DiscoveredTool, DiscoveryResult } from './mcp.types.js';
import { assertSafeFetchUrl, safeFetch, SsrfBlockedError } from './ssrfGuard.js';

const PROTOCOL_VERSION = '2025-03-26';
const DEFAULT_TIMEOUT_MS = 15_000;

export class McpHttpError extends Error {
  readonly code = 'mcp_http_error';
}

/** Raised when the server requires OAuth (HTTP 401). `wwwAuthenticate` carries the challenge. */
export class McpAuthRequiredError extends Error {
  readonly code = 'mcp_auth_required';
  constructor(
    message: string,
    readonly wwwAuthenticate: string | null,
  ) {
    super(message);
  }
}

interface JsonRpcResponse {
  jsonrpc: string;
  id: number | string;
  result?: any;
  error?: { code: number; message: string; data?: unknown };
}

function extractJsonFromSse(text: string): string {
  let lastData = '';
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('data:')) lastData = line.slice('data:'.length).trim();
  }
  if (!lastData) throw new McpHttpError('SSE response contained no data: lines');
  return lastData;
}

/** A single Streamable-HTTP JSON-RPC session (tracks the Mcp-Session-Id across calls). */
class HttpRpcSession {
  private sessionId: string | null = null;

  constructor(
    private readonly url: string,
    private readonly baseHeaders: Record<string, string>,
    private readonly timeoutMs: number,
  ) {}

  async rpc(method: string, params: Record<string, unknown>, id: number): Promise<JsonRpcResponse> {
    const headers = { ...this.baseHeaders };
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let resp: Response;
    try {
      resp = await safeFetch(this.url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ jsonrpc: '2.0', method, params, id }),
        signal: controller.signal,
      });
    } catch (err) {
      throw new McpHttpError(`Cannot reach MCP server: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      clearTimeout(timer);
    }

    const newSession = resp.headers.get('mcp-session-id');
    if (newSession) this.sessionId = newSession;

    if (resp.status === 401) {
      throw new McpAuthRequiredError('MCP server requires authorization', resp.headers.get('www-authenticate'));
    }
    const body = await resp.text();
    if (!resp.ok) {
      // Don't echo the response body: with an SSRF-style target it could exfiltrate internal
      // content back to the operator. The status code is enough to diagnose.
      throw new McpHttpError(`MCP server returned HTTP ${resp.status}`);
    }
    const contentType = resp.headers.get('content-type') ?? '';
    const json =
      contentType.includes('text/event-stream') || body.trimStart().startsWith('event:')
        ? extractJsonFromSse(body)
        : body;
    const parsed = JSON.parse(json) as JsonRpcResponse;
    if (parsed.error) {
      throw new McpHttpError(`MCP error ${parsed.error.code}: ${parsed.error.message}`);
    }
    return parsed;
  }

  async notifyInitialized(): Promise<void> {
    const headers = { ...this.baseHeaders };
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId;
    try {
      await safeFetch(this.url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }),
      });
    } catch {
      /* notification is fire-and-forget */
    }
  }
}

/** Open + initialize a session. Throws McpAuthRequiredError if the server demands OAuth. */
async function openSession(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<{ session: HttpRpcSession; init: JsonRpcResponse }> {
  await assertSafeFetchUrl(url).catch((err) => {
    throw err instanceof SsrfBlockedError ? new McpHttpError(err.message) : err;
  });
  const session = new HttpRpcSession(
    url,
    { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers },
    timeoutMs,
  );
  const init = await session.rpc(
    'initialize',
    { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'qlix-backend', version: '0.1.0' } },
    1,
  );
  await session.notifyInitialized();
  return { session, init };
}

export async function discoverHttpServer(params: {
  url: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}): Promise<DiscoveryResult> {
  const { session, init } = await openSession(params.url, params.headers ?? {}, params.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  const listed = await session.rpc('tools/list', {}, 2);
  const rawTools: any[] = Array.isArray(listed.result?.tools) ? listed.result.tools : [];
  const tools: DiscoveredTool[] = rawTools.map((t) => ({
    name: String(t.name),
    description: typeof t.description === 'string' ? t.description : '',
    inputSchema: t.inputSchema && typeof t.inputSchema === 'object' ? t.inputSchema : null,
    annotations: t.annotations && typeof t.annotations === 'object' ? t.annotations : null,
  }));

  return {
    protocolVersion: typeof init.result?.protocolVersion === 'string' ? init.result.protocolVersion : null,
    serverInfo: init.result?.serverInfo && typeof init.result.serverInfo === 'object' ? init.result.serverInfo : null,
    tools,
  };
}

/** Execute one tool call (initialize + tools/call). Used by proxy-mode execution. */
export async function callHttpTool(params: {
  url: string;
  headers?: Record<string, string>;
  tool: string;
  arguments: Record<string, unknown>;
  timeoutMs?: number;
}): Promise<{ isError: boolean; content: unknown[] }> {
  const { session } = await openSession(params.url, params.headers ?? {}, params.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const res = await session.rpc('tools/call', { name: params.tool, arguments: params.arguments ?? {} }, 2);
  const result = (res.result as { isError?: unknown; content?: unknown } | undefined) ?? {};
  return {
    isError: Boolean(result.isError),
    content: Array.isArray(result.content) ? result.content : [],
  };
}
