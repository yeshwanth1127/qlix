import type {
  ChannelAdapter,
  DeliveryTarget,
  GatewayChannel,
  ReplyPayload,
} from './types.js';
import { clearActiveRun } from './sessionLane.js';

interface PendingReply {
  deliveryTarget: DeliveryTarget;
  sessionKey: string;
  trackedAt: number;
}

/**
 * Tracks run → delivery target and fans out completion to channel adapters.
 * Replaces scattered notifyWhatsappRunComplete call sites.
 */
class ReplyDispatcherImpl {
  private readonly pending = new Map<string, PendingReply>();
  private readonly adapters = new Map<GatewayChannel, ChannelAdapter>();

  registerAdapter(adapter: ChannelAdapter): void {
    this.adapters.set(adapter.channel, adapter);
  }

  track(runId: string, deliveryTarget: DeliveryTarget, sessionKey: string): void {
    this.pending.set(runId, {
      deliveryTarget,
      sessionKey,
      trackedAt: Date.now(),
    });
  }

  getPending(runId: string): PendingReply | undefined {
    return this.pending.get(runId);
  }

  async deliver(runId: string, payload: Omit<ReplyPayload, 'runId'>): Promise<void> {
    const pending = this.pending.get(runId);
    clearActiveRun(pending?.sessionKey ?? '', runId);
    this.pending.delete(runId);

    const full: ReplyPayload = { runId, ...payload };

    // Prefer tracked delivery target; fall back to channel adapters that know how to discover.
    if (pending) {
      const channel = pending.deliveryTarget.channel;
      const adapter =
        this.adapters.get(channel) ?? (channel === 'api' ? this.adapters.get('web') : undefined);
      if (adapter) {
        await adapter.deliver(pending.deliveryTarget, full);
      }
      return;
    }

    // Fallback: try WhatsApp adapter for legacy untracked runs (teamRole=whatsapp).
    const wa = this.adapters.get('whatsapp');
    if (wa) {
      await wa.deliver({ channel: 'whatsapp' }, full);
    }
  }

  /** Test helper */
  _resetForTests(): void {
    this.pending.clear();
  }
}

export const replyDispatcher = new ReplyDispatcherImpl();
