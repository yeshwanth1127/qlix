const QLIX_URL = (process.env.QLIX_URL || 'http://localhost:4000').replace(/\/$/, '');
const SERVICE_SECRET = process.env.SERVICE_SECRET || '';
// 25s default. Inbound messages must complete fast so a hung backend doesn't freeze the inbound lock.
const REQUEST_TIMEOUT_MS = Number(process.env.QLIX_REQUEST_TIMEOUT_MS || 25_000);

function headers() {
  return {
    'Content-Type': 'application/json',
    'X-Service-Secret': SERVICE_SECRET,
  };
}

async function request(method, path, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const url = `${QLIX_URL}${path}`;
  try {
    const res = await fetch(url, {
      method,
      headers: headers(),
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }
    if (!res.ok) {
      const msg = data?.error?.message || data?.message || text || res.statusText;
      // 401 here means the QLIX_INTERNAL_SERVICE_SECRET in the backend doesn't match the
      // SERVICE_SECRET in this sidecar (or the backend was started before .env was updated).
      // Surface this loudly so the user sees it in service logs instead of silently confusing
      // WhatsApp replies.
      if (res.status === 401) {
        console.error(
          `[qlix-whatsapp] backend rejected service secret on ${method} ${path}. ` +
            `Check QLIX_INTERNAL_SERVICE_SECRET in backend/.env matches SERVICE_SECRET in ` +
            `qlix-whatsapp-service/.env and RESTART the backend.`,
        );
      }
      return { ok: false, error: `Qlix API error (${res.status}): ${msg}` };
    }
    return { ok: true, data };
  } catch (err) {
    const aborted = err?.name === 'AbortError';
    const reason = aborted ? `timeout after ${REQUEST_TIMEOUT_MS}ms` : err.message;
    console.warn(`[qlix-whatsapp] request failed ${method} ${path}: ${reason}`);
    return { ok: false, error: `Could not reach Qlix: ${reason}` };
  } finally {
    clearTimeout(timer);
  }
}

export async function notifyLinked(connectorId, ownerJid) {
  await request('POST', `/api/v1/internal/whatsapp/${encodeURIComponent(connectorId)}/linked`, {
    owner_jid: ownerJid,
  });
}

export async function notifyLoggedOut(connectorId) {
  await request('POST', `/api/v1/internal/whatsapp/${encodeURIComponent(connectorId)}/logged-out`);
}

export async function resolveApproval(actionId, approved, reason) {
  const result = await request('POST', '/api/v1/jit/resolve', {
    action_id: actionId,
    approved,
    reason: reason ?? null,
  });
  if (!result.ok) return result.error;
  return null;
}

export async function sendInbound(connectorId, text) {
  const result = await request('POST', '/api/v1/whatsapp/inbound', {
    connector_id: connectorId,
    text,
  });
  if (!result.ok) return result.error;
  return result.data?.reply ?? result.data?.message ?? 'Message received.';
}

export async function getAgentStatus(connectorId) {
  const result = await request(
    'GET',
    `/api/v1/whatsapp/agents/status?connector_id=${encodeURIComponent(connectorId)}`,
  );
  if (!result.ok) return result.error;
  return result.data?.text ?? JSON.stringify(result.data);
}

export async function stopAgent(connectorId, name) {
  const encoded = encodeURIComponent(name);
  const result = await request(
    'POST',
    `/api/v1/whatsapp/agents/${encoded}/stop?connector_id=${encodeURIComponent(connectorId)}`,
    { connector_id: connectorId },
  );
  if (!result.ok) return result.error;
  return result.data?.message ?? `Stopped runs for ${name}.`;
}

export async function postAlert(message) {
  await request('POST', '/api/v1/internal/alerts', { message, source: 'qlix-whatsapp-service' });
}
