import type { StoredOAuthTokens } from '../../connectors.types.js';
import { refreshZohoAccessToken } from '../../zohoOAuth.service.js';
import {
  assertModuleAllowed,
  getCachedModules,
  resolveModuleApiName,
  setCachedModules,
} from '../crmModuleCache.js';
import type { CrmProviderAdapter } from '../crmProvider.interface.js';
import type {
  CrmAddNoteInput,
  CrmAttachmentDownloadInput,
  CrmAttachmentListInput,
  CrmAttachmentUploadInput,
  CrmBulkInput,
  CrmConvertLeadInput,
  CrmCreateInput,
  CrmDeleteInput,
  CrmGetInput,
  CrmLinkInput,
  CrmModuleInfo,
  CrmModuleSchema,
  CrmQueryInput,
  CrmSearchInput,
  CrmSession,
  CrmToolResult,
  CrmUnlinkInput,
  CrmUpdateInput,
} from '../crm.types.js';
import { crmBulkMaxRecords } from '../crm.types.js';

const DEFAULT_FIELDS =
  'id,Full_Name,Email,Phone,Company,Deal_Name,Last_Name,First_Name,Subject,Status,Created_Time,Modified_Time';

async function ensureFreshCredentials(credentials: StoredOAuthTokens): Promise<StoredOAuthTokens> {
  if (credentials.expiresAtMs && credentials.expiresAtMs < Date.now() + 60_000) {
    const refreshed = await refreshZohoAccessToken(credentials);
    return { ...credentials, accessToken: refreshed.accessToken, expiresAtMs: refreshed.expiresAtMs };
  }
  return credentials;
}

function apiBase(credentials: StoredOAuthTokens): string {
  return (credentials.apiDomain ?? 'https://www.zohoapis.com').replace(/\/$/, '');
}

async function zohoFetch(
  credentials: StoredOAuthTokens,
  path: string,
  init?: RequestInit,
): Promise<{ credentials: StoredOAuthTokens; body: unknown }> {
  const active = await ensureFreshCredentials(credentials);
  const url = `${apiBase(active)}/crm/v8${path.startsWith('/') ? path : `/${path}`}`;
  const resp = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Zoho-oauthtoken ${active.accessToken}`,
      ...(init?.headers ?? {}),
    },
  });
  const text = await resp.text();
  let body: unknown = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!resp.ok) {
    const msg =
      typeof body === 'object' && body !== null && 'message' in body
        ? String((body as { message: unknown }).message)
        : text.slice(0, 500);
    const code =
      typeof body === 'object' && body !== null && 'code' in body
        ? String((body as { code: unknown }).code)
        : null;
    throw new Error(
      code ? `Zoho CRM API ${resp.status} (${code}): ${msg}` : `Zoho CRM API ${resp.status}: ${msg}`,
    );
  }
  if (resp.status === 204) {
    return { credentials: active, body: { data: [] } };
  }
  return { credentials: active, body };
}

export function extractZohoArray(body: unknown): unknown[] {
  if (typeof body !== 'object' || body === null) return [];
  const obj = body as Record<string, unknown>;
  for (const key of ['data', 'modules', 'fields'] as const) {
    const val = obj[key];
    if (Array.isArray(val)) return val;
  }
  return [];
}

function wrap<T>(session: CrmSession, credentials: StoredOAuthTokens, data: T): CrmToolResult<T> {
  return {
    session: { ...session, credentials },
    data,
  };
}

function extractDataOne(body: unknown): unknown | null {
  const arr = extractZohoArray(body);
  return arr[0] ?? null;
}

/** Zoho COQL requires a WHERE clause on every SELECT ("missing clause" without it). */
export function normalizeCoqlQuery(query: string, modules: CrmModuleInfo[] = []): string {
  let q = query.trim().replace(/;\s*$/, '');

  // Zoho rejects COUNT(*) and lowercase count() with a misleading "missing clause" error.
  q = q.replace(/\bCOUNT\s*\(\s*\*\s*\)/gi, 'COUNT(id)');
  q = q.replace(/\bcount\s*\(/gi, 'COUNT(');

  // Zoho only accepts lowercase null checks — "IS NOT NULL" → invalid operator.
  q = q.replace(/\bis\s+not\s+null\b/gi, 'is not null');
  q = q.replace(/\bis\s+null\b/gi, 'is null');

  // Zoho COQL does not support <>; != works for null checks.
  q = q.replace(/<>/g, '!=');

  // Common LLM mistake: WHERE Id … — Zoho expects lowercase id in criteria.
  q = q.replace(/\b(WHERE|where)\s+Id\s+is\s+not\s+null\b/g, '$1 id is not null');

  const fromMatch = q.match(/\bFROM\s+([A-Za-z_][A-Za-z0-9_]*)\b/i);
  if (fromMatch && modules.length) {
    const rawModule = fromMatch[1];
    try {
      const resolved = resolveModuleApiName(modules, rawModule, 'zoho');
      if (resolved !== rawModule) {
        q = q.replace(
          new RegExp(`\\bFROM\\s+${rawModule.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'),
          `FROM ${resolved}`,
        );
      }
    } catch {
      // Leave module as-is; Zoho will return a clear module error.
    }
  }

  if (!/\bSELECT\b/i.test(q) || /\bWHERE\b/i.test(q)) return q;

  const clauseBreak = q.search(/\b(GROUP\s+BY|ORDER\s+BY|LIMIT)\b/i);
  if (clauseBreak >= 0) {
    return `${q.slice(0, clauseBreak).trimEnd()} where id is not null ${q.slice(clauseBreak).trimStart()}`;
  }
  return `${q} where id is not null`;
}

