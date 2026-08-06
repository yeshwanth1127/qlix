const baseUrl = (): string | null => {
  const url = process.env.QLIX_WHATSAPP_SERVICE_URL?.trim();
  return url ? url.replace(/\/$/, '') : null;
};

const secret = (): string | null => process.env.QLIX_INTERNAL_SERVICE_SECRET?.trim() || null;

export function isWhatsAppServiceConfigured(): boolean {
  return Boolean(baseUrl() && secret());
}

async function waFetch(
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const base = baseUrl();
  const sec = secret();
  if (!base || !sec) {
    return { ok: false, status: 503, data: { error: 'WhatsApp service not configured' } };
  }
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Service-Secret': sec,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      status: 503,
      data: {
        error: `Cannot reach WhatsApp service at ${base}. Start it: cd qlix-whatsapp-service && npm start (${msg})`,
      },
    };
  }
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    data = { raw: text };
  }
  return { ok: res.ok, status: res.status, data };
}

export async function startWhatsAppSession(connectorId: string): Promise<{ ok: boolean; error?: string }> {
  const res = await waFetch('POST', `/sessions/${encodeURIComponent(connectorId)}/start`);
  if (!res.ok) {
    return { ok: false, error: String(res.data.error ?? 'Failed to start session') };
  }
  return { ok: true };
}

export async function stopWhatsAppSession(connectorId: string): Promise<void> {
  await waFetch('DELETE', `/sessions/${encodeURIComponent(connectorId)}`);
}

export async function getWhatsAppSessionStatus(connectorId: string): Promise<{
  connected: boolean;
  qr: string | null;
  ownerJid: string | null;
}> {
  const res = await waFetch('GET', `/sessions/${encodeURIComponent(connectorId)}/status`);
  return {
    connected: Boolean(res.data.connected),
    qr: typeof res.data.qr === 'string' ? res.data.qr : null,
    ownerJid: typeof res.data.ownerJid === 'string' ? res.data.ownerJid : null,
  };
}

export async function getWhatsAppServiceHealth(): Promise<{
  ok: boolean;
  qrLinkingReady: boolean;
  baileysVersion: string | null;
  error?: string;
}> {
  const res = await waFetch('GET', '/health');
  const version = typeof res.data.baileys_version === 'string' ? res.data.baileys_version : null;
  const qrLinkingReady = res.data.qr_linking_ready === true || res.data.baileys_version_ok === true;
  if (!res.ok || !qrLinkingReady) {
    return {
      ok: false,
      qrLinkingReady: false,
      baileysVersion: version,
      error:
        typeof res.data.baileys_version_error === 'string'
          ? res.data.baileys_version_error
          : 'WhatsApp service health check failed — Baileys version not ready (QR linking will fail)',
    };
  }
  return { ok: true, qrLinkingReady: true, baileysVersion: version };
}

export async function sendWhatsAppToConnector(
  connectorId: string,
  message: string,
): Promise<{ ok: boolean; error?: string }> {
  const res = await waFetch('POST', '/send', { connector_id: connectorId, message });
  if (!res.ok) {
    return { ok: false, error: String(res.data.error ?? 'Send failed') };
  }
  return { ok: true };
}

