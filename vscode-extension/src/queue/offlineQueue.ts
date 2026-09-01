import * as vscode from 'vscode';
import type { EvidenceEvent } from '../api/client';
import { submitEvidenceBatch, QlixApiError } from '../api/client';

/**
 * Local, crash-safe buffer for evidence events. Batches every FLUSH_INTERVAL_MS
 * (or immediately once BATCH_SIZE is reached), and if the network/backend is
 * unavailable, keeps events on disk and retries on the next tick instead of
 * dropping them — the plan's "offline queue" requirement.
 */
const FLUSH_INTERVAL_MS = 30_000;
const BATCH_SIZE = 25;
const QUEUE_FILE = 'evidence-queue.json';

export class OfflineQueue {
  private queue: EvidenceEvent[] = [];
  private timer: ReturnType<typeof setInterval> | undefined;
  private flushing = false;

  constructor(
    private readonly storageUri: vscode.Uri,
    private readonly getToken: () => Promise<string | undefined>,
    private readonly onFlushError: (message: string) => void,
  ) {}

  async start(): Promise<void> {
    await this.loadFromDisk();
    this.timer = setInterval(() => void this.flush(), FLUSH_INTERVAL_MS);
    void this.flush();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Queue one event. `important` events flush immediately rather than waiting for the timer. */
  async enqueue(event: EvidenceEvent, important = false): Promise<void> {
    this.queue.push(event);
    await this.persistToDisk();
    if (important || this.queue.length >= BATCH_SIZE) {
      await this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.flushing || this.queue.length === 0) return;
    const token = await this.getToken();
    if (!token) return;

    this.flushing = true;
    try {
      const batch = this.queue.slice(0, BATCH_SIZE);
      await submitEvidenceBatch(token, batch);
      this.queue = this.queue.slice(batch.length);
      await this.persistToDisk();
    } catch (err) {
      // Network/backend unavailable — leave the queue on disk, try again next tick.
      const message = err instanceof QlixApiError ? err.message : String(err);
      this.onFlushError(message);
    } finally {
      this.flushing = false;
    }
  }

  get pendingCount(): number {
    return this.queue.length;
  }

  private queueFileUri(): vscode.Uri {
    return vscode.Uri.joinPath(this.storageUri, QUEUE_FILE);
  }

  private async persistToDisk(): Promise<void> {
    try {
      await vscode.workspace.fs.createDirectory(this.storageUri);
      const bytes = Buffer.from(JSON.stringify(this.queue), 'utf-8');
      await vscode.workspace.fs.writeFile(this.queueFileUri(), bytes);
    } catch {
      // Best-effort — losing the on-disk mirror isn't fatal as long as the
      // in-memory queue is still intact for this session.
    }
  }

  private async loadFromDisk(): Promise<void> {
    try {
      const bytes = await vscode.workspace.fs.readFile(this.queueFileUri());
      const parsed = JSON.parse(Buffer.from(bytes).toString('utf-8'));
      if (Array.isArray(parsed)) this.queue = parsed as EvidenceEvent[];
    } catch {
      this.queue = [];
    }
  }
}
