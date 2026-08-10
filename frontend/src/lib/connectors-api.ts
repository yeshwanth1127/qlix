import type { ApiErrorBody } from "./auth-api";

const defaultBase = "http://localhost:4000";

function apiBase(): string {
  return (process.env.NEXT_PUBLIC_API_BASE_URL ?? defaultBase).replace(/\/$/, "");
}

export type ConnectorProvider =
  | "google"
  | "whatsapp_baileys"
  | "orbit"
  | "zoho"
  | "slack"
  | "discord"
  | "github"
  | "telegram";

export type ConnectorStatus = "connected" | "revoked" | "error" | "pending_qr";

export interface ConnectorAccountDTO {
  id: string;
  orgId: string;
  userId: string;
  provider: ConnectorProvider;
  status: ConnectorStatus;
  scopes: string[];
  emailAddress: string | null;
  whatsappDefaultAgentId?: string | null;
  whatsappDefaultTeamId?: string | null;
  connectedAt: string;
  updatedAt: string;
}

export interface WhatsAppLinkStatusDTO {
  status: "disconnected" | "pending_qr" | "connected";
  qr?: string | null;
  phone?: string | null;
  connectorId?: string | null;
}

export interface N8nIntegrationDTO {
  configured: boolean;
  n8nBaseUrl: string | null;
  n8nEmailReadPath: string;
  n8nEmailSendPath: string;
}

export interface ConnectorsListResponse {
  connectors: ConnectorAccountDTO[];
  n8n: N8nIntegrationDTO;
}

async function parseJson<T>(response: Response): Promise<T | ApiErrorBody> {
  return response.json() as Promise<T | ApiErrorBody>;
}

export async function listConnectors(): Promise<ConnectorsListResponse> {
  const response = await fetch(`${apiBase()}/api/v1/connectors`, {
    credentials: "include",
  });
  const data = await parseJson<ConnectorsListResponse>(response);
  if (!response.ok) {
    const err = data as ApiErrorBody;
    throw new Error(err.error?.message ?? "Failed to load connectors");
  }
  return data as ConnectorsListResponse;
}

export async function startGoogleOAuth(
  service: "gmail" | "drive" | "calendar" | "meet" | "youtube" = "gmail",
): Promise<{ url: string; service: string }> {
  const response = await fetch(`${apiBase()}/api/v1/connectors/google/start`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ service }),
  });
  const data = await parseJson<{ url: string; service: string }>(response);
  if (!response.ok) {
    const err = data as ApiErrorBody;
    throw new Error(err.error?.message ?? "Failed to start Google OAuth");
  }
  return data as { url: string; service: string };
}

export async function startZohoOAuth(): Promise<{ url: string }> {
  const response = await fetch(`${apiBase()}/api/v1/connectors/zoho/start`, {
    method: "POST",
    credentials: "include",
  });
  const data = await parseJson<{ url: string }>(response);
  if (!response.ok) {
    const err = data as ApiErrorBody;
    throw new Error(err.error?.message ?? "Failed to start Zoho OAuth");
  }
  return data as { url: string };
}

export async function disconnectGoogle(): Promise<void> {
  const response = await fetch(`${apiBase()}/api/v1/connectors/google`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!response.ok && response.status !== 204) {
    const data = await parseJson<ApiErrorBody>(response);
    throw new Error((data as ApiErrorBody).error?.message ?? "Failed to disconnect Google");
  }
}

export async function disconnectGoogleService(
  service: "gmail" | "drive" | "calendar" | "meet" | "youtube",
): Promise<void> {
  const response = await fetch(
    `${apiBase()}/api/v1/connectors/google/services/${encodeURIComponent(service)}`,
    {
      method: "DELETE",
      credentials: "include",
    },
  );
  if (!response.ok && response.status !== 204) {
    const data = await parseJson<ApiErrorBody>(response);
    throw new Error(
      (data as ApiErrorBody).error?.message ?? "Failed to disconnect Google service",
    );
  }
}

export async function disconnectZoho(): Promise<void> {
  const response = await fetch(`${apiBase()}/api/v1/connectors/zoho`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!response.ok && response.status !== 204) {
    const data = await parseJson<ApiErrorBody>(response);
    throw new Error((data as ApiErrorBody).error?.message ?? "Failed to disconnect Zoho");
  }
}

