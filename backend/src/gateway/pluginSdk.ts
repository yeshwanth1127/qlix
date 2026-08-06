import type { ChannelAdapter, GatewayChannel } from './types.js';
import { replyDispatcher } from './replyDispatcher.js';

const adapters = new Map<GatewayChannel | string, ChannelAdapter>();

/**
 * Third-party channel plugin registration (OpenClaw plugin-sdk style).
 * Built-in adapters also go through this so custom channels can plug in.
 */
export function registerChannelAdapter(adapter: ChannelAdapter): void {
  adapters.set(adapter.channel, adapter);
  replyDispatcher.registerAdapter(adapter);
  console.info(`[gateway-plugin] registered channel adapter: ${adapter.channel}`);
}

export function getChannelAdapter(channel: GatewayChannel | string): ChannelAdapter | undefined {
  return adapters.get(channel);
}

export function listChannelAdapters(): string[] {
  return [...adapters.keys()];
}
