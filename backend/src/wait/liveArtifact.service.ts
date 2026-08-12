import { Buffer } from 'node:buffer';
import * as XLSX from 'xlsx';
import { replaceSandboxFile, storeSandboxFile } from '../sandbox/sandboxClient.js';
import { jidLocalPart } from '../whatsapp/whatsappAutoReply.service.js';
import type {
  LiveArtifactFormat,
  LiveArtifactRow,
  LiveArtifactState,
  WaitSideEffect,
} from './waitPolicy.types.js';

function slugify(text: string): string {
  return text.replace(/[^\w.\-]+/g, '_').slice(0, 60) || 'artifact';
}

function defaultColumns(): string[] {
  return ['Name', 'Phone', 'JID', 'Reply', 'Interest', 'Replied at'];
}

export function defaultFileName(title: string | undefined, format: LiveArtifactFormat): string {
  const base = slugify(title ?? 'live-artifact');
  if (format === 'json') return `${base}.json`;
  if (format === 'csv') return `${base}.csv`;
  return `${base}.xlsx`;
}

function rowsToAoA(columns: string[], rows: LiveArtifactRow[]): unknown[][] {
  return [columns, ...rows.map((row) => columns.map((col) => row[col] ?? ''))];
}

export function materializeArtifactBytes(
  format: LiveArtifactFormat,
  columns: string[],
  rows: LiveArtifactRow[],
): { bytes: Buffer; contentType: string } {
  const table = rowsToAoA(columns, rows);
  if (format === 'json') {
    const objects = rows.map((row) => {
      const obj: Record<string, string | null> = {};
      for (const col of columns) obj[col] = row[col] ?? null;
      return obj;
    });
    return {
      bytes: Buffer.from(JSON.stringify(objects, null, 2), 'utf8'),
      contentType: 'application/json',
    };
  }
  if (format === 'csv') {
    const lines = table.map((row) =>
      row
        .map((cell) => {
          const text = String(cell ?? '');
          if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
          return text;
        })
        .join(','),
    );
    return { bytes: Buffer.from(lines.join('\n'), 'utf8'), contentType: 'text/csv' };
  }

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(table);
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const bytes = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  return {
    bytes,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
}

export async function createLiveArtifact(input: {
  sideEffect: WaitSideEffect;
  runId: string;
  teamName?: string;
}): Promise<LiveArtifactState> {
  const columns = input.sideEffect.columns?.length
    ? input.sideEffect.columns
    : defaultColumns();
  const format = input.sideEffect.format;
  const fileName = defaultFileName(
    input.sideEffect.title ?? input.teamName ?? `run-${input.runId.slice(0, 8)}`,
    format,
  );
  const { bytes, contentType } = materializeArtifactBytes(format, columns, []);
  const stored = await storeSandboxFile(bytes, fileName, contentType);
  const now = new Date().toISOString();
  return {
    id: `live_artifact_${input.sideEffect.id}`,
    sideEffectId: input.sideEffect.id,
    sandboxId: stored.id,
    url: stored.url,
    fileName,
    format,
    columns,
    rows: [],
    rowCount: 0,
    updatedAt: now,
  };
}

export function buildWhatsAppReplyRow(input: {
  columns: string[];
  jid: string;
  text: string;
  pushName?: string | null;
  interest: string;
  repliedAt?: string;
}): LiveArtifactRow {
  const phone = jidLocalPart(input.jid);
  const repliedAt = input.repliedAt ?? new Date().toISOString();
  const values: Record<string, string | null> = {
    Name: input.pushName?.trim() || null,
    Phone: phone || null,
    JID: input.jid,
    Reply: input.text,
    Interest: input.interest,
    'Replied at': repliedAt,
  };
  const row: LiveArtifactRow = {};
  for (const col of input.columns) {
    row[col] = values[col] ?? null;
  }
  return row;
}

export function isDuplicateRow(
  artifact: LiveArtifactState,
  row: LiveArtifactRow,
  dedupeBy: WaitSideEffect['dedupeBy'],
): boolean {
  if (dedupeBy !== 'contact_jid') return false;
  const jid = row.JID ?? row.jid ?? null;
  if (!jid) return false;
  return artifact.rows.some((existing) => (existing.JID ?? existing.jid) === jid);
}

export async function appendLiveArtifactRow(input: {
  artifact: LiveArtifactState;
  sideEffect: WaitSideEffect;
  row: LiveArtifactRow;
}): Promise<LiveArtifactState> {
  if (isDuplicateRow(input.artifact, input.row, input.sideEffect.dedupeBy)) {
    return input.artifact;
  }

  const rows = [...input.artifact.rows, input.row];
  const { bytes, contentType } = materializeArtifactBytes(
    input.artifact.format,
    input.artifact.columns,
    rows,
  );
  const stored = await replaceSandboxFile(
    input.artifact.sandboxId,
    bytes,
    input.artifact.fileName,
    contentType,
  );
  const now = new Date().toISOString();
  return {
    ...input.artifact,
    url: stored.url,
    rows,
    rowCount: rows.length,
    updatedAt: now,
  };
}

export function findLiveArtifact(
  artifacts: LiveArtifactState[] | undefined,
  sideEffectId: string,
): LiveArtifactState | null {
  if (!artifacts?.length) return null;
  return artifacts.find((artifact) => artifact.sideEffectId === sideEffectId) ?? null;
}

export function upsertLiveArtifactList(
  artifacts: LiveArtifactState[] | undefined,
  updated: LiveArtifactState,
): LiveArtifactState[] {
  const list = [...(artifacts ?? [])];
  const index = list.findIndex((artifact) => artifact.id === updated.id);
  if (index >= 0) list[index] = updated;
  else list.push(updated);
  return list;
}

/** SSE / UI payload for live spreadsheet preview (rows stay in sync with sandbox file). */
export function liveArtifactPreviewPayload(artifact: LiveArtifactState): {
  artifactId: string;
  sideEffectId: string;
  url: string;
  fileName: string;
  rowCount: number;
  columns: string[];
  rows: LiveArtifactRow[];
} {
  return {
    artifactId: artifact.id,
    sideEffectId: artifact.sideEffectId,
    url: artifact.url,
    fileName: artifact.fileName,
    rowCount: artifact.rowCount,
    columns: artifact.columns,
    rows: artifact.rows,
  };
}
