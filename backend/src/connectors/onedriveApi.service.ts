/**
 * Microsoft OneDrive via Microsoft Graph. Pure functions — scope/JIT/audit live in driveTool.service.
 * Shape matches Google Drive summaries so the agent tool layer stays provider-agnostic.
 */
import type { DriveFileSummary } from './driveApi.service.js';

const GRAPH = 'https://graph.microsoft.com/v1.0';

export class OneDriveApiError extends Error {
  readonly code = 'onedrive_api_failed';
  readonly status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.status = status;
  }
}

async function graphFetch(
  accessToken: string,
  url: string,
  init?: RequestInit,
): Promise<Record<string, unknown>> {
  const resp = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.body && typeof init.body === 'string' && !String(init.headers ?? '').includes('Content-Type')
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...(init?.headers ?? {}),
    },
  });
  const text = await resp.text();
  if (resp.status === 204 || !text) {
    if (!resp.ok) throw new OneDriveApiError(`OneDrive API ${resp.status}`, resp.status);
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
    throw new OneDriveApiError(`OneDrive API ${resp.status}: ${apiMsg}`, resp.status);
  }
  return body;
}

function toSummary(item: Record<string, unknown>): DriveFileSummary {
  const parent = item.parentReference as { id?: string } | undefined;
  const folder = item.folder != null;
  return {
    id: String(item.id ?? ''),
    name: String(item.name ?? ''),
    mimeType: folder
      ? 'application/vnd.ms-onedrive.folder'
      : String((item.file as { mimeType?: string } | undefined)?.mimeType ?? 'application/octet-stream'),
    webViewLink: String(item.webUrl ?? ''),
    modifiedTime: String(item.lastModifiedDateTime ?? ''),
    size: String(item.size ?? ''),
    parents: parent?.id ? [parent.id] : [],
  };
}

export async function oneDriveListFiles(params: {
  accessToken: string;
  query?: string;
  pageSize?: number;
  pageToken?: string | null;
}): Promise<{ files: DriveFileSummary[]; nextPageToken: string | null }> {
  const top = Math.min(50, Math.max(1, params.pageSize ?? 20));
  let url: string;
  if (params.pageToken?.startsWith('https://')) {
    url = params.pageToken;
  } else if (params.query?.trim()) {
    const q = encodeURIComponent(params.query.trim());
    url = `${GRAPH}/me/drive/root/search(q='${q}')?$top=${top}&$select=id,name,size,webUrl,lastModifiedDateTime,file,folder,parentReference`;
  } else {
    url = `${GRAPH}/me/drive/root/children?$top=${top}&$select=id,name,size,webUrl,lastModifiedDateTime,file,folder,parentReference`;
  }

  const result = await graphFetch(params.accessToken, url);
  const values = Array.isArray(result.value) ? (result.value as Record<string, unknown>[]) : [];
  const next =
    typeof result['@odata.nextLink'] === 'string' ? (result['@odata.nextLink'] as string) : null;
  return { files: values.map(toSummary), nextPageToken: next };
}

export async function oneDriveGetFileMeta(params: {
  accessToken: string;
  fileId: string;
}): Promise<DriveFileSummary> {
  const result = await graphFetch(
    params.accessToken,
    `${GRAPH}/me/drive/items/${encodeURIComponent(params.fileId)}?$select=id,name,size,webUrl,lastModifiedDateTime,file,folder,parentReference`,
  );
  return toSummary(result);
}

export async function oneDriveGetFileContent(params: {
  accessToken: string;
  fileId: string;
}): Promise<{ fileId: string; name: string; mimeType: string; contentText: string }> {
  const meta = await oneDriveGetFileMeta({
    accessToken: params.accessToken,
    fileId: params.fileId,
  });
  if (meta.mimeType === 'application/vnd.ms-onedrive.folder') {
    throw new OneDriveApiError('Cannot download folder content; use action=list with parentId', 400);
  }

  const resp = await fetch(
    `${GRAPH}/me/drive/items/${encodeURIComponent(params.fileId)}/content`,
    { headers: { Authorization: `Bearer ${params.accessToken}` }, redirect: 'follow' },
  );
  const buf = Buffer.from(await resp.arrayBuffer());
  if (!resp.ok) {
    throw new OneDriveApiError(`OneDrive download failed (${resp.status})`, resp.status);
  }
  const asText = buf.toString('utf8');
  const contentText = /[\x00-\x08\x0E-\x1F]/.test(asText.slice(0, 200))
    ? `[binary file ${meta.name}; ${buf.length} bytes — not shown as text]`
    : asText.slice(0, 200_000);

  return {
    fileId: meta.id,
    name: meta.name,
    mimeType: meta.mimeType,
    contentText,
  };
}

export async function oneDriveCreateFile(params: {
  accessToken: string;
  name: string;
  contentText?: string;
  mimeType?: string;
  parentId?: string | null;
}): Promise<DriveFileSummary> {
  const mimeType = params.mimeType?.trim() || 'text/plain';
  const safeName = params.name.replace(/[\\/:*?"<>|]/g, '_');
  const path = params.parentId?.trim()
    ? `${GRAPH}/me/drive/items/${encodeURIComponent(params.parentId.trim())}:/${encodeURIComponent(safeName)}:/content`
    : `${GRAPH}/me/drive/root:/${encodeURIComponent(safeName)}:/content`;

  const resp = await fetch(path, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': mimeType,
    },
    body: params.contentText ?? '',
  });
  const text = await resp.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    body = { raw: text.slice(0, 400) };
  }
  if (!resp.ok) {
    const apiMsg =
      (body.error as { message?: string } | undefined)?.message ?? text.slice(0, 300);
    throw new OneDriveApiError(`OneDrive create failed (${resp.status}): ${apiMsg}`, resp.status);
  }
  return toSummary(body);
}

export async function oneDriveUpdateFile(params: {
  accessToken: string;
  fileId: string;
  name?: string;
  contentText?: string;
  mimeType?: string;
}): Promise<DriveFileSummary> {
  if (params.name?.trim()) {
    await graphFetch(
      params.accessToken,
      `${GRAPH}/me/drive/items/${encodeURIComponent(params.fileId)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: params.name.trim() }),
      },
    );
  }

  if (params.contentText != null) {
    const mimeType = params.mimeType?.trim() || 'text/plain';
    const resp = await fetch(
      `${GRAPH}/me/drive/items/${encodeURIComponent(params.fileId)}/content`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${params.accessToken}`,
          'Content-Type': mimeType,
        },
        body: params.contentText,
      },
    );
    if (!resp.ok) {
      const text = await resp.text();
      throw new OneDriveApiError(`OneDrive update failed (${resp.status}): ${text.slice(0, 300)}`, resp.status);
    }
  }

  return oneDriveGetFileMeta({ accessToken: params.accessToken, fileId: params.fileId });
}

export async function oneDriveDeleteFile(params: {
  accessToken: string;
  fileId: string;
}): Promise<{ fileId: string; status: 'deleted' }> {
  await graphFetch(
    params.accessToken,
    `${GRAPH}/me/drive/items/${encodeURIComponent(params.fileId)}`,
    { method: 'DELETE' },
  );
  return { fileId: params.fileId, status: 'deleted' };
}
