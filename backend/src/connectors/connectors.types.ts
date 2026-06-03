export type ConnectorProvider = 'google' | 'whatsapp_baileys';

export type ConnectorStatus = 'connected' | 'revoked' | 'error' | 'pending_qr';

export interface StoredOAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAtMs: number | null;
  scopes: string[];
  emailAddress: string | null;
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
