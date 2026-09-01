"use client";

import "@xyflow/react/dist/style.css";
import "./builder.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ReactFlowProvider,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type Viewport,
} from "@xyflow/react";
import { ArrowLeft, X } from "lucide-react";
import {
  fetchScopeCatalog,
  listAgents,
  updateAgentScopes,
  type AgentDTO,
  type ScopeCatalogEntry,
} from "@/lib/agents-api";
import {
  EMPTY_GRAPH,
  getCanvas,
  updateCanvas,
  type BuilderCanvasDTO,
  type BuilderGroup,
} from "@/lib/builder-api";
import { CreateAgentModal } from "@/components/qlix/agents/CreateAgentModal";
import { useSession } from "@/components/qlix/session-context";
import { SketchPageHeader, sketchLabel } from "@/components/qlix/sketch";
import { cn } from "@/lib/utils/cn";
import { BuilderCanvas } from "./BuilderCanvas";
import { PaletteSidebar } from "./PaletteSidebar";
import { TeamChoicePopup, type TeamChoice } from "./TeamChoicePopup";
import {
  HANDLE,
  agentNodeData,
  connectedAgentIds,
  defaultLeadNodeId,
  fromGraph,
  impliedGrants,
  isAgentNode,
  toGraph,
  type BuilderEdge,
  type BuilderEdgeKind,
  type BuilderNode,
} from "./builderTypes";

const HAIRLINE = "border-[color:var(--ink-border)]";
const INK_SOFT = "text-[color:var(--ink-soft)]";
const INK_FAINT = "text-[color:var(--ink-faint)]";
const MICRO = "text-[10px] font-medium uppercase tracking-[0.16em]";

/** Long enough that dragging a node doesn't fire a request per frame. */
const AUTOSAVE_DELAY_MS = 1200;

type SaveState = "idle" | "saving" | "saved" | "error";