export async function startSlackOAuth(): Promise<{ url: string }> {
  const response = await fetch(`${apiBase()}/api/v1/connectors/slack/start`, {
    method: "POST",
    credentials: "include",
  });
  const data = await parseJson<{ url: string }>(response);
  if (!response.ok) {
    const err = data as ApiErrorBody;
    throw new Error(err.error?.message ?? "Failed to start Slack OAuth");
  }
  return data as { url: string };
}

export async function disconnectSlack(): Promise<void> {
  const response = await fetch(`${apiBase()}/api/v1/connectors/slack`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!response.ok && response.status !== 204) {
    const data = await parseJson<ApiErrorBody>(response);
    throw new Error((data as ApiErrorBody).error?.message ?? "Failed to disconnect Slack");
  }
}

export async function startDiscordOAuth(): Promise<{ url: string }> {
  const response = await fetch(`${apiBase()}/api/v1/connectors/discord/start`, {
    method: "POST",
    credentials: "include",
  });
  const data = await parseJson<{ url: string }>(response);
  if (!response.ok) {
    const err = data as ApiErrorBody;
    throw new Error(err.error?.message ?? "Failed to start Discord OAuth");
  }
  return data as { url: string };
}

export async function disconnectDiscord(): Promise<void> {
  const response = await fetch(`${apiBase()}/api/v1/connectors/discord`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!response.ok && response.status !== 204) {
    const data = await parseJson<ApiErrorBody>(response);
    throw new Error((data as ApiErrorBody).error?.message ?? "Failed to disconnect Discord");
  }
}

export async function startGitHubOAuth(): Promise<{ url: string }> {
  const response = await fetch(`${apiBase()}/api/v1/connectors/github/start`, {
    method: "POST",
    credentials: "include",
  });
  const data = await parseJson<{ url: string }>(response);
  if (!response.ok) {
    const err = data as ApiErrorBody;
    throw new Error(err.error?.message ?? "Failed to start GitHub OAuth");
  }
  return data as { url: string };
}

export async function disconnectGitHub(): Promise<void> {
  const response = await fetch(`${apiBase()}/api/v1/connectors/github`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!response.ok && response.status !== 204) {
    const data = await parseJson<ApiErrorBody>(response);
    throw new Error((data as ApiErrorBody).error?.message ?? "Failed to disconnect GitHub");
  }
}

export async function saveN8nIntegration(input: {
  n8nBaseUrl: string;
  n8nWebhookSecret: string;
  n8nEmailReadPath?: string;
  n8nEmailSendPath?: string;
}): Promise<void> {
  const response = await fetch(`${apiBase()}/api/v1/connectors/integrations/n8n`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const data = await parseJson<ApiErrorBody>(response);
    throw new Error((data as ApiErrorBody).error?.message ?? "Failed to save n8n settings");
  }
}

export function googleConnector(connectors: ConnectorAccountDTO[]): ConnectorAccountDTO | undefined {
  return connectors.find((c) => c.provider === "google" && c.status === "connected");
}

export function zohoConnector(connectors: ConnectorAccountDTO[]): ConnectorAccountDTO | undefined {
  return connectors.find((c) => c.provider === "zoho" && c.status === "connected");
}

export function whatsappConnector(connectors: ConnectorAccountDTO[]): ConnectorAccountDTO | undefined {
  return connectors.find((c) => c.provider === "whatsapp_baileys");
}

export function orbitConnector(connectors: ConnectorAccountDTO[]): ConnectorAccountDTO | undefined {
  return connectors.find((c) => c.provider === "orbit" && c.status === "connected");
}

export const CONNECTOR_DISPLAY_NAMES: Record<ConnectorProvider, string> = {
  google: "Gmail",
  zoho: "Zoho CRM",
  whatsapp_baileys: "WhatsApp",
  orbit: "Orbit Social",
  slack: "Slack",
  discord: "Discord",
  github: "GitHub",
  telegram: "Telegram",
};

export const CONNECTOR_CATALOG_IDS: Record<ConnectorProvider, string> = {
  google: "google",
  whatsapp_baileys: "whatsapp",
  zoho: "zoho",
  orbit: "facebook",
  slack: "slack",
  discord: "discord",
  github: "github",
  telegram: "telegram",
};

