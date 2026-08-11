import type { Connection, Edge, Node } from "@xyflow/react";
import type { AgentDTO, ScopeCatalogEntry } from "@/lib/agents-api";
import type {
  BuilderGraph,
  BuilderGraphEdge,
  BuilderGraphNode,
  BuilderGroup,
} from "@/lib/builder-api";
import { BUILDER_GRAPH_VERSION } from "@/lib/builder-api";
import { groupTitleForScope, toReadableTool } from "./toolCatalog";

/**
 * Node kinds the canvas can hold.
 *
 * `supervisor` and `agent` map to real Agents (with DIDs and scopes); `tool` is a permission
 * scope bound to whichever agent it points at. Everything drawn here has a counterpart in the
 * platform — the canvas never invents a runtime concept of its own.
 */
export type BuilderNodeKind = "supervisor" | "agent" | "tool";

/**
 * Handle ids. Connection rules key off these, so they are part of the data contract, not
 * styling: `tools` is the dedicated third port that keeps capability wiring visually and
 * logically separate from the agent-to-agent flow.
 */
export const HANDLE = {
  flowIn: "flow-in",
  flowOut: "flow-out",
  tools: "tools",
  toolOut: "tool-out",
} as const;

/**
 * One flat data shape rather than a discriminated union: React Flow needs
 * `Record<string, unknown>` node data, and a union there forces casts at every `nodeTypes`
 * boundary for no real safety gain. `kind` is the discriminator.
 */
export interface BuilderNodeData extends Record<string, unknown> {
  kind: BuilderNodeKind;
  label: string;
  /** Agent nodes: the existing agent this node stands for. Absent = not yet created. */
  agentId?: string;
  description?: string;
  runtime?: string;
  model?: string;
  /** Agent nodes: permission scopes the agent holds. */
  scopes?: string[];
  /** Tool nodes: the permission scope this node grants. */
  scopeId?: string;
  /** Tool nodes: friendly category, e.g. "Email". Shown instead of the raw scope id. */
  groupTitle?: string;
  /** Tool nodes: requires approval on every use. */
  forceJit?: boolean;
  /** Tool nodes: false when a connector still has to be linked before it works. */
  available?: boolean;
  /** Tool nodes: what the user must connect first, in plain language. */
  requiresConnector?: string;
  /** Group this node belongs to, when it has been placed in one. */
  groupId?: string;
  groupKind?: BuilderGroup["kind"];
  /** True when the referenced agent or scope no longer exists. */
  missing?: boolean;
}

export type BuilderNode = Node<BuilderNodeData>;
export type BuilderEdge = Edge<Record<string, unknown>>;

export function isAgentNode(node: BuilderNode): boolean {
  return node.type === "agent" || node.type === "supervisor";
}

// ─── Drag payload ────────────────────────────────────────────────────────────

/** MIME type carrying a palette item through an HTML5 drag onto the canvas. */
export const BUILDER_DRAG_TYPE = "application/qlix-builder-node";

export interface BuilderDragPayload {
  kind: BuilderNodeKind;
  data: BuilderNodeData;
}

export function readDragPayload(transfer: DataTransfer): BuilderDragPayload | null {
  const raw = transfer.getData(BUILDER_DRAG_TYPE);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as BuilderDragPayload;
    return parsed?.data?.kind ? parsed : null;
  } catch {
    return null;
  }
}

// ─── Connection rules ────────────────────────────────────────────────────────

/**
 * `flow`   — agent → agent pipeline stage (a team).
 * `tool`   — a permission granted to an agent.
 * `helper` — agent → agent as a capability: "you may hand work to this colleague".
 */
export type BuilderEdgeKind = "flow" | "tool" | "helper";

/**
 * React Flow hands `isValidConnection` either an in-progress `Connection` or an existing
 * `Edge` (during reconnection), so the rule works off the fields both share.
 */
type ConnectionLike = Pick<Connection, "source" | "target"> & {
  sourceHandle?: string | null;
  targetHandle?: string | null;
};

/** Which of the two legal wirings a connection is, or null when it is not legal at all. */
export function connectionKind(connection: ConnectionLike): BuilderEdgeKind | null {
  if (!connection.source || !connection.target) return null;
  if (connection.source === connection.target) return null;

  const from = connection.sourceHandle;
  const to = connection.targetHandle;

  if (from === HANDLE.flowOut && to === HANDLE.flowIn) return "flow";
  if (from === HANDLE.toolOut && to === HANDLE.tools) return "tool";
  // The *target* port disambiguates: an agent wired into another agent's tools port is being
  // offered as a capability, not queued as a pipeline stage. `flow-out` only exists on agent
  // nodes and `tool-out` only on tool nodes, so the handles alone are enough to tell them apart.
  if (from === HANDLE.flowOut && to === HANDLE.tools) return "helper";
  return null;
}

