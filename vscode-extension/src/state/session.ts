import * as vscode from 'vscode';

export type SessionPhase =
  | 'disconnected'
  | 'connected'
  | 'monitoring'
  | 'paused'
  | 'submitting'
  | 'submitted';

export interface SessionInfo {
  sessionId: string;
  orgId: string;
  workspaceRoot: string;
}

const SECRET_TOKEN_KEY = 'qlix.deviceToken';
const STATE_INFO_KEY = 'qlix.sessionInfo';
const STATE_PHASE_KEY = 'qlix.sessionPhase';

const PHASE_LABELS: Record<SessionPhase, string> = {
  disconnected: '$(circle-slash) Qlix: not connected',
  connected: '$(plug) Qlix: connected',
  monitoring: '$(eye) Qlix: observing',
  paused: '$(debug-pause) Qlix: paused',
  submitting: '$(sync~spin) Qlix: submitting…',
  submitted: '$(check) Qlix: submitted',
};

const PHASE_TOOLTIPS: Record<SessionPhase, string> = {
  disconnected: 'Click to connect to a Qlix assessment',
  connected: 'Connected but not observing yet — click for options',
  monitoring: 'Qlix is observing this workspace — click to pause, submit, or disconnect',
  paused: 'Observation paused — click to resume',
  submitting: 'Submitting your project…',
  submitted: 'Project submitted — click for details',
};

/** Owns the connection's durable state (token in SecretStorage, everything else
 * in workspaceState — both survive VS Code restarts, so reopening the same
 * project resumes the same assessment instead of asking to reconnect). */
export class SessionManager {
  private statusBarItem: vscode.StatusBarItem;
  private _phase: SessionPhase = 'disconnected';
  private _info: SessionInfo | undefined;
  private _hasPendingQuestion = false;

  private readonly stateChangeEmitter = new vscode.EventEmitter<void>();
  /** Fires whenever phase/pending-question state changes, so more than one UI
   * surface (status bar, Activity Bar panel) can stay in sync. */
  readonly onDidChangeState = this.stateChangeEmitter.event;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.statusBarItem.command = 'qlix.openMenu';
    context.subscriptions.push(this.statusBarItem, this.stateChangeEmitter);
    this._info = context.workspaceState.get<SessionInfo>(STATE_INFO_KEY);
    this._phase = context.workspaceState.get<SessionPhase>(STATE_PHASE_KEY) ?? 'disconnected';
    this.render();
  }

  get phase(): SessionPhase {
    return this._phase;
  }

  get info(): SessionInfo | undefined {
    return this._info;
  }

  async getToken(): Promise<string | undefined> {
    return this.context.secrets.get(SECRET_TOKEN_KEY);
  }

  async connect(token: string, info: SessionInfo): Promise<void> {
    await this.context.secrets.store(SECRET_TOKEN_KEY, token);
    this._info = info;
    await this.context.workspaceState.update(STATE_INFO_KEY, info);
    await this.setPhase('connected');
  }

  async disconnect(): Promise<void> {
    await this.context.secrets.delete(SECRET_TOKEN_KEY);
    this._info = undefined;
    await this.context.workspaceState.update(STATE_INFO_KEY, undefined);
    await this.setPhase('disconnected');
  }

  async setPhase(phase: SessionPhase): Promise<void> {
    this._phase = phase;
    await this.context.workspaceState.update(STATE_PHASE_KEY, phase);
    if (phase !== 'monitoring') this._hasPendingQuestion = false;
    this.render();
  }

  get hasPendingQuestion(): boolean {
    return this._hasPendingQuestion;
  }

  /** Flips the status bar into an "attention needed" state — a different icon and
   * a warning background so a pending defense-interview question is noticeable
   * without the student having to think to go check. */
  setHasPendingQuestion(value: boolean): void {
    this._hasPendingQuestion = value;
    this.render();
  }

  /** True once a token exists AND the currently open workspace folder matches the
   * folder this connection was issued for — the hard boundary against watching
   * the wrong folder (or a folder this grant was never authorized for). */
  isBoundToOpenWorkspace(): boolean {
    if (!this._info) return false;
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) return false;
    return folder.uri.fsPath === this._info.workspaceRoot;
  }

  private render(): void {
    if (this._hasPendingQuestion) {
      this.statusBarItem.text = '$(bell-dot) Qlix: question waiting';
      this.statusBarItem.tooltip = 'The assessment has a question for you — click to answer';
      this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    } else {
      this.statusBarItem.text = PHASE_LABELS[this._phase];
      this.statusBarItem.tooltip = PHASE_TOOLTIPS[this._phase];
      this.statusBarItem.backgroundColor = undefined;
    }
    this.statusBarItem.show();
    this.stateChangeEmitter.fire();
  }
}
