export type ConnectorProvider =
  | 'google'
  | 'whatsapp_baileys'
  | 'orbit'
  | 'zoho'
  | 'slack'
  | 'discord'
  | 'github'
  | 'telegram';

/** Orbit (Postiz) Public API credentials stored encrypted in tokenEnc. */
export interface StoredOrbitCredentials {
  apiKey: string;
  baseUrl: string;
  /** Orbit integration IDs owned by this Qlix workspace (isolation). */
  channelIds: string[];
  /** When set, next channel list refresh may claim unowned Orbit integrations. */
  pendingClaimAtMs?: number | null;
  /** Optional Orbit Customer/group id when available. */
  groupId?: string | null;
  groupName?: string | null;
}

export type ConnectorStatus = 'connected' | 'revoked' | 'error' | 'pending_qr';

export interface StoredOAuthTokens {
  /** Primary token — Gmail/Zoho access token; Slack **user** token (xoxp-…). */
  accessToken: string;
  refreshToken: string;
  expiresAtMs: number | null;
  scopes: string[];
  emailAddress: string | null;
  /** Zoho API domain from token response (e.g. https://www.zohoapis.in). */
  apiDomain?: string | null;
  /** Zoho accounts server used for refresh (e.g. https://accounts.zoho.in). */
  accountsUrl?: string | null;
  /** Slack bot token (xoxb-…) when app installs with bot scopes. */
  slackBotAccessToken?: string | null;
  /** Slack workspace id (team.id). */
  teamId?: string | null;
  teamName?: string | null;
  /** Slack user id of the authorizing member (authed_user.id). */
  slackUserId?: string | null;
}

export interface ConnectorAccountDTO {
  id: string;
  orgId: string;
  userId: string;
  provider: ConnectorProvider;
  status: ConnectorStatus;
  scopes: string[];
  emailAddress: string | null;
  whatsappOwnerJid: string | null;
  whatsappDefaultAgentId: string | null;
  whatsappDefaultTeamId: string | null;
  connectedAt: string;
  updatedAt: string;
}

export interface WhatsAppLinkStatusDTO {
  connectorId: string;
  status: ConnectorStatus;
  qr: string | null;
  phone: string | null;
  ownerJid: string | null;
}

export interface N8nIntegrationDTO {
  configured: boolean;
  n8nBaseUrl: string | null;
  n8nEmailReadPath: string;
  n8nEmailSendPath: string;
}

export interface EmailReadInput {
  query?: string;
  maxResults?: number;
  messageId?: string | null;
  /** When false, skip downloading/extracting attachments (metadata still omitted). Default true. */
  includeAttachments?: boolean;
}

export type EmailAttachmentProcessed = {
  attachmentId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  /** Sandbox download URL (same store as agent-generated files / chat uploads). */
  url: string;
  /** Text extracted for the LLM (PDF/DOCX/XLSX/CSV/text/…). */
  extractedText?: string;
  textPreview?: string;
  /** Present when download/extract failed but metadata was known. */
  error?: string;
};

export interface EmailReadResult {
  messages: Array<{
    id: string;
    threadId: string;
    from: string;
    to: string[];
    subject: string;
    snippet: string;
    bodyText: string;
    receivedAt: string;
    attachments?: EmailAttachmentProcessed[];
  }>;
}

export type EmailSendMode = 'send' | 'draft' | 'list_drafts' | 'delete_draft';

export interface EmailSendInput {
  to: string[];
  subject: string;
  bodyText: string;
  /**
   * `send` delivers immediately;
   * `draft` saves to Gmail Drafts (no JIT);
   * `list_drafts` lists Gmail drafts;
   * `delete_draft` deletes a draft by `draftId` (no JIT).
   */
  mode?: EmailSendMode;
  /** Required for mode=delete_draft (Gmail draft resource id, not message id). */
  draftId?: string | null;
  maxResults?: number;
  replyToMessageId?: string | null;
  jitToken?: string | null;
  metadata?: {
    campaignId?: string;
    leadId?: string;
  };
}

export interface EmailSendResult {
  messageId: string;
  threadId: string;
  status: string;
  /** Present when mode=draft or delete_draft. */
  draftId?: string;
  mode?: EmailSendMode;
  /** Connected Gmail mailbox where the draft/send was performed. */
  mailboxEmail?: string;
  /**
   * Short instruction for the model/UI — e.g. drafts live in this mailbox's Drafts,
   * not in the To: recipient's inbox, and were not delivered.
   */
  note?: string;
  /** Present when mode=list_drafts. */
  drafts?: Array<{
    draftId: string;
    messageId: string;
    threadId: string;
    to: string[];
    subject: string;
    snippet: string;
  }>;
}
