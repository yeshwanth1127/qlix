/**
 * WhatsApp auto-reply sessions — arm on contact_send when agent has whatsapp.auto_reply,
 * then route contact inbound to that agent and deliver the run result back to the contact.
 */
import { prisma } from '../lib/prisma.js';
import { appendEmailActionLog } from '../connectors/emailAudit.service.js';

export const AUTO_REPLY_TTL_HOURS = 24;
export const MAX_REPLY_INSTRUCTIONS = 2000;

export type AutoReplySessionDTO = {
  id: string;
  connectorId: string;
  agentId: string;
  contactJid: string;
  contactName: string | null;
  contactPhone: string | null;
  replyInstructions: string | null;
  status: string;
  expiresAt: string;
  lastOutboundAt: string;
  lastInboundAt: string | null;
};

function toDto(row: {
  id: string;
  connectorId: string;
  agentId: string;
  contactJid: string;
  contactName: string | null;
  contactPhone: string | null;
  replyInstructions: string | null;
  status: string;
  expiresAt: Date;
  lastOutboundAt: Date;
  lastInboundAt: Date | null;
}): AutoReplySessionDTO {
  return {
    id: row.id,
    connectorId: row.connectorId,
    agentId: row.agentId,
    contactJid: row.contactJid,
    contactName: row.contactName,
    contactPhone: row.contactPhone,
    replyInstructions: row.replyInstructions,
    status: row.status,
    expiresAt: row.expiresAt.toISOString(),
    lastOutboundAt: row.lastOutboundAt.toISOString(),
    lastInboundAt: row.lastInboundAt?.toISOString() ?? null,
  };
}

export function normalizeContactJid(jid: string): string {
  return jid.trim().toLowerCase();
}

/** Phone local part without device suffix (e.g. 9198…:12 → 9198…). */
export function jidLocalPart(jid: string): string {
  return jid.split('@')[0]?.split(':')[0] ?? '';
}

function expiresFromNow(ttlHours = AUTO_REPLY_TTL_HOURS): Date {
  return new Date(Date.now() + ttlHours * 60 * 60 * 1000);
}

export function normalizeReplyInstructions(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const t = raw.trim();
  if (!t) return null;
  return t.length > MAX_REPLY_INSTRUCTIONS ? t.slice(0, MAX_REPLY_INSTRUCTIONS) : t;
}

export function buildAutoReplyInboundPrompt(input: {
  label: string;
  contactJid: string;
  text: string;
  replyInstructions?: string | null;
}): string {
  const body = input.text.trim();
  const instructions = normalizeReplyInstructions(input.replyInstructions);
  const parts = [
    `WhatsApp reply from ${input.label} (${input.contactJid}):`,
    body,
    '',
  ];
  if (instructions) {
    parts.push('Your instructions for this conversation:');
    parts.push(instructions);
    parts.push('');
    parts.push(
      'Follow those instructions. Use whatsapp_read_chat if you need more context, then act and reply with whatsapp_send_message to this contact.',
    );
  } else {
    parts.push(
      'Use whatsapp_read_chat if you need more context, then reply with whatsapp_send_message to this contact.',
    );
  }
  return parts.join('\n');
}

