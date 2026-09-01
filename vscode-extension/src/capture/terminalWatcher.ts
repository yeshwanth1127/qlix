import * as vscode from 'vscode';
import type { OfflineQueue } from '../queue/offlineQueue';
import type { SessionManager } from '../state/session';
import { redactSecrets } from '../redaction/secretScan';

const INSTALLER_PATTERNS: ReadonlyArray<{ manager: string; re: RegExp }> = [
  { manager: 'npm', re: /^npm\s+(i|install)\b/ },
  { manager: 'pnpm', re: /^pnpm\s+add\b/ },
  { manager: 'yarn', re: /^yarn\s+add\b/ },
  { manager: 'pip', re: /^pip3?\s+install\b/ },
  { manager: 'poetry', re: /^poetry\s+add\b/ },
  { manager: 'cargo', re: /^cargo\s+add\b/ },
  { manager: 'go', re: /^go\s+get\b/ },
  { manager: 'bundler', re: /^(bundle\s+add|gem\s+install)\b/ },
];

/**
 * Actual terminal commands the student ran, via the Shell Integration API
 * (`onDidEndTerminalShellExecution`) — gives the real command line and exit
 * code without scraping terminal buffer text. Redacted through the same
 * redactSecrets() used elsewhere before it ever leaves the machine, since a
 * command line can itself contain a secret (`export API_KEY=sk-...`).
 * Requires VS Code 1.93+ (declared in package.json's engines.vscode).
 */
export class TerminalWatcher implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly session: SessionManager,
    private readonly queue: OfflineQueue,
  ) {}

  start(): void {
    this.disposables.push(vscode.window.onDidEndTerminalShellExecution((e) => void this.onEnd(e)));
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }

  private isActive(): boolean {
    return this.session.phase === 'monitoring' && this.session.isBoundToOpenWorkspace();
  }

  private async onEnd(e: vscode.TerminalShellExecutionEndEvent): Promise<void> {
    if (!this.isActive()) return;
    const raw = e.execution.commandLine.value.trim();
    if (!raw) return;

    const { text: command, redactionApplied } = redactSecrets(raw);
    const exitCode = e.exitCode;
    const success = exitCode === 0 || exitCode === undefined;

    await this.queue.enqueue({
      kind: 'terminal_event',
      occurredAt: new Date().toISOString(),
      redacted: redactionApplied,
      payload: { command, exitCode, success },
    });

    const installer = INSTALLER_PATTERNS.find((p) => p.re.test(command));
    if (installer) {
      await this.queue.enqueue({
        kind: 'dependency_event',
        occurredAt: new Date().toISOString(),
        redacted: redactionApplied,
        payload: { manager: installer.manager, command, exitCode, success },
      });
    }
  }
}
