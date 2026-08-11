/**
 * Curated catalog of external platforms with documented OAuth and/or developer APIs.
 * Only platforms with real public developer auth surfaces are listed.
 *
 * `availability`:
 * - `live` — connectable in Qlix today (dedicated connector)
 * - `orbit` — connectable via Orbit social channels
 * - `soon` — documented OAuth/API; Qlix connect flow not wired yet
 */

export type ConnectorAuthType = "OAuth2" | "APIKey";

export type ConnectorCatalogCategory =
  | "Communication"
  | "CRM"
  | "Design"
  | "DevTools"
  | "E-commerce"
  | "Finance"
  | "Forms"
  | "Marketing"
  | "Productivity"
  | "Scheduling"
  | "Storage"
  | "Support";

export type ConnectorAvailability = "live" | "orbit" | "soon";

export type ConnectorAvailabilityFilter = "All" | "Available" | "Coming soon";
export type ConnectorAuthFilter = "All" | "OAuth2" | "APIKey";

export interface ConnectorLogoMeta {
  /** simple-icons slug when available (jsDelivr). */
  readonly slug?: string;
  /** Domain for favicon fallback (Google s2). */
  readonly domain: string;
  /** Brand hex without # — used to tint monochrome icons. */
  readonly color: string;
}

export interface ConnectorCatalogEntry {
  readonly id: string;
  readonly name: string;
  readonly category: ConnectorCatalogCategory;
  readonly authTypes: readonly ConnectorAuthType[];
  readonly description: string;
  readonly docsUrl: string;
  readonly availability: ConnectorAvailability;
  readonly logo: ConnectorLogoMeta;
  /** Search aliases (e.g. "twitter" for X). */
  readonly aliases?: readonly string[];
  /** Scroll/focus target on the page when already wired. */
  readonly liveAnchor?:
    | "google"
    | "whatsapp"
    | "orbit"
    | "zoho"
    | "slack"
    | "discord"
    | "github"
    | "microsoft"
    | "notion"
    | "telegram";
}

