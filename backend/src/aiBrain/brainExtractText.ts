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
  '.svg',
  '.json',
  '.jsonl',
  '.ndjson',
  '.ipynb',
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
  '.py',
  '.java',
  '.c',
  '.cc',
  '.cpp',
  '.h',
  '.hpp',
  '.go',
  '.rs',
  '.rb',
  '.php',
  '.swift',
  '.kt',
  '.kts',
  '.scala',
  '.lua',
  '.pl',
  '.sh',
  '.bash',
  '.env',
  '.toml',
  '.properties',
  '.conf',
  '.config',
  '.ini',
  '.rst',
  '.tex',
  '.srt',
  '.vtt',
  '.eml',
  '.ics',
  '.rtf',
]);

const JSON_EXT = new Set(['.json', '.jsonl', '.ndjson', '.ipynb']);
const HTML_EXT = new Set(['.html', '.htm']);

function truncate(s: string): string {
  if (s.length <= MAX_EXTRACT_CHARS) return s;
  return `${s.slice(0, MAX_EXTRACT_CHARS)}\n\n[…truncated]`;
}

function decodeText(buffer: Buffer): string {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.subarray(2).toString('utf16le');
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.allocUnsafe(buffer.length - 2);
    for (let i = 2; i + 1 < buffer.length; i += 2) {
      swapped[i - 2] = buffer[i + 1] ?? 0;
      swapped[i - 1] = buffer[i] ?? 0;
    }
    return swapped.toString('utf16le');
  }
  const utf8 = buffer.toString('utf8');
  return utf8.charCodeAt(0) === 0xfeff ? utf8.slice(1) : utf8;
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

function extractJson(raw: string, ext: string, filename: string): string {
  try {
    if (ext === '.json') return JSON.stringify(JSON.parse(raw), null, 2);
    const lines = raw.split(/\r?\n/).filter((line) => line.trim());
    return lines
      .map((line, index) => {
        try {
          return JSON.stringify(JSON.parse(line), null, 2);
        } catch {
          throw new Error(`Invalid JSON on line ${index + 1} of "${path.basename(filename)}".`);
        }
      })
      .join('\n\n');
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Invalid JSON on line')) throw error;
    throw new Error(`"${path.basename(filename)}" contains invalid JSON.`);
  }
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  };
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    if (code[0] !== '#') return named[code.toLowerCase()] ?? entity;
    const radix = code[1]?.toLowerCase() === 'x' ? 16 : 10;
    const digits = radix === 16 ? code.slice(2) : code.slice(1);
    const point = Number.parseInt(digits, radix);
    return Number.isFinite(point) && point >= 0 && point <= 0x10ffff
      ? String.fromCodePoint(point)
      : entity;
  });
}

function extractHtml(raw: string): string {
  return decodeHtmlEntities(
    raw
      .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<\/?(p|div|section|article|header|footer|aside|nav|h[1-6]|li|tr|br)\b[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

function extractRtf(raw: string): string {
  return raw
    .replace(/\\par[d]?\b/g, '\n')
    .replace(/\\'[0-9a-f]{2}/gi, (hex) => String.fromCharCode(Number.parseInt(hex.slice(2), 16)))
    .replace(/\\u(-?\d+)\??/g, (_match, value: string) => String.fromCharCode(Number(value) & 0xffff))
    .replace(/\\[a-z]+-?\d* ?/gi, '')
    .replace(/[{}]/g, '')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
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
  } else if (ext === '.xlsx' || ext === '.xls' || ext === '.ods') {
    raw = extractSpreadsheet(buffer);
  } else if (TEXT_LIKE_EXT.has(ext) || ext === '') {
    raw = decodeText(buffer);
    if (hasManyNulBytes(raw)) {
      throw new Error(
        'This file looks binary and cannot be read as text. Supported binary documents include PDF, Word (.docx), and spreadsheets (.xls, .xlsx, .ods).',
      );
    }
    if (JSON_EXT.has(ext)) raw = extractJson(raw, ext, safeName);
    else if (HTML_EXT.has(ext)) raw = extractHtml(raw);
    else if (ext === '.rtf') raw = extractRtf(raw);
  } else {
    raw = decodeText(buffer);
    if (!raw.trim() || hasManyNulBytes(raw)) {
      throw new Error(
        `Could not read "${path.basename(safeName)}". Supported: PDF, Word (.docx), spreadsheets (.xls, .xlsx, .ods), JSON/JSONL, and text-based files such as TXT, Markdown, CSV, HTML, XML, YAML, RTF, logs, source code, and config files.`,
      );
    }
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('No text could be extracted from this file (empty content).');
  }
  return truncate(trimmed);
}
