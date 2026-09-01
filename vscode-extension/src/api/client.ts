import { backendBaseUrl } from '../config';

export interface ConnectResponse {
  token: string;
  sessionId: string;
  orgId: string;
  workspaceRoot: string;
  expiresAt: string;
}

export interface EvidenceEvent {
  kind:
    | 'file_snapshot'
    | 'git_event'
    | 'terminal_event'
    | 'dependency_event'
    | 'test_result'
    | 'build_result'
    | 'lint_result'
    | 'ai_prompt'
    | 'artifact_upload'
    | 'manual_note';
  occurredAt: string;
  payload: Record<string, unknown>;
  redacted: boolean;
}

export class QlixApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

async function parseErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    return body.error?.message ?? `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

/** No device token yet — this IS the auth bootstrap. */
export async function connectWithCode(input: {
  code: string;
  deviceLabel: string;
  workspaceRoot: string;
}): Promise<ConnectResponse> {
  const response = await fetch(`${backendBaseUrl()}/api/v1/assessment/device/connect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new QlixApiError(await parseErrorMessage(response), response.status);
  return (await response.json()) as ConnectResponse;
}

function deviceHeaders(token: string): Record<string, string> {
  return { 'Content-Type': 'application/json', 'X-QLIX-Device-Token': token };
}

export async function submitEvidenceBatch(token: string, events: EvidenceEvent[]): Promise<{ accepted: number }> {
  const response = await fetch(`${backendBaseUrl()}/api/v1/assessment/device/evidence/batch`, {
    method: 'POST',
    headers: deviceHeaders(token),
    body: JSON.stringify({ events }),
  });
  if (!response.ok) throw new QlixApiError(await parseErrorMessage(response), response.status);
  return (await response.json()) as { accepted: number };
}

export async function submitProject(token: string): Promise<{ status: string }> {
  const response = await fetch(`${backendBaseUrl()}/api/v1/assessment/device/submit`, {
    method: 'POST',
    headers: deviceHeaders(token),
  });
  if (!response.ok) throw new QlixApiError(await parseErrorMessage(response), response.status);
  return (await response.json()) as { status: string };
}

export interface DeviceStatus {
  session: { id: string; status: string };
  openQuestion: { threadId: string; questionText: string } | null;
}

export async function fetchDeviceStatus(token: string): Promise<DeviceStatus> {
  const response = await fetch(`${backendBaseUrl()}/api/v1/assessment/device/status`, {
    headers: deviceHeaders(token),
  });
  if (!response.ok) throw new QlixApiError(await parseErrorMessage(response), response.status);
  return (await response.json()) as DeviceStatus;
}

export async function answerQuestion(token: string, threadId: string, text: string): Promise<{ status: string }> {
  const response = await fetch(`${backendBaseUrl()}/api/v1/assessment/device/answer`, {
    method: 'POST',
    headers: deviceHeaders(token),
    body: JSON.stringify({ threadId, text }),
  });
  if (!response.ok) throw new QlixApiError(await parseErrorMessage(response), response.status);
  return (await response.json()) as { status: string };
}

export interface FileHashEntry {
  path: string;
  sha256?: string;
  sizeBytes: number;
  skipped?: boolean;
}

/** Structural fingerprint of the project — fills the ProjectSnapshot model,
 * separate from the routine evidence stream. */
export async function submitSnapshot(
  token: string,
  input: { label: string; fileTreeHash: string; fileHashes: FileHashEntry[] },
): Promise<{ snapshotId: string }> {
  const response = await fetch(`${backendBaseUrl()}/api/v1/assessment/device/snapshot`, {
    method: 'POST',
    headers: deviceHeaders(token),
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new QlixApiError(await parseErrorMessage(response), response.status);
  return (await response.json()) as { snapshotId: string };
}

/** Attaches the final zipped source archive to a snapshot created via submitSnapshot. */
export async function submitArchive(token: string, snapshotId: string, bytes: Buffer): Promise<void> {
  const form = new FormData();
  form.set('snapshotId', snapshotId);
  form.set('file', new Blob([new Uint8Array(bytes)]), 'submission.zip');
  const response = await fetch(`${backendBaseUrl()}/api/v1/assessment/device/archive`, {
    method: 'POST',
    headers: { 'X-QLIX-Device-Token': token },
    body: form,
  });
  if (!response.ok) throw new QlixApiError(await parseErrorMessage(response), response.status);
}