export const CONNECTOR_CATALOG: readonly ConnectorCatalogEntry[] = [
  {
    id: "google",
    name: "Google",
    category: "Productivity",
    authTypes: ["OAuth2"],
    description: "Gmail, Drive, Calendar, Meet, YouTube via Google OAuth.",
    docsUrl: "https://developers.google.com/identity/protocols/oauth2",
    availability: "live",
    liveAnchor: "google",
    aliases: ["gmail", "workspace", "gmeet", "youtube", "drive", "calendar"],
    logo: { slug: "google", domain: "google.com", color: "4285F4" },
  },
  {
    id: "whatsapp",
    name: "WhatsApp",
    category: "Communication",
    authTypes: ["OAuth2"],
    description: "Device link for messaging, JIT approvals, and notifications.",
    docsUrl: "https://developers.facebook.com/docs/whatsapp",
    availability: "live",
    liveAnchor: "whatsapp",
    logo: { slug: "whatsapp", domain: "whatsapp.com", color: "25D366" },
  },
  {
    id: "facebook",
    name: "Facebook",
    category: "Marketing",
    authTypes: ["OAuth2"],
    description: "Pages and publishing via Meta OAuth (Orbit channel).",
    docsUrl: "https://developers.facebook.com/docs/facebook-login",
    availability: "orbit",
    liveAnchor: "orbit",
    aliases: ["meta"],
    logo: { slug: "facebook", domain: "facebook.com", color: "0866FF" },
  },
  {
    id: "instagram",
    name: "Instagram",
    category: "Marketing",
    authTypes: ["OAuth2"],
    description: "Business publishing via Meta OAuth (Orbit channel).",
    docsUrl: "https://developers.facebook.com/docs/instagram-api",
    availability: "orbit",
    liveAnchor: "orbit",
    logo: { slug: "instagram", domain: "instagram.com", color: "E4405F" },
  },
  {
    id: "x",
    name: "X (Twitter)",
    category: "Marketing",
    authTypes: ["OAuth2"],
    description: "Post and read via X API OAuth 2.0 (Orbit channel).",
    docsUrl: "https://developer.x.com/en/docs/authentication/oauth-2-0",
    availability: "orbit",
    liveAnchor: "orbit",
    aliases: ["twitter"],
    logo: { slug: "x", domain: "x.com", color: "000000" },
  },
  {
    id: "linkedin",
    name: "LinkedIn",
    category: "Marketing",
    authTypes: ["OAuth2"],
    description: "Profile and Marketing APIs; 3-legged OAuth (Orbit channel).",
    docsUrl: "https://learn.microsoft.com/en-us/linkedin/shared/authentication/authentication",
    availability: "orbit",
    liveAnchor: "orbit",
    logo: { slug: "linkedin", domain: "linkedin.com", color: "0A66C2" },
  },
  {
    id: "youtube",
    name: "YouTube",
    category: "Marketing",
    authTypes: ["OAuth2"],
    description: "Upload and manage videos via Google OAuth (Orbit channel).",
    docsUrl: "https://developers.google.com/youtube/v3/guides/authentication",
    availability: "orbit",
    liveAnchor: "orbit",
    logo: { slug: "youtube", domain: "youtube.com", color: "FF0000" },
  },
  {
    id: "tiktok",
    name: "TikTok",
    category: "Marketing",
    authTypes: ["OAuth2"],
    description: "Content posting via TikTok Login Kit (Orbit channel).",
    docsUrl: "https://developers.tiktok.com/doc/login-kit-web",
    availability: "orbit",
    liveAnchor: "orbit",
    logo: { slug: "tiktok", domain: "tiktok.com", color: "000000" },
  },
  {
    id: "tally",
    name: "Tally",
    category: "Forms",
    authTypes: ["APIKey"],
    description: "Forms and submissions via Bearer API keys (api.tally.so).",
    docsUrl: "https://developers.tally.so/api-reference/introduction",
    availability: "soon",
    aliases: ["forms", "survey"],
    logo: { domain: "tally.so", color: "000000" },
  },
  {
    id: "zoho",
    name: "Zoho CRM",
    category: "CRM",
    authTypes: ["OAuth2"],
    description: "Leads, contacts, deals, and custom modules via Zoho CRM OAuth 2.0.",
    docsUrl: "https://www.zoho.com/crm/developer/docs/api/v8/oauth-overview.html",
    availability: "live",
    liveAnchor: "zoho",
    aliases: ["crm", "zoho crm"],
    logo: { slug: "zoho", domain: "zoho.com", color: "E42527" },
  },
  {
    id: "zoho-mail",
    name: "Zoho Mail",
    category: "Communication",
    authTypes: ["OAuth2"],
    description: "Organization email, folders, and messages via Zoho Mail API.",
    docsUrl: "https://www.zoho.com/mail/help/api/",
    availability: "soon",
    aliases: ["mail", "zoho mail", "email"],
    logo: { slug: "zoho", domain: "zoho.com", color: "E42527" },
  },
  {
    id: "zoho-books",
    name: "Zoho Books",
    category: "Finance",
    authTypes: ["OAuth2"],
    description: "Invoices, bills, expenses, and accounting via Zoho Books API.",
    docsUrl: "https://www.zoho.com/books/api/v3/",
    availability: "soon",
    aliases: ["books", "accounting", "invoicing"],
    logo: { slug: "zoho", domain: "zoho.com", color: "E42527" },
  },
  {
    id: "zoho-desk",
    name: "Zoho Desk",
    category: "Support",
    authTypes: ["OAuth2"],
    description: "Tickets, contacts, and help desk workflows via Zoho Desk API.",
    docsUrl: "https://desk.zoho.com/DeskAPIDocument#OAuth",
    availability: "soon",
    aliases: ["desk", "support", "tickets", "helpdesk"],
    logo: { slug: "zoho", domain: "zoho.com", color: "E42527" },
  },
  {
    id: "zoho-inventory",
    name: "Zoho Inventory",
    category: "E-commerce",
    authTypes: ["OAuth2"],
    description: "Items, stock, orders, and warehouses via Zoho Inventory API.",
    docsUrl: "https://www.zoho.com/inventory/api/v1/",
    availability: "soon",
    aliases: ["inventory", "stock", "warehouse"],
    logo: { slug: "zoho", domain: "zoho.com", color: "E42527" },
  },
  {
    id: "zoho-projects",
    name: "Zoho Projects",
    category: "Productivity",
    authTypes: ["OAuth2"],
    description: "Projects, tasks, milestones, and timesheets via Zoho Projects API.",
    docsUrl: "https://projects.zoho.com/api-docs",
    availability: "soon",
    aliases: ["projects", "tasks", "pm"],
    logo: { slug: "zoho", domain: "zoho.com", color: "E42527" },
  },
  {
    id: "slack",
    name: "Slack",
    category: "Communication",
    authTypes: ["OAuth2"],
    description: "OAuth connect — agents read channels and post as the signed-in Slack user.",
    docsUrl: "https://api.slack.com/authentication/oauth-v2",
    availability: "live",
    liveAnchor: "slack",
    logo: { slug: "slack", domain: "slack.com", color: "4A154B" },
  },
  {
    id: "telegram",
    name: "Telegram",
    category: "Communication",
    authTypes: ["APIKey"],
    description:
      "Connect Telegram for this workspace — intent routing picks an agent (or shows a numbered picker).",
    docsUrl: "https://core.telegram.org/bots/api",
    availability: "live",
    liveAnchor: "telegram",
    aliases: ["tg", "botfather"],
    logo: { slug: "telegram", domain: "telegram.org", color: "26A5E4" },
  },
  {
    id: "microsoft365",
    name: "Microsoft 365",
    category: "Productivity",
    authTypes: ["OAuth2"],
    description: "Outlook, Teams, OneDrive via Microsoft Graph + Entra ID.",
    docsUrl: "https://learn.microsoft.com/en-us/graph/auth",
    availability: "live",
    liveAnchor: "microsoft",
    aliases: ["outlook", "teams", "office", "entra", "microsoft"],
    logo: { slug: "microsoft", domain: "microsoft.com", color: "00A4EF" },
  },
  {
    id: "hubspot",
    name: "HubSpot",
    category: "CRM",
    authTypes: ["OAuth2", "APIKey"],
    description: "CRM and marketing; OAuth for public apps, private app tokens.",
    docsUrl: "https://developers.hubspot.com/docs/api/oauth-quickstart-guide",
    availability: "soon",
    logo: { slug: "hubspot", domain: "hubspot.com", color: "FF7A59" },
  },
  {
    id: "salesforce",
    name: "Salesforce",
    category: "CRM",
    authTypes: ["OAuth2"],
    description: "CRM REST and Bulk APIs with authorization-code OAuth.",
    docsUrl: "https://help.salesforce.com/s/articleView?id=sf.remoteaccess_oauth_web_server_flow.htm",
    availability: "soon",
    logo: { slug: "salesforce", domain: "salesforce.com", color: "00A1E0" },
  },
  {
    id: "pipedrive",
    name: "Pipedrive",
    category: "CRM",
    authTypes: ["OAuth2", "APIKey"],
    description: "Deals and pipelines; marketplace OAuth or personal tokens.",
    docsUrl: "https://pipedrive.readme.io/docs/marketplace-oauth-authorization",
    availability: "soon",
    logo: { domain: "pipedrive.com", color: "017737" },
  },
  {
    id: "notion",
    name: "Notion",
    category: "Productivity",
    authTypes: ["OAuth2", "APIKey"],
    description: "Pages and databases; public OAuth or internal integration tokens.",
    docsUrl: "https://developers.notion.com/docs/authorization",
    availability: "live",
    liveAnchor: "notion",
    logo: { slug: "notion", domain: "notion.so", color: "000000" },
  },
  {
    id: "airtable",
    name: "Airtable",
    category: "Productivity",
    authTypes: ["OAuth2", "APIKey"],
    description: "Bases and records; OAuth for multi-user or personal access tokens.",
    docsUrl: "https://airtable.com/developers/web/api/oauth-reference",
    availability: "soon",
    logo: { slug: "airtable", domain: "airtable.com", color: "18BFFF" },
  },
  {
    id: "asana",
    name: "Asana",
    category: "Productivity",
    authTypes: ["OAuth2", "APIKey"],
    description: "Tasks and projects via OAuth or personal access tokens.",
    docsUrl: "https://developers.asana.com/docs/oauth",
    availability: "soon",
    logo: { slug: "asana", domain: "asana.com", color: "F06A6A" },
  },
  {
    id: "clickup",
    name: "ClickUp",
    category: "Productivity",
    authTypes: ["OAuth2", "APIKey"],
    description: "Tasks and docs; OAuth for apps or personal API tokens.",
    docsUrl: "https://developer.clickup.com/docs/authentication",
    availability: "soon",
    logo: { slug: "clickup", domain: "clickup.com", color: "7B68EE" },
  },
  {
    id: "monday",
    name: "monday.com",
    category: "Productivity",
    authTypes: ["OAuth2", "APIKey"],
    description: "Boards and items via OAuth or API tokens (GraphQL).",
    docsUrl: "https://developer.monday.com/api-reference/docs/authentication",
    availability: "soon",
    aliases: ["monday"],
    logo: { domain: "monday.com", color: "FF3D57" },
  },
  {
    id: "linear",
    name: "Linear",
    category: "DevTools",
    authTypes: ["OAuth2", "APIKey"],
    description: "Issues and projects; OAuth 2 + PKCE or personal API keys.",
    docsUrl: "https://developers.linear.app/docs/oauth/authentication",
    availability: "soon",
    logo: { slug: "linear", domain: "linear.app", color: "5E6AD2" },
  },
  {
    id: "jira",
    name: "Jira",
    category: "DevTools",
    authTypes: ["OAuth2", "APIKey"],
    description: "Issues and projects via Atlassian OAuth 2.0 (3LO).",
    docsUrl: "https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/",
    availability: "soon",
    aliases: ["atlassian"],
    logo: { slug: "jira", domain: "atlassian.com", color: "0052CC" },
  },
  {
    id: "confluence",
    name: "Confluence",
    category: "Productivity",
    authTypes: ["OAuth2", "APIKey"],
    description: "Pages and spaces; same Atlassian OAuth model as Jira.",
    docsUrl: "https://developer.atlassian.com/cloud/confluence/oauth-2-3lo-apps/",
    availability: "soon",
    logo: { slug: "confluence", domain: "atlassian.com", color: "172B4D" },
  },
  {
    id: "github",
    name: "GitHub",
    category: "DevTools",
    authTypes: ["OAuth2", "APIKey"],
    description: "Repos, issues, and PRs; OAuth Apps, GitHub Apps, or PATs.",
    docsUrl: "https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps",
    availability: "live",
    liveAnchor: "github",
    logo: { slug: "github", domain: "github.com", color: "181717" },
  },
  {
    id: "gitlab",
    name: "GitLab",
    category: "DevTools",
    authTypes: ["OAuth2", "APIKey"],
    description: "Projects and MRs; OAuth 2 + PKCE or access tokens.",
    docsUrl: "https://docs.gitlab.com/ee/api/oauth2.html",
    availability: "soon",
    logo: { slug: "gitlab", domain: "gitlab.com", color: "FC6D26" },
  },
  {
    id: "stripe",
    name: "Stripe",
    category: "Finance",
    authTypes: ["APIKey", "OAuth2"],
    description: "Payments and customers; secret keys or Connect OAuth.",
    docsUrl: "https://docs.stripe.com/connect/oauth-reference",
    availability: "soon",
    logo: { slug: "stripe", domain: "stripe.com", color: "635BFF" },
  },
  {
    id: "quickbooks",
    name: "QuickBooks",
    category: "Finance",
    authTypes: ["OAuth2"],
    description: "Invoices and accounting via Intuit OAuth 2.0.",
    docsUrl: "https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0",
    availability: "soon",
    aliases: ["intuit"],
    logo: { slug: "quickbooks", domain: "quickbooks.intuit.com", color: "2CA01C" },
  },
  {
    id: "xero",
    name: "Xero",
    category: "Finance",
    authTypes: ["OAuth2"],
    description: "Accounting, contacts, and invoices with OAuth 2.0 + PKCE.",
    docsUrl: "https://developer.xero.com/documentation/guides/oauth2/overview",
    availability: "soon",
    logo: { slug: "xero", domain: "xero.com", color: "13B5EA" },
  },
  {
    id: "shopify",
    name: "Shopify",
    category: "E-commerce",
    authTypes: ["OAuth2", "APIKey"],
    description: "Orders and products; OAuth for apps or Admin API tokens.",
    docsUrl: "https://shopify.dev/docs/apps/build/authentication-authorization",
    availability: "soon",
    logo: { slug: "shopify", domain: "shopify.com", color: "7AB55C" },
  },
  {
    id: "dropbox",
    name: "Dropbox",
    category: "Storage",
    authTypes: ["OAuth2"],
    description: "Files and sharing with OAuth code flow + refresh tokens.",
    docsUrl: "https://www.dropbox.com/developers/documentation/http/documentation#authorization",
    availability: "soon",
    logo: { slug: "dropbox", domain: "dropbox.com", color: "0061FF" },
  },
  {
    id: "box",
    name: "Box",
    category: "Storage",
    authTypes: ["OAuth2"],
    description: "Enterprise content and collaboration via Box OAuth 2.0.",
    docsUrl: "https://developer.box.com/guides/authentication/oauth2/",
    availability: "soon",
    logo: { slug: "box", domain: "box.com", color: "0061D5" },
  },
  {
    id: "typeform",
    name: "Typeform",
    category: "Forms",
    authTypes: ["OAuth2"],
    description: "Create and Responses APIs with Typeform OAuth.",
    docsUrl: "https://www.typeform.com/developers/get-started/applications/",
    availability: "soon",
    logo: { slug: "typeform", domain: "typeform.com", color: "262627" },
  },
  {
    id: "calendly",
    name: "Calendly",
    category: "Scheduling",
    authTypes: ["OAuth2", "APIKey"],
    description: "Events and invitees; OAuth with PKCE or personal tokens.",
    docsUrl: "https://developer.calendly.com/api-docs/YTNbQTndX_kQo",
    availability: "soon",
    logo: { slug: "calendly", domain: "calendly.com", color: "006BFF" },
  },
  {
    id: "mailchimp",
    name: "Mailchimp",
    category: "Marketing",
    authTypes: ["OAuth2", "APIKey"],
    description: "Audiences and campaigns; OAuth for apps or API keys.",
    docsUrl: "https://mailchimp.com/developer/marketing/guides/access-user-data-oauth-2/",
    availability: "soon",
    logo: { slug: "mailchimp", domain: "mailchimp.com", color: "FFE01B" },
  },
  {
    id: "intercom",
    name: "Intercom",
    category: "Support",
    authTypes: ["OAuth2"],
    description: "Contacts and conversations via Intercom OAuth apps.",
    docsUrl: "https://developers.intercom.com/docs/build-an-integration/learn-more/authentication",
    availability: "soon",
    logo: { slug: "intercom", domain: "intercom.com", color: "6AFDEF" },
  },
  {
    id: "zendesk",
    name: "Zendesk",
    category: "Support",
    authTypes: ["OAuth2", "APIKey"],
    description: "Tickets and users; OAuth for apps or API tokens.",
    docsUrl: "https://developer.zendesk.com/api-reference/introduction/security-and-auth/",
    availability: "soon",
    logo: { slug: "zendesk", domain: "zendesk.com", color: "03363D" },
  },
  {
    id: "discord",
    name: "Discord",
    category: "Communication",
    authTypes: ["OAuth2"],
    description: "OAuth connect — identity, email, and guilds for the signed-in Discord user.",
    docsUrl: "https://discord.com/developers/docs/topics/oauth2",
    availability: "live",
    liveAnchor: "discord",
    logo: { slug: "discord", domain: "discord.com", color: "5865F2" },
  },
  {
    id: "figma",
    name: "Figma",
    category: "Design",
    authTypes: ["OAuth2"],
    description: "Files, comments, and webhooks via Figma OAuth.",
    docsUrl: "https://www.figma.com/developers/api#authentication",
    availability: "soon",
    logo: { slug: "figma", domain: "figma.com", color: "F24E1E" },
  },
  {
    id: "twilio",
    name: "Twilio",
    category: "Communication",
    authTypes: ["APIKey"],
    description: "SMS, voice, and WhatsApp via Account SID + Auth Token.",
    docsUrl: "https://www.twilio.com/docs/usage/api",
    availability: "soon",
    logo: { slug: "twilio", domain: "twilio.com", color: "F22F46" },
  },
  {
    id: "sendgrid",
    name: "SendGrid",
    category: "Marketing",
    authTypes: ["APIKey"],
    description: "Transactional and marketing email via API keys.",
    docsUrl: "https://www.twilio.com/docs/sendgrid/api-reference",
    availability: "soon",
    logo: { slug: "sendgrid", domain: "sendgrid.com", color: "1A82E2" },
  },
  {
    id: "supabase",
    name: "Supabase",
    category: "DevTools",
    authTypes: ["OAuth2", "APIKey"],
    description: "Management API OAuth; project anon/service keys for data.",
    docsUrl: "https://supabase.com/docs/reference/api/introduction",
    availability: "soon",
    logo: { slug: "supabase", domain: "supabase.com", color: "3FCF8E" },
  },
  {
    id: "vercel",
    name: "Vercel",
    category: "DevTools",
    authTypes: ["OAuth2", "APIKey"],
    description: "Deployments and projects; OAuth integrations or tokens.",
    docsUrl: "https://vercel.com/docs/rest-api/reference/welcome",
    availability: "soon",
    logo: { slug: "vercel", domain: "vercel.com", color: "000000" },
  },
  {
    id: "todoist",
    name: "Todoist",
    category: "Productivity",
    authTypes: ["OAuth2", "APIKey"],
    description: "Tasks and projects via OAuth or API tokens.",
    docsUrl: "https://developer.todoist.com/guides/#authorization",
    availability: "soon",
    logo: { slug: "todoist", domain: "todoist.com", color: "E44332" },
  },
];

