import * as vscode from 'vscode';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { OfflineQueue } from '../queue/offlineQueue';
import type { SessionManager } from '../state/session';

const execFileAsync = promisify(execFile);
const FIELD_SEP = '\x1f';

/**
 * Detects commits by watching .git/logs/HEAD (the ref-update log Git itself
 * appends to on every commit/checkout/merge) rather than polling — cheap and
 * catches commits made from any tool, not just VS Code's own Git panel.
 */
export class GitWatcher implements vscode.Disposable {
  private watcher: vscode.FileSystemWatcher | undefined;
  private lastCommitHash: string | undefined;

  constructor(
    private readonly session: SessionManager,
    private readonly queue: OfflineQueue,
  ) {}

  start(): void {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) return;
    const pattern = new vscode.RelativePattern(folder, '.git/logs/HEAD');
    this.watcher = vscode.workspace.createFileSystemWatcher(pattern);
    this.watcher.onDidChange(() => void this.checkForNewCommit());
    this.watcher.onDidCreate(() => void this.checkForNewCommit());
  }

  dispose(): void {
    this.watcher?.dispose();
  }

  private isActive(): boolean {
    return this.session.phase === 'monitoring' && this.session.isBoundToOpenWorkspace();
  }

  private async checkForNewCommit(): Promise<void> {
    if (!this.isActive()) return;
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) return;

    try {
      const { stdout } = await execFileAsync(
        'git',
        ['log', '-1', `--format=%H${FIELD_SEP}%an${FIELD_SEP}%aI${FIELD_SEP}%s`],
        { cwd: folder.uri.fsPath, timeout: 5000 },
      );
      const [hash, authorName, authorDate, subject] = stdout.trim().split(FIELD_SEP);
      if (!hash || hash === this.lastCommitHash) return;
      this.lastCommitHash = hash;

      const { stdout: statOut } = await execFileAsync(
        'git',
        ['show', '--stat', '--format=', hash],
        { cwd: folder.uri.fsPath, timeout: 5000 },
      ).catch(() => ({ stdout: '' }));

      await this.queue.enqueue(
        {
          kind: 'git_event',
          occurredAt: authorDate ? new Date(authorDate).toISOString() : new Date().toISOString(),
          redacted: false,
          payload: {
            type: 'commit',
            hash,
            authorName,
            subject,
            changedFilesSummary: statOut.trim().slice(0, 2000),
          },
        },
        true, // commits are milestones — flush immediately, don't wait for the batch timer
      );
    } catch {
      // Not a git repo, git not on PATH, or a transient read race with the log
      // file mid-write — safe to skip; the next HEAD change retries.
    }
  }
}