export async function armAutoReplySession(input: {
  connectorId: string;
  agentId: string;
  contactJid: string;
  contactName?: string | null;
  contactPhone?: string | null;
  replyInstructions?: string | null;
  /** When true, clear stored instructions even if replyInstructions is null/empty. */
  clearReplyInstructions?: boolean;
  userId?: string | null;
  ttlHours?: number;
}): Promise<AutoReplySessionDTO> {
  const contactJid = normalizeContactJid(input.contactJid);
  if (!contactJid.includes('@')) {
    throw new Error('contactJid must be a WhatsApp JID');
  }
  const now = new Date();
  const expiresAt = expiresFromNow(input.ttlHours);
  const instructions = normalizeReplyInstructions(input.replyInstructions);

  const updateData: {
    agentId: string;
    contactName?: string | null;
    contactPhone?: string | null;
    status: string;
    expiresAt: Date;
    lastOutboundAt: Date;
    replyInstructions?: string | null;
  } = {
    agentId: input.agentId,
    contactName: input.contactName ?? undefined,
    contactPhone: input.contactPhone ?? undefined,
    status: 'active',
    expiresAt,
    lastOutboundAt: now,
  };

  if (input.clearReplyInstructions) {
    updateData.replyInstructions = null;
  } else if (instructions != null) {
    updateData.replyInstructions = instructions;
  }

  const row = await prisma.whatsAppAutoReplySession.upsert({
    where: {
      connectorId_contactJid: {
        connectorId: input.connectorId,
        contactJid,
      },
    },
    create: {
      connectorId: input.connectorId,
      agentId: input.agentId,
      contactJid,
      contactName: input.contactName ?? null,
      contactPhone: input.contactPhone ?? null,
      replyInstructions: instructions,
      status: 'active',
      expiresAt,
      lastOutboundAt: now,
    },
    update: updateData,
  });

  if (input.userId) {
    await appendEmailActionLog({
      agentId: input.agentId,
      userId: input.userId,
      actionType: 'whatsapp.auto_reply',
      payload: {
        tool: 'arm',
        contactJid,
        contactName: input.contactName ?? null,
        hasInstructions: Boolean(row.replyInstructions),
        expiresAt: expiresAt.toISOString(),
      },
      status: 'success',
      riskLevel: 'medium',
    }).catch(() => {});
  }

  return toDto(row);
}

export async function findActiveAutoReplySession(
  connectorId: string,
  remoteJid: string,
): Promise<AutoReplySessionDTO | null> {
  const normalized = normalizeContactJid(remoteJid);
  const now = new Date();
  const local = jidLocalPart(normalized);

  const candidates = await prisma.whatsAppAutoReplySession.findMany({
    where: {
      connectorId,
      status: 'active',
      expiresAt: { gt: now },
      OR: [
        { contactJid: normalized },
        ...(local.length >= 8
          ? [{ contactJid: { contains: local } }, { contactPhone: { contains: local } }]
          : []),
      ],
    },
    orderBy: { lastOutboundAt: 'desc' },
    take: 5,
  });

  const exact =
    candidates.find((c) => normalizeContactJid(c.contactJid) === normalized) ??
    candidates.find((c) => jidLocalPart(c.contactJid) === local) ??
    candidates[0];

  if (!exact) return null;
  return toDto(exact);
}

async function findActiveSessionForRecipient(input: {
  agentId: string;
  connectorId: string;
  recipient: string;
}): Promise<AutoReplySessionDTO | null> {
  const now = new Date();
  const recipient = input.recipient.trim();
  const normalized = normalizeContactJid(recipient);
  const local = jidLocalPart(normalized);
  const phoneDigits = recipient.replace(/\D/g, '');

  const rows = await prisma.whatsAppAutoReplySession.findMany({
    where: {
      agentId: input.agentId,
      connectorId: input.connectorId,
      status: 'active',
      expiresAt: { gt: now },
      OR: [
        { contactJid: normalized },
        ...(local.length >= 3 ? [{ contactJid: { contains: local } }] : []),
        ...(phoneDigits.length >= 8 ? [{ contactPhone: { contains: phoneDigits } }] : []),
        { contactName: { equals: recipient, mode: 'insensitive' } },
      ],
    },
    orderBy: { lastOutboundAt: 'desc' },
    take: 5,
  });

  if (rows.length === 0) return null;
  return toDto(rows[0]!);
}

/**
 * Set/update reply instructions for a contact. Arms (or refreshes) an active session.
 */
