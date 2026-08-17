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

export function buildReplyRow(input: {
  columns: string[];
  /** Channel-native contact handle (WhatsApp JID today; any inbound id in future). */
  jid: string;
  text: string;
  pushName?: string | null;
  interest: string;
  repliedAt?: string;
  contactHint?: { name?: string | null; phone?: string | null };
  /** Values pulled from this message for goal-specific columns. */
  extracted?: Record<string, string | null>;
}): LiveArtifactRow {
  const repliedAt = input.repliedAt ?? new Date().toISOString();
  const values = semanticValues({ ...input, repliedAt });
  const row: LiveArtifactRow = { _jid: input.jid };
  for (const col of input.columns) {
    const field = resolveLiveSheetField(col);
    row[col] = field ? values[field] : input.extracted?.[col] ?? null;
  }
  return row;
}

const MAX_REPLY_CELL_CHARS = 600;

/** Join a follow-up message onto the reply already recorded, without unbounded growth. */
function mergeReplyText(previous: unknown, next: unknown): string | null {
  const before = typeof previous === 'string' ? previous.trim() : '';
  const after = typeof next === 'string' ? next.trim() : '';
  if (!before) return after || null;
  if (!after || before === after || before.endsWith(after)) return before;
  return `${before} | ${after}`.slice(-MAX_REPLY_CELL_CHARS);
}

/**
 * Fold a new reply into the row already held for that contact.
 *
 * Details arrive across several messages ("Yes" … "Bangalore" … "3 years"), so later messages
 * top up blank cells rather than replacing the row. A decisive interest label is never
 * downgraded to `unclear` by a follow-up that simply answers a question.
 */
export function mergeReplyRow(
  previous: LiveArtifactRow,
  next: LiveArtifactRow,
  columns: string[],
): LiveArtifactRow {
  const merged: LiveArtifactRow = { ...previous };
  for (const col of columns) {
    const field = resolveLiveSheetField(col);
    const incoming = next[col];
    if (field === 'reply') {
      merged[col] = mergeReplyText(previous[col], incoming);
      continue;
    }
    if (field === 'interest') {
      const prior = typeof previous[col] === 'string' ? previous[col] : null;
      const isDowngrade = incoming === 'unclear' && prior && prior !== 'unclear';
      merged[col] = isDowngrade ? prior : (incoming ?? prior ?? null);
      continue;
    }
    if (field === 'repliedAt') {
      merged[col] = incoming ?? previous[col] ?? null;
      continue;
    }
    // Name, phone and every extracted detail: first non-empty value wins.
    merged[col] = previous[col] || incoming || null;
  }
  return merged;
}

/** @deprecated Channel-neutral now — use {@link buildReplyRow}. */
export const buildWhatsAppReplyRow = buildReplyRow;

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

export function applyContactRowToArtifact(
  artifact: LiveArtifactState,
  row: LiveArtifactRow,
  dedupeBy: WaitSideEffect['dedupeBy'],
): { artifact: LiveArtifactState; changed: boolean } {
  const columns = artifact.columns;
  const existingIndex =
    dedupeBy === 'contact_jid'
      ? artifact.rows.findIndex((existing) => {
          const jid = rowContactJid(row);
          return jid !== null && rowContactJid(existing) === jid;
        })
      : -1;

  let rows: LiveArtifactRow[];
  if (existingIndex >= 0) {
    const merged = mergeReplyRow(artifact.rows[existingIndex]!, row, columns);
    if (JSON.stringify(merged) === JSON.stringify(artifact.rows[existingIndex])) {
      return { artifact, changed: false };
    }
    rows = [...artifact.rows];
    rows[existingIndex] = merged;
  } else {
    rows = [...artifact.rows, row];
  }

  return {
    artifact: {
      ...artifact,
      rows,
      rowCount: rows.length,
    },
    changed: true,
  };
}

export async function rematerializeLiveArtifact(artifact: LiveArtifactState): Promise<LiveArtifactState> {
  const title = artifact.fileName.replace(/\.[^.]+$/, '') || 'Live artifact';
  const { bytes, contentType } = await materializeLiveArtifactBytes(
    artifact.format,
    artifact.columns,
    artifact.rows,
    title,
  );
  const stored = await replaceSandboxFile(artifact.sandboxId, bytes, artifact.fileName, contentType);
  return {
    ...artifact,
    url: stored.url,
    updatedAt: new Date().toISOString(),
  };
}

export async function upsertLiveArtifactRow(input: {
  artifact: LiveArtifactState;
  sideEffect: WaitSideEffect;
  row: LiveArtifactRow;
}): Promise<LiveArtifactState> {
  const applied = applyContactRowToArtifact(input.artifact, input.row, input.sideEffect.dedupeBy);
  if (!applied.changed) return input.artifact;
  return rematerializeLiveArtifact(applied.artifact);
}

/** @deprecated Follow-ups now top up the contact's row — use {@link upsertLiveArtifactRow}. */
export const appendLiveArtifactRow = upsertLiveArtifactRow;

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
