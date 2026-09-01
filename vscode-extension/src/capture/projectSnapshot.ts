import * as vscode from 'vscode';
import * as crypto from 'node:crypto';
import type { SessionManager } from '../state/session';
import { submitSnapshot, type FileHashEntry } from '../api/client';
import { SCAN_EXCLUDE_GLOB } from './scanExcludes';
import { isSensitivePath } from '../redaction/secretScan';

const MAX_FILES = 3000;
const MAX_FILE_BYTES_TO_HASH = 5 * 1024 * 1024;

/**
 * A point-in-time structural fingerprint of the project — folder shape and
 * per-file hashes, not routine evidence. Fills the ProjectSnapshot model.
 * Sensitive-pattern files and oversized files are recorded (path + size) but
 * never hashed/read past that — same redaction discipline as FileWatcher.
 */
export async function captureProjectSnapshot(session: SessionManager, label: string): Promise<string | null> {
  const token = await session.getToken();
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!token || !folder) return null;

  const uris = await vscode.workspace.findFiles(
    new vscode.RelativePattern(folder, '**/*'),
    SCAN_EXCLUDE_GLOB,
    MAX_FILES,
  );

  const fileHashes: FileHashEntry[] = [];
  for (const uri of uris) {
    const relPath = vscode.workspace.asRelativePath(uri, false);
    if (isSensitivePath(relPath)) {
      fileHashes.push({ path: relPath, sizeBytes: 0, skipped: true });
      continue;
    }
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.type !== vscode.FileType.File) continue;
      if (stat.size > MAX_FILE_BYTES_TO_HASH) {
        fileHashes.push({ path: relPath, sizeBytes: stat.size, skipped: true });
        continue;
      }
      const bytes = await vscode.workspace.fs.readFile(uri);
      const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
      fileHashes.push({ path: relPath, sha256, sizeBytes: stat.size });
    } catch {
      // Unreadable or a race with a concurrent write — skip this one file, not the whole snapshot.
    }
  }

  const fileTreeHash = crypto
    .createHash('sha256')
    .update(fileHashes.map((f) => f.path).sort().join('\n'))
    .digest('hex');

  try {
    const { snapshotId } = await submitSnapshot(token, { label, fileTreeHash, fileHashes });
    return snapshotId;
  } catch {
    return null;
  }
}
