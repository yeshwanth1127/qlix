import * as vscode from 'vscode';
import * as os from 'node:os';
import { connectWithCode, QlixApiError } from '../api/client';
import type { SessionManager } from '../state/session';
import { showConsentPrompt } from '../ui/consentPanel';
import { captureProjectSnapshot } from '../capture/projectSnapshot';

/** True after we've auto-opened the connect box once in this window, so
 * cancelling it doesn't immediately pop it again. Manual Connect still works. */
let autoPromptedThisWindow = false;
let connectFlowInFlight = false;

function workspaceFolder(): vscode.WorkspaceFolder | undefined {
  return vscode.workspace.workspaceFolders?.[0];
}

async function revealQlixSidebar(): Promise<void> {
  await vscode.commands.executeCommand('workbench.view.extension.qlixAssessment').then(
    () => undefined,
    () => undefined,
  );
}

async function promptForCode(): Promise<string | undefined> {
  const code = await vscode.window.showInputBox({
    title: 'Qlix Assessment',
    prompt: 'Paste the connect code from your Qlix assessment page',
    placeHolder: 'e.g. 7Q3K9XPZ',
    ignoreFocusOut: true,
    validateInput: (value) =>
      value.trim().length < 4 ? 'Enter the code shown on the assessment page' : undefined,
  });
  const trimmed = code?.trim().toUpperCase();
  return trimmed || undefined;
}

/**
 * After install (or any launch while still disconnected): make Qlix visible
 * and ask for the code. No Command Palette step required.
 */
export async function autoStartIfDisconnected(session: SessionManager): Promise<void> {
  if (session.phase !== 'disconnected') return;
  if (autoPromptedThisWindow) return;
  autoPromptedThisWindow = true;

  await revealQlixSidebar();

  if (!workspaceFolder()) {
    const choice = await vscode.window.showInformationMessage(
      'Qlix Assessment is ready. Open the project folder you were asked to build, then paste your connect code.',
      { modal: true },
      'Open Folder',
    );
    if (choice === 'Open Folder') {
      await vscode.commands.executeCommand('vscode.openFolder');
    }
    return;
  }

  await runConnectFlow(session);
}

/** The connect-code exchange. Bound to the currently open folder. */
export async function runConnectFlow(session: SessionManager): Promise<void> {
  if (connectFlowInFlight) return;
  connectFlowInFlight = true;
  try {
    await runConnectFlowInner(session);
  } finally {
    connectFlowInFlight = false;
  }
}

async function runConnectFlowInner(session: SessionManager): Promise<void> {
  const folder = workspaceFolder();
  if (!folder) {
    const choice = await vscode.window.showInformationMessage(
      'Open the project folder for this assessment first, then paste your connect code.',
      { modal: true },
      'Open Folder',
    );
    if (choice === 'Open Folder') {
      await vscode.commands.executeCommand('vscode.openFolder');
    }
    return;
  }

  await revealQlixSidebar();

  for (;;) {
    const code = await promptForCode();
    if (!code) return;

    try {
      const result = await connectWithCode({
        code,
        deviceLabel: os.hostname(),
        workspaceRoot: folder.uri.fsPath,
      });
      await session.connect(result.token, {
        sessionId: result.sessionId,
        orgId: result.orgId,
        workspaceRoot: result.workspaceRoot,
      });

      const consented = await showConsentPrompt(result.workspaceRoot);
      if (consented) {
        await session.setPhase('monitoring');
        void captureProjectSnapshot(session, 'start').catch(() => {});
        void vscode.window.showInformationMessage('Qlix is now observing this workspace for your assessment.');
      } else {
        void vscode.window.showInformationMessage(
          'Connected, but not observing yet. Use Start Observation in the Qlix sidebar when ready.',
        );
      }
      return;
    } catch (err) {
      const message = err instanceof QlixApiError ? err.message : String(err);
      const retry = await vscode.window.showErrorMessage(`Could not connect: ${message}`, 'Try again');
      if (retry !== 'Try again') return;
    }
  }
}
