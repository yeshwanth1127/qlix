import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import PDFDocument from 'pdfkit';
import { prisma } from '../lib/prisma.js';

function brainFilesRoot(): string {
  const fromEnv = process.env.QLIX_BRAIN_FILES_DIR?.trim();
  if (fromEnv) return fromEnv;
  return join(process.cwd(), 'data', 'brain-files');
}

function safeFileName(name: string): string {
  const base = basename(String(name || 'document').trim() || 'document');
  return base.replace(/[^\w.\-()+ ]+/g, '_').slice(0, 180) || 'document.bin';
}

export async function storeBrainOriginalFile(input: {
  orgId: string;
  documentId: string;
  fileName: string;
  mimeType?: string | null;
  bytes: Buffer;
}): Promise<{ storageKey: string; originalFileName: string; originalMimeType: string }> {
  const originalFileName = safeFileName(input.fileName);
  const originalMimeType =
    (input.mimeType && String(input.mimeType).trim()) ||
    guessMimeFromName(originalFileName) ||
    'application/octet-stream';
  const storageKey = join(input.orgId, input.documentId, originalFileName);
  const abs = join(brainFilesRoot(), storageKey);
  await mkdir(join(brainFilesRoot(), input.orgId, input.documentId), { recursive: true });
  await writeFile(abs, input.bytes);
  return { storageKey, originalFileName, originalMimeType };
}

function guessMimeFromName(fileName: string): string | null {
  const ext = extname(fileName).toLowerCase();
  const map: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
  };
  return map[ext] ?? null;
}

async function renderBodyTextPdf(title: string, bodyText: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.fontSize(16).text(title || 'Document', { underline: true });
    doc.moveDown();
    doc.fontSize(11).text(bodyText.slice(0, 100_000), { align: 'left' });
    doc.end();
  });
}

/**
 * Load a brain document as sendable file bytes.
 * Prefers retained original upload; falls back to a generated PDF from bodyText.
 */
export async function loadBrainDocumentFile(input: {
  orgId: string;
  documentId: string;
}): Promise<{
  fileName: string;
  mimetype: string;
  bytes: Buffer;
  source: 'original' | 'generated_pdf';
  title: string;
}> {
  const doc = await prisma.brainKnowledgeDocument.findFirst({
    where: { id: input.documentId, orgId: input.orgId },
    select: {
      id: true,
      title: true,
      bodyText: true,
      originalFileName: true,
      originalMimeType: true,
      storageKey: true,
    },
  });
  if (!doc) throw new Error('Document not found');

  if (doc.storageKey) {
    const abs = join(brainFilesRoot(), doc.storageKey);
    try {
      const bytes = await readFile(abs);
      if (bytes.length > 0) {
        return {
          fileName: doc.originalFileName || safeFileName(doc.title) || 'document.bin',
          mimetype: doc.originalMimeType || guessMimeFromName(doc.originalFileName || '') || 'application/octet-stream',
          bytes,
          source: 'original',
          title: doc.title,
        };
      }
    } catch {
      /* fall through to generated PDF */
    }
  }

  const title = doc.title || 'Document';
  const fileName = `${safeFileName(title.replace(/\.pdf$/i, ''))}.pdf`;
  const bytes = await renderBodyTextPdf(title, doc.bodyText || '');
  return {
    fileName,
    mimetype: 'application/pdf',
    bytes,
    source: 'generated_pdf',
    title,
  };
}

export async function findBrainDocumentsForAgent(input: {
  orgId: string;
  query?: string;
  limit?: number;
}): Promise<
  Array<{
    documentId: string;
    title: string;
    collectionId: string;
    collectionName: string;
    hasOriginalFile: boolean;
  }>
> {
  const q = input.query?.trim();
  const limit = Math.min(20, Math.max(1, input.limit ?? 8));
  const rows = await prisma.brainKnowledgeDocument.findMany({
    where: {
      orgId: input.orgId,
      ...(q
        ? {
            OR: [
              { title: { contains: q, mode: 'insensitive' } },
              { bodyText: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    orderBy: { updatedAt: 'desc' },
    take: limit,
    select: {
      id: true,
      title: true,
      collectionId: true,
      storageKey: true,
      collection: { select: { name: true } },
    },
  });
  return rows.map((r) => ({
    documentId: r.id,
    title: r.title,
    collectionId: r.collectionId,
    collectionName: r.collection.name,
    hasOriginalFile: Boolean(r.storageKey),
  }));
}

/** Pick the org brain file that looks like a brochure (title/filename), preferring a retained original. */
export async function findBrainBrochureDocument(
  orgId: string,
): Promise<{ documentId: string; title: string } | null> {
  const rows = await prisma.brainKnowledgeDocument.findMany({
    where: { orgId, ingestStatus: 'ready' },
    orderBy: { updatedAt: 'desc' },
    take: 80,
    select: {
      id: true,
      title: true,
      originalFileName: true,
      storageKey: true,
    },
  });
  const scored = rows
    .map((row) => {
      const hay = `${row.title} ${row.originalFileName ?? ''}`.toLowerCase();
      let score = 0;
      if (hay.includes('brochure')) score += 10;
      if (hay.includes('.pdf') || hay.endsWith('pdf')) score += 3;
      if (row.storageKey) score += 2;
      return { row, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
  const best = scored[0]?.row;
  if (!best) return null;
  return { documentId: best.id, title: best.title };
}

/** Stage bytes under os.tmpdir for WhatsApp sidecar allowlist. */
export async function stageBytesForWhatsApp(fileName: string, bytes: Buffer): Promise<string> {
  const safe = safeFileName(fileName);
  const path = join(tmpdir(), `qlix-wa-brain-${randomUUID()}-${safe}`);
  await writeFile(path, bytes);
  return path;
}
