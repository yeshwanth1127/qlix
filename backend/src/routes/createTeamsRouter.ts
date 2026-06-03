import { Router } from 'express';
import type { Request, Response } from 'express';
import { addInjection } from '../teams/runInjectionStore.js';
import { launchTeamRun } from '../teams/teamsRunLauncher.js';
import { injectTeamRunMessage } from '../teams/teamChannel.service.js';
import { z } from 'zod';
import { buildAgentCard } from '../agents/agentCard.js';
import { resolveDockerBackendUrl } from '../agents/sdkAgentFile.js';
import { AgentsService } from '../agents/agents.service.js';
import { ALL_PERMISSION_SCOPES, type PermissionScope } from '../agents/agents.types.js';
import { verifyAgentCreateStepUpToken } from '../lib/authTokens.js';
import { authenticateUser, loadJwtSecret } from '../middleware/authenticateUser.js';
import {
  AgentConfirmNameMismatchError,
  AgentDeleteForbiddenError,
  AgentNotFoundError,
} from '../agents/agents.service.js';
import {
  TeamAgentMustBeCloudError,
  TeamAgentNotInOrgError,
  TeamConfirmNameMismatchError,
  TeamForbiddenError,
  TeamMemberAlreadyExistsError,
  TeamMemberNotFoundError,
  TeamNoSupervisorError,
  TeamNoSupervisorToDeleteError,
  TeamNotFoundError,
  TeamRunnersNotReadyError,
  TeamScopeExceedsAgentError,
  TeamsService,
  TeamEmailConnectorRequiredError,
} from '../teams/teams.service.js';
import { TeamsRepository } from '../teams/teams.repository.js';

const permissionScopeSchema = z.enum(ALL_PERMISSION_SCOPES as [PermissionScope, ...PermissionScope[]]);

const createTeamSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  config: z.object({
    maxParallelWorkers: z.number().int().min(1).max(10).optional(),
    subtaskTimeoutMs: z.number().int().min(5000).max(600_000).optional(),
    retryPolicy: z.enum(['none', 'once', 'twice']).optional(),
    humanInLoopTriggers: z.array(z.string()).optional(),
    pipelineMode: z.boolean().optional(),
    autoSequence: z.boolean().optional(),
    defaultModel: z.string().trim().max(120).optional(),
  }).optional(),
});

const reorderMembersSchema = z.object({
  memberIds: z.array(z.string().min(1)).min(1).max(50),
});

const updateConfigSchema = z.object({
  autoSequence: z.boolean().optional(),
  pipelineMode: z.boolean().optional(),
  defaultModel: z.string().trim().max(120).optional(),
});

const setSupervisorSchema = z.object({
  agentId: z.string().min(1),
});

const addMemberSchema = z.object({
  agentId: z.string().min(1),
  role: z.string().trim().min(1).max(80),
  delegatedScopes: z.array(permissionScopeSchema).default([]),
});

const patchMemberSchema = z.object({
  delegatedScopes: z.array(permissionScopeSchema),
});

const startRunSchema = z.object({
  goal: z.string().trim().min(1).max(4000),
});

const deleteTeamBodySchema = z.object({
  confirmName: z.string().trim().min(1).max(120),
});

const deleteTeamAgentBodySchema = z.object({
  confirmName: z.string().trim().min(1).max(120),
});

function resolveBackendUrl(req: Request): string {
  const proto = req.headers['x-forwarded-proto'] ?? req.protocol;
  const host = req.headers['x-forwarded-host'] ?? req.headers.host ?? 'localhost:4000';
  return `${proto}://${host}`;
}

