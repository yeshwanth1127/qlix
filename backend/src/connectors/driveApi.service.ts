/**
 * Google Drive v3 REST client. Pure functions — scope/JIT/audit live in driveTool.service.
 */
const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API_BASE = 'https://www.googleapis.com/upload/drive/v3';

export class DriveApiError extends Error {
  readonly code = 'drive_api_failed';
  readonly status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.status = status;
  }
}

async function driveFetch(
  accessToken: string,
  url: string,
  init?: RequestInit,
): Promise<Record<string, unknown>> {
  const resp = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.body && !(init.body instanceof Buffer)
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...(init?.headers ?? {}),
    },
  });
  const text = await resp.text();
  if (resp.status === 204 || !text) {
    if (!resp.ok) throw new DriveApiError(`Drive API ${resp.status}`, resp.status);
    return {};
  }
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    body = { raw: text.slice(0, 4000) };
  }
  if (!resp.ok) {
    const apiMsg =
      (body.error as { message?: string } | undefined)?.message ?? text.slice(0, 300);
    throw new DriveApiError(`Drive API ${resp.status}: ${apiMsg}`, resp.status);
  }
  return body;
}

export interface DriveFileSummary {
  id: string;
  name: string;
  mimeType: string;
  webViewLink: string;
  modifiedTime: string;
  size: string;
  parents: string[];
}

function toSummary(f: Record<string, unknown>): DriveFileSummary {
  return {
    id: String(f.id ?? ''),
    name: String(f.name ?? ''),
    mimeType: String(f.mimeType ?? ''),
    webViewLink: String(f.webViewLink ?? ''),
    modifiedTime: String(f.modifiedTime ?? ''),
    size: String(f.size ?? ''),
    parents: Array.isArray(f.parents) ? (f.parents as string[]) : [],
  };
}

const FILE_FIELDS =
  'id,name,mimeType,webViewLink,modifiedTime,size,parents';

export async function driveListFiles(params: {
  accessToken: string;
  query?: string;
  pageSize?: number;
  pageToken?: string | null;
}): Promise<{ files: DriveFileSummary[]; nextPageToken: string | null }> {
  const search = new URLSearchParams({
    pageSize: String(Math.min(50, Math.max(1, params.pageSize ?? 20))),
    fields: `nextPageToken,files(${FILE_FIELDS})`,
    spaces: 'drive',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  });
  if (params.query?.trim()) search.set('q', params.query.trim());
  if (params.pageToken) search.set('pageToken', params.pageToken);

  const result = await driveFetch(
    params.accessToken,
    `${DRIVE_API_BASE}/files?${search.toString()}`,
  );
  const files = Array.isArray(result.files)
    ? (result.files as Record<string, unknown>[]).map(toSummary)
    : [];
  return {
    files,
    nextPageToken: typeof result.nextPageToken === 'string' ? result.nextPageToken : null,
  };
}

export async function driveGetFileMeta(params: {
  accessToken: string;
  fileId: string;
}): Promise<DriveFileSummary> {
  const search = new URLSearchParams({
    fields: FILE_FIELDS,
    supportsAllDrives: 'true',
  });
  const result = await driveFetch(
    params.accessToken,
    `${DRIVE_API_BASE}/files/${encodeURIComponent(params.fileId)}?${search}`,
  );
  return toSummary(result);
}

