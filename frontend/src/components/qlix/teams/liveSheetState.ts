import type { TeamRunEventDTO } from "@/lib/teams-api";

export type LiveSheetRow = Record<string, string | null>;

export type LiveSheetPreview = {
  artifactId: string;
  fileName: string;
  url: string;
  columns: string[];
  rows: LiveSheetRow[];
  rowCount: number;
  updatedAt?: string;
};

function parseLiveSheetPayload(raw: Record<string, unknown>): LiveSheetPreview | null {
  const artifactId = typeof raw.artifactId === "string" ? raw.artifactId : "";
  const url = typeof raw.url === "string" ? raw.url : "";
  const fileName =
    typeof raw.fileName === "string" && raw.fileName.trim()
      ? raw.fileName.trim()
      : "Live sheet.xlsx";
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
  if (columns.length === 0 && rows.length === 0) return null;

  return {
    artifactId: artifactId || url,
    fileName,
    url,
    columns,
    rows,
    rowCount,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : undefined,
  };
}

export function liveSheetFromCheckpoint(checkpoint: unknown): LiveSheetPreview | null {
  if (!checkpoint || typeof checkpoint !== "object") return null;
  const liveArtifacts = (checkpoint as Record<string, unknown>).liveArtifacts;
  if (!Array.isArray(liveArtifacts) || liveArtifacts.length === 0) return null;
  return parseLiveSheetPayload(liveArtifacts[0] as Record<string, unknown>);
}

export function liveSheetFromEventPayload(
  eventType: string,
  payload: unknown,
): LiveSheetPreview | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;

  if (eventType === "live_artifact_updated") {
    return parseLiveSheetPayload(p);
  }

  if (eventType === "wait_armed") {
    const liveArtifacts = p.liveArtifacts;
    if (Array.isArray(liveArtifacts) && liveArtifacts.length > 0) {
      return parseLiveSheetPayload(liveArtifacts[0] as Record<string, unknown>);
    }
  }

  if (eventType === "artifact_produced") {
    const artifact = p.artifact as Record<string, unknown> | undefined;
    const content = artifact?.content as Record<string, unknown> | undefined;
    if (content?.columns && (content.rows || content.rowCount != null)) {
      return parseLiveSheetPayload({
        artifactId: artifact?.id,
        fileName: artifact?.name,
        url: content.url,
        columns: content.columns,
        rows: content.rows,
        rowCount: content.rowCount,
        updatedAt: content.updatedAt,
      });
    }
  }

  return null;
}

export function liveSheetFromEvent(event: TeamRunEventDTO): LiveSheetPreview | null {
  return liveSheetFromEventPayload(event.eventType, event.payload);
}

/** Replay stored events to reconstruct the latest live sheet snapshot. */
export function replayLiveSheetFromEvents(events: TeamRunEventDTO[]): LiveSheetPreview | null {
  let sheet: LiveSheetPreview | null = null;
  for (const event of events) {
    const next = liveSheetFromEvent(event);
    if (next) sheet = next;
  }
  return sheet;
}

export function mergeLiveSheet(
  prev: LiveSheetPreview | null,
  next: LiveSheetPreview,
): LiveSheetPreview {
  return {
    ...next,
    artifactId: next.artifactId || prev?.artifactId || next.url,
    fileName: next.fileName || prev?.fileName || "Live sheet.xlsx",
    url: next.url || prev?.url || "",
  };
}
