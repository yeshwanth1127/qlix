import { Buffer } from 'node:buffer';
import { replaceSandboxFile, storeSandboxFile } from '../sandbox/sandboxClient.js';
import { jidLocalPart } from '../whatsapp/whatsappAutoReply.service.js';
import {
  extensionForFormat,
  inferFormatFromFileName,
  inferLiveArtifactFormatFromGoal,
  previewKindForFormat,
} from './liveArtifactFormat.js';
import { materializeLiveArtifactBytes } from './liveArtifactMaterialize.js';
import { resolveLiveSheetField, inferNameFromOutreachMessage } from './liveSheetColumns.js';
import type { LiveSheetField } from './liveSheetColumns.js';
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
  return ['Name', 'Phone', 'Reply', 'Interest', 'Replied at'];
}

export function formatDisplayPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 12 && digits.startsWith('91')) {
    return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
  }
  return digits.startsWith('+') ? digits : `+${digits}`;
}

function semanticValues(input: {
  jid: string;
  text: string;
  pushName?: string | null;
  interest: string;
  repliedAt: string;
  contactHint?: { name?: string | null; phone?: string | null };
}): Record<LiveSheetField, string | null> {
  const rawPhone = input.contactHint?.phone?.replace(/\D/g, '') || jidLocalPart(input.jid);
  return {
    name: input.contactHint?.name?.trim() || input.pushName?.trim() || null,
    phone: formatDisplayPhone(rawPhone),
    reply: input.text,
    interest: input.interest,
    repliedAt: input.repliedAt,
  };
}

export function defaultFileName(title: string | undefined, format: LiveArtifactFormat): string {
  const base = slugify(title ?? 'live-artifact');
  return `${base}.${extensionForFormat(format)}`;
}

export function resolveLiveArtifactFormat(
  sideEffect: WaitSideEffect,
  runGoal?: string | null,
  fileName?: string,
): LiveArtifactFormat {
  if (sideEffect.format) return sideEffect.format;
  if (runGoal?.trim()) return inferLiveArtifactFormatFromGoal(runGoal);
  if (fileName) {
    const fromName = inferFormatFromFileName(fileName);
    if (fromName) return fromName;
  }
  return 'xlsx';
}

/** @deprecated Use materializeLiveArtifactBytes — kept for tests importing materializeArtifactBytes */
export async function materializeArtifactBytes(
  format: LiveArtifactFormat,
  columns: string[],
  rows: LiveArtifactRow[],
  title?: string,
): Promise<{ bytes: Buffer; contentType: string }> {
  return materializeLiveArtifactBytes(format, columns, rows, title);
}

export async function createLiveArtifact(input: {
  sideEffect: WaitSideEffect;
  runId: string;
  teamName?: string;
  runGoal?: string | null;
}): Promise<LiveArtifactState> {
  const columns = input.sideEffect.columns?.length
    ? input.sideEffect.columns
    : defaultColumns();
  const format = resolveLiveArtifactFormat(input.sideEffect, input.runGoal);
  const title = input.sideEffect.title ?? input.teamName ?? `run-${input.runId.slice(0, 8)}`;
  const fileName = defaultFileName(title, format);
  const { bytes, contentType } = await materializeLiveArtifactBytes(format, columns, [], title);
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
  contactHint?: { name?: string | null; phone?: string | null };
}): LiveArtifactRow {
  const repliedAt = input.repliedAt ?? new Date().toISOString();
  const values = semanticValues({ ...input, repliedAt });
  const row: LiveArtifactRow = { _jid: input.jid };
  for (const col of input.columns) {
    const field = resolveLiveSheetField(col);
    row[col] = field ? values[field] : null;
  }
  return row;
}

export function rowContactJid(row: LiveArtifactRow): string | null {
  const hidden = row._jid;
  if (typeof hidden === 'string' && hidden.includes('@')) return hidden;
  for (const col of Object.keys(row)) {
    if (col === '_jid') continue;
    const field = resolveLiveSheetField(col);
    if (field !== 'phone') continue;
    const phone = row[col];
    if (typeof phone !== 'string') continue;
    const digits = phone.replace(/\D/g, '');
    if (digits.length >= 10) return `${digits}@s.whatsapp.net`;
  }
  const legacy = row.JID ?? row.jid;
  return typeof legacy === 'string' ? legacy : null;
}

export function isDuplicateRow(
  artifact: LiveArtifactState,
  row: LiveArtifactRow,
  dedupeBy: WaitSideEffect['dedupeBy'],
): boolean {
  if (dedupeBy !== 'contact_jid') return false;
  const jid = rowContactJid(row);
  if (!jid) return false;
  return artifact.rows.some((existing) => rowContactJid(existing) === jid);
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
  const title = input.artifact.fileName.replace(/\.[^.]+$/, '') || 'Live artifact';
  const { bytes, contentType } = await materializeLiveArtifactBytes(
    input.artifact.format,
    input.artifact.columns,
    rows,
    title,
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

/** SSE / UI payload for live artifact preview (rows stay in sync with sandbox file). */
export function liveArtifactPreviewPayload(artifact: LiveArtifactState): {
  artifactId: string;
  sideEffectId: string;
  url: string;
  fileName: string;
  format: LiveArtifactFormat;
  previewKind: ReturnType<typeof previewKindForFormat>;
  rowCount: number;
  columns: string[];
  rows: LiveArtifactRow[];
} {
  return {
    artifactId: artifact.id,
    sideEffectId: artifact.sideEffectId,
    url: artifact.url,
    fileName: artifact.fileName,
    format: artifact.format,
    previewKind: previewKindForFormat(artifact.format),
    rowCount: artifact.rowCount,
    columns: artifact.columns,
    rows: artifact.rows,
  };
}
