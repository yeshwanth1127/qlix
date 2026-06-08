import { isWhatsAppServiceConfigured, sendWhatsAppApproval, sendWhatsAppNotification, sendWhatsAppToConnector } from '../connectors/whatsappServiceClient.js';

export function isWhatsAppJitEnabled(): boolean {
  return (
    (process.env.QLIX_WHATSAPP_ENABLED === '1' || process.env.QLIX_WHATSAPP_ENABLED === 'true') &&
    isWhatsAppServiceConfigured()
  );
}

export async function sendApproval(input: {
  connector_id: string;
  action_id: string;
  agent_name: string;
  scope: string;
  context: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (!isWhatsAppJitEnabled()) {
    return { ok: false, error: 'WhatsApp JIT not enabled' };
  }
  // Retry to survive the reconnect race: the Baileys session may still be
  // connecting when the JIT request fires, so the first send can 503.
  let last: { ok: boolean; error?: string } = { ok: false, error: 'not attempted' };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    last = await sendWhatsAppApproval(input);
    if (last.ok) return last;
    console.warn(
      `[whatsapp-notifier] sendApproval attempt ${attempt + 1}/3 failed:`,
      last.error,
    );
    if (attempt < 2) await new Promise((r) => setTimeout(r, 1500));
  }
  return last;
}

export async function sendMessage(
  connectorId: string,
  message: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!isWhatsAppServiceConfigured()) {
    return { ok: false, error: 'WhatsApp service not configured (QLIX_WHATSAPP_SERVICE_URL)' };
  }
  const result = await sendWhatsAppToConnector(connectorId, message);
  if (!result.ok) {
    console.warn('[whatsapp-notifier] send failed:', result.error);
  }
  return result;
}

export async function sendNotification(
  connectorId: string,
  message: string,
  level: 'info' | 'warning' | 'error' = 'info',
): Promise<{ ok: boolean; error?: string }> {
  if (!isWhatsAppServiceConfigured()) {
    return { ok: false, error: 'WhatsApp service not configured (QLIX_WHATSAPP_SERVICE_URL)' };
  }
  const res = await sendWhatsAppNotification(connectorId, message, level);
  if (!res.ok) {
    console.warn('[whatsapp-notifier] notification failed:', res.error);
  }
  return res;
}
