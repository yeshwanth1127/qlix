import { prisma } from '../lib/prisma.js';
import { ConnectorsRepository } from '../connectors/connectors.repository.js';
import type { ConnectorProvider } from '../connectors/connectors.types.js';
import { CRM_CONNECTOR_PROVIDERS } from '../connectors/crm/crm.types.js';
import {
  googleServiceConnected,
  PERMISSION_SCOPE_GOOGLE_SERVICE,
} from '../connectors/googleServices.js';
import { getMcpScopeDefsForOrg } from '../mcp/mcpScopeCatalog.js';
import { getPeerAgentScopeDefsForOrg } from './peerAgentScopes.js';
import type { AgentRuntime, BuiltinPermissionScope, PermissionScope } from './agents.types.js';

/**
 * Canonical definition of one supported permission scope.
 *
 * Scopes are NOT free-form: every entry here is backed by a real tool in the SDK
 * runtime. This catalog is the single source of truth for the scope id, its UI
 * label, the AI-builder description, JIT policy, and which connector (if any)
 * must be linked before an agent can actually use it.
 */
export interface ScopeDef {
  id: PermissionScope;
  /** Short UI label (drives the frontend scope pickers). */
  label: string;
  /** One-line capability description fed to the AI builder system prompt. */
  description: string;
  /** Whether granting this scope forces per-invocation user approval (JIT). */
  forceJit: boolean;
  /** Connector that must be `connected` for this scope to be available. Absent = base/always-on. */
  requiresConnector?: ConnectorProvider;
  /** When set, any connected provider in this family satisfies the connector requirement. */
  requiresConnectorFamily?: 'crm' | 'email' | 'drive';
  /** Runtimes whose SDK runner has the backing tool. Informational for now. */
  runtimes: AgentRuntime[];
}

/** A catalog entry annotated with per-org availability state. */
export interface AnnotatedScopeDef extends ScopeDef {
  /** Org-level toggle (Skills page). Default true until a deny entry exists. */
  enabled: boolean;
  /** Required connector is linked (always true for base scopes). */
  connected: boolean;
  /** enabled && connected — the agent can actually be granted this scope. */
  available: boolean;
}

/**
 * The supported scope catalog. Adding a scope here requires a backing tool in the
 * SDK runtime and (if connector-gated) a connector provider mapping.
 */
