import assert from 'node:assert/strict';
import test from 'node:test';
import { PluginLifecycleRegistry, PluginUnavailableError } from './pluginLifecycle.js';

test('plugin draining rejects new work, waits for active work, then cleans up', async () => {
  const registry = new PluginLifecycleRegistry<{ run(): Promise<string> }>();
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => { finish = resolve; });
  let cleaned = false;
  registry.register('channel.test', { run: async () => { await gate; return 'done'; } }, {
    owner: { id: 'test-plugin', kind: 'gateway' },
    cleanup: () => { cleaned = true; },
  });

  const active = registry.run('channel.test', (plugin) => plugin.run());
  const stopping = registry.disposeOwner('test-plugin');
  await Promise.resolve();
  await assert.rejects(
    registry.run('channel.test', (plugin) => plugin.run()),
    PluginUnavailableError,
  );
  assert.equal(cleaned, false);
  finish();
  assert.equal(await active, 'done');
  await stopping;
  assert.equal(cleaned, true);
  assert.equal(registry.get('channel.test'), undefined);
});

test('activation validates config and active dependencies', async () => {
  const registry = new PluginLifecycleRegistry<string, { endpoint?: string }>();
  registry.register('dependency', 'dep');
  registry.register('plugin', 'value', {
    active: false,
    dependencies: ['dependency'],
    validateConfig(config) {
      if (!config.endpoint?.startsWith('https://')) throw new Error('https endpoint required');
    },
  });
  await assert.rejects(registry.activate('plugin', {}), /https endpoint required/);
  await registry.activate('plugin', { endpoint: 'https://example.test' });
  assert.equal(registry.get('plugin'), 'value');
});
