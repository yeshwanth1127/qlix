/**
 * Capability-grant labeling + cloud scope remapping (no JIT imports — keeps
 * capabilityGrant.service ↔ jit.service cycle-free).
 */
import type { PermissionScope } from '../agents/agents.types.js';
import { SCOPE_CATALOG_BY_ID } from '../agents/scopeCatalog.js';

const HYBRID_ONLY_SCOPES = new Set(['system.file_write', 'system.file_read', 'system.gui_control']);

export const PDF_DOC_REASON =
  /\b(pdf|document|docx?|brochure|report|export\s+(?:to\s+)?(?:a\s+)?(?:pdf|doc)|create_report_pdf|luna_local_create_pdf)\b/i;
export const SPREADSHEET_REASON =
  /\b(spreadsheet|excel|xlsx|csv|workbook|create_xlsx|sheet)\b/i;

function scopeCatalogLabel(scope: string): string {
  const def = SCOPE_CATALOG_BY_ID[scope as keyof typeof SCOPE_CATALOG_BY_ID];
  if (def?.label) return def.label;
  return scope;
}

/** User-facing capability title — prefer what they asked for over raw scope labels. */
export function labelsForCapabilityScopes(
  scopes: string[],
  reason?: string | null,
): string {
  const r = typeof reason === 'string' ? reason : '';
  const set = new Set(scopes);
  const parts: string[] = [];

  if (PDF_DOC_REASON.test(r) || set.has('files.create')) {
    if (PDF_DOC_REASON.test(r)) {
      parts.push('Create PDF documents');
    } else if (SPREADSHEET_REASON.test(r)) {
      parts.push('Create spreadsheets');
    } else if (set.has('files.create')) {
      parts.push('Create files (PDF, spreadsheet)');
    }
  } else if (SPREADSHEET_REASON.test(r)) {
    parts.push('Create spreadsheets');
  }

  for (const scope of scopes) {
    if (scope === 'files.create' && parts.some((p) => /pdf|spreadsheet|file/i.test(p))) {
      continue;
    }
    if (scope === 'system.file_write' && PDF_DOC_REASON.test(r)) {
      if (!parts.includes('Create PDF documents')) parts.push('Create PDF documents');
      continue;
    }
    if (scope === 'system.file_write' && SPREADSHEET_REASON.test(r)) {
      if (!parts.includes('Create spreadsheets')) parts.push('Create spreadsheets');
      continue;
    }
    const label = scopeCatalogLabel(scope);
    if (!parts.includes(label)) parts.push(label);
  }

  return parts.length > 0 ? parts.join(', ') : 'Add capability';
}

/**
 * Cloud runners cannot use local filesystem scopes. PDF/spreadsheet requests that
 * asked for system.file_* must become files.create (create_report_pdf / create_xlsx).
 * Does not remapping into web.research.
 */
export function remapCapabilityScopesForRuntime(input: {
  scopes: PermissionScope[];
  reason?: string | null;
  runtime?: string | null;
}): PermissionScope[] {
  const runtime = (input.runtime ?? 'cloud').trim().toLowerCase();
  const reason = input.reason ?? '';
  const wantsDocs = PDF_DOC_REASON.test(reason) || SPREADSHEET_REASON.test(reason);
  const unique = Array.from(new Set(input.scopes));

  if (runtime === 'hybrid' || runtime === 'local') {
    return unique;
  }

  const kept = unique.filter((s) => !HYBRID_ONLY_SCOPES.has(s));
  const strippedHybrid = kept.length < unique.length;
  const out = [...kept];
  if (
    (wantsDocs || (strippedHybrid && kept.length === 0)) &&
    SCOPE_CATALOG_BY_ID['files.create'] &&
    !out.includes('files.create' as PermissionScope)
  ) {
    out.push('files.create' as PermissionScope);
  }
  return out;
}
