import type { ScopeCatalogEntry } from "@/lib/agents-api";
import type { ConnectorProvider } from "@/lib/connectors-api";
import { connectorsRequiredByScopes, connectorInfo } from "@/lib/required-connectors";

/**
 * Turns the raw scope catalog into something a non-technical user can read.
 *
 * Scope ids are already `namespace.action`, so the namespace *is* the grouping — no backend
 * field to add and no list to keep in sync as scopes are introduced. Only the display titles
 * live here.
 */

export interface ReadableTool {
  /** Raw scope id. Kept for the node, the tooltip, and the inspector — not the palette row. */
  id: string;
  /** Plain-language name from the catalog, e.g. "Send email via connected Gmail". */
  label: string;
  description: string;
  /** Needs the user to approve every single use. */
  forceJit: boolean;
  /** A connector still has to be linked before this does anything. */
  unavailable: boolean;
  /** Friendly connector name to show when unavailable, e.g. "Gmail". */
  needsConnector?: string;
  groupId: string;
}

export interface ToolGroup {
  id: string;
  title: string;
  tools: ReadableTool[];
}

/** Namespace → what a person would call it. */
const GROUP_TITLES: Readonly<Record<string, string>> = {
  web: "Web & research",
  email: "Email",
  whatsapp: "WhatsApp",
  slack: "Slack",
  social: "Social",
  crm: "Customer records",
  system: "Files on your computer",
  finance: "Spending",
  brain: "Company knowledge",
};

/** Groups are shown in this order; anything unlisted follows, alphabetically. */
const GROUP_ORDER = [
  "web",
  "email",
  "whatsapp",
  "slack",
  "social",
  "crm",
  "brain",
  "system",
  "finance",
];

const OTHER_GROUP = "other";

interface Bucketed {
  groupId: string;
  groupTitle: string;
  label: string;
}

/**
 * MCP scopes are `mcp.<server-slug>.<tool>` and arrive labelled `"<Server name>: <tool>"`
 * (see `getMcpScopeDefsForOrg`). Group them per server and strip the server prefix off the
 * item label so it isn't repeated on every row.
 */
function bucketMcpScope(scope: ScopeCatalogEntry): Bucketed {
  const slug = scope.id.split(".")[1] ?? "server";
  const separator = scope.label.indexOf(": ");
  const serverName = separator > 0 ? scope.label.slice(0, separator) : slug;
  const toolName = separator > 0 ? scope.label.slice(separator + 2) : scope.label;
  return { groupId: `mcp.${slug}`, groupTitle: serverName, label: toolName };
}

function bucket(scope: ScopeCatalogEntry): Bucketed {
  if (scope.id.startsWith("mcp.")) return bucketMcpScope(scope);
  const namespace = scope.id.split(".")[0] ?? OTHER_GROUP;
  const title = GROUP_TITLES[namespace];
  return title
    ? { groupId: namespace, groupTitle: title, label: scope.label }
    : { groupId: OTHER_GROUP, groupTitle: "Other", label: scope.label };
}

function rank(groupId: string): number {
  const index = GROUP_ORDER.indexOf(groupId);
  if (index >= 0) return index;
  // MCP servers sit after the built-ins; "Other" always last.
  if (groupId === OTHER_GROUP) return Number.MAX_SAFE_INTEGER;
  return GROUP_ORDER.length;
}

const KNOWN_PROVIDERS = new Set<string>([
  "google",
  "whatsapp_baileys",
  "orbit",
  "zoho",
  "slack",
  "telegram",
]);

/**
 * Resolve the connector a scope needs, as a name a user would recognise.
 *
 * Prefers `requiresConnector` straight off the catalog entry (authoritative, and covers
 * scopes the local map doesn't know about), falling back to `connectorsRequiredByScopes`
 * for CRM scopes, which declare a connector *family* rather than one provider.
 */
function needsConnectorName(scope: ScopeCatalogEntry): string | undefined {
  if (scope.requiresConnector && KNOWN_PROVIDERS.has(scope.requiresConnector)) {
    return connectorInfo(scope.requiresConnector as ConnectorProvider).name;
  }
  const provider = connectorsRequiredByScopes([scope.id])[0];
  return provider ? connectorInfo(provider).name : undefined;
}

export function toReadableTool(scope: ScopeCatalogEntry): ReadableTool {
  const { groupId, label } = bucket(scope);
  const unavailable = scope.available === false;
  return {
    id: scope.id,
    label,
    description: scope.description,
    forceJit: scope.forceJit,
    unavailable,
    needsConnector: unavailable ? needsConnectorName(scope) : undefined,
    groupId,
  };
}

/** Bucket the catalog into ordered, titled groups. Empty groups are never emitted. */
export function groupScopes(scopes: ScopeCatalogEntry[]): ToolGroup[] {
  const groups = new Map<string, ToolGroup>();

  for (const scope of scopes) {
    const { groupId, groupTitle } = bucket(scope);
    const existing = groups.get(groupId);
    const tool = toReadableTool(scope);
    if (existing) existing.tools.push(tool);
    else groups.set(groupId, { id: groupId, title: groupTitle, tools: [tool] });
  }

  return [...groups.values()].sort((a, b) => {
    const byRank = rank(a.id) - rank(b.id);
    return byRank !== 0 ? byRank : a.title.localeCompare(b.title);
  });
}

/** Search across the friendly label, the raw id, and the group title. */
export function filterGroups(groups: ToolGroup[], query: string): ToolGroup[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return groups;

  return groups
    .map((group) => {
      if (group.title.toLowerCase().includes(needle)) return group;
      const tools = group.tools.filter(
        (tool) =>
          tool.label.toLowerCase().includes(needle) || tool.id.toLowerCase().includes(needle),
      );
      return { ...group, tools };
    })
    .filter((group) => group.tools.length > 0);
}

/** Group title for one scope id — used by the node chrome, which has no group context. */
export function groupTitleForScope(scopeId: string): string {
  if (scopeId.startsWith("mcp.")) return scopeId.split(".")[1] ?? "Tool";
  const namespace = scopeId.split(".")[0] ?? "";
  return GROUP_TITLES[namespace] ?? "Tool";
}
