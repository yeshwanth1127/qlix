export type ConnectorProvider = 'google' | 'whatsapp_baileys' | 'orbit' | 'zoho' | 'slack' | 'telegram';

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
}

export interface EmailSendInput {
  to: string[];
  subject: string;
  bodyText: string;
  replyToMessageId?: string | null;
  jitToken?: string | null;
  metadata?: {
    campaignId?: string;
    leadId?: string;
  };
}

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
  }>;
}

export interface EmailSendResult {
  messageId: string;
  threadId: string;
  status: string;
}
