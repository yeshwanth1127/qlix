import { canonicalCity, normalizeCityValue } from './cityAliases.js';
import type { TeamRunInput } from './teams.types.js';
import { isRowStructuredInput } from './lunaTeamsHost.js';

/**
 * Host-side backstop for a filter stage that kept one spelling of a city and dropped another.
 *
 * The worker prompt already asks for alias-aware matching, and a small model still returns
 * "Bangalore" while leaving the "Bengaluru" row behind. Prompting cannot make that safe, so the
 * omission is repaired here from the authoritative rows instead.
 *
 * The rule is deliberately narrow: a row is only restored when its city means the same place as
 * a city the worker itself kept AND is spelled differently. A row the worker dropped that shares
 * a kept row's exact spelling was dropped on some other criterion — degree, experience, whatever
 * the goal also asked for — and is left alone, because that criterion is not knowable here.
 */

export interface RestoredRow {
  /** 1-based row number among the data rows, matching `provenance.recordRefs`. */
  row: number;
  city: string;
  label: string;
  record: Record<string, unknown>;
  recordRef: string;
}

export interface RowAliasRepair {
  payload: unknown;
  restored: RestoredRow[];
}

interface ParsedSheet {
  header: string[];
  rows: string[][];
}

const CITY_HEADER_RE = /\b(city|town|location|place|region|district)\b/i;
const NAME_HEADER_RE = /\b(name|lead|contact|person|candidate|prospect)\b/i;
const PHONE_HEADER_RE = /\b(phone|mobile|number|whatsapp|cell|contact\s*no)\b/i;
const RECORD_ARRAY_KEY_RE = /^(leads|contacts|recipients|targets|records|rows|matches|results|items)$/i;

/** Minimal RFC-4180 reader: `sheet_to_csv` quotes any cell containing a comma or a newline. */
export function parseDelimitedRows(text: string): ParsedSheet | null {
  const lines: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell);
      lines.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  row.push(cell);
  lines.push(row);
  const populated = lines.filter((line) => line.some((value) => value.trim().length > 0));
  if (populated.length < 2) return null;
  return {
    header: populated[0]!.map((value) => value.trim()),
    rows: populated.slice(1),
  };
}

function digitsOf(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '');
}

/** Same value written two ways: "+91 81051 99337" and "8105199337" are one phone number. */
function valuesMatch(left: unknown, right: unknown): boolean {
  const leftDigits = digitsOf(left);
  const rightDigits = digitsOf(right);
  if (leftDigits.length >= 8 && rightDigits.length >= 8) {
    return leftDigits.endsWith(rightDigits) || rightDigits.endsWith(leftDigits);
  }
  const leftText = normalizeCityValue(left);
  return leftText.length > 0 && leftText === normalizeCityValue(right);
}

function columnFor(header: string[], pattern: RegExp): number {
  return header.findIndex((column) => pattern.test(column));
}

/** The array of operational records inside a Result, wherever the worker filed it. */
function locateRecordArray(node: unknown, key = '', depth = 0): Record<string, unknown>[] | null {
  if (depth > 6) return null;
  if (Array.isArray(node)) {
    const records = node.every((item) => item && typeof item === 'object' && !Array.isArray(item));
    if (records && node.length > 0 && (key === '' || RECORD_ARRAY_KEY_RE.test(key))) {
      return node as Record<string, unknown>[];
    }
    return null;
  }
  if (!node || typeof node !== 'object') return null;
  for (const [childKey, child] of Object.entries(node as Record<string, unknown>)) {
    const found = locateRecordArray(child, childKey, depth + 1);
    if (found) return found;
  }
  return null;
}

function findingsContainer(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const outer = payload as Record<string, unknown>;
  const inner =
    outer.data && typeof outer.data === 'object' && !Array.isArray(outer.data)
      ? (outer.data as Record<string, unknown>)
      : outer;
  return inner;
}

/**
 * Which source row a kept record came from. Matching on any single cell is enough — the record
 * only needs to be traced back to its row, and phone or name alone identifies it.
 */
function rowIndexForRecord(sheet: ParsedSheet, record: Record<string, unknown>): number {
  const values = Object.values(record).filter(
    (value) => typeof value === 'string' || typeof value === 'number',
  );
  return sheet.rows.findIndex((row) =>
    values.some((value) => row.some((cell) => cell.trim() !== '' && valuesMatch(value, cell))),
  );
}

/**
 * Rebuild a dropped row using the keys and formatting the worker itself used, so the restored
 * record is indistinguishable from the ones it returned. A country code the worker prefixed onto
 * a phone number is reapplied; a key that maps to no column is carried over only when every kept
 * record agrees on its value.
 */
