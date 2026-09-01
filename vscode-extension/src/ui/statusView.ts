import * as vscode from 'vscode';
import type { SessionManager } from '../state/session';

export interface QlixActions {
  connect: () => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  submit: () => Promise<void>;
  disconnect: () => Promise<void>;
  answerPendingQuestion: () => Promise<void>;
}

const PHASE_LABELS: Record<string, string> = {
  disconnected: 'Not connected',
  connected: 'Connected — not observing yet',
  monitoring: 'Observing',
  paused: 'Paused',
  submitting: 'Submitting…',
  submitted: 'Submitted',
};

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function button(cmd: string, label: string, warn = false): string {
  return `<button data-cmd="${cmd}" class="${warn ? 'warn' : ''}">${escapeHtml(label)}</button>`;
}

/**
 * Activity Bar sidebar panel — the closest supported equivalent to "a
 * persistent icon the student can glance at," since VS Code's extension API
 * has no free-floating, drag-anywhere overlay. Mirrors the status bar item's
 * state exactly (both subscribe to SessionManager.onDidChangeState) and
 * posts the same actions back through the same functions extension.ts
 * already wires to the status bar's QuickPick menu.
 */
export class QlixStatusViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;

  constructor(
    private readonly session: SessionManager,
    private readonly actions: QlixActions,
  ) {
    session.onDidChangeState(() => this.render());
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.onDidReceiveMessage((message: { command?: string }) => {
      void this.handleMessage(message.command);
    });
    this.render();
  }

  private async handleMessage(command: string | undefined): Promise<void> {
    switch (command) {
      case 'connect':
        return this.actions.connect();
      case 'pause':
        return this.actions.pause();
      case 'resume':
        return this.actions.resume();
      case 'submit':
        return this.actions.submit();
      case 'disconnect':
        return this.actions.disconnect();
      case 'answer':
        return this.actions.answerPendingQuestion();
      default:
        return;
    }
  }

  private render(): void {
    if (!this.view) return;
    this.view.webview.html = this.html();
  }

  private html(): string {
    const phase = this.session.phase;
    const info = this.session.info;
    const pending = this.session.hasPendingQuestion;

    const buttons: string[] = [];
    if (phase === 'disconnected') {
      buttons.push(button('connect', 'Connect Assessment'));
    } else {
      if (pending) buttons.push(button('answer', 'Answer Question', true));
      if (phase === 'monitoring') buttons.push(button('pause', 'Pause Observation'));
      if (phase === 'paused' || phase === 'connected') buttons.push(button('resume', 'Start / Resume Observation'));
      if (phase === 'monitoring' || phase === 'paused') buttons.push(button('submit', 'Submit Project'));
      buttons.push(button('disconnect', 'Disconnect'));
    }

    return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><style>${STYLE}</style></head>
<body>
  <div class="phase">${escapeHtml(PHASE_LABELS[phase] ?? phase)}</div>
  ${info ? `<div class="root">${escapeHtml(info.workspaceRoot)}</div>` : ''}
  ${pending ? '<div class="banner">Qlix has a question waiting for you</div>' : ''}
  <div class="actions">${buttons.join('')}</div>
  <script>
    const vscode = acquireVsCodeApi();
    document.querySelectorAll('button[data-cmd]').forEach((el) => {
      el.addEventListener('click', () => vscode.postMessage({ command: el.getAttribute('data-cmd') }));
    });
  </script>
</body>
</html>`;
  }
}

const STYLE = `
  body { font-family: var(--vscode-font-family); padding: 8px; color: var(--vscode-foreground); }
  .phase { font-weight: 600; margin-bottom: 4px; }
  .root { font-size: 11px; opacity: 0.7; margin-bottom: 8px; word-break: break-all; }
  .banner { background: var(--vscode-inputValidation-warningBackground); border: 1px solid var(--vscode-inputValidation-warningBorder); padding: 6px; margin-bottom: 8px; font-size: 12px; }
  .actions { display: flex; flex-direction: column; gap: 6px; }
  button { padding: 6px 8px; border: 1px solid var(--vscode-button-border, transparent); background: var(--vscode-button-background); color: var(--vscode-button-foreground); cursor: pointer; border-radius: 2px; font-size: 12px; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.warn { background: var(--vscode-inputValidation-warningBackground); color: var(--vscode-foreground); }
`;
