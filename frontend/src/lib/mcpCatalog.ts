import type { McpTransport } from "./mcp-api";

/**
 * Curated catalog of well-known MCP servers, surfaced as one-click "integrations".
 *
 * Each entry is a *starting template*: the connect form prefills the transport, endpoint/
 * command, and the exact secret fields the server needs, but everything stays editable so
 * the operator can adapt it (package name, path, header style) before registering. Secrets
 * are never hard-coded here — only the field shape (which header/env var to ask for).
 */

export type McpSecretKind = "header" | "env";

export interface McpSecretField {
  /** Header name (e.g. "Authorization") or env var name (e.g. "SLACK_BOT_TOKEN"). */
  key: string;
  label: string;
  kind: McpSecretKind;
  placeholder?: string;
  required?: boolean;
  /** Wraps the entered value before sending, e.g. "Bearer " for Authorization headers. */
  prefix?: string;
}

export interface McpCatalogEntry {
  id: string;
  name: string;
  category: "Dev" | "Comms" | "Productivity" | "Data";
  blurb: string;
  /** Key into the icon map in McpAddServer. */
  icon: "github" | "slack" | "linear" | "notion" | "postgres" | "filesystem" | "google";
  /** Tailwind text colour for the icon accent. */
  accent: string;
  transport: McpTransport;
  /** `oauth` → one-click "Connect" (the recommended path); `token` → static secret fields. */
  auth?: "oauth" | "token";
  /**
   * Pre-filled OAuth config for providers without dynamic registration (e.g. Google). Applied
   * via PUT /oauth/config before the authorization redirect; the admin still supplies clientId/secret.
   */
  oauthConfig?: {
    authorizationEndpoint?: string;
    tokenEndpoint?: string;
    scope?: string;
    issuer?: string;
    /** Extra auth-request params, e.g. "access_type=offline&prompt=consent". */
    authParams?: string;
  };
  endpointUrl?: string;
  command?: string;
  args?: string[];
  secretFields?: McpSecretField[];
  docsUrl?: string;
  /** Shown above the connect form so the operator double-checks the template. */
  reviewNote?: string;
}