function buildRecord(
  sheet: ParsedSheet,
  template: Record<string, unknown>,
  templateRow: string[],
  kept: Record<string, unknown>[],
  row: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(template)) {
    const column = templateRow.findIndex(
      (cell) => cell.trim() !== '' && valuesMatch(value, cell),
    );
    if (column < 0) {
      const shared = kept.every((record) => record[key] === value);
      if (shared) out[key] = value;
      continue;
    }
    const cell = (row[column] ?? '').trim();
    const templateDigits = digitsOf(value);
    const sourceDigits = digitsOf(templateRow[column]);
    const cellDigits = digitsOf(cell);
    if (
      templateDigits.length >= 8 &&
      sourceDigits.length >= 8 &&
      cellDigits.length >= 8 &&
      templateDigits.endsWith(sourceDigits) &&
      templateDigits.length > sourceDigits.length
    ) {
      const prefix = templateDigits.slice(0, templateDigits.length - sourceDigits.length);
      out[key] = `${String(value).trim().startsWith('+') ? '+' : ''}${prefix}${cellDigits}`;
      continue;
    }
    out[key] = cell;
  }
  return out;
}

function recordRefPrefix(provenance: unknown, inputRef: string): string {
  const refs = (provenance as { recordRefs?: unknown } | null)?.recordRefs;
  if (Array.isArray(refs)) {
    for (const ref of refs) {
      const match = typeof ref === 'string' ? ref.match(/^(.*):row:\d+$/) : null;
      if (match) return match[1]!;
    }
  }
  return inputRef;
}

/**
 * Restore rows the stage dropped only because the city was spelled differently. Returns the
 * payload unchanged (and `restored: []`) whenever anything about the shape is unrecognised —
 * this must never be the reason a Result stops validating.
 */
export function repairCityAliasOmissions(params: {
  payload: unknown;
  inputs: Array<Pick<TeamRunInput, 'ref' | 'fileName' | 'mimeType' | 'extractedText'>>;
}): RowAliasRepair {
  const unchanged: RowAliasRepair = { payload: params.payload, restored: [] };
  const container = findingsContainer(params.payload);
  if (!container) return unchanged;
  const source = params.inputs.find(
    (input) => input.extractedText?.trim() && isRowStructuredInput(input),
  );
  if (!source) return unchanged;
  const sheet = parseDelimitedRows(source.extractedText!);
  if (!sheet) return unchanged;
  const cityColumn = columnFor(sheet.header, CITY_HEADER_RE);
  if (cityColumn < 0) return unchanged;

  const clone = structuredClone(params.payload);
  const cloneContainer = findingsContainer(clone)!;
  const kept = locateRecordArray(cloneContainer.findings ?? cloneContainer.data);
  if (!kept || kept.length === 0) return unchanged;

  const keptRows = kept.map((record) => rowIndexForRecord(sheet, record));
  const templateIndex = keptRows.findIndex((index) => index >= 0);
  if (templateIndex < 0) return unchanged;
  const takenRows = new Set(keptRows.filter((index) => index >= 0));
  const keptCanonical = new Set<string>();
  const keptSpellings = new Set<string>();
  for (const index of takenRows) {
    const city = sheet.rows[index]![cityColumn] ?? '';
    if (!normalizeCityValue(city)) continue;
    keptCanonical.add(canonicalCity(city));
    keptSpellings.add(normalizeCityValue(city));
  }
  if (keptCanonical.size === 0) return unchanged;

  const nameColumn = columnFor(sheet.header, NAME_HEADER_RE);
  const phoneColumn = columnFor(sheet.header, PHONE_HEADER_RE);
  const prefix = recordRefPrefix(
    (clone as Record<string, unknown> | null)?.provenance ?? cloneContainer.provenance,
    source.ref,
  );
  const restored: RestoredRow[] = [];
  sheet.rows.forEach((row, index) => {
    if (takenRows.has(index)) return;
    const city = row[cityColumn] ?? '';
    const spelling = normalizeCityValue(city);
    if (!spelling || keptSpellings.has(spelling)) return;
    if (!keptCanonical.has(canonicalCity(city))) return;
    const record = buildRecord(
      sheet,
      kept[templateIndex]!,
      sheet.rows[keptRows[templateIndex]!]!,
      kept,
      row,
    );
    restored.push({
      row: index + 1,
      city: city.trim(),
      label: (row[nameColumn >= 0 ? nameColumn : 0] ?? row[phoneColumn] ?? '').trim(),
      record,
      recordRef: `${prefix}:row:${index + 1}`,
    });
  });
  if (restored.length === 0) return unchanged;

  for (const item of restored) kept.push(item.record);
  const provenanceHolder =
    (clone as Record<string, unknown>).provenance &&
    typeof (clone as Record<string, unknown>).provenance === 'object'
      ? ((clone as Record<string, unknown>).provenance as Record<string, unknown>)
      : cloneContainer.provenance && typeof cloneContainer.provenance === 'object'
        ? (cloneContainer.provenance as Record<string, unknown>)
        : null;
  if (provenanceHolder && Array.isArray(provenanceHolder.recordRefs)) {
    const refs = new Set(provenanceHolder.recordRefs as unknown[]);
    for (const item of restored) refs.add(item.recordRef);
    provenanceHolder.recordRefs = [...refs];
  }
  return { payload: clone, restored };
}