function assertReadOnlyQuery(query: string): void {
  const upper = query.toUpperCase();
  for (const kw of ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'CREATE', 'MERGE']) {
    if (new RegExp(`\\b${kw}\\b`).test(upper)) {
      throw new Error(`Query must be read-only; forbidden keyword: ${kw}`);
    }
  }
}

async function resolveModules(session: CrmSession): Promise<{ session: CrmSession; modules: CrmModuleInfo[] }> {
  const cached = getCachedModules(session.orgId, session.platform);
  if (cached?.length) return { session, modules: cached };

  const { credentials, body } = await zohoFetch(session.credentials, '/settings/modules');
  const modules: CrmModuleInfo[] = [];
  for (const row of extractZohoArray(body)) {
    if (typeof row !== 'object' || row === null) continue;
    const r = row as Record<string, unknown>;
    const apiName = String(r.api_name ?? r.module_name ?? '').trim();
    if (!apiName) continue;
    if (r.api_supported === false) continue;
    if (r.status && String(r.status).toLowerCase() === 'hidden') continue;
    modules.push({
      apiName,
      label: String(r.singular_label ?? r.module_name ?? apiName),
      pluralLabel: String(r.plural_label ?? r.module_name ?? apiName),
    });
  }

  if (modules.length) setCachedModules(session.orgId, session.platform, modules);
  return { session: { ...session, credentials }, modules };
}

async function assertModule(session: CrmSession, module: string): Promise<{ session: CrmSession; module: string }> {
  const resolved = await resolveModules(session);
  return {
    session: resolved.session,
    module: assertModuleAllowed(resolved.modules, module, session.platform),
  };
}

const ZOHO_RECORD_ID_RE = /^\d{12,20}$/;

const NAME_LOOKUP_FIELDS = [
  'Full_Name',
  'Name',
  'Deal_Name',
  'Last_Name',
  'Subject',
  'Company',
  'Email',
] as const;

export function isZohoRecordId(value: string): boolean {
  return ZOHO_RECORD_ID_RE.test(value.trim());
}

