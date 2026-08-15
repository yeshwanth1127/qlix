import { Router } from 'express';
import { createHash } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { addInjection } from '../teams/runInjectionStore.js';
import { buildTeamInbound, gatewayService } from '../gateway/index.js';
import { injectTeamRunMessage } from '../teams/teamChannel.service.js';
import { z } from 'zod';
import { buildAgentCard } from '../agents/agentCard.js';
import { resolveDockerBackendUrl } from '../agents/sdkAgentFile.js';
import { AgentsService } from '../agents/agents.service.js';
import { permissionScopeSchema } from '../agents/scopeValidation.js';
import { authenticateUser } from '../middleware/authenticateUser.js';
import { requireSubscriptionAccess } from '../middleware/requireSubscriptionAccess.js';
import { checkStepUpOrGuest } from '../lib/stepUpOrGuest.js';
import { inboundChannelFromRequest } from '../lib/runOrigin.js';
import {
  buildPromptWithAttachments,
  CHAT_ATTACHMENT_MAX_BYTES,
  CHAT_ATTACHMENT_MAX_MB,
  processChatUploads,
  storedChatAttachments,
} from '../agentChat/chatAttachment.service.js';
import {
  assertModelAllowed,
  ModelPolicyError,
  normalizeQlixInferenceModelId,
} from '../llm/modelPolicy.js';
import { parseReasoningEffort } from '../llm/routing/reasoningBudget.js';
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
  TeamContinuesRunError,
} from '../teams/teams.service.js';
import { TeamsRepository } from '../teams/teams.repository.js';
import { JitService } from '../jit/jit.service.js';
import { stopInFlightTeamRunWorkers } from '../teams/teamRunCancel.js';
import type { TeamRunInputPurpose } from '../teams/teams.types.js';

/** Team-run uploads allow slightly more files than agent chat (8). */
const TEAM_INJECT_MAX_FILES = 10;
const TEAM_INJECT_MESSAGE_MAX = 2000;
const TEAM_RUN_GOAL_MAX = 4000;

const teamFileUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: CHAT_ATTACHMENT_MAX_BYTES, files: TEAM_INJECT_MAX_FILES },
});

function isMultipartRequest(req: Request): boolean {
  const raw = req.headers['content-type'];
  const ct = Array.isArray(raw) ? raw.join(';') : (raw ?? '');
  if (ct.toLowerCase().includes('multipart/form-data')) return true;
  // Fallback for proxies that normalize the header in ways type-is misses.
  return Boolean(req.is('multipart/form-data'));
}

function parseTeamFileUpload(req: Request, res: Response, next: NextFunction): void {
  if (!isMultipartRequest(req)) {
    next();
    return;
  }
  teamFileUpload.array('files', TEAM_INJECT_MAX_FILES)(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      res.status(400).json({
        error: {
          code: 'upload_error',
          message:
            err.code === 'LIMIT_FILE_SIZE'
              ? `File is too large (max ${CHAT_ATTACHMENT_MAX_MB} MB).`
              : err.code === 'LIMIT_FILE_COUNT'
                ? `Too many files (max ${TEAM_INJECT_MAX_FILES}).`
                : err.message,
        },
      });
      return;
    }
    if (err) {
      res.status(400).json({ error: { code: 'upload_error', message: 'File upload failed' } });
      return;
    }
    next();
  });
}

function parseInputPurposes(raw: unknown, count: number): TeamRunInputPurpose[] {
  if (typeof raw !== 'string' || !raw.trim()) {
    return Array.from({ length: count }, () => 'authoritative_input');
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== count) throw new Error('invalid count');
    return parsed.map((purpose) => {
      if (purpose !== 'authoritative_input' && purpose !== 'reference_asset') {
        throw new Error('invalid purpose');
      }
      return purpose;
    });
  } catch {
    throw Object.assign(new Error('inputPurposes must classify every file'), {
      code: 'invalid_input_purposes',
      status: 400,
    });
  }
}

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

const reorderMembersSchema = z
  .object({
    /** Flat form — every member gets its own stage (nothing runs concurrently). */
    memberIds: z.array(z.string().min(1)).min(1).max(50).optional(),
    /** Grouped form — each inner array is one stage; members in a stage run together. */
    stages: z
      .array(z.array(z.string().min(1)).min(1).max(50))
      .min(1)
      .max(50)
      .optional(),
  })
  .refine((v) => v.memberIds != null || v.stages != null, {
    message: 'memberIds or stages is required',
  });

