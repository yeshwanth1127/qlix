import * as vscode from 'vscode';
import archiver from 'archiver';
import { PassThrough } from 'node:stream';
import { isSensitivePath, redactSecrets } from '../redaction/secretScan';
import { SCAN_EXCLUDE_GLOB } from './scanExcludes';

const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;
const MAX_FILES = 5000;

// Extensions skipped from the (best-effort, text-only) secret scan — binary
// content isn't meaningfully scannable and shouldn't be decoded as utf-8.
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.pdf', '.zip', '.gz', '.tar',
  '.mp4', '.mp3', '.wav', '.woff', '.woff2', '.ttf', '.eot', '.exe', '.dll',
  '.so', '.dylib', '.class', '.jar', '.wasm',
]);

/**
 * Zips the working tree for the final "actual submitted code" deliverable —
 * same exclude list as the structure snapshot, plus: sensitive-pattern files
 * are omitted entirely (never even a placeholder), text file contents are
 * run through the same secret redaction as routine evidence, and the total
 * is capped so a large asset-heavy repo doesn't produce a multi-hundred-MB
 * upload over the device-token API. Oversized files are skipped from the
 * *archive bytes* only — they're still listed in the ProjectSnapshot's
 * fileHashes from captureProjectSnapshot, so nothing is silently lost from
 * the record, only from the zip itself.
 */
export async function buildSourceArchive(): Promise<Buffer | null> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return null;

  const uris = await vscode.workspace.findFiles(
    new vscode.RelativePattern(folder, '**/*'),
    SCAN_EXCLUDE_GLOB,
    MAX_FILES,
  );

  const archive = archiver('zip', { zlib: { level: 6 } });
  const chunks: Buffer[] = [];
  const output = new PassThrough();
  output.on('data', (chunk: Buffer) => chunks.push(chunk));
  archive.pipe(output);

  let totalBytes = 0;
  for (const uri of uris) {
    const relPath = vscode.workspace.asRelativePath(uri, false);
    if (isSensitivePath(relPath)) continue;

    let stat: vscode.FileStat;
    try {
      stat = await vscode.workspace.fs.stat(uri);
    } catch {
      continue;
    }
    if (stat.type !== vscode.FileType.File) continue;
    if (totalBytes + stat.size > MAX_ARCHIVE_BYTES) continue;

    let bytes: Uint8Array;
    try {
      bytes = await vscode.workspace.fs.readFile(uri);
    } catch {
      continue;
    }

    let payload = Buffer.from(bytes);
    const ext = relPath.slice(relPath.lastIndexOf('.')).toLowerCase();
    if (!BINARY_EXTENSIONS.has(ext)) {
      const { text } = redactSecrets(payload.toString('utf-8'));
      payload = Buffer.from(text, 'utf-8');
    }

    archive.append(payload, { name: relPath });
    totalBytes += payload.length;
  }

  const done = new Promise<void>((resolve) => output.once('end', resolve));
  await archive.finalize();
  await done;
  return Buffer.concat(chunks);
}
