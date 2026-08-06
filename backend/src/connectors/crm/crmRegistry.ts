import type { CrmPlatformId, CrmSession } from './crm.types.js';
import type { CrmProviderAdapter } from './crmProvider.interface.js';
import { zohoCrmProvider } from './providers/zohoCrm.provider.js';

const adapters: Record<CrmPlatformId, CrmProviderAdapter> = {
  zoho: zohoCrmProvider,
};

export function getCrmAdapter(platform: CrmPlatformId): CrmProviderAdapter {
  const adapter = adapters[platform];
  if (!adapter) throw new Error(`No CRM adapter registered for platform: ${platform}`);
  return adapter;
}

export function listCrmAdapters(): CrmProviderAdapter[] {
  return Object.values(adapters);
}
