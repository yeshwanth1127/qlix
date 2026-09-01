import * as vscode from 'vscode';
import { SessionManager } from './state/session';
import { OfflineQueue } from './queue/offlineQueue';
import { FileWatcher } from './capture/fileWatcher';
import { GitWatcher } from './capture/gitWatcher';
import { TaskWatcher } from './capture/taskWatcher';
import { TerminalWatcher } from './capture/terminalWatcher';
import { captureProjectSnapshot } from './capture/projectSnapshot';
import { buildSourceArchive } from './capture/sourceArchive';
import { autoStartIfDisconnected, runConnectFlow } from './auth/deviceConnect';
import { showConsentPrompt } from './ui/consentPanel';
import { QlixStatusViewProvider } from './ui/statusView';
import {
  answerQuestion,
  fetchDeviceStatus,
  submitArchive,
  submitProject,
  QlixApiError,
} from './api/client';

const QUESTION_POLL_MS = 60_000;

let fileWatcher: FileWatcher | undefined;
let gitWatcher: GitWatcher | undefined;
let taskWatcher: TaskWatcher | undefined;
let terminalWatcher: TerminalWatcher | undefined;
let queue: OfflineQueue | undefined;
let questionPollTimer: ReturnType<typeof setInterval> | undefined;
let lastSeenQuestionThreadId: string | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const session = new SessionManager(context);

  queue = new OfflineQueue(
    context.storageUri ?? context.globalStorageUri,
    () => session.getToken(),
    (message) => console.warn(`[qlix] evidence flush failed, will retry: ${message}`),
  );
  void queue.start();

  fileWatcher = new FileWatcher(session, queue);
  gitWatcher = new GitWatcher(session, queue);
  taskWatcher = new TaskWatcher(session, queue);
  terminalWatcher = new TerminalWatcher(session, queue);
  fileWatcher.start();
  gitWatcher.start();
  taskWatcher.start();
  terminalWatcher.start();
  context.subscriptions.push(fileWatcher, gitWatcher, taskWatcher, terminalWatcher);

  if (session.phase !== 'disconnected' && !session.isBoundToOpenWorkspace()) {
    void vscode.window.showWarningMessage(
      'This folder does not match the workspace your Qlix assessment is connected to. Observation stays off here.',
    );
  }

  async function doPause(): Promise<void> {
    if (session.phase !== 'monitoring') return;
    await session.setPhase('paused');
    void vscode.window.showInformationMessage('Qlix observation paused.');
  }

  async function doResume(): Promise<void> {
    if (session.phase !== 'paused' && session.phase !== 'connected') return;
    if (!session.isBoundToOpenWorkspace()) {
      void vscode.window.showErrorMessage('Open the original assessment workspace folder to resume observation.');
      return;
    }
    const isFirstStart = session.phase === 'connected';
    if (isFirstStart) {
      const consented = await showConsentPrompt(session.info!.workspaceRoot);
      if (!consented) return;
    }
    await session.setPhase('monitoring');
    // Structural fingerprint of the project as observation begins — fired
    // once, not on every pause/resume cycle.
    if (isFirstStart) void captureProjectSnapshot(session, 'start').catch(() => {});
    void vscode.window.showInformationMessage('Qlix observation resumed.');
  }

  async function doSubmit(): Promise<void> {
    const token = await session.getToken();
    if (!token) {
      void vscode.window.showErrorMessage('Connect to an assessment first.');
      return;
    }
    const confirm = await vscode.window.showWarningMessage(
      'Submit your project for this assessment? Make sure everything is saved and committed first.',
      { modal: true },
      'Submit',
    );
    if (confirm !== 'Submit') return;

    await session.setPhase('submitting');
    try {
      await queue?.flush();

      // Final snapshot + the actual source code, so the submission is a
      // reviewable artifact, not just a stream of change events.
      const snapshotId = await captureProjectSnapshot(session, 'submission');
      if (snapshotId) {
        const archive = await buildSourceArchive();
        if (archive) await submitArchive(token, snapshotId, archive);
      }

      await submitProject(token);
      await session.setPhase('submitted');
      void vscode.window.showInformationMessage('Project submitted for assessment.');
    } catch (err) {
      await session.setPhase('monitoring');
      const message = err instanceof QlixApiError ? err.message : String(err);
      void vscode.window.showErrorMessage(`Submit failed: ${message}`);
    }
  }

  async function doDisconnect(): Promise<void> {
    const confirm = await vscode.window.showWarningMessage(
      'Disconnect this workspace from your Qlix assessment? Observation will stop.',
      { modal: true },
      'Disconnect',
    );
    if (confirm !== 'Disconnect') return;
    lastSeenQuestionThreadId = undefined;
    await session.disconnect();
  }

  async function doAnswerQuestion(threadId: string, questionText: string): Promise<void> {
    const token = await session.getToken();
    if (!token) return;
    const answer = await vscode.window.showInputBox({
      title: 'Qlix — defense interview question',
      prompt: questionText,
      ignoreFocusOut: true,
    });
    if (!answer?.trim()) return;
    await answerQuestion(token, threadId, answer.trim());
    session.setHasPendingQuestion(false);
    void vscode.window.showInformationMessage('Answer submitted.');
  }

  async function checkForPendingQuestion(notifyIfNew: boolean): Promise<void> {
    const token = await session.getToken();
    if (!token || session.phase === 'disconnected') return;
    try {
      const status = await fetchDeviceStatus(token);
      if (status.openQuestion) {
        const isNew = status.openQuestion.threadId !== lastSeenQuestionThreadId;
        lastSeenQuestionThreadId = status.openQuestion.threadId;
        session.setHasPendingQuestion(true);
        if (isNew && notifyIfNew) {
          void vscode.window
            .showInformationMessage('Qlix has a question for you.', 'Answer Now')
            .then((choice) => {
              if (choice === 'Answer Now') void doAnswerQuestion(status.openQuestion!.threadId, status.openQuestion!.questionText);
            });
        }
      } else {
        lastSeenQuestionThreadId = undefined;
        session.setHasPendingQuestion(false);
      }
    } catch {
      // Transient network/backend issue — next poll retries; don't nag the user about it.
    }
  }

  questionPollTimer = setInterval(() => void checkForPendingQuestion(true), QUESTION_POLL_MS);
  void checkForPendingQuestion(false);

  /** Shared by the status bar menu and the Activity Bar panel's "Answer
   * Question" button — both need to re-fetch the question text before
   * prompting, since only the thread id is cached locally. */
  async function answerPendingQuestionNow(): Promise<void> {
    if (!session.hasPendingQuestion || !lastSeenQuestionThreadId) return;
    const token = await session.getToken();
    if (!token) return;
    const status = await fetchDeviceStatus(token).catch(() => null);
    if (status?.openQuestion) {
      await doAnswerQuestion(status.openQuestion.threadId, status.openQuestion.questionText);
    }
  }

  const statusView = new QlixStatusViewProvider(session, {
    connect: () => runConnectFlow(session),
    pause: doPause,
    resume: doResume,
    submit: doSubmit,
    disconnect: doDisconnect,
    answerPendingQuestion: answerPendingQuestionNow,
  });
  context.subscriptions.push(vscode.window.registerWebviewViewProvider('qlix.statusView', statusView));

  async function openMenu(): Promise<void> {
    if (session.hasPendingQuestion && lastSeenQuestionThreadId) {
      await answerPendingQuestionNow();
      return;
    }

    type MenuItem = vscode.QuickPickItem & { action: () => Promise<void> };
    const items: MenuItem[] = [];

    if (session.phase === 'disconnected') {
      items.push({ label: '$(plug) Connect Assessment', action: () => runConnectFlow(session) });
    } else {
      if (session.phase === 'monitoring') {
        items.push({ label: '$(debug-pause) Pause Observation', action: doPause });
      }
      if (session.phase === 'paused' || session.phase === 'connected') {
        items.push({ label: '$(eye) Start / Resume Observation', action: doResume });
      }
      if (session.phase === 'monitoring' || session.phase === 'paused') {
        items.push({ label: '$(cloud-upload) Submit Project', action: doSubmit });
      }
      items.push({
        label: '$(info) Show Status',
        detail: `${queue?.pendingCount ?? 0} event(s) queued locally`,
        action: async () => {
          void vscode.window.showInformationMessage(
            `Qlix: ${session.phase}${session.info ? ` — ${session.info.workspaceRoot}` : ''}`,
          );
        },
      });
      items.push({ label: '$(circle-slash) Disconnect', action: doDisconnect });
    }

    const picked = await vscode.window.showQuickPick(items, { title: 'Qlix Assessment' });
    if (picked) await picked.action();
  }

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      if (session.phase === 'disconnected' && vscode.workspace.workspaceFolders?.[0]) {
        void runConnectFlow(session);
      }
    }),
  );

  // Let the workbench finish painting, then open Qlix and ask for the code.
  // This is the install/first-open path — no Command Palette required.
  setTimeout(() => void autoStartIfDisconnected(session), 400);

  context.subscriptions.push(
    vscode.commands.registerCommand('qlix.connect', () => runConnectFlow(session)),
    vscode.commands.registerCommand('qlix.disconnect', doDisconnect),
    vscode.commands.registerCommand('qlix.pause', doPause),
    vscode.commands.registerCommand('qlix.resume', doResume),
    vscode.commands.registerCommand('qlix.submit', doSubmit),
    vscode.commands.registerCommand('qlix.showStatus', openMenu),
    vscode.commands.registerCommand('qlix.openMenu', openMenu),
  );
}

export function deactivate(): Promise<void> | void {
  if (questionPollTimer) clearInterval(questionPollTimer);
  queue?.stop();
  return queue?.flush();
}
