import type { AgentDTO } from '../agents/agents.types.js';
import type { DockerTeamContext } from './dockerNaming.js';

export type ProvisionJob =
  | {
      kind: 'provision';
      agent: AgentDTO;
      privateKey: string;
      backendUrl: string;
    }
  | {
      kind: 'restart';
      agentId: string;
      backendUrl: string;
    }
  | {
      kind: 'team';
      agentId: string;
      backendUrl: string;
      teamContext: DockerTeamContext;
    };

type JobHandler = (job: ProvisionJob) => Promise<void>;

function provisionMaxConcurrent(): number {
  const raw = process.env.QLIX_PROVISION_MAX_CONCURRENT?.trim();
  const n = raw ? Number.parseInt(raw, 10) : 1;
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 4) : 1;
}

/**
 * In-process provisioning queue with bounded concurrency.
 * Jobs are re-enqueued on backend startup via the watchdog (DB-backed recovery).
 */
export class ProvisioningQueue {
  private static instance: ProvisioningQueue | null = null;

  private readonly queue: ProvisionJob[] = [];
  private active = 0;
  private readonly maxConcurrent = provisionMaxConcurrent();
  private handler: JobHandler | null = null;

  static getInstance(): ProvisioningQueue {
    if (!ProvisioningQueue.instance) {
      ProvisioningQueue.instance = new ProvisioningQueue();
    }
    return ProvisioningQueue.instance;
  }

  setHandler(handler: JobHandler): void {
    this.handler = handler;
  }

  enqueue(job: ProvisionJob): void {
    const duplicate = this.queue.some((queued) => jobKey(queued) === jobKey(job));
    if (duplicate) return;
    this.queue.push(job);
    void this.drain();
  }

  pendingCount(): number {
    return this.queue.length + this.active;
  }

  private async drain(): Promise<void> {
    while (this.queue.length > 0 && this.active < this.maxConcurrent) {
      const job = this.queue.shift();
      if (!job || !this.handler) return;
      this.active++;
      void this.handler(job)
        .catch((err) => {
          console.warn('[provisionQueue] job failed', jobKey(job), err);
        })
        .finally(() => {
          this.active--;
          void this.drain();
        });
    }
  }
}

function jobKey(job: ProvisionJob): string {
  switch (job.kind) {
    case 'provision':
      return `provision:${job.agent.id}`;
    case 'restart':
      return `restart:${job.agentId}`;
    case 'team':
      return `team:${job.agentId}:${job.teamContext.id}`;
  }
}

export function agentIdFromJob(job: ProvisionJob): string {
  switch (job.kind) {
    case 'provision':
      return job.agent.id;
    case 'restart':
    case 'team':
      return job.agentId;
  }
}