/**
 * Exactly three shapes are allowed: agent→agent along the flow ports (a team), tool→agent into
 * the tools port (a permission), and agent→agent into the tools port (a colleague it may ask).
 * Everything else — tool into a flow port, tool→tool, self-edges — is refused at the handle
 * rather than cleaned up afterwards.
 */
export function isValidBuilderConnection(connection: ConnectionLike): boolean {
  return connectionKind(connection) !== null;
}

// ─── Groups ──────────────────────────────────────────────────────────────────

/**
 * Agents reachable from `startId` through flow edges, i.e. everyone who would end up working
 * together. Tool edges are ignored — a shared tool does not make two agents a team.
 */
export function connectedAgentIds(
  startId: string,
  nodes: BuilderNode[],
  edges: BuilderEdge[],
): string[] {
  const agentIds = new Set(nodes.filter(isAgentNode).map((node) => node.id));
  if (!agentIds.has(startId)) return [];

  const neighbours = new Map<string, string[]>();
  for (const edge of edges) {
    // `helper` edges are deliberately excluded: being allowed to ask a colleague does not put
    // the two agents on one pipeline, which is exactly the distinction the popup asks about.
    if (edge.data?.kind !== "flow") continue;
    if (!agentIds.has(edge.source) || !agentIds.has(edge.target)) continue;
    // Undirected on purpose: membership is about who is wired together, not flow direction.
    neighbours.set(edge.source, [...(neighbours.get(edge.source) ?? []), edge.target]);
    neighbours.set(edge.target, [...(neighbours.get(edge.target) ?? []), edge.source]);
  }

  const seen = new Set<string>([startId]);
  const queue = [startId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of neighbours.get(current) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  // Return in canvas order so the "most upstream" default lead is stable.
  return nodes.filter((node) => seen.has(node.id)).map((node) => node.id);
}

/**
 * The node a group defaults to leading with: the one no other member feeds into. Falls back
 * to the first member when the members form a cycle.
 */
export function defaultLeadNodeId(memberIds: string[], edges: BuilderEdge[]): string {
  const members = new Set(memberIds);
  const hasIncoming = new Set(
    edges
      .filter((edge) => edge.data?.kind === "flow" && members.has(edge.source) && members.has(edge.target))
      .map((edge) => edge.target),
  );
  return memberIds.find((id) => !hasIncoming.has(id)) ?? memberIds[0]!;
}

// ─── Implied grants ──────────────────────────────────────────────────────────

/** `agent.ask.<agentId>` — mirrors the backend scope id. */
export function agentAskScope(agentId: string): string {
  return `agent.ask.${agentId}`;
}

/**
 * The scope grants the drawn graph implies, per agent: every tool wired into an agent's tools
 * port, plus `agent.ask.<colleague>` for every agent wired there.
 *
 * Drawing never applies these — Apply diffs this against each agent's live scopes and asks for
 * confirmation, so a canvas edit can't silently widen an agent's permissions.
 */
export function impliedGrants(
  nodes: BuilderNode[],
  edges: BuilderEdge[],
): Map<string, Set<string>> {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const grants = new Map<string, Set<string>>();

  for (const edge of edges) {
    const kind = edge.data?.kind;
    if (kind !== "tool" && kind !== "helper") continue;

    const target = byId.get(edge.target);
    const source = byId.get(edge.source);
    if (!target?.data.agentId || !source) continue;

    const scope =
      kind === "tool"
        ? source.data.scopeId
        : source.data.agentId
          ? agentAskScope(source.data.agentId)
          : undefined;
    if (!scope) continue;

    const existing = grants.get(target.data.agentId);
    if (existing) existing.add(scope);
    else grants.set(target.data.agentId, new Set([scope]));
  }

  return grants;
}

// ─── Persistence ─────────────────────────────────────────────────────────────

/**
 * Strip a canvas down to references. Display data (names, models, scope lists, availability)
 * is deliberately dropped — it is re-hydrated from live agents and the scope catalog on load,
 * so a saved canvas can never describe an agent that has since been renamed or re-scoped.
 */
export function toGraph(
  nodes: BuilderNode[],
  edges: BuilderEdge[],
  groups: BuilderGroup[],
  viewport?: { x: number; y: number; zoom: number },
): BuilderGraph {
  return {
    version: BUILDER_GRAPH_VERSION,
    nodes: nodes.map<BuilderGraphNode>((node) => ({
      id: node.id,
      type: (node.type ?? "agent") as BuilderGraphNode["type"],
      position: node.position,
      ...(node.data.agentId ? { agentId: node.data.agentId } : {}),
      ...(node.data.scopeId ? { scopeId: node.data.scopeId } : {}),
      // Only kept for nodes with nothing to re-hydrate from (a lead placeholder).
      ...(!node.data.agentId && !node.data.scopeId ? { label: node.data.label } : {}),
    })),
    edges: edges.map<BuilderGraphEdge>((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle ?? null,
      targetHandle: edge.targetHandle ?? null,
      kind: (edge.data?.kind as BuilderEdgeKind) ?? "flow",
    })),
    groups,
    ...(viewport ? { viewport } : {}),
  };
}

