import assert from 'node:assert/strict';
import test from 'node:test';
import { filterScopesByDisabledPlugins } from '../agents/scopeCatalog.js';
import { validatePluginActivation, type PluginDef } from './pluginCatalog.js';
import {
  drainOrganizationPlugin,
  registerOrganizationPluginCleanup,
  resumeOrganizationPlugin,
  withOrganizationPluginLease,
} from './organizationPluginLifecycle.js';

test('organization plugin drains active work and runs every cleanup hook', async () => {
  const orgId = 'org-phase11';
  const pluginId = 'plugin-phase11';
  resumeOrganizationPlugin(orgId, pluginId);
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => { finish = resolve; });
  let cleaned = false;
  const unregister = registerOrganizationPluginCleanup(pluginId, () => { cleaned = true; });
  const active = withOrganizationPluginLease(orgId, pluginId, async () => { await gate; });
  const draining = drainOrganizationPlugin(orgId, pluginId);
  await Promise.resolve();
  assert.equal(cleaned, false);
  finish();
  await active;
  await draining;
  assert.equal(cleaned, true);
  unregister();
});

test('declarative requirements fail before activation', () => {
  const plugin: PluginDef = {
    id: 'dependent',
    name: 'Dependent',
    description: 'fixture',
    navItems: [],
    defaultEnabled: false,
    requirements: { plugins: ['base'], env: ['API_TOKEN'], configKeys: ['endpoint'] },
  };
  const errors = validatePluginActivation(plugin, {
    enabledPluginIds: [],
    config: {},
    env: {},
  });
  assert.deepEqual(errors, [
    'requires plugin base',
    'requires environment variable API_TOKEN',
    'requires configuration key endpoint',
  ]);
});

test('explicit disable hides only plugin-owned scopes and keeps grants restorable', () => {
  const original = ['web.read', 'assessment.session.get', 'assessment.report.create'];
  const filtered = filterScopesByDisabledPlugins(original, ['assessment']);
  assert.deepEqual(filtered, ['web.read']);
  assert.deepEqual(original, ['web.read', 'assessment.session.get', 'assessment.report.create']);
  assert.deepEqual(filterScopesByDisabledPlugins(original, []), original);
});
