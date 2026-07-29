import type { ApiErrorBody } from "./auth-api";

const defaultBase = "http://localhost:4000";

function apiBase(): string {
  return (process.env.NEXT_PUBLIC_API_BASE_URL ?? defaultBase).replace(/\/$/, "");
}

export type ConnectorProvider = "google" | "whatsapp_baileys" | "orbit";

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

export async function startGoogleOAuth(): Promise<{ url: string }> {
  const response = await fetch(`${apiBase()}/api/v1/connectors/google/start`, {
    method: "POST",
    credentials: "include",
  });
  const data = await parseJson<{ url: string }>(response);
  if (!response.ok) {
    const err = data as ApiErrorBody;
    throw new Error(err.error?.message ?? "Failed to start Google OAuth");
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

export function whatsappConnector(connectors: ConnectorAccountDTO[]): ConnectorAccountDTO | undefined {
  return connectors.find((c) => c.provider === "whatsapp_baileys");
}

export function orbitConnector(connectors: ConnectorAccountDTO[]): ConnectorAccountDTO | undefined {
  return connectors.find((c) => c.provider === "orbit" && c.status === "connected");
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