export const SCOPE_CATALOG: ScopeDef[] = [
  {
    id: 'web.read',
    label: 'Read web pages',
    description: 'Browse and read web pages, fetch URLs — needed for any web interaction',
    forceJit: false,
    runtimes: ['cloud', 'hybrid'],
  },
  {
    id: 'web.research',
    label: 'Web research (platform APIs)',
    description:
      'Search and read Twitter, Reddit, GitHub, YouTube, Bilibili, and the open web via structured APIs — no browser automation',
    forceJit: false,
    runtimes: ['cloud', 'hybrid'],
  },
  {
    id: 'web.click',
    label: 'Click on web pages',
    description: 'Click links and buttons on web pages — required alongside web.read whenever the agent navigates or interacts with sites',
    forceJit: false,
    runtimes: ['cloud', 'hybrid'],
  },
  {
    id: 'web.transaction',
    label: 'Submit web forms / transactions',
    description: 'Submit web forms, fill in fields, complete checkouts, or make online purchases — required when the agent types into or submits any web form',
    forceJit: true,
    runtimes: ['cloud', 'hybrid'],
  },
  {
    id: 'system.file_read',
    label: 'Read local files',
    description: 'Read files from the local filesystem (hybrid/local only)',
    forceJit: false,
    runtimes: ['hybrid'],
  },
  {
    id: 'system.file_write',
    label: 'Write local files',
    description: 'Write or modify files on the local filesystem (hybrid/local only)',
    forceJit: true,
    runtimes: ['hybrid'],
  },
  {
    id: 'system.gui_control',
    label: 'Control desktop apps (screen automation)',
    description: 'Open and control desktop apps, type text, click buttons, take screenshots via screen automation on the user\'s local machine (hybrid/local only) — combine with web.read + web.click + web.transaction when the agent also interacts with websites',
    forceJit: true,
    runtimes: ['hybrid'],
  },
  {
    id: 'finance.spend_50',
    label: 'Spend up to $50',
    description: 'Authorize financial transactions up to $50',
    forceJit: true,
    runtimes: ['cloud', 'hybrid', 'local'],
  },
  {
    id: 'finance.spend_100',
    label: 'Spend up to $100',
    description: 'Authorize financial transactions up to $100',
    forceJit: true,
    runtimes: ['cloud', 'hybrid', 'local'],
  },
  {
    id: 'brain.query',
    label: 'Query company AI brain',
    description:
      'Query the organization AI brain for insights and answers (always granted to every standard agent)',
    forceJit: false,
    runtimes: ['cloud', 'hybrid', 'local'],
  },
  {
    id: 'brain.knowledge_read',
    label: 'Read org knowledge indexed for the brain',
    description: 'Read documents indexed in the org knowledge base',
    forceJit: false,
    runtimes: ['cloud', 'hybrid'],
  },
  {
    id: 'email.read',
    label: 'Read connected email inbox',
    description: 'Read messages from a connected Gmail or Microsoft 365 inbox',
    forceJit: false,
    requiresConnectorFamily: 'email',
    runtimes: ['cloud', 'hybrid'],
  },
  {
    id: 'email.send',
    label: 'Send / draft email via connected mailbox',
    description: 'Send emails or save drafts via Gmail or Microsoft 365 (send is JIT)',
    forceJit: true,
    requiresConnectorFamily: 'email',
    runtimes: ['cloud', 'hybrid'],
  },
  {
    id: 'drive.read',
    label: 'Read cloud drive',
    description: 'List and read files from connected Google Drive or OneDrive',
    forceJit: false,
    requiresConnectorFamily: 'drive',
    runtimes: ['cloud', 'hybrid'],
  },
  {
    id: 'drive.write',
    label: 'Write to cloud drive',
    description: 'Create, update, or delete files in connected Google Drive or OneDrive',
    forceJit: true,
    requiresConnectorFamily: 'drive',
    runtimes: ['cloud', 'hybrid'],
  },
  {
    id: 'docs.read',
    label: 'Read Google Docs',
    description: 'Read documents from connected Google Docs',
    forceJit: false,
    requiresConnector: 'google',
    runtimes: ['cloud', 'hybrid'],
  },
  {
    id: 'docs.write',
    label: 'Write Google Docs',
    description: 'Create or update documents in connected Google Docs',
    forceJit: true,
    requiresConnector: 'google',
    runtimes: ['cloud', 'hybrid'],
  },
  {
    id: 'sheets.read',
    label: 'Read Google Sheets',
    description: 'Read spreadsheets and cell values from connected Google Sheets',
    forceJit: false,
    requiresConnector: 'google',
    runtimes: ['cloud', 'hybrid'],
  },
  {
    id: 'sheets.write',
    label: 'Write Google Sheets',
    description: 'Create spreadsheets or update cell values in Google Sheets',
    forceJit: true,
    requiresConnector: 'google',
    runtimes: ['cloud', 'hybrid'],
  },
  {
    id: 'slides.read',
    label: 'Read Google Slides',
    description: 'Read presentations from connected Google Slides',
    forceJit: false,
    requiresConnector: 'google',
    runtimes: ['cloud', 'hybrid'],
  },
  {
    id: 'slides.write',
    label: 'Write Google Slides',
    description: 'Create or update presentations in connected Google Slides',
    forceJit: true,
    requiresConnector: 'google',
    runtimes: ['cloud', 'hybrid'],
  },
  {
    id: 'forms.read',
    label: 'Read Google Forms',
    description: 'Read forms and responses from connected Google Forms',
    forceJit: false,
    requiresConnector: 'google',
    runtimes: ['cloud', 'hybrid'],
  },
  {
    id: 'forms.write',
    label: 'Write Google Forms',
    description: 'Create or update forms in connected Google Forms',
    forceJit: true,
    requiresConnector: 'google',
    runtimes: ['cloud', 'hybrid'],
  },
  {
    id: 'calendar.read',
    label: 'Read Google Calendar',
    description: 'List and read events from connected Google Calendar',
    forceJit: false,
    requiresConnector: 'google',
    runtimes: ['cloud', 'hybrid'],
  },
  {
    id: 'calendar.write',
    label: 'Write to Google Calendar',
    description: 'Create, update, or delete events on connected Google Calendar',
    forceJit: true,
    requiresConnector: 'google',
    runtimes: ['cloud', 'hybrid'],
  },
  {
    id: 'meet.manage',
    label: 'Google Meet',
    description: 'Create and manage Google Meet links and meeting spaces',
    forceJit: true,
    requiresConnector: 'google',
    runtimes: ['cloud', 'hybrid'],
  },
  {
    id: 'youtube.read',
    label: 'Read YouTube',
    description: 'Search and read YouTube channels, videos, and metadata via Google',
    forceJit: false,
    requiresConnector: 'google',
    runtimes: ['cloud', 'hybrid'],
  },
  {
    id: 'youtube.publish',
    label: 'Publish to YouTube',
    description: 'Upload or update YouTube videos via a connected Google account',
    forceJit: true,
    requiresConnector: 'google',
    runtimes: ['cloud', 'hybrid'],
  },
  {
    id: 'whatsapp.send',
    label: 'Send files to your linked WhatsApp',
    description:
      'Deliver files/PDFs/screenshots to the linked WhatsApp self-chat (not to other contacts)',
    forceJit: false,
    requiresConnector: 'whatsapp_baileys',
    runtimes: ['cloud', 'hybrid'],
  },
  {
    id: 'whatsapp.read',
    label: 'Read WhatsApp contact chats',
    description:
      'List phonebook contacts and read recent 1:1 chat messages — only when the user asks to look at a chat',
    forceJit: false,
    requiresConnector: 'whatsapp_baileys',
    runtimes: ['cloud', 'hybrid'],
  },
  {
    id: 'whatsapp.contact_send',
    label: 'Message WhatsApp contacts',
    description:
      'Send WhatsApp text, files, or native polls to a phonebook contact or phone number — only when the user explicitly asks; requires approval. Multiple messages to one contact are sent in order.',
    forceJit: true,
    requiresConnector: 'whatsapp_baileys',
    runtimes: ['cloud', 'hybrid'],
  },
  {
    id: 'whatsapp.auto_reply',
    label: 'Auto-reply to WhatsApp contacts',
    description:
      'After messaging a contact, listen for their replies and auto-route them into a new agent run; deliver the answer back to that contact',
    forceJit: false,
    requiresConnector: 'whatsapp_baileys',
    runtimes: ['cloud', 'hybrid'],
  },
  {
    id: 'social.read',
    label: 'Read Orbit social channels & posts',
    description: 'List connected social channels, scheduled posts, and analytics via Orbit',
    forceJit: false,
    requiresConnector: 'orbit',
    runtimes: ['cloud', 'hybrid'],
  },
  {
    id: 'social.publish',
    label: 'Publish / schedule posts via Orbit',
    description: 'Create or schedule social posts on connected Orbit channels (Instagram, Facebook, X, …)',
    forceJit: true,
    requiresConnector: 'orbit',
    runtimes: ['cloud', 'hybrid'],
  },
  {
    id: 'crm.read',
    label: 'Read CRM records',
    description: 'Search, query, and read records in the connected CRM (Zoho, HubSpot, Salesforce, …)',
    forceJit: false,
    requiresConnectorFamily: 'crm',
    runtimes: ['cloud', 'hybrid'],
  },
  {
    id: 'crm.write',
    label: 'Create / update CRM records',
    description: 'Create, update, convert, link records and upload attachments in the connected CRM',
    forceJit: true,
    requiresConnectorFamily: 'crm',
    runtimes: ['cloud', 'hybrid'],
  },
  {
    id: 'crm.delete',
    label: 'Delete CRM records',
    description: 'Delete records in the connected CRM (requires explicit approval)',
    forceJit: true,
    requiresConnectorFamily: 'crm',
    runtimes: ['cloud', 'hybrid'],
  },
  {
    id: 'slack.read',
    label: 'Read Slack messages',
    description: 'List channels, search messages, read history, and read Slack List items',
    forceJit: false,
    requiresConnector: 'slack',
    runtimes: ['cloud', 'hybrid'],
  },
  {
    id: 'slack.send',
    label: 'Write to Slack',
    description:
      'Post messages, create channels, open DMs, set topics/presence, and create or update Slack List task items',
    forceJit: true,
    requiresConnector: 'slack',
    runtimes: ['cloud', 'hybrid'],
  },
  {
    id: 'notion.read',
    label: 'Read Notion',
    description: 'Search Notion pages/databases, read page content, and query databases',
    forceJit: false,
    requiresConnector: 'notion',
    runtimes: ['cloud', 'hybrid'],
  },
  {
    id: 'notion.write',
    label: 'Write to Notion',
    description: 'Create or update Notion pages and add database rows (JIT)',
    forceJit: true,
    requiresConnector: 'notion',
    runtimes: ['cloud', 'hybrid'],
  },
];

