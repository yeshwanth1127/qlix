import * as vscode from 'vscode';
import type { OfflineQueue } from '../queue/offlineQueue';
import type { SessionManager } from '../state/session';

type ResultKind = 'test_result' | 'build_result' | 'lint_result';

function classify(haystack: string): ResultKind | null {
  const s = haystack.toLowerCase();
  if (/\b(test|jest|vitest|pytest|mocha)\b/.test(s)) return 'test_result';
  if (/\b(lint|eslint|ruff|flake8)\b/.test(s)) return 'lint_result';
  if (/\b(build|webpack|vite|tsc|compile)\b/.test(s)) return 'build_result';
  return null;
}

function commandFromTask(task: vscode.Task): string {
  const execution = task.execution;
  if (execution instanceof vscode.ShellExecution) {
    if (typeof execution.commandLine === 'string') return execution.commandLine;
    const cmd = execution.command;
    const command = typeof cmd === 'string' ? cmd : cmd?.value ?? '';
    const args = (execution.args ?? []).map((a) => (typeof a === 'string' ? a : a.value));
    return [command, ...args].join(' ').trim();
  }
  if (execution instanceof vscode.ProcessExecution) {
    return [execution.process, ...(execution.args ?? [])].join(' ').trim();
  }
  return task.name;
}

/**
 * Build/test/lint results, captured via VS Code's Task system — only catches
 * tasks run through it (the Terminal "Run Task" dropdown, `npm: test`, etc.),
 * not ad-hoc terminal typing, which TerminalWatcher covers separately.
 */
export class TaskWatcher implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly startedAt = new Map<string, number>();

  constructor(
    private readonly session: SessionManager,
    private readonly queue: OfflineQueue,
  ) {}

  start(): void {
    this.disposables.push(
      vscode.tasks.onDidStartTaskProcess((e) => {
        this.startedAt.set(this.key(e.execution), Date.now());
      }),
      vscode.tasks.onDidEndTaskProcess((e) => void this.onEnd(e)),
    );
  }

  dispose(): void {
    this.startedAt.clear();
    for (const d of this.disposables) d.dispose();
  }

  private isActive(): boolean {
    return this.session.phase === 'monitoring' && this.session.isBoundToOpenWorkspace();
  }

  private key(execution: vscode.TaskExecution): string {
    return `${execution.task.name}::${execution.task.source}`;
  }

  private async onEnd(e: vscode.TaskProcessEndEvent): Promise<void> {
    if (!this.isActive()) return;
    const task = e.execution.task;
    const kind = classify(`${task.name} ${task.source}`);
    if (!kind) return;

    const key = this.key(e.execution);
    const startTime = this.startedAt.get(key);
    this.startedAt.delete(key);

    await this.queue.enqueue({
      kind,
      occurredAt: new Date().toISOString(),
      redacted: false,
      payload: {
        command: commandFromTask(task),
        exitCode: e.exitCode,
        success: e.exitCode === 0,
        ...(startTime ? { durationMs: Date.now() - startTime } : {}),
      },
    });
  }
}