export const CONNECTOR_CATALOG_ENTRIES: readonly ConnectorCatalogEntry[] = CONNECTOR_CATALOG;

/** Zoho product lines shown together on the Connectors page. */
export const ZOHO_SUITE_CATALOG_IDS = [
  "zoho",
  "zoho-mail",
  "zoho-books",
  "zoho-desk",
  "zoho-inventory",
  "zoho-projects",
] as const;

export const CONNECTOR_CATEGORIES: readonly ConnectorCatalogCategory[] = [
  "Communication",
  "CRM",
  "Design",
  "DevTools",
  "E-commerce",
  "Finance",
  "Forms",
  "Marketing",
  "Productivity",
  "Scheduling",
  "Storage",
  "Support",
];

const AVAILABILITY_RANK: Record<ConnectorAvailability, number> = {
  live: 0,
  orbit: 1,
  soon: 2,
};

function matchesQuery(entry: ConnectorCatalogEntry, q: string): boolean {
  if (!q) return true;
  const hay = [
    entry.name,
    entry.category,
    entry.description,
    entry.id,
    ...entry.authTypes,
    ...(entry.aliases ?? []),
  ]
    .join(" ")
    .toLowerCase();
  return q.split(/\s+/).every((token) => hay.includes(token));
}

export function filterConnectorCatalog(input: {
  query?: string;
  category?: ConnectorCatalogCategory | "All";
  availability?: ConnectorAvailabilityFilter;
  auth?: ConnectorAuthFilter;
}): ConnectorCatalogEntry[] {
  const q = (input.query ?? "").trim().toLowerCase();
  const category = input.category ?? "All";
  const availability = input.availability ?? "All";
  const auth = input.auth ?? "All";

  return CONNECTOR_CATALOG_ENTRIES.filter((entry) => {
    if (category !== "All" && entry.category !== category) return false;
    if (availability === "Available" && entry.availability === "soon") return false;
    if (availability === "Coming soon" && entry.availability !== "soon") return false;
    if (auth !== "All" && !entry.authTypes.includes(auth)) return false;
    return matchesQuery(entry, q);
  }).sort((a, b) => {
    const rank = AVAILABILITY_RANK[a.availability] - AVAILABILITY_RANK[b.availability];
    if (rank !== 0) return rank;
    return a.name.localeCompare(b.name);
  });
}