/** Export Google Docs/Sheets/Slides as text/csv, or download binary files as utf8 when possible. */
export async function driveGetFileContent(params: {
  accessToken: string;
  fileId: string;
  mimeType?: string;
}): Promise<{ fileId: string; name: string; mimeType: string; contentText: string }> {
  const meta = await driveGetFileMeta({
    accessToken: params.accessToken,
    fileId: params.fileId,
  });
  const mime = params.mimeType || meta.mimeType;

  let contentText = '';
  if (mime.startsWith('application/vnd.google-apps.')) {
    const exportMime =
      mime === 'application/vnd.google-apps.spreadsheet'
        ? 'text/csv'
        : 'text/plain';
    const resp = await fetch(
      `${DRIVE_API_BASE}/files/${encodeURIComponent(params.fileId)}/export?mimeType=${encodeURIComponent(exportMime)}`,
      { headers: { Authorization: `Bearer ${params.accessToken}` } },
    );
    contentText = (await resp.text()).slice(0, 200_000);
    if (!resp.ok) {
      throw new DriveApiError(`Drive export failed (${resp.status}): ${contentText.slice(0, 300)}`, resp.status);
    }
  } else {
    const resp = await fetch(
      `${DRIVE_API_BASE}/files/${encodeURIComponent(params.fileId)}?alt=media&supportsAllDrives=true`,
      { headers: { Authorization: `Bearer ${params.accessToken}` } },
    );
    const buf = Buffer.from(await resp.arrayBuffer());
    if (!resp.ok) {
      throw new DriveApiError(`Drive download failed (${resp.status})`, resp.status);
    }
    // Best-effort text; binary files return a short notice.
    const asText = buf.toString('utf8');
    contentText =
      /[\x00-\x08\x0E-\x1F]/.test(asText.slice(0, 200))
        ? `[binary file ${meta.name}; ${buf.length} bytes — not shown as text]`
        : asText.slice(0, 200_000);
  }

  return {
    fileId: meta.id,
    name: meta.name,
    mimeType: meta.mimeType,
    contentText,
  };
}

export async function driveCreateFile(params: {
  accessToken: string;
  name: string;
  contentText?: string;
  mimeType?: string;
  parentId?: string | null;
}): Promise<DriveFileSummary> {
  const mimeType = params.mimeType?.trim() || 'text/plain';
  const metadata: Record<string, unknown> = { name: params.name, mimeType };
  if (params.parentId?.trim()) metadata.parents = [params.parentId.trim()];

  const boundary = `qlix_${cryptoRandom()}`;
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${mimeType}\r\n\r\n` +
    `${params.contentText ?? ''}\r\n` +
    `--${boundary}--`;

  const result = await driveFetch(
    params.accessToken,
    `${UPLOAD_API_BASE}/files?uploadType=multipart&fields=${encodeURIComponent(FILE_FIELDS)}&supportsAllDrives=true`,
    {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    },
  );
  return toSummary(result);
}

export async function driveUpdateFile(params: {
  accessToken: string;
  fileId: string;
  name?: string;
  contentText?: string;
  mimeType?: string;
}): Promise<DriveFileSummary> {
  if (params.name?.trim()) {
    await driveFetch(
      params.accessToken,
      `${DRIVE_API_BASE}/files/${encodeURIComponent(params.fileId)}?fields=${encodeURIComponent(FILE_FIELDS)}&supportsAllDrives=true`,
      {
        method: 'PATCH',
        body: JSON.stringify({ name: params.name.trim() }),
      },
    );
  }

  if (params.contentText != null) {
    const mimeType = params.mimeType?.trim() || 'text/plain';
    await driveFetch(
      params.accessToken,
      `${UPLOAD_API_BASE}/files/${encodeURIComponent(params.fileId)}?uploadType=media&supportsAllDrives=true`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': mimeType },
        body: params.contentText,
      },
    );
  }

  return driveGetFileMeta({ accessToken: params.accessToken, fileId: params.fileId });
}

export async function driveDeleteFile(params: {
  accessToken: string;
  fileId: string;
}): Promise<{ fileId: string; status: 'deleted' }> {
  await driveFetch(
    params.accessToken,
    `${DRIVE_API_BASE}/files/${encodeURIComponent(params.fileId)}?supportsAllDrives=true`,
    { method: 'DELETE' },
  );
  return { fileId: params.fileId, status: 'deleted' };
}

function cryptoRandom(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
