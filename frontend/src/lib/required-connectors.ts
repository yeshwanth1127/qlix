import type { AgentCreationPlan } from "@/lib/nl-builder-api";
import type { ConnectorProvider } from "@/lib/connectors-api";

/** CRM scopes work with any connected CRM platform provider. */
export const CRM_PLATFORM_PROVIDERS: readonly ConnectorProvider[] = ["zoho"];

const CRM_SCOPES = new Set(["crm.read", "crm.write", "crm.delete"]);

/**
 * Scope → connector mapping (mirrors backend `SCOPE_CATALOG`).
 * CRM scopes resolve dynamically to whichever CRM platform is connected.
 */
const SCOPE_REQUIRES_CONNECTOR: Readonly<Partial<Record<string, ConnectorProvider>>> = {
  "email.read": "google",
  "email.send": "google",
  "drive.read": "google",
  "drive.write": "google",
  "calendar.read": "google",
  "calendar.write": "google",
  "meet.manage": "google",
  "youtube.read": "google",
  "youtube.publish": "google",
  "whatsapp.send": "whatsapp_baileys",
  "whatsapp.read": "whatsapp_baileys",
  "whatsapp.contact_send": "whatsapp_baileys",
  "social.read": "orbit",
  "social.publish": "orbit",
};

export interface RequiredConnectorInfo {
  provider: ConnectorProvider;
  name: string;
  description: string;
}

const CONNECTOR_INFO: Readonly<Record<ConnectorProvider, Omit<RequiredConnectorInfo, "provider">>> = {
  google: {
    name: "Google",
    description: "Gmail, Drive, Calendar, Meet, and YouTube through your Google account",
  },
  whatsapp_baileys: {
    name: "WhatsApp",
    description: "Send messages and files from your linked WhatsApp",
  },
  orbit: {
    name: "Orbit",
    description: "Read and publish on connected social channels",
  },
  zoho: {
    name: "CRM (Zoho)",
    description: "Read and write CRM records via Zoho (or connect another CRM when available)",
  },
  slack: {
    name: "Slack",
    description: "Receive and reply to Slack messages via the workspace bot",
  },
  discord: {
    name: "Discord",
    description: "Connect your Discord account for identity and guild access",
  },
  github: {
    name: "GitHub",
    description: "Repos, issues, and pull requests via your GitHub account",
  },
  telegram: {
    name: "Telegram",
    description: "Receive and reply to Telegram messages via the bot API",
  },
};

const PROVIDER_ORDER: readonly ConnectorProvider[] = ["google", "zoho", "whatsapp_baileys", "orbit"];

/** Unique connectors required by any of the given permission scopes. */
export function connectorsRequiredByScopes(scopes: readonly string[]): ConnectorProvider[] {
  const found = new Set<ConnectorProvider>();
  let needsCrm = false;
  for (const scope of scopes) {
    if (CRM_SCOPES.has(scope)) {
      needsCrm = true;
      continue;
    }
    const provider = SCOPE_REQUIRES_CONNECTOR[scope];
    if (provider) found.add(provider);
  }
  if (needsCrm) {
    for (const p of CRM_PLATFORM_PROVIDERS) found.add(p);
  }
  return PROVIDER_ORDER.filter((p) => found.has(p));
}

/** All permission scopes across a single-agent or team plan. */
export function collectPlanScopes(plan: AgentCreationPlan): string[] {
  if (plan.type === "single") {
    return [...plan.agent.permissionScopes];
  }
  const scopes = [
    ...plan.team.supervisor.permissionScopes,
    ...plan.team.workers.flatMap((w) => w.permissionScopes),
  ];
  return [...new Set(scopes)];
}

export function connectorInfo(provider: ConnectorProvider): RequiredConnectorInfo {
  return { provider, ...CONNECTOR_INFO[provider] };
}

export function requiredConnectorInfos(providers: readonly ConnectorProvider[]): RequiredConnectorInfo[] {
  return providers.map(connectorInfo);
}

/** Providers the plan needs that are not yet `connected`. */
export function missingRequiredConnectors(
  plan: AgentCreationPlan,
  connectedProviders: ReadonlySet<ConnectorProvider>,
): ConnectorProvider[] {
  const scopes = collectPlanScopes(plan);
  const required = connectorsRequiredByScopes(scopes);
  const needsCrm = scopes.some((s) => CRM_SCOPES.has(s));
  const crmConnected = CRM_PLATFORM_PROVIDERS.some((p) => connectedProviders.has(p));

  return required.filter((p) => {
    if (needsCrm && CRM_PLATFORM_PROVIDERS.includes(p)) {
      return !crmConnected;
    }
    return !connectedProviders.has(p);
  });
}