export async function setAutoReplyInstructions(input: {
  connectorId: string;
  agentId: string;
  contactJid: string;
  contactName?: string | null;
  contactPhone?: string | null;
  instructions: string;
  userId?: string | null;
}): Promise<AutoReplySessionDTO> {
  const instructions = normalizeReplyInstructions(input.instructions);
  if (!instructions) {
    throw new Error('instructions are required');
  }

  const session = await armAutoReplySession({
    connectorId: input.connectorId,
    agentId: input.agentId,
    contactJid: input.contactJid,
    contactName: input.contactName,
    contactPhone: input.contactPhone,
    replyInstructions: instructions,
    userId: input.userId,
  });

  if (input.userId) {
    await appendEmailActionLog({
      agentId: input.agentId,
      userId: input.userId,
      actionType: 'whatsapp.auto_reply',
      payload: {
        tool: 'set_reply_instructions',
        contactJid: session.contactJid,
        instructionsPreview: instructions.slice(0, 200),
      },
      status: 'success',
      riskLevel: 'low',
    }).catch(() => {});
  }

  return session;
}

export async function findOrMatchSessionForInstructions(input: {
  agentId: string;
  connectorId: string;
  recipient: string;
}): Promise<AutoReplySessionDTO | null> {
  return findActiveSessionForRecipient(input);
}

export async function markAutoReplyInbound(sessionId: string): Promise<void> {
  await prisma.whatsAppAutoReplySession.update({
    where: { id: sessionId },
    data: { lastInboundAt: new Date() },
  });
}

export async function listAutoReplySessions(input: {
  agentId: string;
  connectorId?: string | null;
  includeStopped?: boolean;
}): Promise<AutoReplySessionDTO[]> {
  const now = new Date();
  await prisma.whatsAppAutoReplySession.updateMany({
    where: {
      agentId: input.agentId,
      status: 'active',
      expiresAt: { lte: now },
    },
    data: { status: 'expired' },
  });

  const rows = await prisma.whatsAppAutoReplySession.findMany({
    where: {
      agentId: input.agentId,
      ...(input.connectorId ? { connectorId: input.connectorId } : {}),
      ...(input.includeStopped
        ? {}
        : { status: 'active', expiresAt: { gt: now } }),
    },
    orderBy: { lastOutboundAt: 'desc' },
    take: 50,
  });
  return rows.map(toDto);
}

export async function stopAutoReplySessions(input: {
  agentId: string;
  recipient?: string | null;
  connectorId?: string | null;
  userId?: string | null;
}): Promise<{ stopped: number }> {
  const now = new Date();
  const recipient = input.recipient?.trim();

  if (recipient) {
    const normalized = normalizeContactJid(recipient);
    const local = jidLocalPart(normalized);
    const result = await prisma.whatsAppAutoReplySession.updateMany({
      where: {
        agentId: input.agentId,
        status: 'active',
        ...(input.connectorId ? { connectorId: input.connectorId } : {}),
        OR: [
          { contactJid: normalized },
          { contactJid: { contains: local } },
          { contactPhone: { contains: local.replace(/\D/g, '') || local } },
          { contactName: { equals: recipient, mode: 'insensitive' } },
        ],
      },
      data: { status: 'stopped' },
    });
    if (input.userId) {
      await appendEmailActionLog({
        agentId: input.agentId,
        userId: input.userId,
        actionType: 'whatsapp.auto_reply',
        payload: { tool: 'stop', recipient, stopped: result.count },
        status: 'success',
        riskLevel: 'low',
      }).catch(() => {});
    }
    return { stopped: result.count };
  }

  const result = await prisma.whatsAppAutoReplySession.updateMany({
    where: {
      agentId: input.agentId,
      status: 'active',
      ...(input.connectorId ? { connectorId: input.connectorId } : {}),
      OR: [{ expiresAt: { gt: now } }, { expiresAt: { lte: now } }],
    },
    data: { status: 'stopped' },
  });

  if (input.userId) {
    await appendEmailActionLog({
      agentId: input.agentId,
      userId: input.userId,
      actionType: 'whatsapp.auto_reply',
      payload: { tool: 'stop_all', stopped: result.count },
      status: 'success',
      riskLevel: 'low',
    }).catch(() => {});
  }
  return { stopped: result.count };
}

export async function isContactArmed(connectorId: string, remoteJid: string): Promise<boolean> {
  const session = await findActiveAutoReplySession(connectorId, remoteJid);
  return session != null;
}
