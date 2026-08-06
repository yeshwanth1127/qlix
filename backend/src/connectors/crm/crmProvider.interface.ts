import type {
  CrmAddNoteInput,
  CrmAttachmentDownloadInput,
  CrmAttachmentListInput,
  CrmAttachmentUploadInput,
  CrmBulkInput,
  CrmConvertLeadInput,
  CrmCreateInput,
  CrmDeleteInput,
  CrmFieldInfo,
  CrmGetInput,
  CrmLinkInput,
  CrmModuleInfo,
  CrmModuleSchema,
  CrmPlatformId,
  CrmQueryInput,
  CrmSearchInput,
  CrmSession,
  CrmToolResult,
  CrmUnlinkInput,
  CrmUpdateInput,
} from './crm.types.js';

/**
 * Provider-agnostic CRM adapter. Each CRM platform (Zoho, HubSpot, Salesforce, …)
 * implements this interface; agent tools call through the registry only.
 */
export interface CrmProviderAdapter {
  readonly platformId: CrmPlatformId;
  readonly displayName: string;
  /** Human-readable query language name shown to agents (e.g. COQL, SOQL). */
  readonly queryLanguage: string;
  readonly queryHint: string;

  refreshSession(session: CrmSession): Promise<CrmSession>;

  listModules(session: CrmSession): Promise<CrmToolResult<CrmModuleInfo[]>>;
  describeModule(session: CrmSession, module: string): Promise<CrmToolResult<CrmModuleSchema>>;

  searchRecords(session: CrmSession, input: CrmSearchInput): Promise<CrmToolResult<unknown[]>>;
  queryRecords(session: CrmSession, input: CrmQueryInput): Promise<CrmToolResult<unknown[]>>;
  getRecord(session: CrmSession, input: CrmGetInput): Promise<CrmToolResult<unknown | null>>;

  createRecord(session: CrmSession, input: CrmCreateInput): Promise<CrmToolResult<unknown | null>>;
  updateRecord(session: CrmSession, input: CrmUpdateInput): Promise<CrmToolResult<unknown | null>>;
  deleteRecord(session: CrmSession, input: CrmDeleteInput): Promise<CrmToolResult<{ deleted: boolean }>>;

  bulkCreate(session: CrmSession, input: CrmBulkInput): Promise<CrmToolResult<unknown[]>>;
  bulkUpdate(
    session: CrmSession,
    input: CrmBulkInput & { recordIds?: string[] },
  ): Promise<CrmToolResult<unknown[]>>;

  convertLead(session: CrmSession, input: CrmConvertLeadInput): Promise<CrmToolResult<unknown>>;
  linkRecords(session: CrmSession, input: CrmLinkInput): Promise<CrmToolResult<{ linked: boolean }>>;
  unlinkRecords(session: CrmSession, input: CrmUnlinkInput): Promise<CrmToolResult<{ unlinked: boolean }>>;

  listAttachments(session: CrmSession, input: CrmAttachmentListInput): Promise<CrmToolResult<unknown[]>>;
  uploadAttachment(session: CrmSession, input: CrmAttachmentUploadInput): Promise<CrmToolResult<unknown | null>>;
  downloadAttachment(
    session: CrmSession,
    input: CrmAttachmentDownloadInput,
  ): Promise<CrmToolResult<{ fileName: string; mimeType: string; fileBase64: string }>>;

  addNote(session: CrmSession, input: CrmAddNoteInput): Promise<CrmToolResult<unknown | null>>;
}

export type { CrmFieldInfo, CrmModuleInfo, CrmModuleSchema };
