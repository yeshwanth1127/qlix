import { prisma } from '../lib/prisma.js';
import { ConnectorsRepository } from '../connectors/connectors.repository.js';
import type { ConnectorProvider } from '../connectors/connectors.types.js';
import { getMcpScopeDefsForOrg } from '../mcp/mcpScopeCatalog.js';
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
    description: 'Query the organization AI brain for insights and answers',
    forceJit: false,
    runtimes: ['cloud', 'hybrid'],
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
    label: 'Read connected Gmail inbox',
    description: 'Read messages from a connected Gmail inbox',
    forceJit: false,
    requiresConnector: 'google',
    runtimes: ['cloud', 'hybrid'],
  },
  {
    id: 'email.send',
    label: 'Send email via connected Gmail',
    description: 'Send emails via a connected Gmail account',
    forceJit: true,
    requiresConnector: 'google',
    runtimes: ['cloud', 'hybrid'],
  },
  {
    id: 'whatsapp.send',
    label: 'Send messages/files on connected WhatsApp',
    description: 'Send a message or document to the linked WhatsApp account',
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
  let disabled = new Set<string>();

  if (orgId) {
    const accounts = await connectorsRepo.listForOrg(orgId);
    for (const a of accounts) {
      if (a.status === 'connected') connected.add(a.provider);
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
    const isConnected = !s.requiresConnector || connected.has(s.requiresConnector);
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
  const mcp = await getMcpScopeDefsForOrg(orgId);
  return [...builtin, ...mcp];
}
