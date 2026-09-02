/**
 * Canonical list of optional product capabilities an org can enable from the
 * dashboard's Plugins page. This is code, not data — OrgPlugin only records
 * which of these ids a given org has turned on. Adding a plugin here requires
 * the feature it represents to actually exist behind it (routes, pages, etc.),
 * the same discipline scopeCatalog.ts applies to SCOPE_CATALOG entries.
 *
 * A plugin gates two things, both optional per plugin:
 *  - which scopes are offerable (a ScopeDef tagged with this plugin's id in
 *    scopeCatalog.ts — see SCOPE_CATALOG's `pluginId` field)
 *  - which nav item(s) appear once enabled
 * Nothing else is gated by plugin state (routes stay mounted; the scope check
 * is the real access boundary).
 */
export interface PluginNavItem {
  /** Route segment appended to the workspace prefix, e.g. "assessments" → "/individual/assessments". */
  href: string;
  label: string;
  /** lucide-react icon name; the frontend maps this to the actual icon component. */
  iconName: string;
}

export interface PluginDef {
  id: string;
  name: string;
  description: string;
  /** Nav items added to the sidebar once this plugin is enabled. Empty when the
   * plugin only gates scopes and needs no page of its own (e.g. WhatsApp Outreach). */
  navItems: PluginNavItem[];
  /** True = new orgs get this enabled automatically at signup. Neither plugin
   * uses this today — both are opt-in — but the mechanism exists for later. */
  defaultEnabled: boolean;
  /** Declarative activation checks; kept JSON-safe for session/API responses. */
  requirements?: {
    plugins?: string[];
    env?: string[];
    configKeys?: string[];
  };
}

export const PLUGIN_CATALOG: PluginDef[] = [
  {
    id: 'gtm',
    name: 'GTM Revenue OS',
    description:
      'Discover and validate target accounts with Exa, reviewed organization knowledge, source-backed evidence, and governed Qlix agents. Outreach stays disabled until discovery calibration is complete.',
    navItems: [
      { href: 'gtm', label: 'GTM', iconName: 'Target' },
    ],
    defaultEnabled: false,
  },
  {
    id: 'assessment',
    name: 'Assessment Engine',
    description:
      'Observe authorized work, collect evidence, evaluate it against a checklist, run an adaptive review, and produce a human-confirmed report. Student final-project assessment is the first configuration.',
    navItems: [
      { href: 'assessments', label: 'Assessments', iconName: 'ClipboardCheck' },
    ],
    defaultEnabled: false,
  },
  {
    id: 'whatsapp_outreach',
    name: 'WhatsApp Outreach',
    description:
      'Message multiple contacts and wait for their replies as a managed campaign (arms a durable wait, routes each reply back into the run). Sending to one contact, reading chats, and delivering files to your own WhatsApp are ordinary agent scopes and do not require this — this plugin only gates the auto-reply/wait-for-replies capability.',
    navItems: [],
    defaultEnabled: false,
  },
];

export function getPluginDef(pluginId: string): PluginDef | undefined {
  return PLUGIN_CATALOG.find((plugin) => plugin.id === pluginId);
}

export function validatePluginActivation(
  plugin: PluginDef,
  options: {
    enabledPluginIds: Iterable<string>;
    config?: Record<string, unknown>;
    env?: Record<string, string | undefined>;
  },
): string[] {
  const enabled = new Set(options.enabledPluginIds);
  const config = options.config ?? {};
  const env = options.env ?? process.env;
  const errors: string[] = [];
  for (const dependency of plugin.requirements?.plugins ?? []) {
    if (!enabled.has(dependency)) errors.push(`requires plugin ${dependency}`);
  }
  for (const variable of plugin.requirements?.env ?? []) {
    if (!env[variable]?.trim()) errors.push(`requires environment variable ${variable}`);
  }
  for (const key of plugin.requirements?.configKeys ?? []) {
    if (config[key] === undefined || config[key] === null || config[key] === '') {
      errors.push(`requires configuration key ${key}`);
    }
  }
  return errors;
}