const updateConfigSchema = z.object({
  autoSequence: z.boolean().optional(),
  pipelineMode: z.boolean().optional(),
  defaultModel: z.string().trim().max(120).optional(),
  conversationWorkflowVersionId: z.string().trim().min(1).nullable().optional(),
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
  model: z.string().trim().min(1).max(200).optional(),
  reasoningEffort: z
    .enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
    .optional(),
  continuesRunId: z.string().trim().min(1).max(64).optional(),
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
  const jitService = new JitService();

  // ─── List & Create ──────────────────────────────────────────────────────────

  router.get('/', authenticateUser(true), requireSubscriptionAccess, async (req: Request, res: Response) => {
    try {
      const teams = await service.listTeams(req.auth!.orgId);
      res.json({ teams });
    } catch (err) {
      console.error('listTeams error', err);
      res.status(500).json({ error: { code: 'teams_list_failed', message: 'Failed to list teams' } });
    }
  });

  router.post('/', authenticateUser(true), requireSubscriptionAccess, async (req: Request, res: Response) => {
    const parsed = createTeamSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'invalid_body', message: 'Invalid team payload', issues: parsed.error.issues } });
      return;
    }

    const stepUp = await checkStepUpOrGuest(req);
    if (!stepUp.ok) {
      res.status(stepUp.status).json({ error: { code: stepUp.code, message: stepUp.message } });
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

  router.get('/:id/runners-status', authenticateUser(true), requireSubscriptionAccess, async (req: Request, res: Response) => {
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

  router.get('/:id', authenticateUser(true), requireSubscriptionAccess, async (req: Request, res: Response) => {
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

  router.delete('/:id', authenticateUser(true), requireSubscriptionAccess, async (req: Request, res: Response) => {
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

  router.delete('/:id/supervisor', authenticateUser(true), requireSubscriptionAccess, async (req: Request, res: Response) => {
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

  router.patch('/:id/supervisor', authenticateUser(true), requireSubscriptionAccess, async (req: Request, res: Response) => {
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

  router.post('/:id/members', authenticateUser(true), requireSubscriptionAccess, async (req: Request, res: Response) => {
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
   * Rewrite the pipeline order. Body is either:
   *   { memberIds: string[] }    — one member per stage, fully sequential
   *   { stages: string[][] }     — each inner array is a stage; its members run concurrently
   * Either way the (flattened) list must name every current member exactly once.
   * IMPORTANT: register before /:id/members/:agentId or Express treats "order" as agentId.
   */
  router.patch('/:id/members/order', authenticateUser(true), requireSubscriptionAccess, async (req: Request, res: Response) => {
    const parsed = reorderMembersSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'invalid_body', message: 'memberIds or stages (array) is required' } });
      return;
    }
    try {
      const auth = req.auth!;
      const team = await service.reorderMembers(
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
      if (err instanceof Error && err.message.startsWith('reorderMembers:')) {
        res.status(400).json({ error: { code: 'invalid_member_ids', message: err.message } });
        return;
      }
      console.error('reorderMembers error', err);
      res.status(500).json({ error: { code: 'reorder_failed', message: 'Failed to reorder members' } });
    }
  });

  router.patch('/:id/members/:agentId', authenticateUser(true), requireSubscriptionAccess, async (req: Request, res: Response) => {
    const parsed = patchMemberSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'invalid_body', message: 'Invalid delegated scopes' } });
      return;
    }
    try {
      const backendUrl = resolveDockerBackendUrl(req);
      const member = await service.updateMemberScopes(
        req.params.id!,
        req.auth!.orgId,
        req.params.agentId!,
        parsed.data.delegatedScopes,
        backendUrl,
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
  router.patch('/:id/config', authenticateUser(true), requireSubscriptionAccess, async (req: Request, res: Response) => {
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

  router.delete('/:id/members/:agentId', authenticateUser(true), requireSubscriptionAccess, async (req: Request, res: Response) => {
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

  router.get('/:id/runs', authenticateUser(true), requireSubscriptionAccess, async (req: Request, res: Response) => {
    try {
      const runs = await service.listRuns(req.params.id!, req.auth!.orgId);
      res.json({ runs });
    } catch (err) {
      if (err instanceof TeamNotFoundError) { res.status(404).json({ error: { code: 'not_found', message: err.message } }); return; }
      res.status(500).json({ error: { code: 'runs_list_failed', message: 'Failed to list runs' } });
    }
  });

  router.get('/:id/runs/:runId', authenticateUser(true), requireSubscriptionAccess, async (req: Request, res: Response) => {
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

  /** Set how long a paused WhatsApp wait should collect replies before partial resume. */
  router.post(
    '/:id/runs/:runId/wait-ttl',
    authenticateUser(true),
    requireSubscriptionAccess,
    async (req: Request, res: Response) => {
      const parsed = z
        .object({
          hours: z.number().positive().max(168),
        })
        .safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: { code: 'validation_error', message: 'hours is required (0.25–168)' },
        });
        return;
      }
      try {
        const result = await service.setWaitTtlHours(
          req.params.id!,
          req.params.runId!,
          req.auth!.orgId,
          parsed.data.hours,
        );
        res.json({ ok: true, ...result });
      } catch (err) {
        if (err instanceof TeamNotFoundError) {
          res.status(404).json({ error: { code: 'not_found', message: err.message } });
          return;
        }
        const status =
          typeof (err as { status?: number })?.status === 'number'
            ? (err as { status: number }).status
            : 500;
        const code =
          typeof (err as { code?: string })?.code === 'string'
            ? (err as { code: string }).code
            : 'wait_ttl_failed';
        if (status >= 400 && status < 500) {
          res.status(status).json({
            error: { code, message: err instanceof Error ? err.message : 'Failed to set wait duration' },
          });
          return;
        }
        res.status(500).json({
          error: { code: 'wait_ttl_failed', message: 'Failed to set wait duration' },
        });
      }
    },
  );

  /** Pending JIT approvals for worker/supervisor agent runs in this team execution. */
  router.get(
    '/:id/runs/:runId/pending-jit',
    authenticateUser(true),
    requireSubscriptionAccess,
    async (req: Request, res: Response) => {
      try {
        const run = await service.getRun(req.params.id!, req.params.runId!, req.auth!.orgId);
        if (run.startedByUserId !== req.auth!.userId) {
          res.status(403).json({ error: { code: 'forbidden', message: 'Not your team run' } });
          return;
        }
        const tasks = await repo.listA2ATasks(run.id);
        const agentRunIds = tasks
          .map((t) => t.agentRunId)
          .filter((id): id is string => typeof id === 'string' && id.length > 0);
        const pending = await jitService.listPendingForAgentRuns({
          userId: req.auth!.userId,
          agentRunIds,
        });
        res.json({ pending });
      } catch (err) {
        if (err instanceof TeamNotFoundError) {
          res.status(404).json({ error: { code: 'not_found', message: err.message } });
          return;
        }
        res.status(500).json({ error: { code: 'pending_jit_failed', message: 'Failed to load pending approvals' } });
      }
    },
  );

  router.post(
    '/:id/runs',
    authenticateUser(true),
    requireSubscriptionAccess,
    parseTeamFileUpload,
    async (req: Request, res: Response) => {
    try {
      const isMultipart = isMultipartRequest(req);
      const files = (req.files as Express.Multer.File[] | undefined) ?? [];
      let goal = '';
      let modelRaw = '';
      let reasoningEffortRaw = '';
      let continuesRunId = '';
      if (isMultipart) {
        goal = typeof req.body?.goal === 'string' ? req.body.goal.trim() : '';
        modelRaw = typeof req.body?.model === 'string' ? req.body.model.trim() : '';
        reasoningEffortRaw =
          typeof req.body?.reasoningEffort === 'string' ? req.body.reasoningEffort.trim() : '';
        continuesRunId =
          typeof req.body?.continuesRunId === 'string' ? req.body.continuesRunId.trim() : '';
      } else {
        const parsed = startRunSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: { code: 'invalid_body', message: 'goal is required' } });
          return;
        }
        goal = parsed.data.goal;
        modelRaw = parsed.data.model?.trim() ?? '';
        reasoningEffortRaw = parsed.data.reasoningEffort ?? '';
        continuesRunId = parsed.data.continuesRunId?.trim() ?? '';
      }

      if (goal.length > TEAM_RUN_GOAL_MAX) {
        res.status(400).json({
          error: { code: 'invalid_body', message: `goal is too long (max ${TEAM_RUN_GOAL_MAX} chars)` },
        });
        return;
      }
      if (!goal && files.length === 0) {
        res.status(400).json({
          error: { code: 'invalid_body', message: 'goal or at least one file is required' },
        });
        return;
      }

      let inferenceModel: string | undefined;
      if (modelRaw) {
        try {
          inferenceModel = normalizeQlixInferenceModelId(modelRaw);
          assertModelAllowed(inferenceModel);
        } catch (err) {
          const message =
            err instanceof ModelPolicyError
              ? err.message
              : err instanceof Error
                ? err.message
                : 'Invalid model';
          res.status(400).json({ error: { code: 'invalid_model', message } });
          return;
        }
      }

      const reasoningEffort = parseReasoningEffort(reasoningEffortRaw);

      console.info(
        `[team-run-start] team=${req.params.id} multipart=${String(isMultipart)} files=${String(files.length)} ` +
          `goalChars=${String(goal.length)} model=${inferenceModel ?? '(agent/team default)'} ` +
          `reasoningEffort=${reasoningEffort ?? '(default)'} ` +
          `contentType=${JSON.stringify(req.headers['content-type'] ?? null)}`,
      );

      let processed: Awaited<ReturnType<typeof processChatUploads>> = [];
      if (files.length > 0) {
        processed = await processChatUploads(files, TEAM_INJECT_MAX_FILES);
      } else if (isMultipart) {
        // Client sent multipart (usually means it intended files) but multer got none —
        // common when the body was consumed upstream or the field name mismatched.
        console.warn(
          `[team-run-start] multipart with 0 files team=${req.params.id} bodyKeys=${Object.keys(req.body ?? {}).join(',')}`,
        );
      }
      const attachments = storedChatAttachments(processed);
      const purposes = parseInputPurposes(req.body?.inputPurposes, processed.length);
      const inputs = processed.map((attachment, index) => ({
        id: attachment.id,
        ref: `team-input:${attachment.id}`,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        url: attachment.url,
        sizeBytes: attachment.sizeBytes,
        ...(attachment.extractedText ? { extractedText: attachment.extractedText } : {}),
        sha256: createHash('sha256').update(files[index]!.buffer).digest('hex'),
        purpose: purposes[index]!,
      }));
      const agentGoal = goal.trim() || 'Process the attached input files.';
      if (agentGoal.length > 100_000) {
        res.status(400).json({
          error: {
            code: 'invalid_body',
            message: 'Attached files are too large to include in the run goal. Try fewer or smaller files.',
          },
        });
        return;
      }

      const auth = req.auth!;
      const team = await service.getTeam(req.params.id!, auth.orgId);
      const backendUrl = resolveDockerBackendUrl(req);
      const turn = await gatewayService.handleInbound(
        buildTeamInbound({
          channel: inboundChannelFromRequest(req),
          teamId: team.id,
          teamName: team.name,
          orgId: auth.orgId,
          userId: auth.userId,
          email: auth.email,
          goal: agentGoal,
          backendUrl,
          inferenceModel: inferenceModel ?? null,
          reasoningEffort: reasoningEffort ?? null,
          continuesRunId: continuesRunId || null,
          inputs,
        }),
      );
      if (turn.status !== 'accepted') {
        res.status(turn.status === 'rejected' ? 409 : 202).json({
          error: {
            code: 'gateway_rejected',
            message: turn.status === 'rejected' ? turn.reason : (turn.ackReply ?? turn.status),
          },
        });
        return;
      }
      const run = await service.getRun(team.id, turn.runId!, auth.orgId);
      const displayGoal =
        goal ||
        (processed.length === 1
          ? `Attached ${processed[0]!.fileName}`
          : processed.length > 0
            ? `Attached ${processed.length} files`
            : agentGoal);
      res.status(202).json({
        run,
        displayGoal,
        model: inferenceModel ?? team.config?.defaultModel ?? null,
        ...(attachments.length > 0 ? { attachments } : {}),
      });
    } catch (err) {
      if (err instanceof TeamNotFoundError) { res.status(404).json({ error: { code: 'not_found', message: err.message } }); return; }
      if (err instanceof TeamNoSupervisorError) { res.status(400).json({ error: { code: err.code, message: err.message } }); return; }
      if (err instanceof TeamRunnersNotReadyError) { res.status(400).json({ error: { code: err.code, message: err.message } }); return; }
      if (err instanceof TeamEmailConnectorRequiredError) { res.status(409).json({ error: { code: err.code, message: err.message } }); return; }
      if (err instanceof TeamContinuesRunError) { res.status(400).json({ error: { code: err.code, message: err.message } }); return; }
      if (err instanceof ModelPolicyError) {
        res.status(400).json({ error: { code: 'invalid_model', message: err.message } });
        return;
      }
      const status = typeof (err as { status?: number })?.status === 'number' ? (err as { status: number }).status : 500;
      const code = typeof (err as { code?: string })?.code === 'string' ? (err as { code: string }).code : 'run_start_failed';
      if (status >= 400 && status < 500) {
        res.status(status).json({
          error: { code, message: err instanceof Error ? err.message : 'Failed to start run' },
        });
        return;
      }
      res.status(500).json({ error: { code: 'run_start_failed', message: 'Failed to start run' } });
    }
  });

  // User: inject a guidance message (optional files) into the active worker mid-run
  router.post(
    '/:id/runs/:runId/inject',
    authenticateUser(true),
    requireSubscriptionAccess,
    parseTeamFileUpload,
    async (req: Request, res: Response) => {
    try {
      const isMultipart = isMultipartRequest(req);
      const files = (req.files as Express.Multer.File[] | undefined) ?? [];
      let message = '';
      if (isMultipart) {
        message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
      } else {
        const body = z
          .object({ message: z.string().trim().min(1).max(TEAM_INJECT_MESSAGE_MAX) })
          .safeParse(req.body);
        if (!body.success) {
          res.status(400).json({
            error: { code: 'validation_error', message: 'message is required (max 2000 chars)' },
          });
          return;
        }
        message = body.data.message;
      }

      if (message.length > TEAM_INJECT_MESSAGE_MAX) {
        res.status(400).json({
          error: { code: 'validation_error', message: `message is too long (max ${TEAM_INJECT_MESSAGE_MAX} chars)` },
        });
        return;
      }
      if (!message && files.length === 0) {
        res.status(400).json({
          error: { code: 'validation_error', message: 'message or at least one file is required' },
        });
        return;
      }

      console.info(
        `[team-run-inject] team=${req.params.id} run=${req.params.runId} multipart=${String(isMultipart)} ` +
          `files=${String(files.length)} messageChars=${String(message.length)} ` +
          `contentType=${JSON.stringify(req.headers['content-type'] ?? null)}`,
      );

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

      let processed: Awaited<ReturnType<typeof processChatUploads>> = [];
      if (files.length > 0) {
        processed = await processChatUploads(files, TEAM_INJECT_MAX_FILES);
      } else if (isMultipart) {
        console.warn(
          `[team-run-inject] multipart with 0 files team=${req.params.id} run=${req.params.runId} bodyKeys=${Object.keys(req.body ?? {}).join(',')}`,
        );
      }
      const attachments = storedChatAttachments(processed);
      const injectText = buildPromptWithAttachments(message, processed);
      const displayMessage =
        message ||
        (processed.length === 1
          ? `Attached ${processed[0]!.fileName}`
          : `Attached ${processed.length} files`);

      await addInjection(task.agentRunId, injectText);
      await repo.appendEvent(run.id, req.params.id!, task.toAgentId, 'user_injection' as any, {
        message: displayMessage,
        ...(attachments.length > 0 ? { attachments } : {}),
      });
      res.json({ ok: true, attachments });
    } catch (err) {
      if (err instanceof TeamNotFoundError) { res.status(404).json({ error: { code: 'not_found', message: (err as Error).message } }); return; }
      const status = typeof (err as { status?: number })?.status === 'number' ? (err as { status: number }).status : 500;
      const code = typeof (err as { code?: string })?.code === 'string' ? (err as { code: string }).code : 'inject_failed';
      if (status >= 400 && status < 500) {
        res.status(status).json({
          error: { code, message: err instanceof Error ? err.message : 'Failed to inject message' },
        });
        return;
      }
      res.status(500).json({ error: { code: 'inject_failed', message: 'Failed to inject message' } });
    }
  });

  router.post('/:id/runs/:runId/cancel', authenticateUser(true), requireSubscriptionAccess, async (req: Request, res: Response) => {
    try {
      const run = await service.getRun(req.params.id!, req.params.runId!, req.auth!.orgId);
      if (!['queued', 'running', 'paused'].includes(run.status)) {
        res.status(409).json({ error: { code: 'run_not_cancelable', message: `Run is already ${run.status}` } });
        return;
      }
      // Stop workers before flipping TeamRun status so WhatsApp tools cannot
      // fall through from wait-queue to live send.
      await stopInFlightTeamRunWorkers(run.id);
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
  router.get('/:id/runs/:runId/stream', authenticateUser(true), requireSubscriptionAccess, async (req: Request, res: Response) => {
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

      // If already terminal, close immediately (paused runs keep streaming)
      const currentRun = await repo.findRun(run.id);
      if (currentRun && ['completed', 'failed', 'canceled'].includes(currentRun.status)) {
        send('complete', { status: currentRun.status, result: currentRun.result });
        res.end();
        return;
      }
      if (currentRun?.status === 'paused') {
        send('paused', {
          status: 'paused',
          teamRunId: currentRun.id,
        });
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
        if (latest?.status === 'paused' && !closed) {
          send('paused', {
            status: 'paused',
            teamRunId: latest.id,
          });
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