export interface LiveConnectorItem {
  provider: ConnectorProvider;
  name: string;
  detail: string | null;
}

/** Connected workspace connectors (Gmail, WhatsApp, Zoho CRM, Orbit). */
export function listLiveConnectors(connectors: ConnectorAccountDTO[]): LiveConnectorItem[] {
  const items: LiveConnectorItem[] = [];
  const push = (provider: ConnectorProvider, connector: ConnectorAccountDTO) => {
    items.push({
      provider,
      name: CONNECTOR_DISPLAY_NAMES[provider],
      detail: connector.emailAddress,
    });
  };

  const google = googleConnector(connectors);
  if (google) push("google", google);

  const wa = whatsappConnector(connectors);
  if (wa?.status === "connected") push("whatsapp_baileys", wa);

  const zoho = zohoConnector(connectors);
  if (zoho) push("zoho", zoho);

  const orbit = orbitConnector(connectors);
  if (orbit) push("orbit", orbit);

  const slack = slackConnector(connectors);
  if (slack) push("slack", slack);

  const discord = discordConnector(connectors);
  if (discord) push("discord", discord);

  const github = githubConnector(connectors);
  if (github) push("github", github);

  return items;
}

/** Enable Orbit for this workspace using the platform key (no paste). */
export async function enableOrbit(): Promise<{
  connector: ConnectorAccountDTO;
  channelCount: number;
}> {
  const response = await fetch(`${apiBase()}/api/v1/connectors/orbit/enable`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const data = await parseJson<{ connector: ConnectorAccountDTO; channelCount: number }>(response);
  if (!response.ok) {
    const err = data as ApiErrorBody;
    throw new Error(err.error?.message ?? "Failed to enable Orbit");
  }
  return data as { connector: ConnectorAccountDTO; channelCount: number };
}

export async function getOrbitPlatformStatus(): Promise<{
  platformConfigured: boolean;
  defaultBaseUrl: string;
}> {
  const response = await fetch(`${apiBase()}/api/v1/connectors/orbit/status`, {
    credentials: "include",
  });
  const data = await parseJson<{ platformConfigured: boolean; defaultBaseUrl: string }>(response);
  if (!response.ok) {
    const err = data as ApiErrorBody;
    throw new Error(err.error?.message ?? "Failed to load Orbit status");
  }
  return data as { platformConfigured: boolean; defaultBaseUrl: string };
}

export async function disconnectOrbit(): Promise<void> {
  const response = await fetch(`${apiBase()}/api/v1/connectors/orbit`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!response.ok && response.status !== 204) {
    const data = await parseJson<ApiErrorBody>(response);
    throw new Error((data as ApiErrorBody).error?.message ?? "Failed to disconnect Orbit");
  }
}

export interface OrbitChannelDTO {
  id: string;
  name: string;
  identifier: string;
  picture: string | null;
  disabled: boolean;
  profile: string | null;
}

export async function listOrbitChannels(): Promise<OrbitChannelDTO[]> {
  const response = await fetch(`${apiBase()}/api/v1/connectors/orbit/channels`, {
    credentials: "include",
  });
  const data = await parseJson<{ channels: OrbitChannelDTO[] }>(response);
  if (!response.ok) {
    const err = data as ApiErrorBody;
    throw new Error(err.error?.message ?? "Failed to list Orbit channels");
  }
  return (data as { channels: OrbitChannelDTO[] }).channels ?? [];
}

export async function startOrbitSocialOAuth(integration: string): Promise<{ url: string }> {
  const response = await fetch(
    `${apiBase()}/api/v1/connectors/orbit/social/${encodeURIComponent(integration)}/start`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    },
  );
  const data = await parseJson<{ url: string }>(response);
  if (!response.ok) {
    const err = data as ApiErrorBody;
    throw new Error(err.error?.message ?? "Failed to start channel connect");
  }
  return data as { url: string };
}

export async function disconnectOrbitChannel(channelId: string): Promise<void> {
  const response = await fetch(
    `${apiBase()}/api/v1/connectors/orbit/channels/${encodeURIComponent(channelId)}`,
    { method: "DELETE", credentials: "include" },
  );
  if (!response.ok && response.status !== 204) {
    const data = await parseJson<ApiErrorBody>(response);
    throw new Error((data as ApiErrorBody).error?.message ?? "Failed to disconnect channel");
  }
}

