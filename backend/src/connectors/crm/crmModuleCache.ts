import type { CrmModuleInfo, CrmPlatformId } from './crm.types.js';

const TTL_MS = 60 * 60 * 1000;

interface CacheEntry {
  modules: CrmModuleInfo[];
  fetchedAtMs: number;
}

const cache = new Map<string, CacheEntry>();

function cacheKey(orgId: string, platform: CrmPlatformId): string {
  return `${orgId}:${platform}`;
}

export function getCachedModules(orgId: string, platform: CrmPlatformId): CrmModuleInfo[] | null {
  const entry = cache.get(cacheKey(orgId, platform));
  if (!entry) return null;
  if (Date.now() - entry.fetchedAtMs > TTL_MS) {
    cache.delete(cacheKey(orgId, platform));
    return null;
  }
  return entry.modules;
}

export function setCachedModules(orgId: string, platform: CrmPlatformId, modules: CrmModuleInfo[]): void {
  cache.set(cacheKey(orgId, platform), { modules, fetchedAtMs: Date.now() });
}

export function clearCachedModules(orgId: string, platform?: CrmPlatformId): void {
  if (platform) {
    cache.delete(cacheKey(orgId, platform));
    return;
  }
  for (const key of cache.keys()) {
    if (key.startsWith(`${orgId}:`)) cache.delete(key);
  }
}

export function resolveModuleApiName(
  modules: CrmModuleInfo[],
  module: string,
  platform: CrmPlatformId,
): string {
  const normalized = module.trim();
  const exact = modules.find((m) => m.apiName === normalized);
  if (exact) return exact.apiName;

  const lower = normalized.toLowerCase();
  const match = modules.find((m) => m.apiName.toLowerCase() === lower);
  if (match) return match.apiName;

  const sample = modules.slice(0, 12).map((m) => m.apiName).join(', ');
  throw new Error(
    `Unknown CRM module "${module}" for ${platform}. Available modules include: ${sample}${modules.length > 12 ? ', …' : ''}. Call crm_list_modules first.`,
  );
}

export function assertModuleAllowed(
  modules: CrmModuleInfo[],
  module: string,
  platform: CrmPlatformId,
): string {
  return resolveModuleApiName(modules, module, platform);
}
