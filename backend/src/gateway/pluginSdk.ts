import type { ChannelAdapter, GatewayChannel } from './types.js';
import { replyDispatcher } from './replyDispatcher.js';
import {
  PluginLifecycleRegistry,
  type DisposableRegistration,
  type PluginOwner,
} from '../plugins/pluginLifecycle.js';

const adapters = new PluginLifecycleRegistry<ChannelAdapter>();
const managedAdapters = new Map<string, ChannelAdapter>();

/**
 * Third-party channel plugin registration (OpenClaw plugin-sdk style).
 * Built-in adapters also go through this so custom channels can plug in.
 */
export function registerChannelAdapter(
  adapter: ChannelAdapter,
  options: { owner?: PluginOwner; dependencies?: string[]; cleanup?: () => void | Promise<void> } = {},
): DisposableRegistration {
  const channel = String(adapter.channel);
  const managed: ChannelAdapter = {
    channel: adapter.channel,
    deliver: (target, payload) => adapters.run(channel, (active) => active.deliver(target, payload)),
  };
  const registration = adapters.register(channel, adapter, {
    owner: options.owner ?? { id: `gateway:${channel}`, kind: 'gateway' },
    dependencies: options.dependencies,
    cleanup: async () => {
      replyDispatcher.unregisterAdapter(adapter.channel, managed);
      managedAdapters.delete(channel);
      await options.cleanup?.();
    },
  });
  managedAdapters.set(channel, managed);
  replyDispatcher.registerAdapter(managed);
  console.info(`[gateway-plugin] registered channel adapter: ${adapter.channel}`);
  return registration;
}

export function getChannelAdapter(channel: GatewayChannel | string): ChannelAdapter | undefined {
  const key = String(channel);
  return adapters.get(key) ? managedAdapters.get(key) : undefined;
}

export function listChannelAdapters(): string[] {
  return adapters.keys();
}

export function getChannelAdapterMetadata(channel: GatewayChannel | string) {
  return adapters.metadata(String(channel));
}

export async function deactivateChannelAdapter(channel: GatewayChannel | string): Promise<void> {
  await adapters.deactivate(String(channel));
}

export async function disposeGatewayPlugin(ownerId: string): Promise<void> {
  await adapters.disposeOwner(ownerId);
}
