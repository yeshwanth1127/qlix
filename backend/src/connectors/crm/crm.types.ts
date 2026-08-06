import type { ConnectorProvider, StoredOAuthTokens } from '../connectors.types.js';

/** Supported CRM platforms (extend when adding HubSpot, Salesforce, etc.). */
export type CrmPlatformId = 'zoho';

/** Connector providers that expose CRM capabilities. */
export const CRM_CONNECTOR_PROVIDERS: readonly ConnectorProvider[] = ['zoho'] as const;

export function connectorProviderToCrmPlatform(provider: ConnectorProvider): CrmPlatformId | null {
  if (provider === 'zoho') return 'zoho';
  return null;
}

export function isCrmConnectorProvider(provider: ConnectorProvider): boolean {
  return CRM_CONNECTOR_PROVIDERS.includes(provider);
}

/** Active CRM connection for a workspace. */
export interface CrmSession {
  platform: CrmPlatformId;
  connectorProvider: ConnectorProvider;
  orgId: string;
  credentials: StoredOAuthTokens;
}

export interface CrmModuleInfo {
  apiName: string;
  label: string;
  pluralLabel?: string;
}

export interface CrmFieldInfo {
  apiName: string;
  label: string;
  dataType: string;
  required?: boolean;
  picklistValues?: string[];
}

export interface CrmModuleSchema {
  module: string;
  fields: CrmFieldInfo[];
  queryLanguage?: string;
  queryHint?: string;
}

export interface CrmSearchInput {
  module: string;
  word?: string;
  fields?: string[];
  page?: number;
  perPage?: number;
}

export interface CrmQueryInput {
  /** Provider-native query (COQL for Zoho, SOQL for Salesforce, etc.). */
  query: string;
}

export interface CrmGetInput {
  module: string;
  recordId: string;
  fields?: string[];
}

export interface CrmCreateInput {
  module: string;
  fields: Record<string, unknown>;
  jitToken?: string | null;
}

export interface CrmUpdateInput {
  module: string;
  recordId: string;
  fields: Record<string, unknown>;
  jitToken?: string | null;
}

export interface CrmDeleteInput {
  module: string;
  recordId: string;
  jitToken?: string | null;
}

export interface CrmBulkInput {
  module: string;
  records: Array<Record<string, unknown>>;
  jitToken?: string | null;
}

export interface CrmConvertLeadInput {
  leadId: string;
  dealName?: string;
  accountName?: string;
  contactRole?: string;
  overwrite?: boolean;
  notifyLeadOwner?: boolean;
  assignTo?: string;
  jitToken?: string | null;
}

export interface CrmLinkInput {
  module: string;
  recordId: string;
  relatedModule: string;
  relatedRecordId: string;
  jitToken?: string | null;
}

export interface CrmUnlinkInput {
  module: string;
  recordId: string;
  relatedModule: string;
  relatedRecordId: string;
  jitToken?: string | null;
}

export interface CrmAttachmentListInput {
  module: string;
  recordId: string;
}

export interface CrmAttachmentUploadInput {
  module: string;
  recordId: string;
  fileName: string;
  /** Base64-encoded file bytes from the agent runner. */
  fileBase64: string;
  mimeType?: string;
  jitToken?: string | null;
}

export interface CrmAttachmentDownloadInput {
  module: string;
  recordId: string;
  attachmentId: string;
}

export interface CrmAddNoteInput {
  module: string;
  recordId: string;
  title?: string;
  content: string;
  jitToken?: string | null;
}

export interface CrmToolResult<T> {
  session: CrmSession;
  data: T;
}

export function crmBulkMaxRecords(): number {
  const raw = Number(process.env.CRM_BULK_MAX_RECORDS ?? 100);
  if (!Number.isFinite(raw) || raw < 1) return 100;
  return Math.min(500, Math.floor(raw));
}