/** Details for whichever node is selected. Where the raw scope id finally shows up. */
function Inspector({
  node,
  group,
  onClose,
}: {
  readonly node: BuilderNode;
  readonly group?: BuilderGroup;
  readonly onClose: () => void;
}) {
  const { data } = node;
  const scopes = data.scopes ?? [];

  return (
    <aside
      className={cn(
        "flex w-60 shrink-0 flex-col overflow-hidden border-l bg-transparent",
        HAIRLINE,
      )}
    >
      <div className={cn("flex items-center gap-1 border-b px-3 py-2", HAIRLINE)}>
        <span className={cn("flex-1", MICRO, "text-black")}>Details</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className="grid size-6 place-items-center rounded-lg text-black transition-colors hover:bg-black/[0.06]"
        >
          <X size={13} />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-3 py-3">
        <div>
          <p className={cn(MICRO, INK_FAINT)}>Name</p>
          <p className="text-[12.5px] text-black">{data.label}</p>
        </div>

        {group && (
          <div>
            <p className={cn(MICRO, INK_FAINT)}>
              {group.kind === "team" ? "Team" : "Connected agents"}
            </p>
            <p className={cn("text-[12px]", INK_SOFT)}>
              {group.name}
              {group.kind === "team" && group.leadNodeId === node.id && " — leads"}
            </p>
            {group.kind === "peers" && (
              <p className={cn("mt-0.5 text-[11px] leading-relaxed", INK_FAINT)}>
                These agents pass messages to each other. Running them together isn&apos;t
                supported yet.
              </p>
            )}
          </div>
        )}

        {data.description && (
          <div>
            <p className={cn(MICRO, INK_FAINT)}>What it does</p>
            <p className={cn("text-[12px] leading-relaxed", INK_SOFT)}>{data.description}</p>
          </div>
        )}

        {data.model && (
          <div>
            <p className={cn(MICRO, INK_FAINT)}>Model</p>
            <p className={cn("break-words text-[12px]", INK_SOFT)}>{data.model}</p>
          </div>
        )}

        {data.scopeId && (
          <div>
            <p className={cn(MICRO, INK_FAINT)}>Permission id</p>
            <p className={cn("break-words font-mono text-[11px]", INK_SOFT)}>{data.scopeId}</p>
          </div>
        )}

        {scopes.length > 0 && (
          <div>
            <p className={cn(MICRO, INK_FAINT)}>Can already use</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {scopes.map((scope) => (
                <span
                  key={scope}
                  className={cn("rounded-full border px-1.5 py-0.5 text-[10px]", HAIRLINE, INK_SOFT)}
                >
                  {scope}
                </span>
              ))}
            </div>
            <p className={cn("mt-1.5 text-[10.5px] leading-relaxed", INK_FAINT)}>
              Connecting tools here doesn&apos;t change the agent&apos;s real permissions.
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}

export interface VisualBuilderViewProps {
  readonly routePrefix: string;
  readonly canvasId: string;
}

interface PendingGroup {
  memberIds: string[];
  edgeId: string;
  /** The connection's target — the agent that would become the helper. */
  targetNodeId: string;
}

function VisualBuilderWorkspace({ routePrefix, canvasId }: VisualBuilderViewProps) {
  const { session } = useSession();
  const isOrg = routePrefix === "/organization";
  const orgId = isOrg ? (session?.organization.id ?? null) : null;
  const { screenToFlowPosition } = useReactFlow();

  const [agents, setAgents] = useState<AgentDTO[]>([]);
  const [scopes, setScopes] = useState<ScopeCatalogEntry[]>([]);
  const [canvas, setCanvas] = useState<BuilderCanvasDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [nodes, setNodes] = useState<BuilderNode[]>([]);
  const [edges, setEdges] = useState<BuilderEdge[]>([]);
  const [groups, setGroups] = useState<BuilderGroup[]>([]);
  const [viewport, setViewport] = useState<Viewport | undefined>(undefined);

  const [paletteCollapsed, setPaletteCollapsed] = useState(false);
  const [createAgentOpen, setCreateAgentOpen] = useState(false);
  const [pendingGroup, setPendingGroup] = useState<PendingGroup | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [applyOpen, setApplyOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  /** Guards the autosave against firing for the state that hydration just installed. */
  const hydrated = useRef(false);

  // Every setState lands after an await, keeping the effect body free of synchronous state
  // updates (see the react-hooks/set-state-in-effect rule).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [agentList, scopeList, loaded] = await Promise.all([
          listAgents(orgId),
          fetchScopeCatalog(orgId),
          getCanvas(canvasId),
        ]);
        if (cancelled) return;

        const liveAgents = agentList ?? [];
        const liveScopes = scopeList ?? [];
        const graph = loaded.graph ?? EMPTY_GRAPH;
        const restored = fromGraph(graph, liveAgents, liveScopes);

        setAgents(liveAgents);
        setScopes(liveScopes);
        setCanvas(loaded);
        setNodes(restored.nodes);
        setEdges(restored.edges);
        setGroups(restored.groups);
        setViewport(graph.viewport);
        hydrated.current = true;
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : "Couldn't open that canvas.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canvasId, orgId]);

  // ── Autosave ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!hydrated.current) return;
    let cancelled = false;

    const timer = window.setTimeout(() => {
      void (async () => {
        setSaveState("saving");
        try {
          await updateCanvas(canvasId, { graph: toGraph(nodes, edges, groups, viewport) });
          if (!cancelled) setSaveState("saved");
        } catch {
          if (!cancelled) setSaveState("error");
        }
      })();
    }, AUTOSAVE_DELAY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [canvasId, nodes, edges, groups, viewport]);

  // ── Graph editing ──────────────────────────────────────────────────────────
  const onNodesChange = useCallback(
    (changes: NodeChange<BuilderNode>[]) =>
      setNodes((current) => applyNodeChanges(changes, current)),
    [],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<BuilderEdge>[]) =>
      setEdges((current) => applyEdgeChanges(changes, current)),
    [],
  );

  const onDropNode = useCallback((node: BuilderNode) => {
    setNodes((current) => [...current, node]);
  }, []);

  const onClear = useCallback(() => {
    setNodes([]);
    setEdges([]);
    setGroups([]);
  }, []);

  /**
   * A new agent→agent edge can turn loose agents into a working group. Ask once, the first
   * time a component reaches two members with no group of its own — a tool edge never
   * triggers this, because sharing a tool doesn't make two agents colleagues.
   */
  const onConnectEdge = useCallback(
    (connection: Connection, kind: BuilderEdgeKind) => {
      const edgeId = `e-${connection.source}-${connection.target}-${Date.now()}`;
      setEdges((current) => {
        const next = addEdge({ ...connection, id: edgeId, data: { kind } }, current);
        if (kind !== "flow") return next;

        setNodes((currentNodes) => {
          const members = connectedAgentIds(connection.source!, currentNodes, next);
          const alreadyGrouped = currentNodes.some(
            (node) => members.includes(node.id) && node.data.groupId,
          );
          if (members.length >= 2 && !alreadyGrouped) {
            setPendingGroup({ memberIds: members, edgeId, targetNodeId: connection.target! });
          }
          return currentNodes;
        });
        return next;
      });
    },
    [],
  );

  const resolvePendingGroup = useCallback(
    (choice: TeamChoice) => {
      if (!pendingGroup) return;

      // "Helper" is not a group at all — it is a capability grant, so the edge is rewired from
      // the pipeline port to the target's tools port and no group is recorded.
      if (choice.kind === "helper") {
        setEdges((current) =>
          current.map((edge) =>
            edge.id === pendingGroup.edgeId
              ? { ...edge, targetHandle: HANDLE.tools, data: { kind: "helper" } }
              : edge,
          ),
        );
        setPendingGroup(null);
        return;
      }

      const group: BuilderGroup = {
        id: `group-${Date.now()}`,
        kind: "team",
        name: choice.name,
        nodeIds: pendingGroup.memberIds,
        leadNodeId: defaultLeadNodeId(pendingGroup.memberIds, edges),
      };
      setGroups((current) => [...current, group]);
      setNodes((current) =>
        current.map((node) =>
          group.nodeIds.includes(node.id)
            ? { ...node, data: { ...node.data, groupId: group.id, groupKind: group.kind } }
            : node,
        ),
      );
      setPendingGroup(null);
    },
    [pendingGroup, edges],
  );

  const cancelPendingGroup = useCallback(() => {
    if (!pendingGroup) return;
    setEdges((current) => current.filter((edge) => edge.id !== pendingGroup.edgeId));
    setPendingGroup(null);
  }, [pendingGroup]);

  /** New agents land at the middle of what the user is currently looking at. */
  const handleAgentCreated = useCallback(
    (agent: AgentDTO) => {
      setAgents((current) => [agent, ...current]);
      const centre = screenToFlowPosition({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      });
      setNodes((current) => [
        ...current,
        {
          id: `agent-${agent.id}-${Date.now()}`,
          type: "agent",
          position: centre,
          data: agentNodeData(agent),
        },
      ]);
      setCreateAgentOpen(false);
    },
    [screenToFlowPosition],
  );

  const selectedNode = nodes.find((node) => node.selected) ?? null;
  const selectedGroup = selectedNode?.data.groupId
    ? groups.find((group) => group.id === selectedNode.data.groupId)
    : undefined;

  const deselect = useCallback(() => {
    setNodes((current) =>
      current.map((node) => (node.selected ? { ...node, selected: false } : node)),
    );
  }, []);

  /**
   * What Apply would change: for each agent on the canvas, the scopes the drawing implies that
   * the agent does not already hold. Purely additive — the canvas never revokes, because a
   * partial drawing is not a statement that everything absent should be taken away.
   */
  const pendingGrants = useMemo(() => {
    const implied = impliedGrants(nodes, edges);
    const agentById = new Map(agents.map((agent) => [agent.id, agent]));
    const rows: Array<{ agentId: string; agentName: string; scopes: string[] }> = [];

    for (const [agentId, scopes] of implied) {
      const agent = agentById.get(agentId);
      if (!agent) continue;
      const held = new Set<string>(agent.permissionScopes);
      const missing = [...scopes].filter((scope) => !held.has(scope));
      if (missing.length > 0) {
        rows.push({ agentId, agentName: agent.name, scopes: missing.sort() });
      }
    }
    return rows;
  }, [nodes, edges, agents]);

  const applyGrants = useCallback(async () => {
    setApplying(true);
    setApplyError(null);
    try {
      const agentById = new Map(agents.map((agent) => [agent.id, agent]));
      for (const row of pendingGrants) {
        const agent = agentById.get(row.agentId);
        if (!agent) continue;
        const next = [...new Set([...agent.permissionScopes, ...row.scopes])];
        const result = await updateAgentScopes(row.agentId, next);
        if (!result.ok) throw new Error(result.error);
        setAgents((current) =>
          current.map((a) => (a.id === row.agentId ? result.agent : a)),
        );
      }
      setApplyOpen(false);
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : "Couldn't apply the changes");
    } finally {
      setApplying(false);
    }
  }, [agents, pendingGrants]);

  const saveLabel = useMemo(() => {
    if (saveState === "saving") return "Saving…";
    if (saveState === "saved") return "Saved";
    if (saveState === "error") return "Couldn't save";
    return "";
  }, [saveState]);

  const agentCount = nodes.filter(isAgentNode).length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SketchPageHeader
        title={canvas?.name ?? "Visual Builder"}
        actions={
          <div className="flex items-center gap-3">
            {pendingGrants.length > 0 && (
              <button
                type="button"
                onClick={() => setApplyOpen(true)}
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-[11px] text-black transition-colors hover:bg-black/[0.05]",
                  HAIRLINE,
                )}
              >
                Apply {pendingGrants.reduce((n, r) => n + r.scopes.length, 0)} change
                {pendingGrants.reduce((n, r) => n + r.scopes.length, 0) === 1 ? "" : "s"}
              </button>
            )}
            {loadError ? (
              <span className={sketchLabel}>{loadError}</span>
            ) : (
              saveLabel && (
                <span
                  className={cn(
                    MICRO,
                    saveState === "error" ? "text-[color:var(--sketch-red)]" : INK_FAINT,
                  )}
                >
                  {saveLabel}
                </span>
              )
            )}
            <Link
              href={`${routePrefix}/visual-builder`}
              className={cn("inline-flex items-center gap-1 text-[11px]", INK_SOFT)}
            >
              <ArrowLeft size={12} />
              All canvases
            </Link>
          </div>
        }
      />

      <div
        className={cn(
          "flex min-h-0 flex-1 overflow-hidden border-y bg-transparent",
          HAIRLINE,
        )}
      >
        <PaletteSidebar
          agents={agents}
          scopes={scopes}
          loading={loading}
          collapsed={paletteCollapsed}
          onToggleCollapsed={() => setPaletteCollapsed((collapsed) => !collapsed)}
          onCreateAgent={() => setCreateAgentOpen(true)}
        />

        <BuilderCanvas
          nodes={nodes}
          edges={edges}
          groups={groups}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnectEdge={onConnectEdge}
          onDropNode={onDropNode}
          onClear={onClear}
          onViewportChange={setViewport}
          initialViewport={viewport}
          overlay={
            pendingGroup ? (
              <div className="absolute left-1/2 top-6 z-20 -translate-x-1/2">
                <TeamChoicePopup
                  memberCount={pendingGroup.memberIds.length}
                  defaultName={`Team ${groups.length + 1}`}
                  helperName={
                    nodes.find((node) => node.id === pendingGroup.targetNodeId)?.data.label ??
                    "that agent"
                  }
                  onChoose={resolvePendingGroup}
                  onCancel={cancelPendingGroup}
                />
              </div>
            ) : null
          }
        />

        {selectedNode && (
          <Inspector node={selectedNode} group={selectedGroup} onClose={deselect} />
        )}
      </div>

      {applyOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/20 p-6">
          <div
            role="dialog"
            aria-label="Apply canvas changes"
            className={cn(
              "w-full max-w-sm rounded-2xl border bg-[#E2F0CC]/95 p-4 shadow-[0_20px_50px_-20px_rgba(16,14,22,0.55)] backdrop-blur-md",
              HAIRLINE,
            )}
          >
            <p className={cn(MICRO, "text-black")}>Apply to your agents</p>
            <p className={cn("mt-1 text-[12px] leading-relaxed", INK_SOFT)}>
              These permissions will be added. Nothing is removed, and nothing changes until you
              confirm.
            </p>

            <div className="mt-3 max-h-56 space-y-2 overflow-y-auto">
              {pendingGrants.map((row) => (
                <div key={row.agentId}>
                  <p className="text-[12px] font-medium text-black">{row.agentName}</p>
                  <div className="mt-0.5 flex flex-wrap gap-1">
                    {row.scopes.map((scope) => (
                      <span
                        key={scope}
                        className={cn(
                          "rounded-full border px-1.5 py-0.5 text-[10px]",
                          HAIRLINE,
                          INK_SOFT,
                        )}
                      >
                        {scope.startsWith("agent.ask.") ? "may ask a colleague" : scope}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {applyError && (
              <p className="mt-2 text-[11px] text-[color:var(--sketch-red)]">{applyError}</p>
            )}

            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setApplyOpen(false)}
                disabled={applying}
                className={cn("rounded-full px-3 py-1 text-[11px]", INK_SOFT)}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void applyGrants()}
                disabled={applying}
                className="rounded-full bg-black px-3 py-1 text-[11px] text-white transition-colors hover:bg-[color:var(--sketch-purple)] disabled:opacity-40"
              >
                {applying ? "Applying…" : "Apply"}
              </button>
            </div>
          </div>
        </div>
      )}

      {createAgentOpen && (
        <CreateAgentModal
          open={createAgentOpen}
          orgId={orgId}
          // Team members must be cloud or hybrid — see assertCloudAgentInOrg on the backend.
          cloudOnly={agentCount > 0}
          onClose={() => setCreateAgentOpen(false)}
          onCreated={handleAgentCreated}
        />
      )}
    </div>
  );
}

export function VisualBuilderView(props: VisualBuilderViewProps) {
  // `useReactFlow` (used for screen→flow projection) needs this provider above it, so the
  // whole workspace is wrapped rather than the canvas alone.
  return (
    <ReactFlowProvider>
      <VisualBuilderWorkspace {...props} />
    </ReactFlowProvider>
  );
}
