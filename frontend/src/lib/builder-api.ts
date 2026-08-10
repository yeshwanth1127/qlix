import type { ApiErrorBody } from "./auth-api";

const defaultBase = "http://localhost:4000";

function apiBase(): string {
  return (process.env.NEXT_PUBLIC_API_BASE_URL ?? defaultBase).replace(/\/$/, "");
}

/**
 * Saved Visual Builder canvases.
 *
 * A canvas is a draft. Saving one never creates agents, grants scopes, or assembles a team —
 * it only records what was drawn.
 */

/** Bump when the persisted graph shape changes in a way old readers can't handle. */
export const BUILDER_GRAPH_VERSION = 1;

export type BuilderGroupKind = "team" | "peers";

export interface BuilderGroup {
  id: string;
  kind: BuilderGroupKind;
  name: string;
  nodeIds: string[];
  /** Team groups only: which node leads and hands out the steps. */
  leadNodeId?: string;
}

/**
 * Persisted node. Deliberately a *reference*, not a snapshot: only `agentId` / `scopeId` and
 * geometry are stored, and display data is re-hydrated from live agents and the scope catalog
 * on load. Snapshotting labels would leave the canvas describing agents that have since been
 * renamed, re-scoped, or deleted.
 */
export interface BuilderGraphNode {
  id: string;
  type: "supervisor" | "agent" | "tool";
  position: { x: number; y: number };
  agentId?: string;
  scopeId?: string;
  /** Free-text label for nodes with no backing record yet (e.g. a placeholder team lead). */
  label?: string;
}

export interface BuilderGraphEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  kind: "flow" | "tool";
}

export interface BuilderGraph {
  version: number;
  nodes: BuilderGraphNode[];
  edges: BuilderGraphEdge[];
  groups: BuilderGroup[];
  viewport?: { x: number; y: number; zoom: number };
}

export interface BuilderCanvasSummary {
  id: string;
  name: string;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface BuilderCanvasDTO extends BuilderCanvasSummary {
  graph: BuilderGraph;
}

export const EMPTY_GRAPH: BuilderGraph = {
  version: BUILDER_GRAPH_VERSION,
  nodes: [],
  edges: [],
  groups: [],
};

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
  return body?.error?.message ?? fallback;
}

export async function listCanvases(): Promise<BuilderCanvasSummary[]> {
  const res = await fetch(`${apiBase()}/api/v1/builder/canvases`, { credentials: "include" });
  if (!res.ok) throw new Error(await errorMessage(res, "Couldn't load your canvases"));
  const body = (await res.json()) as { canvases: BuilderCanvasSummary[] };
  return body.canvases ?? [];
}

export async function createCanvas(name: string): Promise<BuilderCanvasDTO> {
  const res = await fetch(`${apiBase()}/api/v1/builder/canvases`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(await errorMessage(res, "Couldn't create the canvas"));
  const body = (await res.json()) as { canvas: BuilderCanvasDTO };
  return body.canvas;
}

export async function getCanvas(id: string): Promise<BuilderCanvasDTO> {
  const res = await fetch(`${apiBase()}/api/v1/builder/canvases/${encodeURIComponent(id)}`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(await errorMessage(res, "Couldn't open that canvas"));
  const body = (await res.json()) as { canvas: BuilderCanvasDTO };
  return body.canvas;
}

export async function updateCanvas(
  id: string,
  patch: { name?: string; graph?: BuilderGraph },
): Promise<BuilderCanvasDTO> {
  const res = await fetch(`${apiBase()}/api/v1/builder/canvases/${encodeURIComponent(id)}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(await errorMessage(res, "Couldn't save the canvas"));
  const body = (await res.json()) as { canvas: BuilderCanvasDTO };
  return body.canvas;
}

export async function deleteCanvas(id: string): Promise<void> {
  const res = await fetch(`${apiBase()}/api/v1/builder/canvases/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) throw new Error(await errorMessage(res, "Couldn't delete the canvas"));
}
