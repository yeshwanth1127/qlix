import { Buffer } from 'node:buffer';

/**
 * Talks to the sandbox file store hosted in the qlix-mcp service. The store keeps
 * generated report PDFs; the backend uploads bytes to it and later streams them back
 * to the user's browser via createSandboxRouter (server-side proxy, so the mcp service
 * stays internal-only).
 */

function mcpBase(): string {
  const explicit = process.env.QLIX_MCP_SANDBOX_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, '');
  const mcp =
    process.env.QLIX_MCP_URL?.trim()?.replace(/\/mcp\/?$/, '') ||
    process.env.QLIX_MCP_LEADS_URL?.trim()?.replace(/\/mcp\/?$/, '');
  return (mcp || 'http://127.0.0.1:3940').replace(/\/$/, '');
}

/** Public origin the browser uses to reach this API (for building download links). */
function publicApiBase(): string {
  const url = process.env.PUBLIC_API_URL?.trim();
  return (url || `http://localhost:${process.env.PORT?.trim() || '4000'}`).replace(/\/$/, '');
}

function serviceSecret(): string {
  const secret = process.env.QLIX_INTERNAL_SERVICE_SECRET?.trim();
  if (!secret) throw new Error('QLIX_INTERNAL_SERVICE_SECRET is not configured');
  return secret;
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^\w.\-]+/g, '_').slice(0, 120) || 'report.pdf';
}

export interface StoredSandboxFile {
  id: string;
  url: string;
  expiresAt: number | null;
}

/** Upload bytes to the sandbox store; returns a browser-facing download URL. */
export async function storeSandboxFile(
  bytes: Buffer,
  fileName: string,
  contentType = 'application/pdf',
): Promise<StoredSandboxFile> {
  const resp = await fetch(`${mcpBase()}/sandbox`, {
    method: 'POST',
    headers: {
      'Content-Type': contentType,
      'X-Content-Type': contentType,
      'X-Service-Secret': serviceSecret(),
      'X-File-Name': sanitizeFileName(fileName),
    },
    body: new Uint8Array(bytes),
  });
  if (!resp.ok) {
    throw new Error(`sandbox store failed: HTTP ${resp.status}`);
  }
  const data = (await resp.json()) as { id?: string; expiresAt?: number };
  if (!data.id) throw new Error('sandbox store returned no id');
  return {
    id: data.id,
    url: `${publicApiBase()}/api/v1/sandbox/${data.id}`,
    expiresAt: data.expiresAt ?? null,
  };
}

export interface SandboxDownload {
  contentType: string;
  fileName: string;
  body: Buffer;
}

/** Fetch a stored file (server-side) for the public download proxy. Null if missing/expired. */
export async function fetchSandboxFile(id: string): Promise<SandboxDownload | null> {
  const resp = await fetch(`${mcpBase()}/sandbox/${id}`, {
    headers: { 'X-Service-Secret': serviceSecret() },
  });
  if (!resp.ok) return null;
  const body = Buffer.from(await resp.arrayBuffer());
  const contentType = resp.headers.get('content-type') || 'application/pdf';
  const disposition = resp.headers.get('content-disposition') || '';
  const match = /filename="?([^"]+)"?/.exec(disposition);
  return { contentType, fileName: match?.[1] || 'report.pdf', body };
}
