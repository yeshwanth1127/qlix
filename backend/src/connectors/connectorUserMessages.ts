/** User-facing steps when Gmail is required but not linked. */
export const GMAIL_CONNECT_INSTRUCTIONS = `Gmail is not connected for this workspace. The user must connect it before you can send or read email.

Tell the user clearly — do not retry sending until they connect:

1. Open **Connectors** in the Qlix sidebar (plug icon).
2. Under **Google (Gmail)**, click **Connect Google**.
3. Sign in with the Google account they want to send from and approve access.
4. Return to this chat and ask you to send again.

Connectors URL path: /individual/connectors or /organization/connectors (same page in their workspace).`;

export const GMAIL_CONNECT_SHORT =
  'Connect Gmail first: sidebar → Connectors → Google (Gmail) → Connect Google, then retry.';

export function gmailConnectorNotConnectedMessage(): string {
  return `Google Gmail is not connected for this workspace. ${GMAIL_CONNECT_SHORT}`;
}

/** User-facing steps when Orbit is required but not linked. */
export const ORBIT_CONNECT_INSTRUCTIONS = `Orbit is not connected for this workspace. The user must connect it before social tools work.

Tell the user clearly:

1. Open Orbit (social scheduler) and create an API key under Settings → Developers → Public API.
2. In Qlix, open **Connectors** in the sidebar.
3. Under **Orbit by Exora**, paste the API key and click **Connect Orbit**.
4. Connect social channels inside Orbit (Instagram, Facebook, X, …), then return here.

Connectors path: /individual/connectors or /organization/connectors.`;

export const ORBIT_CONNECT_SHORT =
  'Connect Orbit first: sidebar → Connectors → Orbit by Exora → paste API key, then retry.';

export function orbitConnectorNotConnectedMessage(): string {
  return `Orbit is not connected for this workspace. ${ORBIT_CONNECT_SHORT}`;
}

/** User-facing steps when a CRM platform is required but not linked. */
export const CRM_CONNECT_INSTRUCTIONS = `CRM is not connected for this workspace. The user must connect a CRM platform before you can read or write records.

Tell the user clearly — do not retry until they connect:

1. Open **Connectors** in the Qlix sidebar (plug icon).
2. Under **Zoho CRM** (or their CRM provider), click **Connect**.
3. Sign in and approve CRM access.
4. Return to this chat and ask you to try again.

Connectors URL path: /individual/connectors or /organization/connectors.`;

export const CRM_CONNECT_SHORT =
  'Connect CRM first: sidebar → Connectors → connect your CRM provider, then retry.';

export function crmConnectorNotConnectedMessage(): string {
  return `CRM is not connected for this workspace. ${CRM_CONNECT_SHORT}`;
}

/** @deprecated Use crmConnectorNotConnectedMessage — Zoho-specific alias. */
export function zohoConnectorNotConnectedMessage(): string {
  return crmConnectorNotConnectedMessage();
}

/** User-facing steps when Slack is required but not linked. */
export const SLACK_CONNECT_INSTRUCTIONS = `Slack is not connected for this workspace. The user must connect Slack before you can read channels or post messages.

Tell the user clearly — do not retry until they connect:

1. Open **Connectors** in the Qlix sidebar (plug icon).
2. Under **Slack**, click **Connect Slack**.
3. Sign in to their Slack workspace and approve access (the agent will act as their Slack user).
4. Return to this chat and ask you to try again.

Connectors URL path: /individual/connectors or /organization/connectors.`;

export const SLACK_CONNECT_SHORT =
  'Connect Slack first: sidebar → Connectors → Slack → Connect Slack, then retry.';

export function slackConnectorNotConnectedMessage(): string {
  return `Slack is not connected for this workspace. ${SLACK_CONNECT_SHORT}`;
}