export const MCP_CATALOG: readonly McpCatalogEntry[] = [
  {
    id: "qlix-leads",
    name: "Qlix Leads",
    category: "Data",
    blurb: "Google Business Profile lead scraping and outreach (first-party).",
    icon: "postgres",
    accent: "text-emerald-400",
    transport: "http",
    auth: "token",
    endpointUrl:
      typeof process !== "undefined"
        ? process.env.NEXT_PUBLIC_QLIX_MCP_URL ??
          process.env.NEXT_PUBLIC_QLIX_MCP_LEADS_URL ??
          "http://localhost:3940/mcp"
        : "http://localhost:3940/mcp",
    secretFields: [
      {
        key: "Authorization",
        label: "Service secret",
        kind: "header",
        prefix: "Bearer ",
        placeholder: "Same as QLIX_INTERNAL_SERVICE_SECRET",
        required: true,
      },
    ],
    reviewNote:
      "Auto-registered on deploy (qlix-mcp PM2 process). Bind agents to gmb_search_leads, list_leads, and start_outreach.",
  },
  {
    id: "qlix-jobs",
    name: "Qlix Jobs",
    category: "Data",
    blurb: "Job Apply Copilot — Greenhouse / Lever / Ashby career applications (first-party).",
    icon: "postgres",
    accent: "text-sky-400",
    transport: "http",
    auth: "token",
    endpointUrl:
      typeof process !== "undefined"
        ? process.env.NEXT_PUBLIC_QLIX_MCP_JOBS_URL ??
          "http://localhost:3940/mcp-jobs"
        : "http://localhost:3940/mcp-jobs",
    secretFields: [
      {
        key: "Authorization",
        label: "Service secret",
        kind: "header",
        prefix: "Bearer ",
        placeholder: "Same as QLIX_INTERNAL_SERVICE_SECRET",
        required: true,
      },
    ],
    reviewNote:
      "Auto-registered on deploy. AI Builder grants mcp.qlix-jobs.* when the user asks for a resume/job-apply agent. Pair with web.read + web.click + web.transaction.",
  },
  {
    id: "github",
    name: "GitHub",
    category: "Dev",
    blurb: "Issues, pull requests, code & repo search.",
    icon: "github",
    accent: "text-white",
    transport: "http",
    auth: "oauth",
    endpointUrl: "https://api.githubcopilot.com/mcp/",
    docsUrl: "https://github.com/github/github-mcp-server",
    reviewNote: "Connect with GitHub grants only the scopes you approve on GitHub's consent screen — no token to paste.",
  },
  {
    id: "google-workspace",
    name: "Google Workspace",
    category: "Productivity",
    blurb: "Gmail, Calendar, Drive, Docs & Sheets.",
    icon: "google",
    accent: "text-sky-300",
    transport: "http",
    auth: "oauth",
    // The endpoint is your Google Workspace MCP server (no Google-hosted one exists); fill it in.
    oauthConfig: {
      authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenEndpoint: "https://oauth2.googleapis.com/token",
      issuer: "https://accounts.google.com",
      // Workspace defaults — trim to least privilege for what the agent actually needs.
      scope:
        "openid email https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/drive",
      // Required for Google to return a refresh token (otherwise access dies after ~1 hour).
      authParams: "access_type=offline&prompt=consent",
    },
    docsUrl: "https://developers.google.com/identity/protocols/oauth2",
    reviewNote:
      "Two-part setup: (1) create a Google Cloud OAuth client (Web application) and add this Qlix callback as an authorized redirect URI; (2) run a Google Workspace MCP server and put its URL above. Paste the client ID/secret under Advanced before connecting.",
  },
  {
    id: "slack",
    name: "Slack",
    category: "Comms",
    blurb: "Read channels and post messages as a bot.",
    icon: "slack",
    accent: "text-fuchsia-300",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-slack"],
    secretFields: [
      { key: "SLACK_BOT_TOKEN", label: "Bot token", kind: "env", placeholder: "xoxb-…", required: true },
      { key: "SLACK_TEAM_ID", label: "Team ID", kind: "env", placeholder: "T01234567", required: true },
    ],
    docsUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/slack",
    reviewNote: "Runs on the agent's hybrid runner. Restrict the bot's channel access in Slack.",
  },
  {
    id: "linear",
    name: "Linear",
    category: "Productivity",
    blurb: "Create and update issues, projects and cycles.",
    icon: "linear",
    accent: "text-indigo-300",
    transport: "http",
    auth: "oauth",
    endpointUrl: "https://mcp.linear.app/sse",
    docsUrl: "https://linear.app/docs/mcp",
    reviewNote: "Linear's hosted server registers automatically — just approve access on Linear.",
  },
  {
    id: "notion",
    name: "Notion",
    category: "Productivity",
    blurb: "Search and read pages, append to databases.",
    icon: "notion",
    accent: "text-white",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@notionhq/notion-mcp-server"],
    secretFields: [
      { key: "NOTION_TOKEN", label: "Internal integration token", kind: "env", placeholder: "ntn_…", required: true },
    ],
    docsUrl: "https://github.com/makenotion/notion-mcp-server",
    reviewNote: "Share only the specific pages/databases with the integration in Notion. Token grants its full access.",
  },
  {
    id: "postgres",
    name: "PostgreSQL",
    category: "Data",
    blurb: "Read-only SQL queries against a database.",
    icon: "postgres",
    accent: "text-sky-300",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-postgres"],
    secretFields: [
      {
        key: "DATABASE_URI",
        label: "Connection string",
        kind: "env",
        placeholder: "postgresql://readonly:…@host:5432/db",
        required: true,
      },
    ],
    docsUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/postgres",
    reviewNote: "Point this at a read-only replica or a least-privilege role. Some builds take the URI as an argument instead — adjust if needed.",
  },
  {
    id: "filesystem",
    name: "Filesystem",
    category: "Data",
    blurb: "Read & write files in an allow-listed directory.",
    icon: "filesystem",
    accent: "text-amber-300",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/data"],
    docsUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem",
    reviewNote: "No secret needed. Replace /data with the exact path(s) the agent may access — that allow-list is the security boundary.",
  },
] as const;