export async function startWhatsAppLink(): Promise<WhatsAppLinkStatusDTO> {
  const response = await fetch(`${apiBase()}/api/v1/connectors/whatsapp/link`, {
    method: "POST",
    credentials: "include",
  });
  const data = await parseJson<WhatsAppLinkStatusDTO>(response);
  if (!response.ok) {
    const err = data as ApiErrorBody;
    throw new Error(err.error?.message ?? "Failed to start WhatsApp link");
  }
  return data as WhatsAppLinkStatusDTO;
}

export async function getWhatsAppStatus(): Promise<WhatsAppLinkStatusDTO> {
  const response = await fetch(`${apiBase()}/api/v1/connectors/whatsapp/status`, {
    credentials: "include",
  });
  const data = await parseJson<WhatsAppLinkStatusDTO>(response);
  if (!response.ok) {
    const err = data as ApiErrorBody;
    throw new Error(err.error?.message ?? "Failed to get WhatsApp status");
  }
  return data as WhatsAppLinkStatusDTO;
}

export async function patchWhatsAppDefaults(input: {
  agentId?: string | null;
  teamId?: string | null;
}): Promise<{ connector: ConnectorAccountDTO }> {
  const response = await fetch(`${apiBase()}/api/v1/connectors/whatsapp/defaults`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await parseJson<{ connector: ConnectorAccountDTO }>(response);
  if (!response.ok) {
    const err = data as ApiErrorBody;
    throw new Error(err.error?.message ?? "Failed to update WhatsApp defaults");
  }
  return data as { connector: ConnectorAccountDTO };
}

export async function disconnectWhatsApp(): Promise<void> {
  const response = await fetch(`${apiBase()}/api/v1/connectors/whatsapp`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!response.ok && response.status !== 204) {
    const data = await parseJson<ApiErrorBody>(response);
    throw new Error((data as ApiErrorBody).error?.message ?? "Failed to disconnect WhatsApp");
  }
}

export function slackConnector(connectors: ConnectorAccountDTO[]): ConnectorAccountDTO | undefined {
  return connectors.find((c) => c.provider === "slack" && c.status === "connected");
}

export function discordConnector(connectors: ConnectorAccountDTO[]): ConnectorAccountDTO | undefined {
  return connectors.find((c) => c.provider === "discord" && c.status === "connected");
}

export function githubConnector(connectors: ConnectorAccountDTO[]): ConnectorAccountDTO | undefined {
  return connectors.find((c) => c.provider === "github" && c.status === "connected");
}

export async function connectSlackBot(input: {
  botToken: string;
  defaultAgentId?: string;
  teamName?: string;
}): Promise<void> {
  const response = await fetch(`${apiBase()}/api/v1/slack/connect`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const data = await parseJson<ApiErrorBody>(response);
    throw new Error((data as ApiErrorBody).error?.message ?? "Failed to connect Slack");
  }
}

export type ChannelDefaultsDTO = {
  whatsapp: { agentId: string | null; teamId: string | null; connected: boolean };
  slack: { agentId: string | null; connected: boolean };
  telegram: { agentId: string | null; connected: boolean };
};

export async function getChannelDefaults(): Promise<ChannelDefaultsDTO> {
  const response = await fetch(`${apiBase()}/api/v1/channel-defaults`, {
    credentials: "include",
  });
  const data = await parseJson<ChannelDefaultsDTO>(response);
  if (!response.ok) {
    throw new Error((data as ApiErrorBody).error?.message ?? "Failed to load channel defaults");
  }
  return data as ChannelDefaultsDTO;
}

export async function patchChannelDefaults(input: {
  whatsappAgentId?: string | null;
  whatsappTeamId?: string | null;
  slackAgentId?: string | null;
  telegramAgentId?: string | null;
}): Promise<void> {
  const response = await fetch(`${apiBase()}/api/v1/channel-defaults`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const data = await parseJson<ApiErrorBody>(response);
    throw new Error((data as ApiErrorBody).error?.message ?? "Failed to save channel defaults");
  }
}