export const SCOPE_CATALOG_BY_ID: Record<BuiltinPermissionScope, ScopeDef> = Object.fromEntries(
  SCOPE_CATALOG.map((s) => [s.id, s]),
) as Record<BuiltinPermissionScope, ScopeDef>;

export function getBuiltinScopeDef(id: string): ScopeDef | undefined {
  return SCOPE_CATALOG_BY_ID[id as BuiltinPermissionScope];
}

/** All supported scope ids (replaces the old hardcoded ALL_PERMISSION_SCOPES). */
export const ALL_PERMISSION_SCOPES: PermissionScope[] = SCOPE_CATALOG.map((s) => s.id);

/** Scopes that always require per-invocation approval (replaces the old FORCE_JIT_SCOPES). */
export const FORCE_JIT_SCOPES: PermissionScope[] = SCOPE_CATALOG.filter((s) => s.forceJit).map(
  (s) => s.id,
);

/** True when any scope's SDK tools are unavailable on cloud runners (e.g. local filesystem, GUI). */
export function scopesRequireHybrid(scopes: readonly string[]): boolean {
  return scopes.some((id) => {
    const def = getBuiltinScopeDef(id);
    return def != null && !def.runtimes.includes('cloud');
  });
}

/**
 * Ensures runtime matches scope capabilities. Hybrid-only scopes cannot run on cloud;
 * keep `local` when explicitly chosen, otherwise upgrade to `hybrid`.
 */
