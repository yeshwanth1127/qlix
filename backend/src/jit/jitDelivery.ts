export type JitDeliveryChannel =
  | 'web'
  | 'api'
  | 'whatsapp'
  | 'slack'
  | 'telegram'
  | 'local'
  | 'cron';

const KNOWN: ReadonlySet<string> = new Set([
  'web',
  'api',
  'whatsapp',
  'slack',
  'telegram',
  'local',
  'cron',
]);

function normalize(raw?: string | null): JitDeliveryChannel | null {
  const value = raw?.trim().toLowerCase();
  if (value && KNOWN.has(value)) return value as JitDeliveryChannel;
  return null;
}

/**
 * JIT approvals go back to the channel that started the run.
 * Prefer the stored agent-run source, then legacy teamRole, then the parent team run.
 */
export function resolveJitDeliveryChannel(input: {
  sourceChannel?: string | null;
  teamRole?: string | null;
  teamRunSourceChannel?: string | null;
}): JitDeliveryChannel {
  return (
    normalize(input.sourceChannel) ??
    normalize(input.teamRole) ??
    normalize(input.teamRunSourceChannel) ??
    'web'
  );
}

export function shouldDeliverJitToExternalChat(channel: JitDeliveryChannel): boolean {
  return channel === 'whatsapp' || channel === 'slack' || channel === 'telegram';
}

export function jitEventChannel(channel: JitDeliveryChannel): string {
  if (channel === 'web' || channel === 'cron' || channel === 'local') return 'dashboard';
  return channel;
}
