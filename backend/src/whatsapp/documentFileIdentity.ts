/**
 * Keep WhatsApp document deliveries from falling back to application/octet-stream
 * (phones often save those as download.bin) when the model omits a file extension.
 */

const MIME_BY_EXT: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.csv': 'text/csv',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.html': 'text/html',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.zip': 'application/zip',
};

function normalizeExt(ext: string | null | undefined): string {
  const e = (ext ?? '').trim().toLowerCase();
  if (!e) return '';
  return e.startsWith('.') ? e : `.${e}`;
}

export function extFromFileName(name: string | null | undefined): string {
  const base = (name ?? '').trim().split(/[/\\]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return '';
  return normalizeExt(base.slice(dot));
}

/** Best-effort magic-byte / ZIP entry sniff when no extension is available. */
export function sniffDocumentExtension(bytes: Buffer): string {
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString('ascii') === '%PDF-') {
    return '.pdf';
  }
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const head = bytes.subarray(0, Math.min(bytes.length, 64 * 1024)).toString('latin1');
    if (head.includes('xl/') || head.includes('xl\\')) return '.xlsx';
    if (head.includes('word/')) return '.docx';
    if (head.includes('ppt/')) return '.pptx';
    return '.zip';
  }
  const textProbe = bytes.subarray(0, Math.min(bytes.length, 256)).toString('utf8').trimStart();
  if (textProbe.startsWith('{') || textProbe.startsWith('[')) return '.json';
  if (textProbe.startsWith('<!DOCTYPE html') || textProbe.startsWith('<html')) return '.html';
  if (textProbe.includes(',') && textProbe.includes('\n') && !textProbe.includes('\0')) {
    return '.csv';
  }
  return '';
}

export function mimeForExtension(ext: string): string | null {
  return MIME_BY_EXT[normalizeExt(ext)] ?? null;
}

/**
 * Resolve a WhatsApp-safe file name + MIME.
 * Prefer an existing extension on `fileName` or `fallbackName`, else sniff bytes.
 */
export function resolveWhatsAppDocumentIdentity(input: {
  fileName?: string | null;
  fallbackName?: string | null;
  bytes?: Buffer | null;
  mimetype?: string | null;
}): { fileName: string; mimetype: string; ext: string } {
  const rawName = (input.fileName ?? '').trim() || (input.fallbackName ?? '').trim() || 'document';
  const base = rawName.split(/[/\\]/).pop() || 'document';
  let ext = extFromFileName(base);
  if (!ext) ext = extFromFileName(input.fallbackName);
  if (!ext && input.bytes && input.bytes.length > 0) {
    ext = sniffDocumentExtension(input.bytes);
  }
  if (!ext) ext = '.bin';

  const stem = extFromFileName(base) ? base.slice(0, base.lastIndexOf('.')) : base;
  const safeStem = stem.replace(/[^\w.\-]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '') || 'document';
  const fileName = `${safeStem}${ext}`.slice(0, 120);

  const mimetype =
    (input.mimetype ?? '').trim() ||
    mimeForExtension(ext) ||
    'application/octet-stream';

  return { fileName, mimetype, ext };
}
