import type { TeamRunEventDTO } from "@/lib/teams-api";

export type LiveArtifactFormat =
  | "xlsx"
  | "csv"
  | "json"
  | "pdf"
  | "pptx"
  | "md"
  | "html";

export type LiveArtifactPreviewKind =
  | "table"
  | "pdf"
  | "office"
  | "html"
  | "markdown"
  | "download";

export type LiveSheetRow = Record<string, string | null>;

/** @deprecated alias */
export type LiveSheetPreview = LiveArtifactPreview;

export type LiveArtifactPreview = {
  artifactId: string;
  fileName: string;
  url: string;
  format: LiveArtifactFormat;
  previewKind: LiveArtifactPreviewKind;
  columns: string[];
  rows: LiveSheetRow[];
  rowCount: number;
  updatedAt?: string;
};

const TABULAR: LiveArtifactFormat[] = ["xlsx", "csv", "json"];

function inferFormatFromFileName(fileName: string): LiveArtifactFormat {
  const ext = fileName.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "pdf":
      return "pdf";
    case "pptx":
    case "ppt":
      return "pptx";
    case "csv":
      return "csv";
    case "json":
      return "json";
    case "md":
      return "md";
    case "html":
      return "html";
    default:
      return "xlsx";
  }
}

function previewKindForFormat(format: LiveArtifactFormat): LiveArtifactPreviewKind {
  if (TABULAR.includes(format)) return "table";
  if (format === "pdf") return "pdf";
  if (format === "pptx") return "office";
  if (format === "html") return "html";
  if (format === "md") return "markdown";
  return "download";
}

function parseLiveArtifactPayload(raw: Record<string, unknown>): LiveArtifactPreview | null {
  const artifactId = typeof raw.artifactId === "string" ? raw.artifactId : "";
  const url = typeof raw.url === "string" ? raw.url : "";
  const fileName =
    typeof raw.fileName === "string" && raw.fileName.trim()
      ? raw.fileName.trim()
      : "Live document";
  const format =
    typeof raw.format === "string"
      ? (raw.format as LiveArtifactFormat)
      : inferFormatFromFileName(fileName);
  const previewKind =
    typeof raw.previewKind === "string"
      ? (raw.previewKind as LiveArtifactPreviewKind)
      : previewKindForFormat(format);
  const columns = Array.isArray(raw.columns)
    ? raw.columns.filter((column): column is string => typeof column === "string")
    : [];
  const rows = Array.isArray(raw.rows)
    ? raw.rows.filter(
        (row): row is LiveSheetRow => typeof row === "object" && row !== null && !Array.isArray(row),
      )
    : [];
  const rowCount = Number.isFinite(Number(raw.rowCount)) ? Number(raw.rowCount) : rows.length;
  if (!artifactId && !url) return null;

  const tabular = TABULAR.includes(format);
  if (tabular && columns.length === 0 && rows.length === 0 && rowCount === 0) {
    return null;
  }
  if (!tabular && !url) return null;

  return {
    artifactId: artifactId || url,
    fileName,
    url,
    format,
    previewKind,
    columns,
    rows,
    rowCount,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : undefined,
  };
}

export function liveArtifactFromCheckpoint(checkpoint: unknown): LiveArtifactPreview | null {
  if (!checkpoint || typeof checkpoint !== "object") return null;
  const liveArtifacts = (checkpoint as Record<string, unknown>).liveArtifacts;
  if (!Array.isArray(liveArtifacts) || liveArtifacts.length === 0) return null;
  return parseLiveArtifactPayload(liveArtifacts[0] as Record<string, unknown>);
}

/** @deprecated */
export const liveSheetFromCheckpoint = liveArtifactFromCheckpoint;

export function liveArtifactFromEventPayload(
  eventType: string,
  payload: unknown,
): LiveArtifactPreview | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;

  if (eventType === "live_artifact_updated") {
    return parseLiveArtifactPayload(p);
  }

  if (eventType === "wait_armed") {
    const liveArtifacts = p.liveArtifacts;
    if (Array.isArray(liveArtifacts) && liveArtifacts.length > 0) {
      return parseLiveArtifactPayload(liveArtifacts[0] as Record<string, unknown>);
    }
  }

  if (eventType === "artifact_produced") {
    const artifact = p.artifact as Record<string, unknown> | undefined;
    const content = artifact?.content as Record<string, unknown> | undefined;
    if (content?.url) {
      return parseLiveArtifactPayload({
        artifactId: artifact?.id,
        fileName: artifact?.name,
        url: content.url,
        format: content.format,
        columns: content.columns,
        rows: content.rows,
        rowCount: content.rowCount,
        updatedAt: content.updatedAt,
      });
    }
  }

  return null;
}

/** @deprecated */
export const liveSheetFromEventPayload = liveArtifactFromEventPayload;

export function liveArtifactFromEvent(event: TeamRunEventDTO): LiveArtifactPreview | null {
  return liveArtifactFromEventPayload(event.eventType, event.payload);
}

export function replayLiveArtifactFromEvents(events: TeamRunEventDTO[]): LiveArtifactPreview | null {
  let artifact: LiveArtifactPreview | null = null;
  for (const event of events) {
    const next = liveArtifactFromEvent(event);
    if (next) artifact = next;
  }
  return artifact;
}

/** @deprecated */
export const replayLiveSheetFromEvents = replayLiveArtifactFromEvents;

export function mergeLiveArtifact(
  prev: LiveArtifactPreview | null,
  next: LiveArtifactPreview,
): LiveArtifactPreview {
  return {
    ...next,
    artifactId: next.artifactId || prev?.artifactId || next.url,
    fileName: next.fileName || prev?.fileName || "Live document",
    url: next.url || prev?.url || "",
    format: next.format || prev?.format || "xlsx",
    previewKind: next.previewKind || prev?.previewKind || previewKindForFormat(next.format),
  };
}

/** @deprecated */
export const mergeLiveSheet = mergeLiveArtifact;
