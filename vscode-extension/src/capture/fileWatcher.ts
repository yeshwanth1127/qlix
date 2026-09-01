import * as vscode from 'vscode';
import * as path from 'node:path';
import type { OfflineQueue } from '../queue/offlineQueue';
import type { SessionManager } from '../state/session';
import { isSensitivePath } from '../redaction/secretScan';
import { isDependencyManifest } from './scanExcludes';

const SAVE_DEBOUNCE_MS = 3000;

/**
 * Captures file saves/creates/deletes/renames as small, structured metadata
 * events — never raw file content, and never anything for a sensitive path
 * (.env, keys, etc.) beyond the fact that it changed. Only active while the
 * session is 'monitoring' and the open folder matches the bound workspace.
 *
 * Critical boundary, found broken in real testing: `onDidSaveTextDocument`
 * fires for ANY document saved in the editor while this window has focus —
 * including VS Code's own global settings.json, or any other file the user
 * opens via the command palette — not just files inside the project folder.
 * Matching the *workspace folder* is not the same as matching the *file*.
 * Every record path below is gated on isWithinBoundWorkspace(uri), which
 * checks the actual file path, not just which folder VS Code has open.
 */
export class FileWatcher implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly pendingSaves = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly session: SessionManager,
    private readonly queue: OfflineQueue,
  ) {}

  start(): void {
    this.disposables.push(
      vscode.workspace.onDidSaveTextDocument((doc) => this.onSave(doc)),
      vscode.workspace.onDidCreateFiles((event) => this.onCreateOrDelete(event.files, 'created')),
      vscode.workspace.onDidDeleteFiles((event) => this.onCreateOrDelete(event.files, 'deleted')),
      vscode.workspace.onDidRenameFiles((event) => {
        for (const { oldUri, newUri } of event.files) {
          if (!this.isWithinBoundWorkspace(newUri)) continue;
          void this.record('renamed', newUri, { from: this.relativePath(oldUri) });
        }
      }),
    );
  }

  dispose(): void {
    for (const timeout of this.pendingSaves.values()) clearTimeout(timeout);
    this.pendingSaves.clear();
    for (const d of this.disposables) d.dispose();
  }

  private isActive(): boolean {
    return this.session.phase === 'monitoring' && this.session.isBoundToOpenWorkspace();
  }

  /** The real boundary check: is this specific file actually inside the bound
   * workspace root, not just "is the right folder open in this window." */
  private isWithinBoundWorkspace(uri: vscode.Uri): boolean {
    const root = this.session.info?.workspaceRoot;
    if (!root) return false;
    if (uri.scheme !== 'file') return false;
    const rel = path.relative(root, uri.fsPath);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  }

  private relativePath(uri: vscode.Uri): string {
    return vscode.workspace.asRelativePath(uri, false);
  }

  private onSave(doc: vscode.TextDocument): void {
    if (!this.isActive() || !this.isWithinBoundWorkspace(doc.uri)) return;
    const path = this.relativePath(doc.uri);
    const existing = this.pendingSaves.get(path);
    if (existing) clearTimeout(existing);
    this.pendingSaves.set(
      path,
      setTimeout(() => {
        this.pendingSaves.delete(path);
        void this.recordSave(doc);
      }, SAVE_DEBOUNCE_MS),
    );
  }

  private async recordSave(doc: vscode.TextDocument): Promise<void> {
    const path = this.relativePath(doc.uri);
    if (isSensitivePath(path)) {
      await this.record('saved', doc.uri, { sensitive: true }, true);
      return;
    }
    await this.record('saved', doc.uri, {
      sizeBytes: Buffer.byteLength(doc.getText(), 'utf-8'),
      lineCount: doc.lineCount,
      languageId: doc.languageId,
      isDependencyManifest: isDependencyManifest(path),
    });
  }

  private onCreateOrDelete(files: readonly vscode.Uri[], changeType: 'created' | 'deleted'): void {
    if (!this.isActive()) return;
    for (const uri of files) {
      if (!this.isWithinBoundWorkspace(uri)) continue;
      const relPath = this.relativePath(uri);
      void this.record(changeType, uri, {
        sensitive: isSensitivePath(relPath),
        isDependencyManifest: isDependencyManifest(relPath),
      });
    }
  }

  private async record(
    changeType: string,
    uri: vscode.Uri,
    extra: Record<string, unknown>,
    redacted = false,
  ): Promise<void> {
    // Defense in depth — every call site above already checks this, but a
    // future call site that forgets to must not be able to leak an out-of-scope path.
    if (!this.isActive() || !this.isWithinBoundWorkspace(uri)) return;
    await this.queue.enqueue({
      kind: 'file_snapshot',
      occurredAt: new Date().toISOString(),
      redacted,
      payload: { path: this.relativePath(uri), changeType, ...extra },
    });
  }
}
