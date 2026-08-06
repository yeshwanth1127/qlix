/** Poll until a WhatsApp link status includes a QR or connected state. */
export async function waitForWhatsAppLinkPoll<T extends { qr: string | null; status: string }>(
  poll: () => Promise<T>,
  options?: { maxMs?: number; intervalMs?: number },
): Promise<T> {
  const maxMs = options?.maxMs ?? 20_000;
  const intervalMs = options?.intervalMs ?? 500;
  const deadline = Date.now() + maxMs;
  let last = await poll();
  while (Date.now() < deadline) {
    if (last.qr || last.status === 'connected') return last;
    await new Promise((r) => setTimeout(r, intervalMs));
    last = await poll();
  }
  return last;
}

export function isWhatsAppLinkReady(status: { qr: string | null; status: string }): boolean {
  return Boolean(status.qr) || status.status === 'connected';
}

export function whatsAppLinkNotReadyMessage(): string {
  return (
    'WhatsApp QR could not be generated. Check that qlix-whatsapp-service is running and ' +
    'its /health reports baileys_version_ok. Restart the service if Baileys version lookup failed.'
  );
}
