import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import {
  PLUGIN_CATALOG,
  getPluginDef,
  validatePluginActivation,
  type PluginDef,
} from './pluginCatalog.js';
import {
  drainOrganizationPlugin,
  resumeOrganizationPlugin,
} from './organizationPluginLifecycle.js';

export interface AnnotatedPluginDef extends PluginDef {
  enabled: boolean;
  lifecycleState: string;
}

export class UnknownPluginError extends Error {
  constructor(pluginId: string) {
    super(`Unknown plugin: ${pluginId}`);
  }
}

export class PluginValidationError extends Error {
  readonly code = 'plugin_validation_failed';
  constructor(pluginId: string, readonly problems: string[]) {
    super(`Cannot activate ${pluginId}: ${problems.join('; ')}`);
  }
}

/** Full catalog annotated with this org's enabled state — same shape convention as getEffectiveScopes. */
export async function listPluginsForOrg(orgId: string): Promise<AnnotatedPluginDef[]> {
  const rows = await prisma.orgPlugin.findMany({
    where: { orgId },
    select: { pluginId: true, enabled: true, lifecycleState: true },
  });
  const state = new Map(rows.map((row) => [row.pluginId, row]));
  return PLUGIN_CATALOG.map((plugin) => ({
    ...plugin,
    enabled: state.get(plugin.id)?.enabled === true,
    lifecycleState: state.get(plugin.id)?.lifecycleState ?? 'inactive',
  }));
}

/** Just the enabled plugin ids — what the session payload and nav need. */
export async function getEnabledPluginIds(orgId: string): Promise<string[]> {
  const rows = await prisma.orgPlugin.findMany({
    where: { orgId, enabled: true },
    select: { pluginId: true },
  });
  return rows.map((row) => row.pluginId);
}

/** Only explicit user disables count here; a missing legacy row preserves old behavior. */
export async function getExplicitlyDisabledPluginIds(orgId: string): Promise<string[]> {
  const rows = await prisma.orgPlugin.findMany({
    where: { orgId, enabled: false },
    select: { pluginId: true },
  });
  return rows.map((row) => row.pluginId);
}

export async function enablePlugin(
  orgId: string,
  pluginId: string,
  userId: string,
  config: Record<string, unknown> = {},
): Promise<void> {
  const plugin = getPluginDef(pluginId);
  if (!plugin) throw new UnknownPluginError(pluginId);
  const enabledPluginIds = await getEnabledPluginIds(orgId);
  const problems = validatePluginActivation(plugin, { enabledPluginIds, config });
  if (problems.length > 0) throw new PluginValidationError(pluginId, problems);
  await prisma.orgPlugin.upsert({
    where: { orgId_pluginId: { orgId, pluginId } },
    update: {
      enabled: true,
      disabledAt: null,
      lifecycleState: 'active',
      lifecycleError: null,
      config: config as Prisma.InputJsonValue,
    },
    create: {
      orgId,
      pluginId,
      enabled: true,
      enabledByUserId: userId,
      lifecycleState: 'active',
      config: config as Prisma.InputJsonValue,
    },
  });
  resumeOrganizationPlugin(orgId, pluginId);
}

export async function disablePlugin(orgId: string, pluginId: string): Promise<void> {
  if (!getPluginDef(pluginId)) throw new UnknownPluginError(pluginId);
  await prisma.orgPlugin.updateMany({
    where: { orgId, pluginId },
    data: { enabled: false, disabledAt: new Date(), lifecycleState: 'draining', lifecycleError: null },
  });
  try {
    await drainOrganizationPlugin(orgId, pluginId);
    await prisma.orgPlugin.updateMany({
      where: { orgId, pluginId },
      data: { lifecycleState: 'inactive' },
    });
  } catch (error) {
    await prisma.orgPlugin.updateMany({
      where: { orgId, pluginId },
      data: {
        lifecycleState: 'failed',
        lifecycleError: error instanceof Error ? error.message.slice(0, 2000) : String(error).slice(0, 2000),
      },
    });
    throw error;
  }
}
