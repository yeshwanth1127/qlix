import type { GatewayChannel, InboundMessage } from './types.js';

/**
 * Build a stable session key for per-conversation admission (OpenClaw + Hermes pattern).
 * Format: org:{orgId}|user:{userId}|channel:{ch}|peer:{peer}[|thread:{t}]
 */
export function buildSessionKey(input: {
  orgId: string | null | undefined;
  userId: string;
  channel: GatewayChannel;
  peerId: string;
  threadId?: string | null;
}): string {
  const org = input.orgId?.trim() || 'personal';
  const user = input.userId.trim();
  const channel = input.channel;
  const peer = sanitizeKeyPart(input.peerId);
  const parts = [`org:${org}`, `user:${user}`, `channel:${channel}`, `peer:${peer}`];
  const thread = input.threadId?.trim();
  if (thread) {
    parts.push(`thread:${sanitizeKeyPart(thread)}`);
  }
  return parts.join('|');
}

export function buildSessionKeyFromInbound(msg: InboundMessage): string {
  return buildSessionKey({
    orgId: msg.orgId,
    userId: msg.userId,
    channel: msg.channel,
    peerId: msg.peerId,
    threadId: msg.threadId ?? msg.preResolved?.conversationId ?? null,
  });
}

function sanitizeKeyPart(value: string): string {
  return value.trim().replace(/[|\s]+/g, '_').slice(0, 200);
}

export function parseSessionKey(sessionKey: string): {
  orgId: string;
  userId: string;
  channel: string;
  peerId: string;
  threadId?: string;
} | null {
  const parts = sessionKey.split('|');
  const map = new Map<string, string>();
  for (const part of parts) {
    const idx = part.indexOf(':');
    if (idx <= 0) continue;
    map.set(part.slice(0, idx), part.slice(idx + 1));
  }
  const orgId = map.get('org');
  const userId = map.get('user');
  const channel = map.get('channel');
  const peerId = map.get('peer');
  if (!orgId || !userId || !channel || !peerId) return null;
  return {
    orgId,
    userId,
    channel,
    peerId,
    threadId: map.get('thread'),
  };
}
