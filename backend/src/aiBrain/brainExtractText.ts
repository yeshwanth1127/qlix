import path from 'node:path';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import { PDFParse } from 'pdf-parse';

const MAX_EXTRACT_CHARS = 2_000_000;

const TEXT_LIKE_EXT = new Set([
  '.txt',
  '.md',
  '.csv',
  '.tsv',
  '.html',
  '.htm',
  '.xml',
  '.json',
  '.log',
  '.tsx',
  '.ts',
  '.jsx',
  '.js',
  '.mjs',
  '.cjs',
  '.css',
  '.scss',
  '.less',
  '.yml',
  '.yaml',
  '.sql',
  '.sh',
  '.bash',
  '.env',
  '.ini',
  '.rst',
  '.rtf',
]);

function truncate(s: string): string {
  if (s.length <= MAX_EXTRACT_CHARS) return s;
  return `${s.slice(0, MAX_EXTRACT_CHARS)}\n\n[…truncated]`;
}

function decodeUtf8(buffer: Buffer): string {
  return buffer.toString('utf8');
}

/** Heuristic: reject obvious binary when guessing text from unknown extensions. */
function hasManyNulBytes(s: string, sample = 4000): boolean {
  const end = Math.min(s.length, sample);
  let nul = 0;
  for (let i = 0; i < end; i++) {
    if (s.charCodeAt(i) === 0) nul++;
  }
  return nul > 8;
}

async function extractPdf(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const tr = await parser.getText();
    return (tr.text ?? '').trim();
  } finally {
    await parser.destroy();
  }
}

async function extractDocx(buffer: Buffer): Promise<string> {
  const { value } = await mammoth.extractRawText({ buffer });
  return (value ?? '').trim();
}

function extractSpreadsheet(buffer: Buffer): string {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  let out = '';
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    if (sheet) out += XLSX.utils.sheet_to_csv(sheet) + '\n';
  }
  return out.trim();
}

/**
 * Best-effort text extraction for AI Brain ingest. Unsupported binary types throw a clear Error.
 */
export async function extractTextFromUpload(buffer: Buffer, originalFilename: string): Promise<string> {
  const ext = path.extname(originalFilename || '').toLowerCase();
  const safeName = originalFilename || 'upload';

  let raw: string;

  if (ext === '.pdf') {
    raw = await extractPdf(buffer);
  } else if (ext === '.docx') {
    raw = await extractDocx(buffer);
  } else if (ext === '.xlsx' || ext === '.xls') {
    raw = extractSpreadsheet(buffer);
  } else if (TEXT_LIKE_EXT.has(ext) || ext === '') {
    raw = decodeUtf8(buffer);
    if (hasManyNulBytes(raw)) {
      throw new Error(
        'This file looks binary. Upload a PDF, Word (.docx), Excel (.xls/.xlsx), or a plain text file.',
      );
    }
  } else {
    raw = decodeUtf8(buffer);
    if (!raw.trim() || hasManyNulBytes(raw)) {
      throw new Error(
        `Could not read text from "${path.basename(safeName)}". Supported: PDF, Word (.docx), Excel (.xls/.xlsx), and text-based files (e.g. .txt, .md, .csv, .html, .json).`,
      );
    }
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('No text could be extracted from this file (empty content).');
  }
  return truncate(trimmed);
}