export function reconcileRuntimeWithScopes(
  runtime: AgentRuntime,
  scopes: readonly PermissionScope[],
): AgentRuntime {
  if (!scopesRequireHybrid(scopes)) return runtime;
  return runtime === 'local' ? 'local' : 'hybrid';
}

const connectorsRepo = new ConnectorsRepository();

/**
 * Resolve the scope catalog for an org, annotated with availability:
 *   available = enabled (Skills page) AND (no connector required OR connector connected).
 *
 * `orgId` is the workspace org id (present for individual + organization workspaces —
 * the same id connectors are keyed on).
 */
export async function getEffectiveScopes(orgId: string | null): Promise<AnnotatedScopeDef[]> {
  const connected = new Set<ConnectorProvider>();
  let googleOAuthScopes: string[] = [];
  let disabled = new Set<string>();

  if (orgId) {
    const accounts = await connectorsRepo.listForOrg(orgId);
    for (const a of accounts) {
      if (a.status === 'connected') connected.add(a.provider);
      if (a.provider === 'google' && a.status === 'connected') {
        googleOAuthScopes = a.scopes;
      }
    }
    try {
      const org = await prisma.organization.findUnique({ where: { id: orgId } });
      // `disabledScopes` is read via cast so this compiles even before the Prisma
      // client is regenerated; the migration lights it up at runtime.
      const ds = (org as { disabledScopes?: string[] } | null)?.disabledScopes;
      disabled = new Set(ds ?? []);
    } catch {
      // disabled_scopes column may not be migrated yet — treat all scopes as enabled.
      disabled = new Set();
    }
  }

  return SCOPE_CATALOG.map((s) => {
    const enabled = !disabled.has(s.id);
    let isConnected = !s.requiresConnector || connected.has(s.requiresConnector);
    if (s.requiresConnectorFamily === 'crm') {
      isConnected = CRM_CONNECTOR_PROVIDERS.some((p) => connected.has(p));
    }
    if (s.requiresConnectorFamily === 'email') {
      isConnected =
        googleServiceConnected('gmail', googleOAuthScopes) || connected.has('microsoft');
    }
    if (s.requiresConnectorFamily === 'drive') {
      isConnected =
        googleServiceConnected('drive', googleOAuthScopes) || connected.has('microsoft');
    }
    // Google products are individually connectable — email/drive families already handled above.
    const googleService = PERMISSION_SCOPE_GOOGLE_SERVICE[s.id];
    if (googleService && !s.requiresConnectorFamily) {
      isConnected = googleServiceConnected(googleService, googleOAuthScopes);
    }
    return { ...s, enabled, connected: isConnected, available: enabled && isConnected };
  });
}

/** Just the available scope defs for an org (enabled AND connector linked). */
export async function getAvailableScopes(orgId: string | null): Promise<ScopeDef[]> {
  const annotated = await getEffectiveScopes(orgId);
  return annotated.filter((s) => s.available);
}

/**
 * Scopes offerable when building/creating an agent: everything enabled for the org
 * (Skills page), REGARDLESS of whether the backing connector is linked yet.
 *
 * Connection is enforced at run time, not build time — an agent can be created with
 * a connector scope (e.g. whatsapp.send) before the connector is linked. When the
 * agent runs, the tool checks the link and either executes or returns a "not linked"
 * result the model can act on.
 */
export async function getBuildableScopes(orgId: string | null): Promise<ScopeDef[]> {
  const annotated = await getEffectiveScopes(orgId);
  const builtin = annotated.filter((s) => s.enabled);
  const [mcp, peers] = await Promise.all([
    getMcpScopeDefsForOrg(orgId),
    getPeerAgentScopeDefsForOrg(orgId),
  ]);
  return [...builtin, ...mcp, ...peers];
}