export function createTeamsRouter(): Router {
  const router = Router();
  const service = new TeamsService();
  const agentsService = new AgentsService();
  const repo = new TeamsRepository();

  // ─── List & Create ──────────────────────────────────────────────────────────

  router.get('/', authenticateUser(true), async (req: Request, res: Response) => {
    try {
      const teams = await service.listTeams(req.auth!.orgId);
      res.json({ teams });
    } catch (err) {
      console.error('listTeams error', err);
      res.status(500).json({ error: { code: 'teams_list_failed', message: 'Failed to list teams' } });
    }
  });

  router.post('/', authenticateUser(true), async (req: Request, res: Response) => {
    const parsed = createTeamSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'invalid_body', message: 'Invalid team payload', issues: parsed.error.issues } });
      return;
    }

    const stepUpHeader = req.headers['x-qlix-device-step-up'];
    const stepUpToken = typeof stepUpHeader === 'string' ? stepUpHeader.trim() : '';
    if (!stepUpToken) {
      res.status(403).json({ error: { code: 'step_up_required', message: 'Device step-up required to create a team' } });
      return;
    }
    try {
      verifyAgentCreateStepUpToken(stepUpToken, loadJwtSecret(), req.auth!.userId);
    } catch {
      res.status(403).json({ error: { code: 'step_up_invalid_or_expired', message: 'Step-up token invalid or expired' } });
      return;
    }

    try {
      const backendUrl = resolveBackendUrl(req);
      const team = await service.createTeam(req.auth!.userId, {
        ...parsed.data,
        orgId: req.auth!.orgId,
      }, backendUrl);
      res.status(201).json({ team });
    } catch (err) {
      if (err instanceof TeamAgentNotInOrgError) {
        res.status(403).json({ error: { code: err.code, message: err.message } });
        return;
      }
      if (err instanceof TeamScopeExceedsAgentError) {
        res.status(400).json({ error: { code: err.code, message: err.message } });
        return;
      }
      console.error('createTeam error', err);
      res.status(500).json({ error: { code: 'team_create_failed', message: 'Failed to create team' } });
    }
  });

  // ─── Single Team ─────────────────────────────────────────────────────────────

  router.get('/:id/runners-status', authenticateUser(true), async (req: Request, res: Response) => {
    try {
      const status = await service.getRunnersStatus(req.params.id!, req.auth!.orgId);
      res.json(status);
    } catch (err) {
      if (err instanceof TeamNotFoundError) {
        res.status(404).json({ error: { code: 'not_found', message: err.message } });
        return;
      }
      res.status(500).json({ error: { code: 'runners_status_failed', message: 'Failed to load runners status' } });
    }
  });

  router.get('/:id', authenticateUser(true), async (req: Request, res: Response) => {
    try {
      const team = await service.getTeam(req.params.id!, req.auth!.orgId);
      res.json({ team });
    } catch (err) {
      if (err instanceof TeamNotFoundError) {
        res.status(404).json({ error: { code: 'not_found', message: err.message } });
        return;
      }
      res.status(500).json({ error: { code: 'team_get_failed', message: 'Failed to load team' } });
    }
  });

  router.delete('/:id', authenticateUser(true), async (req: Request, res: Response) => {
    const parsed = deleteTeamBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'invalid_body', message: 'confirmName is required' } });
      return;
    }
    try {
      const auth = req.auth!;
      await service.deleteTeam(
        req.params.id!,
        auth.orgId,
        auth.userId,
        auth.role,
        parsed.data.confirmName,
      );
      res.status(204).send();
    } catch (err) {
      if (err instanceof TeamNotFoundError) {
        res.status(404).json({ error: { code: 'not_found', message: err.message } });
        return;
      }
      if (err instanceof TeamConfirmNameMismatchError) {
        res.status(400).json({ error: { code: err.code, message: err.message } });
        return;
      }
      if (err instanceof TeamForbiddenError) {
        res.status(403).json({ error: { code: 'forbidden', message: err.message } });
        return;
      }
      res.status(500).json({ error: { code: 'team_delete_failed', message: 'Failed to delete team' } });
    }
  });

  // ─── Supervisor ───────────────────────────────────────────────────────────────

  router.delete('/:id/supervisor', authenticateUser(true), async (req: Request, res: Response) => {
    const parsed = deleteTeamAgentBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'invalid_body', message: 'confirmName is required' } });
      return;
    }
    try {
      const auth = req.auth!;
      const team = await service.deleteSupervisor(
        req.params.id!,
        auth.orgId,
        auth.userId,
        auth.role,
        parsed.data.confirmName,
      );
      res.json({ team });
    } catch (err) {
      if (err instanceof TeamNotFoundError) { res.status(404).json({ error: { code: 'not_found', message: err.message } }); return; }
      if (err instanceof TeamNoSupervisorToDeleteError) { res.status(400).json({ error: { code: err.code, message: err.message } }); return; }
      if (err instanceof TeamConfirmNameMismatchError) { res.status(400).json({ error: { code: err.code, message: err.message } }); return; }
      if (err instanceof AgentConfirmNameMismatchError) { res.status(400).json({ error: { code: err.code, message: err.message } }); return; }
      if (err instanceof AgentDeleteForbiddenError) { res.status(403).json({ error: { code: err.code, message: err.message } }); return; }
      if (err instanceof AgentNotFoundError) { res.status(404).json({ error: { code: 'not_found', message: err.message } }); return; }
      if (err instanceof TeamForbiddenError) { res.status(403).json({ error: { code: 'forbidden', message: err.message } }); return; }
      res.status(500).json({ error: { code: 'supervisor_delete_failed', message: 'Failed to delete supervisor' } });
    }
  });

  router.patch('/:id/supervisor', authenticateUser(true), async (req: Request, res: Response) => {
    const parsed = setSupervisorSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'invalid_body', message: 'agentId is required' } });
      return;
    }
    try {
      const backendUrl = resolveDockerBackendUrl(req);
      const team = await service.setSupervisor(
        req.params.id!,
        req.auth!.orgId,
        parsed.data.agentId,
        backendUrl,
      );
      res.json({ team });
    } catch (err) {
      if (err instanceof TeamNotFoundError) { res.status(404).json({ error: { code: 'not_found', message: err.message } }); return; }
      if (err instanceof TeamAgentNotInOrgError) { res.status(403).json({ error: { code: err.code, message: err.message } }); return; }
      if (err instanceof TeamAgentMustBeCloudError) { res.status(400).json({ error: { code: err.code, message: err.message } }); return; }
      res.status(500).json({ error: { code: 'supervisor_set_failed', message: 'Failed to set supervisor' } });
    }
  });

  // ─── Members ─────────────────────────────────────────────────────────────────

  router.post('/:id/members', authenticateUser(true), async (req: Request, res: Response) => {
    const parsed = addMemberSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'invalid_body', message: 'Invalid member payload' } });
      return;
    }
    try {
      const backendUrl = resolveDockerBackendUrl(req);
      const member = await service.addMember(req.params.id!, req.auth!.orgId, parsed.data, backendUrl);
      res.status(201).json({ member });
    } catch (err) {
      if (err instanceof TeamNotFoundError) { res.status(404).json({ error: { code: 'not_found', message: err.message } }); return; }
      if (err instanceof TeamMemberAlreadyExistsError) { res.status(409).json({ error: { code: err.code, message: err.message } }); return; }
      if (err instanceof TeamAgentNotInOrgError) { res.status(403).json({ error: { code: err.code, message: err.message } }); return; }
      if (err instanceof TeamAgentMustBeCloudError) { res.status(400).json({ error: { code: err.code, message: err.message } }); return; }
      if (err instanceof TeamScopeExceedsAgentError) { res.status(400).json({ error: { code: err.code, message: err.message } }); return; }
      res.status(500).json({ error: { code: 'member_add_failed', message: 'Failed to add member' } });
    }
  });

  /**
   * Rewrite the pipeline order. Body: { memberIds: string[] } — array index becomes
   * the new stage (1-indexed). Must list every current member exactly once.
   * IMPORTANT: register before /:id/members/:agentId or Express treats "order" as agentId.
   */
  router.patch('/:id/members/order', authenticateUser(true), async (req: Request, res: Response) => {
    const parsed = reorderMembersSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'invalid_body', message: 'memberIds (array) is required' } });
      return;
    }
    try {
      const auth = req.auth!;
      const team = await service.reorderMembers(
        req.params.id!,
        auth.orgId,
        auth.userId,
        auth.role,
        parsed.data.memberIds,
      );
      res.json({ team });
    } catch (err) {
      if (err instanceof TeamNotFoundError) { res.status(404).json({ error: { code: 'not_found', message: err.message } }); return; }
      if (err instanceof TeamForbiddenError) { res.status(403).json({ error: { code: 'forbidden', message: err.message } }); return; }
      if (err instanceof Error && err.message.startsWith('reorderMembers:')) {
        res.status(400).json({ error: { code: 'invalid_member_ids', message: err.message } });
        return;
      }
      console.error('reorderMembers error', err);
      res.status(500).json({ error: { code: 'reorder_failed', message: 'Failed to reorder members' } });
    }
  });

  router.patch('/:id/members/:agentId', authenticateUser(true), async (req: Request, res: Response) => {
    const parsed = patchMemberSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'invalid_body', message: 'Invalid delegated scopes' } });
      return;
    }
    try {
      const member = await service.updateMemberScopes(
        req.params.id!,
        req.auth!.orgId,
        req.params.agentId!,
        parsed.data.delegatedScopes,
      );
      res.json({ member });
    } catch (err) {
      if (err instanceof TeamNotFoundError) { res.status(404).json({ error: { code: 'not_found', message: err.message } }); return; }
      if (err instanceof TeamMemberNotFoundError) { res.status(404).json({ error: { code: err.code, message: err.message } }); return; }
      if (err instanceof TeamScopeExceedsAgentError) { res.status(400).json({ error: { code: err.code, message: err.message } }); return; }
      res.status(500).json({ error: { code: 'member_update_failed', message: 'Failed to update member scopes' } });
    }
  });

  /** Update team-level config (e.g. autoSequence on/off, pipelineMode on/off). */
  router.patch('/:id/config', authenticateUser(true), async (req: Request, res: Response) => {
    const parsed = updateConfigSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'invalid_body', message: 'Invalid config patch' } });
      return;
    }
    try {
      const auth = req.auth!;
      const team = await service.updateConfig(
        req.params.id!,
        auth.orgId,
        auth.userId,
        auth.role,
        parsed.data,
      );
      res.json({ team });
    } catch (err) {
      if (err instanceof TeamNotFoundError) { res.status(404).json({ error: { code: 'not_found', message: err.message } }); return; }
      if (err instanceof TeamForbiddenError) { res.status(403).json({ error: { code: 'forbidden', message: err.message } }); return; }
      console.error('updateConfig error', err);
      res.status(500).json({ error: { code: 'config_update_failed', message: 'Failed to update team config' } });
    }
  });

  router.delete('/:id/members/:agentId', authenticateUser(true), async (req: Request, res: Response) => {
    const parsed = deleteTeamAgentBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'invalid_body', message: 'confirmName is required' } });
      return;
    }
    try {
      const auth = req.auth!;
      await service.deleteMemberAgent(
        req.params.id!,
        auth.orgId,
        auth.userId,
        auth.role,
        req.params.agentId!,
        parsed.data.confirmName,
      );
      res.status(204).send();
    } catch (err) {
      if (err instanceof TeamNotFoundError) { res.status(404).json({ error: { code: 'not_found', message: err.message } }); return; }
      if (err instanceof TeamMemberNotFoundError) { res.status(404).json({ error: { code: err.code, message: err.message } }); return; }
      if (err instanceof TeamConfirmNameMismatchError) { res.status(400).json({ error: { code: err.code, message: err.message } }); return; }
      if (err instanceof AgentConfirmNameMismatchError) { res.status(400).json({ error: { code: err.code, message: err.message } }); return; }
      if (err instanceof AgentDeleteForbiddenError) { res.status(403).json({ error: { code: err.code, message: err.message } }); return; }
      if (err instanceof AgentNotFoundError) { res.status(404).json({ error: { code: 'not_found', message: err.message } }); return; }
      if (err instanceof TeamForbiddenError) { res.status(403).json({ error: { code: 'forbidden', message: err.message } }); return; }
      res.status(500).json({ error: { code: 'member_delete_failed', message: 'Failed to delete team agent' } });
    }
  });

  // ─── Runs ─────────────────────────────────────────────────────────────────────

  router.get('/:id/runs', authenticateUser(true), async (req: Request, res: Response) => {
    try {
      const runs = await service.listRuns(req.params.id!, req.auth!.orgId);
      res.json({ runs });
    } catch (err) {
      if (err instanceof TeamNotFoundError) { res.status(404).json({ error: { code: 'not_found', message: err.message } }); return; }
      res.status(500).json({ error: { code: 'runs_list_failed', message: 'Failed to list runs' } });
    }
  });

  router.get('/:id/runs/:runId', authenticateUser(true), async (req: Request, res: Response) => {
    try {
      const run = await service.getRun(req.params.id!, req.params.runId!, req.auth!.orgId);
      const events = await repo.listEvents(run.id);
      const tasks = await repo.listA2ATasks(run.id);
      res.json({ run, events, tasks });
    } catch (err) {
      if (err instanceof TeamNotFoundError) { res.status(404).json({ error: { code: 'not_found', message: err.message } }); return; }
      res.status(500).json({ error: { code: 'run_get_failed', message: 'Failed to load run' } });
    }
  });

  router.post('/:id/runs', authenticateUser(true), async (req: Request, res: Response) => {
    const parsed = startRunSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'invalid_body', message: 'goal is required' } });
      return;
    }
    try {
      const auth = req.auth!;
      const { run } = await launchTeamRun({
        teamId: req.params.id!,
        orgId: auth.orgId,
        userId: auth.userId,
        goal: parsed.data.goal,
        source: { channel: 'web' },
      });

      res.status(202).json({ run });
    } catch (err) {
      if (err instanceof TeamNotFoundError) { res.status(404).json({ error: { code: 'not_found', message: err.message } }); return; }
      if (err instanceof TeamNoSupervisorError) { res.status(400).json({ error: { code: err.code, message: err.message } }); return; }
      if (err instanceof TeamRunnersNotReadyError) { res.status(400).json({ error: { code: err.code, message: err.message } }); return; }
      if (err instanceof TeamEmailConnectorRequiredError) { res.status(409).json({ error: { code: err.code, message: err.message } }); return; }
      res.status(500).json({ error: { code: 'run_start_failed', message: 'Failed to start run' } });
    }
  });

  // User: inject a guidance message into the active worker mid-run
  router.post('/:id/runs/:runId/inject', authenticateUser(true), async (req: Request, res: Response) => {
    const schema = z.object({ message: z.string().trim().min(1).max(2000) });
    const body = schema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: { code: 'validation_error', message: 'message is required (max 2000 chars)' } });
      return;
    }
    try {
      const run = await service.getRun(req.params.id!, req.params.runId!, req.auth!.orgId);
      if (run.status !== 'running') {
        res.status(409).json({ error: { code: 'run_not_active', message: 'Run is not currently active' } });
        return;
      }
      // Find the active A2A task to get the current agentRunId
      const { prisma } = await import('../lib/prisma.js');
      const task = await prisma.a2ATask.findFirst({
        where: { runId: run.id, teamId: req.params.id!, status: 'working' },
        select: { agentRunId: true, toAgentId: true },
      });
      if (!task?.agentRunId) {
        res.status(404).json({ error: { code: 'no_active_worker', message: 'No active worker found — run may be between stages' } });
        return;
      }
      await addInjection(task.agentRunId, body.data.message);
      await repo.appendEvent(run.id, req.params.id!, task.toAgentId, 'user_injection' as any, {
        message: body.data.message,
      });
      res.json({ ok: true });
    } catch (err) {
      if (err instanceof TeamNotFoundError) { res.status(404).json({ error: { code: 'not_found', message: (err as Error).message } }); return; }
      res.status(500).json({ error: { code: 'inject_failed', message: 'Failed to inject message' } });
    }
  });

  router.post('/:id/runs/:runId/cancel', authenticateUser(true), async (req: Request, res: Response) => {
    try {
      const run = await service.getRun(req.params.id!, req.params.runId!, req.auth!.orgId);
      if (!['queued', 'running'].includes(run.status)) {
        res.status(409).json({ error: { code: 'run_not_cancelable', message: `Run is already ${run.status}` } });
        return;
      }
      await repo.updateRunStatus(run.id, 'canceled', { completedAt: new Date() });
      if (run.sourceConnectorId) {
        await repo.clearChannelSession(run.sourceConnectorId);
      }
      await repo.appendEvent(run.id, req.params.id!, null, 'run_failed', { reason: 'canceled_by_user' });
      res.json({ ok: true, status: 'canceled' });
    } catch (err) {
      if (err instanceof TeamNotFoundError) { res.status(404).json({ error: { code: 'not_found', message: err.message } }); return; }
      res.status(500).json({ error: { code: 'cancel_failed', message: 'Failed to cancel run' } });
    }
  });

  // ─── SSE Stream ──────────────────────────────────────────────────────────────

  /**
   * GET /api/v1/teams/:id/runs/:runId/stream
   * Server-Sent Events: streams TeamRunEvent records in real time.
   * Also replays any events that occurred before the client connected (cursor via ?afterSeq=N).
   */
  router.get('/:id/runs/:runId/stream', authenticateUser(true), async (req: Request, res: Response) => {
    try {
      const auth = req.auth!;
      const run = await service.getRun(req.params.id!, req.params.runId!, auth.orgId);

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();

      const send = (event: string, data: unknown): void => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      // Replay past events
      const afterSeqRaw = req.query.afterSeq;
      const afterSeq = typeof afterSeqRaw === 'string' ? parseInt(afterSeqRaw, 10) : -1;
      const pastEvents = await repo.listEventsSince(run.id, afterSeq);
      for (const e of pastEvents) send('event', e);

      // If already terminal, close immediately
      const currentRun = await repo.findRun(run.id);
      if (currentRun && ['completed', 'failed', 'canceled'].includes(currentRun.status)) {
        send('complete', { status: currentRun.status, result: currentRun.result });
        res.end();
        return;
      }

      // Poll for new events every 800ms
      let lastSeq = pastEvents.length > 0 ? pastEvents[pastEvents.length - 1]!.seq : afterSeq;
      let closed = false;
      req.on('close', () => { closed = true; });

      const poll = async (): Promise<void> => {
        if (closed) return;
        const newEvents = await repo.listEventsSince(run.id, lastSeq).catch(() => []);
        for (const e of newEvents) {
          send('event', e);
          lastSeq = e.seq;
        }
        const latest = await repo.findRun(run.id).catch(() => null);
        if (latest && ['completed', 'failed', 'canceled'].includes(latest.status)) {
          send('complete', { status: latest.status, result: latest.result });
          res.end();
          return;
        }
        if (!closed) setTimeout(() => { poll().catch(console.error); }, 800);
      };

      setTimeout(() => { poll().catch(console.error); }, 800);
    } catch (err) {
      if (err instanceof TeamNotFoundError) {
        res.status(404).json({ error: { code: 'not_found', message: 'Team or run not found' } });
        return;
      }
      res.status(500).json({ error: { code: 'stream_failed', message: 'Stream failed' } });
    }
  });

  // ─── A2A Agent Card endpoint ─────────────────────────────────────────────────

  /**
   * GET /api/v1/teams/a2a/agents/:did
   * Returns the A2A Agent Card for a given agent DID. Public (no auth required).
   */
  router.get('/a2a/agents/:did', async (req: Request, res: Response) => {
    try {
      const did = decodeURIComponent(req.params.did ?? '');
      const agent = await agentsService.getAgentByDid(did);
      if (!agent) {
        res.status(404).json({ error: { code: 'not_found', message: 'Agent not found' } });
        return;
      }
      const backendUrl = resolveBackendUrl(req);
      const card = buildAgentCard(agent, backendUrl);
      res.json(card);
    } catch (err) {
      res.status(500).json({ error: { code: 'card_failed', message: 'Failed to load agent card' } });
    }
  });

  return router;
}
