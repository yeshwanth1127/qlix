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
}): Promise<void> {
  if (!isWhatsAppJitEnabled()) return;
  const result = await sendWhatsAppApproval(input);
  if (!result.ok) {
    console.warn('[whatsapp-notifier] sendApproval failed:', result.error);
  }
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