function escapeCoqlString(value: string): string {
  return value.replace(/'/g, "''");
}

function ordinalSuffix(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return 'th';
  switch (n % 10) {
    case 1:
      return 'st';
    case 2:
      return 'nd';
    case 3:
      return 'rd';
    default:
      return 'th';
  }
}

async function coqlSelectRecords(
  session: CrmSession,
  modules: CrmModuleInfo[],
  selectQuery: string,
): Promise<{ session: CrmSession; rows: Array<Record<string, unknown>> }> {
  const query = normalizeCoqlQuery(selectQuery, modules);
  const { credentials, body } = await zohoFetch(session.credentials, '/coql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ select_query: query }),
  });
  const rows = extractZohoArray(body).filter(
    (row): row is Record<string, unknown> => typeof row === 'object' && row !== null,
  );
  return { session: { ...session, credentials }, rows };
}

/**
 * Map a human reference (numeric Zoho id, ordinal, or name) to a Zoho record id.
 * Agents often pass names like "Michael Ruta" or ordinals like "9" instead of ids.
 */
async function resolveRecordRef(
  session: CrmSession,
  module: string,
  recordRef: string,
): Promise<{ session: CrmSession; recordId: string }> {
  const ref = recordRef.trim();
  if (!ref) throw new Error('recordId is required');
  if (isZohoRecordId(ref)) return { session, recordId: ref };

  const { session: s, module: mod } = await assertModule(session, module);
  const { modules } = await resolveModules(s);
  let active = s;

  const ordinalMatch = ref.match(/^(\d{1,3})(?:st|nd|rd|th)?$/i);
  if (ordinalMatch) {
    const index = Number.parseInt(ordinalMatch[1], 10);
    if (index >= 1 && index <= 200) {
      const looked = await coqlSelectRecords(
        active,
        modules,
        `SELECT id, Full_Name FROM ${mod} ORDER BY Created_Time ASC LIMIT ${index}`,
      );
      active = looked.session;
      const pick = looked.rows[index - 1];
      const id = pick ? String(pick.id ?? '').trim() : '';
      if (id) return { session: active, recordId: id };
      throw new Error(
        `No ${index}${ordinalSuffix(index)} record in ${mod} (only ${looked.rows.length} found). Use crm_search to list records.`,
      );
    }
  }

  const escaped = escapeCoqlString(ref);

  for (const field of NAME_LOOKUP_FIELDS) {
    try {
      const looked = await coqlSelectRecords(
        active,
        modules,
        `SELECT id, Full_Name FROM ${mod} WHERE ${field} = '${escaped}' LIMIT 3`,
      );
      active = looked.session;
      const ids = looked.rows
        .map((row) => ({
          id: String(row.id ?? '').trim(),
          label: String(row.Full_Name ?? row.Name ?? row.Deal_Name ?? row.Subject ?? row.id ?? ''),
        }))
        .filter((row) => row.id);
      if (ids.length === 1) return { session: active, recordId: ids[0].id };
      if (ids.length > 1) {
        throw new Error(
          `Multiple ${mod} records match "${ref}": ${ids.map((r) => r.label || r.id).join(', ')}. Use the numeric id from crm_search.`,
        );
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Multiple ')) throw err;
    }
  }

  try {
    const looked = await coqlSelectRecords(
      active,
      modules,
      `SELECT id, Full_Name FROM ${mod} WHERE Full_Name like '%${escaped}%' LIMIT 5`,
    );
    active = looked.session;
    const ids = looked.rows
      .map((row) => ({
        id: String(row.id ?? '').trim(),
        label: String(row.Full_Name ?? row.id ?? ''),
      }))
      .filter((row) => row.id);
    if (ids.length === 1) return { session: active, recordId: ids[0].id };
    if (ids.length > 1) {
      throw new Error(
        `Multiple ${mod} records match "${ref}": ${ids.map((r) => r.label || r.id).join(', ')}. Use the numeric id from crm_search.`,
      );
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Multiple ')) throw err;
  }

  const { credentials, body } = await zohoFetch(
    active.credentials,
    `/${mod}/search?word=${encodeURIComponent(ref)}&fields=id,Full_Name&per_page=5`,
  );
  active = { ...active, credentials };
  const found = extractZohoArray(body) as Array<{ id?: string; Full_Name?: string }>;
  const matches = found
    .filter((row) => row.id)
    .map((row) => ({ id: String(row.id), label: String(row.Full_Name ?? row.id) }));
  if (matches.length === 1) return { session: active, recordId: matches[0].id };
  if (matches.length > 1) {
    throw new Error(
      `Multiple ${mod} records match "${ref}": ${matches.map((m) => m.label).join(', ')}. Use the numeric id from crm_search.`,
    );
  }

  throw new Error(
    `No ${mod} record found for "${ref}". Call crm_search to get the numeric id (e.g. 1384269000000531230).`,
  );
}

export const zohoCrmProvider: CrmProviderAdapter = {
  platformId: 'zoho',
  displayName: 'Zoho CRM',
  queryLanguage: 'COQL',
  queryHint:
    'Use Zoho COQL SELECT syntax. Every SELECT needs WHERE (e.g. WHERE id is not null). Use COUNT(id) not COUNT(*) or count(id). Write null checks lowercase: "is not null" / "is null" (not IS NOT NULL). Use != not <>. Module names are case-sensitive (Leads not leads).',

  async refreshSession(session) {
    const credentials = await ensureFreshCredentials(session.credentials);
    return { ...session, credentials };
  },

  async listModules(session) {
    const { session: s, modules } = await resolveModules(session);
    return wrap(s, s.credentials, modules);
  },

  async describeModule(session, module) {
    const { session: s, module: mod } = await assertModule(session, module);
    const { credentials, body } = await zohoFetch(
      s.credentials,
      `/settings/fields?module=${encodeURIComponent(mod)}`,
    );
    const fields = extractZohoArray(body).map((row) => {
      const r = row as Record<string, unknown>;
      const picklist =
        Array.isArray(r.pick_list_values) ?
          r.pick_list_values.map((v) => String((v as { display_value?: string }).display_value ?? v))
        : undefined;
      return {
        apiName: String(r.api_name ?? ''),
        label: String(r.field_label ?? r.api_name ?? ''),
        dataType: String(r.data_type ?? 'unknown'),
        required: Boolean(r.system_mandatory || r.required),
        picklistValues: picklist,
      };
    });
    const schema: CrmModuleSchema = {
      module: mod,
      fields,
      queryLanguage: 'COQL',
      queryHint: zohoCrmProvider.queryHint,
    };
    return wrap(s, credentials, schema);
  },

  async searchRecords(session, input) {
    const { session: s, module } = await assertModule(session, input.module);
    const page = Math.max(1, input.page ?? 1);
    const perPage = Math.min(50, Math.max(1, input.perPage ?? 10));
    const fields =
      input.fields?.length ? input.fields.join(',') : DEFAULT_FIELDS;
    const path =
      input.word?.trim() ?
        `/${module}/search?word=${encodeURIComponent(input.word.trim())}&fields=${encodeURIComponent(fields)}&page=${page}&per_page=${perPage}`
      : `/${module}?fields=${encodeURIComponent(fields)}&page=${page}&per_page=${perPage}`;
    const { credentials, body } = await zohoFetch(s.credentials, path);
    return wrap(s, credentials, extractZohoArray(body));
  },

  async queryRecords(session, input) {
    const { session: s, modules } = await resolveModules(session);
    const query = normalizeCoqlQuery(input.query, modules);
    assertReadOnlyQuery(query);
    const { credentials, body } = await zohoFetch(s.credentials, '/coql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ select_query: query }),
    });
    return wrap(s, credentials, extractZohoArray(body));
  },

  async getRecord(session, input) {
    const { session: s, module } = await assertModule(session, input.module);
    const { session: resolved, recordId } = await resolveRecordRef(s, module, input.recordId);
    const fields =
      input.fields?.length ? `?fields=${encodeURIComponent(input.fields.join(','))}` : '';
    const { credentials, body } = await zohoFetch(
      resolved.credentials,
      `/${module}/${encodeURIComponent(recordId)}${fields}`,
    );
    return wrap(resolved, credentials, extractDataOne(body));
  },

  async createRecord(session, input) {
    const { session: s, module } = await assertModule(session, input.module);
    const { credentials, body } = await zohoFetch(s.credentials, `/${module}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: [input.fields] }),
    });
    return wrap(s, credentials, extractDataOne(body));
  },

  async updateRecord(session, input) {
    const { session: s, module } = await assertModule(session, input.module);
    const { session: resolved, recordId } = await resolveRecordRef(s, module, input.recordId);
    const { credentials, body } = await zohoFetch(
      resolved.credentials,
      `/${module}/${encodeURIComponent(recordId)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: [input.fields] }),
      },
    );
    return wrap(resolved, credentials, extractDataOne(body));
  },

  async deleteRecord(session, input) {
    const { session: s, module } = await assertModule(session, input.module);
    const { session: resolved, recordId } = await resolveRecordRef(s, module, input.recordId);
    await zohoFetch(resolved.credentials, `/${module}/${encodeURIComponent(recordId)}`, {
      method: 'DELETE',
    });
    return wrap(resolved, resolved.credentials, { deleted: true, recordId });
  },

  async bulkCreate(session, input) {
    const max = crmBulkMaxRecords();
    if (input.records.length > max) throw new Error(`Bulk create limited to ${max} records per call`);
    const { session: s, module } = await assertModule(session, input.module);
    const { credentials, body } = await zohoFetch(s.credentials, `/${module}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: input.records }),
    });
    return wrap(s, credentials, extractZohoArray(body));
  },

  async bulkUpdate(session, input) {
    const max = crmBulkMaxRecords();
    if (input.records.length > max) throw new Error(`Bulk update limited to ${max} records per call`);
    const { session: s, module } = await assertModule(session, input.module);
    const payload = input.records.map((fields, i) => {
      const id = input.recordIds?.[i] ?? fields.id;
      if (!id) throw new Error('Each bulk update record needs id in fields or recordIds');
      return { ...fields, id };
    });
    const { credentials, body } = await zohoFetch(s.credentials, `/${module}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: payload }),
    });
    return wrap(s, credentials, extractZohoArray(body));
  },

  async convertLead(session, input) {
    const { session: resolved, recordId: leadId } = await resolveRecordRef(session, 'Leads', input.leadId);
    const { credentials, body } = await zohoFetch(
      resolved.credentials,
      `/Leads/${encodeURIComponent(leadId)}/actions/convert`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: [
            {
              ...(input.dealName ? { Deal_Name: input.dealName } : {}),
              ...(input.accountName ? { Accounts: input.accountName } : {}),
              ...(input.contactRole ? { Contact_Role: input.contactRole } : {}),
              ...(input.assignTo ? { Assign_To: input.assignTo } : {}),
              overwrite: input.overwrite ?? false,
              notify_lead_owner: input.notifyLeadOwner ?? false,
            },
          ],
        }),
      },
    );
    return wrap(resolved, credentials, extractDataOne(body) ?? extractZohoArray(body));
  },

  async linkRecords(session, input) {
    const { session: s, module } = await assertModule(session, input.module);
    const { session: s1, recordId } = await resolveRecordRef(s, module, input.recordId);
    const { session: s2, module: relatedMod } = await assertModule(s1, input.relatedModule);
    const { session: s3, recordId: relatedRecordId } = await resolveRecordRef(
      s2,
      relatedMod,
      input.relatedRecordId,
    );
    await zohoFetch(
      s3.credentials,
      `/${module}/${encodeURIComponent(recordId)}/${encodeURIComponent(relatedMod)}/${encodeURIComponent(relatedRecordId)}`,
      { method: 'PUT' },
    );
    return wrap(s3, s3.credentials, { linked: true });
  },

  async unlinkRecords(session, input) {
    const { session: s, module } = await assertModule(session, input.module);
    const { session: s1, recordId } = await resolveRecordRef(s, module, input.recordId);
    const { session: s2, module: relatedMod } = await assertModule(s1, input.relatedModule);
    const { session: s3, recordId: relatedRecordId } = await resolveRecordRef(
      s2,
      relatedMod,
      input.relatedRecordId,
    );
    await zohoFetch(
      s3.credentials,
      `/${module}/${encodeURIComponent(recordId)}/${encodeURIComponent(relatedMod)}/${encodeURIComponent(relatedRecordId)}`,
      { method: 'DELETE' },
    );
    return wrap(s3, s3.credentials, { unlinked: true });
  },

  async listAttachments(session, input) {
    const { session: s, module } = await assertModule(session, input.module);
    const { session: resolved, recordId } = await resolveRecordRef(s, module, input.recordId);
    const { credentials, body } = await zohoFetch(
      resolved.credentials,
      `/${module}/${encodeURIComponent(recordId)}/Attachments?fields=${encodeURIComponent('id,File_Name,Size,Created_Time,Owner')}`,
    );
    return wrap(resolved, credentials, extractZohoArray(body));
  },

  async uploadAttachment(session, input) {
    const { session: s, module } = await assertModule(session, input.module);
    const { session: resolved, recordId } = await resolveRecordRef(s, module, input.recordId);
    const active = await ensureFreshCredentials(resolved.credentials);
    const buffer = Buffer.from(input.fileBase64, 'base64');
    const maxBytes = 10 * 1024 * 1024;
    if (buffer.length > maxBytes) throw new Error('Attachment exceeds 10MB limit');

    const form = new FormData();
    form.append(
      'file',
      new Blob([buffer], { type: input.mimeType ?? 'application/octet-stream' }),
      input.fileName,
    );

    const url = `${apiBase(active)}/crm/v8/${module}/${encodeURIComponent(recordId)}/Attachments`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Zoho-oauthtoken ${active.accessToken}` },
      body: form,
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Zoho attachment upload ${resp.status}: ${text.slice(0, 500)}`);
    }
    const text = await resp.text();
    let body: unknown = {};
    try {
      body = text ? JSON.parse(text) : { data: [] };
    } catch {
      body = text ? { raw: text } : { data: [] };
    }
    return wrap(resolved, active, extractDataOne(body) ?? { uploaded: true });
  },

  async downloadAttachment(session, input) {
    const { session: s, module } = await assertModule(session, input.module);
    const { session: resolved, recordId } = await resolveRecordRef(s, module, input.recordId);
    const active = await ensureFreshCredentials(resolved.credentials);
    const url = `${apiBase(active)}/crm/v8/${module}/${encodeURIComponent(recordId)}/Attachments/${encodeURIComponent(input.attachmentId)}`;
    const resp = await fetch(url, {
      headers: { Authorization: `Zoho-oauthtoken ${active.accessToken}` },
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Zoho attachment download ${resp.status}: ${text.slice(0, 500)}`);
    }
    const buffer = Buffer.from(await resp.arrayBuffer());
    const mimeType = resp.headers.get('content-type') ?? 'application/octet-stream';
    const disposition = resp.headers.get('content-disposition') ?? '';
    const match = /filename="?([^";\n]+)"?/.exec(disposition);
    const fileName = match?.[1] ?? `attachment-${input.attachmentId}`;
    return wrap(resolved, active, {
      fileName,
      mimeType,
      fileBase64: buffer.toString('base64'),
    });
  },

  async addNote(session, input) {
    const { session: s, module } = await assertModule(session, input.module);
    const { session: resolved, recordId } = await resolveRecordRef(s, module, input.recordId);
    const noteFields: Record<string, unknown> = {
      Note_Content: input.content,
      ...(input.title ? { Note_Title: input.title } : {}),
      Parent_Id: recordId,
      se_module: module,
    };
    const { credentials, body } = await zohoFetch(resolved.credentials, '/Notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: [noteFields] }),
    });
    return wrap(resolved, credentials, extractDataOne(body));
  },
};
