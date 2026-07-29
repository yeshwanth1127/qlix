import { randomUUID } from 'node:crypto';

const PROTOCOL_VERSION = '2025-03-26';

function jsonRpc(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function jsonRpcError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

/**
 * @param {{ name: string, version?: string, tools: unknown[], execute: (name: string, args: object, agentId: string) => Promise<object> }} options
 */
export function createMcpRouter(options) {
  const serverInfo = { name: options.name, version: options.version || '1.0.0' };
  const sessions = new Map();

  return async (req, res) => {
    const sessionId = req.header('Mcp-Session-Id') || randomUUID();
    if (!sessions.has(sessionId)) {
      sessions.set(sessionId, { initialized: false });
    }
    res.setHeader('Mcp-Session-Id', sessionId);

    let body = req.body;
    if (!body || typeof body !== 'object') {
      res.status(400).json(jsonRpcError(null, -32700, 'Parse error'));
      return;
    }

    const { method, params, id } = body;

    if (method === 'notifications/initialized') {
      sessions.get(sessionId).initialized = true;
      res.status(202).end();
      return;
    }

    if (method === 'initialize') {
      res.json(
        jsonRpc(id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo,
        }),
      );
      return;
    }

    if (method === 'tools/list') {
      res.json(jsonRpc(id, { tools: options.tools }));
      return;
    }

    if (method === 'tools/call') {
      const toolName = params?.name;
      const toolArgs = params?.arguments ?? {};
      const agentId = req.header('X-Qlix-Agent-Id') || toolArgs.agentId || '';
      const result = await options.execute(toolName, toolArgs, agentId);
      res.json(jsonRpc(id, result));
      return;
    }

    res.json(jsonRpcError(id, -32601, `Method not found: ${method}`));
  };
}