export async function sendWhatsAppDocument(input: {
  connectorId: string;
  filePath: string;
  fileName?: string;
  mimetype?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const res = await waFetch('POST', '/send-document', {
    connector_id: input.connectorId,
    file_path: input.filePath,
    file_name: input.fileName,
    mimetype: input.mimetype,
  });
  if (!res.ok) {
    return { ok: false, error: String(res.data.error ?? 'Document send failed') };
  }
  return { ok: true };
}

export async function sendWhatsAppApproval(input: {
  connector_id: string;
  action_id: string;
  agent_name: string;
  scope: string;
  context: string;
}): Promise<{ ok: boolean; error?: string }> {
  const res = await waFetch('POST', '/send-approval', input);
  if (!res.ok) {
    return { ok: false, error: String(res.data.error ?? 'Approval send failed') };
  }
  return { ok: true };
}

export async function sendWhatsAppNotification(
  connectorId: string,
  message: string,
  level: 'info' | 'warning' | 'error',
): Promise<{ ok: boolean; error?: string }> {
  const res = await waFetch('POST', '/send-notification', {
    connector_id: connectorId,
    message,
    level,
  });
  if (!res.ok) {
    return { ok: false, error: String(res.data.error ?? 'Notification send failed') };
  }
  return { ok: true };
}

export async function sendWhatsAppToRecipient(input: {
  connectorId: string;
  recipient: string;
  message: string;
}): Promise<{
  ok: boolean;
  error?: string;
  jid?: string;
  phone?: string | null;
  name?: string | null;
  matches?: Array<{ name: string | null; phone: string | null; jid: string }>;
}> {
  const res = await waFetch('POST', '/send-to', {
    connector_id: input.connectorId,
    recipient: input.recipient,
    message: input.message,
  });
  if (!res.ok) {
    return {
      ok: false,
      error: String(res.data.error ?? 'Send failed'),
      matches: Array.isArray(res.data.matches)
        ? (res.data.matches as Array<{ name: string | null; phone: string | null; jid: string }>)
        : undefined,
    };
  }
  return {
    ok: true,
    jid: typeof res.data.jid === 'string' ? res.data.jid : undefined,
    phone: typeof res.data.phone === 'string' ? res.data.phone : null,
    name: typeof res.data.name === 'string' ? res.data.name : null,
  };
}

export async function listWhatsAppContacts(input: {
  connectorId: string;
  query?: string;
  limit?: number;
}): Promise<{
  ok: boolean;
  error?: string;
  contacts?: Array<{ jid: string; phone: string | null; name: string | null }>;
  totalMatched?: number;
}> {
  const res = await waFetch('POST', '/contacts/list', {
    connector_id: input.connectorId,
    query: input.query ?? '',
    limit: input.limit ?? 50,
  });
  if (!res.ok) {
    return { ok: false, error: String(res.data.error ?? 'List contacts failed') };
  }
  return {
    ok: true,
    contacts: Array.isArray(res.data.contacts)
      ? (res.data.contacts as Array<{ jid: string; phone: string | null; name: string | null }>)
      : [],
    totalMatched: typeof res.data.total_matched === 'number' ? res.data.total_matched : undefined,
  };
}

export async function getWhatsAppChatMessages(input: {
  connectorId: string;
  recipient: string;
  limit?: number;
}): Promise<{
  ok: boolean;
  error?: string;
  jid?: string;
  name?: string | null;
  phone?: string | null;
  messages?: Array<{
    id: string | null;
    from_me: boolean;
    text: string;
    timestamp: string;
    push_name: string | null;
  }>;
  note?: string;
  matches?: Array<{ name: string | null; phone: string | null; jid: string }>;
}> {
  const res = await waFetch('POST', '/chats/messages', {
    connector_id: input.connectorId,
    recipient: input.recipient,
    limit: input.limit ?? 30,
  });
  if (!res.ok) {
    return {
      ok: false,
      error: String(res.data.error ?? 'Read chat failed'),
      matches: Array.isArray(res.data.matches)
        ? (res.data.matches as Array<{ name: string | null; phone: string | null; jid: string }>)
        : undefined,
    };
  }
  return {
    ok: true,
    jid: typeof res.data.jid === 'string' ? res.data.jid : undefined,
    name: typeof res.data.name === 'string' ? res.data.name : null,
    phone: typeof res.data.phone === 'string' ? res.data.phone : null,
    messages: Array.isArray(res.data.messages)
      ? (res.data.messages as Array<{
          id: string | null;
          from_me: boolean;
          text: string;
          timestamp: string;
          push_name: string | null;
        }>)
      : [],
    note: typeof res.data.note === 'string' ? res.data.note : undefined,
  };
}