export function connectorLogoUrl(logo: ConnectorLogoMeta, size = 64): string {
  if (logo.slug) {
    return `https://cdn.jsdelivr.net/npm/simple-icons@v11/icons/${logo.slug}.svg`;
  }
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(logo.domain)}&sz=${size}`;
}

export function connectorFaviconUrl(domain: string, size = 128): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=${size}`;
}

export function getCatalogEntry(id: string): ConnectorCatalogEntry | undefined {
  return CONNECTOR_CATALOG_ENTRIES.find((e) => e.id === id);
}

/** Map catalog platform ids to Connectors page `?needed=` provider ids. */
export function catalogIdsToConnectorsNeeded(platformIds: readonly string[]): string {
  const providers = new Set<string>();
  for (const id of platformIds) {
    const entry = getCatalogEntry(id);
    if (!entry?.liveAnchor) continue;
    if (entry.liveAnchor === "google") providers.add("google");
    if (entry.liveAnchor === "whatsapp") providers.add("whatsapp_baileys");
    if (entry.liveAnchor === "orbit") providers.add("orbit");
    if (entry.liveAnchor === "zoho") providers.add("zoho");
    if (entry.liveAnchor === "slack") providers.add("slack");
    if (entry.liveAnchor === "telegram") providers.add("telegram");
    if (entry.liveAnchor === "discord") providers.add("discord");
    if (entry.liveAnchor === "github") providers.add("github");
    if (entry.liveAnchor === "microsoft") providers.add("microsoft");
    if (entry.liveAnchor === "notion") providers.add("notion");
  }
  return [...providers].join(",");
}
