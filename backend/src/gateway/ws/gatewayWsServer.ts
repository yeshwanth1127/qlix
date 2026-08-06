import type { Server as HttpServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { gatewayService } from '../gatewayService.js';
import { buildWebChatInbound } from '../adapters/webChat.adapter.js';
import { buildSessionKey } from '../sessionKey.js';
import { runEventBus } from '../runEventBus.js';
import { prisma } from '../../lib/prisma.js';

type RpcRequest = {
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
};

type RpcResponse = {
  id?: string | number;
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string };
  event?: string;
};

/**
 * Phase B: lightweight WebSocket gateway (OpenClaw-style agent / chat.send RPC).
 * Mounted on the same HTTP server at `/gateway`.
 *
 * Methods:
 * - ping
 * - chat.send / agent — enqueue turn; returns immediately (fire-and-forget by default)
 * - agent.wait — wait for terminal run status (optional)
 * - agent.subscribe — push run events + terminal status onto this socket
 */
export function attachGatewayWebSocket(server: HttpServer): WebSocketServer | null {
  if (process.env.QLIX_GATEWAY_WS_DISABLED === '1') {
    return null;
  }

  let wss: WebSocketServer;
  try {
    wss = new WebSocketServer({ server, path: '/gateway' });
  } catch (err) {
    console.error('[gateway-ws] failed to attach', err);
    return null;
  }

  wss.on('connection', (socket, req) => {
    if (!authorizeWs(req.url ?? '')) {
      socket.close(4401, 'unauthorized');
      return;
    }

    const unsubs: Array<() => void> = [];
    (socket as WebSocket & { __qlixUnsubs?: Array<() => void> }).__qlixUnsubs = unsubs;

    socket.send(
      JSON.stringify({
        ok: true,
        event: 'hello',
        methods: ['agent', 'chat.send', 'agent.subscribe', 'agent.wait', 'ping'],
      }),
    );

    socket.on('message', (raw) => {
      void handleMessage(socket, raw.toString(), unsubs).catch((err) => {
        send(socket, {
          ok: false,
          error: { code: 'internal', message: err instanceof Error ? err.message : 'error' },
        });
      });
    });

    socket.on('close', () => {
      for (const u of unsubs) u();
      unsubs.length = 0;
    });
  });

  console.log('[gateway-ws] listening on /gateway');
  return wss;
}

function authorizeWs(url: string): boolean {
  const expected = process.env.QLIX_GATEWAY_WS_TOKEN?.trim();
  if (!expected) {
    return process.env.NODE_ENV === 'development' || process.env.QLIX_GATEWAY_WS_OPEN === '1';
  }
  try {
    const u = new URL(url, 'http://localhost');
    const token = u.searchParams.get('token') ?? '';
    return token === expected;
  } catch {
    return false;
  }
}

function send(socket: WebSocket, msg: RpcResponse): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(msg));
  }
}

async function handleMessage(
  socket: WebSocket,
  raw: string,
  unsubs: Array<() => void>,
): Promise<void> {
  let req: RpcRequest;
  try {
    req = JSON.parse(raw) as RpcRequest;
  } catch {
    send(socket, { ok: false, error: { code: 'invalid_json', message: 'Expected JSON RPC' } });
    return;
  }

  const id = req.id;
  if (req.method === 'ping') {
    send(socket, { id, ok: true, result: { pong: true } });
    return;
  }

  if (req.method === 'agent.subscribe') {
    const runId = String(req.params?.runId ?? '');
    if (!runId) {
      send(socket, { id, ok: false, error: { code: 'invalid_params', message: 'runId required' } });
      return;
    }
    const unsub = await runEventBus.subscribe(runId, (ev) => {
      send(socket, {
        ok: true,
        event: 'run.event',
        result: ev,
      });
    });
    unsubs.push(unsub);

    // Also poll terminal status lightly.
    const timer = setInterval(async () => {
      try {
        const run = await prisma.agentRun.findUnique({
          where: { id: runId },
          select: { status: true, result: true, errorMessage: true },
        });
        if (!run) return;
        if (run.status === 'success' || run.status === 'failed' || run.status === 'canceled') {
          send(socket, {
            ok: true,
            event: 'run.terminal',
            result: {
              runId,
              status: run.status,
              result: run.result,
              errorMessage: run.errorMessage,
            },
          });
          clearInterval(timer);
          unsub();
        }
      } catch {
        // ignore
      }
    }, 1500);
    unsubs.push(() => clearInterval(timer));

    send(socket, { id, ok: true, result: { subscribed: runId } });
    return;
  }

  if (req.method === 'agent.wait') {
    const runId = String(req.params?.runId ?? '');
    const timeoutMs = Math.min(Number(req.params?.timeoutMs ?? 120_000) || 120_000, 600_000);
    if (!runId) {
      send(socket, { id, ok: false, error: { code: 'invalid_params', message: 'runId required' } });
      return;
    }
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const run = await prisma.agentRun.findUnique({
        where: { id: runId },
        select: { status: true, result: true, errorMessage: true },
      });
      if (run && (run.status === 'success' || run.status === 'failed' || run.status === 'canceled')) {
        send(socket, {
          id,
          ok: true,
          result: {
            runId,
            status: run.status,
            result: run.result,
            errorMessage: run.errorMessage,
          },
        });
        return;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    send(socket, { id, ok: false, error: { code: 'timeout', message: 'Run did not finish in time' } });
    return;
  }

  if (req.method === 'chat.send' || req.method === 'agent') {
    const p = req.params ?? {};
    const agentId = String(p.agentId ?? '');
    const conversationId = String(p.conversationId ?? '');
    const userId = String(p.userId ?? '');
    const orgId = p.orgId == null ? null : String(p.orgId);
    const body = String(p.message ?? p.prompt ?? p.body ?? '');
    const fireAndForget = p.fireAndForget !== false; // default true
    const subscribe = Boolean(p.subscribe);
    if (!agentId || !conversationId || !userId || !body) {
      send(socket, {
        id,
        ok: false,
        error: {
          code: 'invalid_params',
          message: 'agentId, conversationId, userId, message required',
        },
      });
      return;
    }

    const turn = await gatewayService.handleInbound(
      buildWebChatInbound({
        agentId,
        conversationId,
        userId,
        orgId,
        body,
        email: typeof p.email === 'string' ? p.email : undefined,
        useBrain: Boolean(p.useBrain),
        skills: Array.isArray(p.skills) ? p.skills.map(String) : undefined,
      }),
    );

    const sessionKey = buildSessionKey({
      orgId,
      userId,
      channel: 'web',
      peerId: userId,
      threadId: conversationId,
    });

    send(socket, {
      id,
      ok: turn.status === 'accepted' || turn.status === 'steered',
      result: {
        ...turn,
        sessionKey,
        fireAndForget,
      },
    });

    const runId = 'runId' in turn ? turn.runId : undefined;
    if (subscribe && runId) {
      const unsub = await runEventBus.subscribe(runId, (ev) => {
        send(socket, { ok: true, event: 'run.event', result: ev });
      });
      unsubs.push(unsub);
    }

    return;
  }

  send(socket, {
    id,
    ok: false,
    error: { code: 'unknown_method', message: `Unknown method: ${req.method}` },
  });
}