export function agentNodeData(agent: AgentDTO, kind: BuilderNodeKind = "agent"): BuilderNodeData {
  return {
    kind,
    label: agent.name,
    agentId: agent.id,
    description: agent.description ?? undefined,
    runtime: agent.runtime,
    model: agent.model,
    scopes: agent.permissionScopes,
  };
}

export function toolNodeData(scope: ScopeCatalogEntry): BuilderNodeData {
  const readable = toReadableTool(scope);
  return {
    kind: "tool",
    label: readable.label,
    scopeId: readable.id,
    description: readable.description,
    groupTitle: groupTitleForScope(readable.id),
    forceJit: readable.forceJit,
    available: !readable.unavailable,
    requiresConnector: readable.needsConnector,
  };
}

/**
 * Rebuild canvas nodes from a saved graph plus live data.
 *
 * A node whose agent or scope has since been deleted is kept and flagged `missing` rather than
 * dropped: silently reshaping someone's saved graph because an agent was removed elsewhere is
 * worse than showing them a tombstone they can delete themselves.
 */
export function fromGraph(
  graph: BuilderGraph,
  agents: AgentDTO[],
  scopes: ScopeCatalogEntry[],
): { nodes: BuilderNode[]; edges: BuilderEdge[]; groups: BuilderGroup[] } {
  const agentById = new Map(agents.map((agent) => [agent.id, agent]));
  const scopeById = new Map(scopes.map((scope) => [scope.id, scope]));
  const groupByNodeId = new Map<string, BuilderGroup>();
  for (const group of graph.groups ?? []) {
    for (const nodeId of group.nodeIds) groupByNodeId.set(nodeId, group);
  }

  const nodes = (graph.nodes ?? []).map<BuilderNode>((saved) => {
    const group = groupByNodeId.get(saved.id);
    const groupFields = group ? { groupId: group.id, groupKind: group.kind } : {};

    if (saved.type === "tool") {
      const scope = saved.scopeId ? scopeById.get(saved.scopeId) : undefined;
      const data: BuilderNodeData = scope
        ? { ...toolNodeData(scope), ...groupFields }
        : {
            kind: "tool",
            label: saved.scopeId ?? "Unknown tool",
            scopeId: saved.scopeId,
            missing: true,
            ...groupFields,
          };
      return { id: saved.id, type: "tool", position: saved.position, data };
    }

    const agent = saved.agentId ? agentById.get(saved.agentId) : undefined;
    const kind: BuilderNodeKind = saved.type === "supervisor" ? "supervisor" : "agent";
    const data: BuilderNodeData = agent
      ? { ...agentNodeData(agent, kind), ...groupFields }
      : saved.agentId
        ? { kind, label: saved.label ?? "Deleted agent", agentId: saved.agentId, missing: true, ...groupFields }
        : { kind, label: saved.label ?? "Team lead", ...groupFields };

    return { id: saved.id, type: kind, position: saved.position, data };
  });

  const edges = (graph.edges ?? []).map<BuilderEdge>((saved) => ({
    id: saved.id,
    source: saved.source,
    target: saved.target,
    sourceHandle: saved.sourceHandle ?? undefined,
    targetHandle: saved.targetHandle ?? undefined,
    data: { kind: saved.kind },
  }));

  return { nodes, edges, groups: graph.groups ?? [] };
}
