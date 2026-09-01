import * as vscode from 'vscode';

/** Shown once, before observation starts, in plain language — not buried in a
 * settings page. Declining leaves the extension connected but not observing. */
export async function showConsentPrompt(workspaceRoot: string): Promise<boolean> {
  const choice = await vscode.window.showInformationMessage(
    `Qlix will observe your project at "${workspaceRoot}" for this assessment: file changes you save, ` +
      'Git commits, and (once you enable it) terminal commands and test/build results. ' +
      'It never sees anything outside this folder, and files like .env or private keys are never captured. ' +
      'You can pause or disconnect at any time from the status bar.',
    { modal: true },
    'Start Observing',
  );
  return choice === 'Start Observing';
}
