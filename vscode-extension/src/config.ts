import * as vscode from 'vscode';

/** Backend base URL — configurable so the same extension works against local dev,
 * qlixdev.exora.solutions, or a future production domain. */
export function backendBaseUrl(): string {
  const configured = vscode.workspace.getConfiguration('qlix').get<string>('backendUrl');
  return (configured?.trim() || 'https://qlixdev.exora.solutions').replace(/\/$/, '');
}
