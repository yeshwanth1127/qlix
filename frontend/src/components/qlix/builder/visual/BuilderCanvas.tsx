"use client";

import { useCallback, useMemo, useRef, type DragEvent } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  Panel,
  ReactFlow,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type OnConnect,
  type Viewport,
} from "@xyflow/react";
import { MousePointerSquareDashed, Trash2 } from "lucide-react";
import type { BuilderGroup } from "@/lib/builder-api";
import { cn } from "@/lib/utils/cn";
import { AgentNode } from "./nodes/AgentNode";
import { ToolNode } from "./nodes/ToolNode";
import {
  connectionKind,
  isAgentNode,
  isValidBuilderConnection,
  readDragPayload,
  type BuilderEdge,
  type BuilderEdgeKind,
  type BuilderNode,
} from "./builderTypes";

const HAIRLINE = "border-[color:var(--ink-border)]";
const INK_SOFT = "text-[color:var(--ink-soft)]";
const INK_FAINT = "text-[color:var(--ink-faint)]";
const MICRO = "text-[10px] font-medium uppercase tracking-[0.16em]";

/** Defined once at module scope — React Flow warns when these identities change. */
const NODE_TYPES = {
  supervisor: AgentNode,
  agent: AgentNode,
  tool: ToolNode,
};

/** Agent→agent: directional work handoff, so it keeps the arrowhead. */
const FLOW_EDGE = {
  type: "smoothstep",
  markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
};

/** Tool→agent: a grant, not a handoff. Dashed and unarrowed so it reads differently. */
const TOOL_EDGE = {
  type: "smoothstep",
  style: { strokeDasharray: "4 3", strokeWidth: 1 },
};

/**
 * Agent→agent as a capability. Dashed like a tool grant (because that is what it is) but
 * arrowed, since work does travel along it when the colleague is asked.
 */
const HELPER_EDGE = {
  type: "smoothstep",
  style: { strokeDasharray: "6 3", strokeWidth: 1.25 },
  markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 },
};

const EDGE_STYLE: Record<BuilderEdgeKind, Record<string, unknown>> = {
  flow: FLOW_EDGE,
  tool: TOOL_EDGE,
  helper: HELPER_EDGE,
};

export interface BuilderCanvasProps {
  readonly nodes: BuilderNode[];
  readonly edges: BuilderEdge[];
  readonly groups: BuilderGroup[];
  readonly onNodesChange: (changes: NodeChange<BuilderNode>[]) => void;
  readonly onEdgesChange: (changes: EdgeChange<BuilderEdge>[]) => void;
  readonly onConnectEdge: (connection: Connection, kind: BuilderEdgeKind) => void;
  readonly onDropNode: (node: BuilderNode) => void;
  readonly onClear: () => void;
  readonly onViewportChange: (viewport: Viewport) => void;
  readonly initialViewport?: Viewport;
  /** Rendered over the canvas — the team/peers prompt, anchored by the parent. */
  readonly overlay?: React.ReactNode;
}

export function BuilderCanvas({
  nodes,
  edges,
  groups,
  onNodesChange,
  onEdgesChange,
  onConnectEdge,
  onDropNode,
  onClear,
  onViewportChange,
  initialViewport,
  overlay,
}: BuilderCanvasProps) {
  const { screenToFlowPosition } = useReactFlow();
  const nodeSeq = useRef(0);

  const onConnect = useCallback<OnConnect>(
    (connection: Connection) => {
      const kind = connectionKind(connection);
      if (kind) onConnectEdge(connection, kind);
    },
    [onConnectEdge],
  );

  const onDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const payload = readDragPayload(event.dataTransfer);
      if (!payload) return;

      // Drop where the pointer is, not where the node data says — the canvas can be panned
      // and zoomed, so screen coords have to be projected into flow space.
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      nodeSeq.current += 1;

      onDropNode({
        id: `${payload.kind}-${Date.now()}-${nodeSeq.current}`,
        type: payload.kind,
        position,
        data: payload.data,
      });
    },
    [onDropNode, screenToFlowPosition],
  );

  const styledEdges = useMemo(
    () =>
      edges.map((edge) => ({
        ...edge,
        ...(EDGE_STYLE[(edge.data?.kind as BuilderEdgeKind) ?? "flow"] ?? FLOW_EDGE),
      })),
    [edges],
  );

  const isEmpty = nodes.length === 0;

  const stats = useMemo(() => {
    const agents = nodes.filter(isAgentNode).length;
    const tools = nodes.length - agents;
    return { agents, tools, teams: groups.filter((group) => group.kind === "team").length };
  }, [nodes, groups]);

  return (
    <div
      className="qlix-builder relative min-h-0 min-w-0 flex-1"
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <ReactFlow
        nodes={nodes}
        edges={styledEdges}
        nodeTypes={NODE_TYPES}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={(connection) => isValidBuilderConnection(connection)}
        onMoveEnd={(_, viewport) => onViewportChange(viewport)}
        defaultViewport={initialViewport}
        fitView={!initialViewport && !isEmpty}
        minZoom={0.2}
        maxZoom={1.75}
        deleteKeyCode={["Backspace", "Delete"]}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="var(--ink-border)" />
        <Controls showInteractive={false} position="bottom-right" />

        {!isEmpty && (
          <Panel position="top-right">
            <div
              className={cn(
                "flex items-center gap-2 rounded-full border bg-white/70 px-3 py-1 backdrop-blur-sm",
                HAIRLINE,
              )}
            >
              <span className={cn(MICRO, INK_SOFT)}>
                {stats.agents} {stats.agents === 1 ? "agent" : "agents"} · {stats.tools}{" "}
                {stats.tools === 1 ? "tool" : "tools"}
                {stats.teams > 0 && ` · ${stats.teams} ${stats.teams === 1 ? "team" : "teams"}`}
              </span>
              <button
                type="button"
                onClick={onClear}
                title="Clear the canvas"
                className="grid size-5 place-items-center rounded-full text-black transition-colors hover:bg-black/[0.06]"
              >
                <Trash2 size={11} />
              </button>
            </div>
          </Panel>
        )}
      </ReactFlow>

      {isEmpty && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center px-6">
          <div className="flex max-w-xs flex-col items-center gap-2 text-center">
            <MousePointerSquareDashed size={20} className={INK_FAINT} aria-hidden />
            <p className="text-[13px] font-medium text-black">Start with an empty canvas</p>
            <p className={cn("text-[12px] leading-relaxed", INK_SOFT)}>
              Drag an agent from the library on the left, then drag the tools it should be
              allowed to use onto its Tools port.
            </p>
          </div>
        </div>
      )}

      {overlay}
    </div>
  );
}
