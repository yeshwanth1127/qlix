import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  AgentConfirmNameMismatchError,
  AgentDeleteForbiddenError,
  AgentNotFoundError,
  AgentsService,
  DeviceNotVerifiedError,
  OrgMembershipError,
} from '../agents/agents.service.js';
import { NLCreationService } from '../agents/nlCreate.js';
import { parseAgentCreationPrompt, NLParseError } from '../agents/nlParse.js';
import type { AgentCreationPlan } from '../agents/nlTypes.js';
import type { HybridStarterPlatform } from '../agents/hybridStarterPack.js';
import {
  buildSdkAgentJson,
  buildSdkAgentJsonPublic,
  buildSdkAgentJsonHybrid,
  buildSdkAgentPathsHint,
  resolvePublicBackendUrl,
  resolveDockerBackendUrl,
  resolveHybridRunnerBackendUrl,
} from '../agents/sdkAgentFile.js';
import {
  buildHybridStarterPackZip,
  hybridStarterPackFilename,
  resolveHybridStarterPlatform,
} from '../agents/hybridStarterPack.js';
import { ALL_PERMISSION_SCOPES, type PermissionScope } from '../agents/agents.types.js';
import { authenticateUser } from '../middleware/authenticateUser.js';
import { checkStepUpOrGuest, checkGuestAgentCap } from '../lib/stepUpOrGuest.js';
import { CloudProvisionFailedError, CloudProvisionerService } from '../cloudRunners/cloudProvisioner.service.js';
import { dockerLogs, DockerNotAvailableError } from '../cloudRunners/dockerClient.js';
import { dockerContainerName, legacyDockerContainerName } from '../cloudRunners/dockerNaming.js';
import { AgentsRepository } from '../agents/agents.repository.js';
import { BrainAgentService } from '../aiBrain/brainAgent.service.js';
import { encryptForAgentSecrets, AgentSecretsKeyMissingError } from '../cloudRunners/agentSecrets.js';
import {
  assertRunnerAuthByDidOrId,
  RunnerUnauthorizedError,
  generateHybridRunnerToken,
} from '../agentChat/runnerAuth.js';
import { listActiveAgentRuns, listAgentRunHistory } from '../agentChat/agentRunService.js';
import { BrainQueryService } from '../aiBrain/brainQuery.service.js';
import {
  assertStandardAgentCanQueryBrain,
  BrainNotProvisionedError,
  BrainQueryForbiddenError,
  BrainWrongOrgError,
} from '../aiBrain/agentBrainAccess.js';

const permissionScopeSchema = z.enum(ALL_PERMISSION_SCOPES as [PermissionScope, ...PermissionScope[]]);

const createAgentSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(10000).optional().nullable(),
    permissionScopes: z.array(permissionScopeSchema).min(1).max(ALL_PERMISSION_SCOPES.length),
    jitScopes: z.array(permissionScopeSchema).default([]),
    runtime: z.enum(['cloud', 'local', 'hybrid']),
    model: z.string().trim().min(1).max(120),
    llmMode: z.enum(['direct', 'proxy']).default('proxy'),
    orgId: z.string().uuid().nullable(),
    localInferenceMode: z.enum(['local_llm', 'cloud_api']).nullable(),
    /** Hybrid starter ZIP: include only the launcher for this OS (from the creating browser). */
    clientPlatform: z.enum(['windows', 'macos', 'linux']).optional(),
  })
  .superRefine((data, ctx) => {
    if ((data.runtime === 'cloud' || data.runtime === 'hybrid') && data.llmMode === 'direct') {
      ctx.addIssue({
        code: 'custom',
        message: 'llmMode "direct" is not allowed when runtime is "cloud" or "hybrid"',
        path: ['llmMode'],
      });
    }
    if (data.runtime === 'local') {
      if (data.localInferenceMode == null) {
        ctx.addIssue({
          code: 'custom',
          message: 'localInferenceMode is required when runtime is local',
          path: ['localInferenceMode'],
        });
      }
    } else if (data.runtime !== 'local' && data.localInferenceMode != null) {
      ctx.addIssue({
        code: 'custom',
        message: 'localInferenceMode must be null when runtime is cloud or hybrid',
        path: ['localInferenceMode'],
      });
    }
  });

const deleteAgentBodySchema = z.object({
  confirmName: z.string().trim().min(1).max(200),
});

const agentBrainQueryBody = z.object({
  question: z.string().trim().min(1).max(4000),
  collectionIds: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
});

export function createAgentsRouter(): Router {
  const router = Router();
  const service = new AgentsService();
  const cloudProvisioner = new CloudProvisionerService();
  const agentsRepo = new AgentsRepository();

  router.post('/', authenticateUser(true), async (request: Request, response: Response) => {
    const parsed = createAgentSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({
        error: { code: 'invalid_body', message: 'Invalid agent creation payload', issues: parsed.error.issues },
      });
      return;
    }

    const stepUp = await checkStepUpOrGuest(request);
    if (!stepUp.ok) {
      response.status(stepUp.status).json({ error: { code: stepUp.code, message: stepUp.message } });
      return;
    }
    if (stepUp.isGuest) {
      const capError = await checkGuestAgentCap(request.auth!.userId, 1);
      if (capError) {
        response.status(capError.status).json({ error: { code: capError.code, message: capError.message } });
        return;
      }
    }

    try {
      const result = await service.createAgent(request.auth!.userId, parsed.data);
      const backendUrl =
        result.agent.runtime === 'hybrid' || result.agent.runtime === 'local'
          ? resolveHybridRunnerBackendUrl(request)
          : resolvePublicBackendUrl(request);
      let sdkAgentFile: Record<string, unknown>;

      if (result.agent.runtime === 'cloud') {
        // Persist encrypted signing key even if Docker/provisioning fails, so restart can work later.
        try {
          const enc = encryptForAgentSecrets(result.privateKey);
          await agentsRepo.updateCloudFields(result.agent.id, {
            cloudPrivateKeyEnc: enc,
            cloudProvisioningStatus: 'provisioning',
            cloudProvisioningError: null,
          });
        } catch (e) {
          const msg =
            e instanceof AgentSecretsKeyMissingError
              ? e.message
              : e instanceof Error
                ? e.message
                : String(e);
          console.warn('[cloudProvision] Failed to encrypt cloud agent key:', msg);
          await agentsRepo
            .updateCloudFields(result.agent.id, {
              cloudProvisioningStatus: 'failed',
              cloudRunnerId: null,
              cloudProvisioningError: msg,
            })
            .catch(() => {});
        }
        try {
          await cloudProvisioner.provisionCloudRunner({
            agent: result.agent,
            privateKey: result.privateKey,
            requestForBackendUrl: request,
          });
        } catch (provErr) {
          const message =
            provErr instanceof DockerNotAvailableError
              ? provErr.message
              : provErr instanceof CloudProvisionFailedError
                ? provErr.message
                : 'Cloud runner provisioning failed';
          console.warn('[cloudProvision]', message);
          await agentsRepo
            .updateCloudFields(result.agent.id, {
              cloudProvisioningStatus: 'failed',
              cloudRunnerId: null,
              cloudProvisioningError: message,
            })
            .catch(() => {});
        }
        sdkAgentFile = buildSdkAgentJsonPublic(result.agent, backendUrl);
      } else if (result.agent.runtime === 'hybrid') {
        // Generate one-time runner token; store HMAC hash, return plaintext once.
        const { token: runnerToken, hash: runnerTokenHash } = generateHybridRunnerToken();
        await agentsRepo.updateHybridFields(result.agent.id, { hybridRunnerTokenHash: runnerTokenHash });
        sdkAgentFile = buildSdkAgentJsonHybrid(result.agent, result.privateKey, runnerToken, backendUrl);
      } else {
        sdkAgentFile = buildSdkAgentJson(result.agent, result.privateKey, backendUrl);
      }

      const sdkAgentPaths = buildSdkAgentPathsHint(result.agent.name);

      let hybridStarterPack: { filename: string; base64: string } | undefined;
      if (result.agent.runtime === 'hybrid') {
        try {
          const platform = resolveHybridStarterPlatform(
            parsed.data.clientPlatform,
            request.headers['user-agent'],
          );
          const zip = await buildHybridStarterPackZip(sdkAgentFile, result.agent.name, platform);
          hybridStarterPack = {
            filename: hybridStarterPackFilename(result.agent.name, platform),
            base64: zip.toString('base64'),
          };
        } catch (packErr) {
          console.warn('[hybridStarterPack]', packErr);
        }
      }

      response.status(201).json({
        agent: result.agent,
        credentials: result.credentials,
        sdkAgentFile,
        sdkAgentPaths,
        hybridStarterPack,
      });
    } catch (err) {
      if (err instanceof DeviceNotVerifiedError) {
        response.status(403).json({
          error: { code: 'device_not_verified', message: 'Device verification required before creating an agent' },
        });
        return;
      }
      if (err instanceof OrgMembershipError) {
        response.status(403).json({
          error: { code: 'forbidden', message: err.message },
        });
        return;
      }
      console.error('createAgent error', err);
      response.status(500).json({
        error: { code: 'agent_create_failed', message: 'Failed to create agent' },
      });
    }
  });

  // ── NL Builder: parse prompt ─────────────────────────────────────────────
  const nlParseSchema = z.object({
    prompt: z.string().trim().min(1).max(5000),
    model: z.string().trim().min(1).max(200).optional(),
  });

  router.post('/nl-parse', authenticateUser(true), async (request: Request, response: Response) => {
    const parsed = nlParseSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({
        error: { code: 'invalid_body', message: 'prompt is required (1-5000 chars)' },
      });
      return;
    }
    try {
      const plan = await parseAgentCreationPrompt(parsed.data.prompt, request.auth!.orgId, parsed.data.model);
      response.json({ plan });
    } catch (err) {
      if (err instanceof NLParseError) {
        response.status(422).json({ error: { code: 'nl_parse_failed', message: err.message } });
        return;
      }
      console.error('[nlParse]', err);
      response.status(500).json({ error: { code: 'nl_parse_error', message: 'Failed to parse prompt' } });
    }
  });

  // ── NL Builder: create agents from plan ──────────────────────────────────
  const nlCreateSchema = z.object({
    plan: z.object({
      type: z.enum(['single', 'team']),
      rationale: z.string().optional(),
    }).passthrough(),
    orgId: z.string().uuid().nullable(),
    clientPlatform: z.enum(['windows', 'macos', 'linux']).optional(),
    model: z.string().trim().min(1).max(200).optional(),
  });

  const nlCreationService = new NLCreationService();

  router.post('/nl-create', authenticateUser(true), async (request: Request, response: Response) => {
    const parsed = nlCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({
        error: { code: 'invalid_body', message: 'plan and orgId are required', issues: parsed.error.issues },
      });
      return;
    }

    const stepUp = await checkStepUpOrGuest(request);
    if (!stepUp.ok) {
      response.status(stepUp.status).json({ error: { code: stepUp.code, message: stepUp.message } });
      return;
    }
    if (stepUp.isGuest) {
      const planForCount = parsed.data.plan as AgentCreationPlan;
      const agentsToCreate =
        planForCount.type === 'team' ? 1 + (planForCount.team?.workers?.length ?? 0) : 1;
      const capError = await checkGuestAgentCap(request.auth!.userId, agentsToCreate);
      if (capError) {
        response.status(capError.status).json({ error: { code: capError.code, message: capError.message } });
        return;
      }
    }

    try {
      let plan = parsed.data.plan as AgentCreationPlan;
      const userModel = parsed.data.model;
      if (userModel) {
        if (plan.type === 'single') {
          plan = { ...plan, agent: { ...plan.agent, model: userModel } };
        } else {
          plan = {
            ...plan,
            team: {
              ...plan.team,
              supervisor: { ...plan.team.supervisor, model: userModel },
              workers: plan.team.workers.map((w) => ({ ...w, model: userModel })),
            },
          };
        }
      }

      const result = await nlCreationService.createFromPlan({
        userId: request.auth!.userId,
        orgId: parsed.data.orgId,
        plan,
        request,
        clientPlatform: parsed.data.clientPlatform as HybridStarterPlatform | undefined,
      });

      if (result.type === 'single') {
        const { agentResult, sdkAgentFile, sdkAgentPaths, hybridStarterPack } = result.output;
        response.status(201).json({
          type: 'single',
          agent: agentResult.agent,
          credentials: agentResult.credentials,
          sdkAgentFile,
          sdkAgentPaths,
          hybridStarterPack,
        });
      } else {
        response.status(201).json({
          type: 'team',
          teamId: result.teamId,
          supervisor: {
            agent: result.supervisorOutput.agentResult.agent,
            credentials: result.supervisorOutput.agentResult.credentials,
            sdkAgentFile: result.supervisorOutput.sdkAgentFile,
            sdkAgentPaths: result.supervisorOutput.sdkAgentPaths,
            hybridStarterPack: result.supervisorOutput.hybridStarterPack,
          },
          workers: result.workerOutputs.map((w) => ({
            agent: w.agentResult.agent,
            credentials: w.agentResult.credentials,
            sdkAgentFile: w.sdkAgentFile,
            sdkAgentPaths: w.sdkAgentPaths,
            hybridStarterPack: w.hybridStarterPack,
          })),
        });
      }
    } catch (err) {
      if (err instanceof DeviceNotVerifiedError) {
        response.status(403).json({ error: { code: 'device_not_verified', message: 'Device verification required' } });
        return;
      }
      if (err instanceof OrgMembershipError) {
        response.status(403).json({ error: { code: 'forbidden', message: err.message } });
        return;
      }
      console.error('[nlCreate]', err);
      response.status(500).json({ error: { code: 'nl_create_failed', message: 'Failed to create agents from plan' } });
    }
  });

  router.get('/', authenticateUser(true), async (request: Request, response: Response) => {
    try {
      const auth = request.auth!;
      const orgIdParam = request.query.orgId;
      const orgId = typeof orgIdParam === 'string' && orgIdParam.length > 0 ? orgIdParam : null;
      if (orgId && orgId !== auth.orgId) {
        response.status(403).json({ error: { code: 'forbidden', message: 'Not a member of that org' } });
        return;
      }
      if (orgId) {
        await new BrainAgentService().normalizeOrgBrain(orgId);
      }
      // Individual workspace (no orgId param): also include agents that carry the
      // caller's personal workspace org (e.g. team-built agents), not just orgId-null ones.
      const agents = await service.listAgents(auth.userId, orgId, auth.orgId);
      response.json({ agents });
    } catch (err) {
      console.error('listAgents error', err);
      response.status(500).json({
        error: { code: 'agents_list_failed', message: 'Failed to list agents' },
      });
    }
  });

  router.get('/active-runs', authenticateUser(true), async (request: Request, response: Response) => {
    try {
      const auth = request.auth!;
      const orgIdParam = request.query.orgId;
      const orgId =
        typeof orgIdParam === 'string' && orgIdParam.length > 0 ? orgIdParam : auth.orgId;
      if (orgId && orgId !== auth.orgId) {
        response.status(403).json({ error: { code: 'forbidden', message: 'Forbidden' } });
        return;
      }
      const runs = await listActiveAgentRuns(auth.userId, orgId);
      response.json({ runs });
    } catch (err) {
      console.error('list active runs error', err);
      response.status(500).json({ error: { code: 'active_runs_failed', message: 'Failed to list active runs' } });
    }
  });

  router.get('/run-history', authenticateUser(true), async (request: Request, response: Response) => {
    try {
      const auth = request.auth!;
      const orgIdParam = request.query.orgId;
      const orgId =
        typeof orgIdParam === 'string' && orgIdParam.length > 0 ? orgIdParam : auth.orgId;
      if (orgId && orgId !== auth.orgId) {
        response.status(403).json({ error: { code: 'forbidden', message: 'Forbidden' } });
        return;
      }
      const limitParam = request.query.limit;
      const limit =
        typeof limitParam === 'string' && limitParam.length > 0
          ? Number.parseInt(limitParam, 10)
          : 30;
      const runs = await listAgentRunHistory(
        auth.userId,
        orgId,
        Number.isFinite(limit) ? limit : 30,
      );
      response.json({ runs });
    } catch (err) {
      console.error('list run history error', err);
      response.status(500).json({ error: { code: 'run_history_failed', message: 'Failed to list run history' } });
    }
  });

  router.get('/:id', authenticateUser(true), async (request: Request, response: Response) => {
    try {
      const id = String(request.params.id);
      const agent = await service.getAgent(id);
      if (!agent) {
        response.status(404).json({ error: { code: 'not_found', message: 'Agent not found' } });
        return;
      }
      const auth = request.auth!;
      const ownsAgent = agent.userId === auth.userId || (agent.orgId && agent.orgId === auth.orgId);
      if (!ownsAgent) {
        response.status(403).json({ error: { code: 'forbidden', message: 'Cannot view agent' } });
        return;
      }
      const credentials = await service.listCredentials(agent.id);
      response.json({ agent, credentials });
    } catch (err) {
      console.error('getAgent error', err);
      response.status(500).json({
        error: { code: 'agent_get_failed', message: 'Failed to load agent' },
      });
    }
  });

  router.get('/:id/runtime-status', authenticateUser(true), async (request: Request, response: Response) => {
    try {
      const id = String(request.params.id);
      const agent = await service.getAgent(id);
      if (!agent) {
        response.status(404).json({ error: { code: 'not_found', message: 'Agent not found' } });
        return;
      }
      const auth = request.auth!;
      const ownsAgent = agent.userId === auth.userId || (agent.orgId && agent.orgId === auth.orgId);
      if (!ownsAgent) {
        response.status(403).json({ error: { code: 'forbidden', message: 'Cannot view agent' } });
        return;
      }

      const HEARTBEAT_FRESH_MS = 20_000;
      const cloudHb = agent.cloudLastHeartbeatAt
        ? Date.now() - new Date(agent.cloudLastHeartbeatAt).getTime() < HEARTBEAT_FRESH_MS
        : false;
      const hybridHb = agent.hybridLastHeartbeatAt
        ? Date.now() - new Date(agent.hybridLastHeartbeatAt).getTime() < HEARTBEAT_FRESH_MS
        : false;
      const heartbeatFresh =
        agent.runtime === 'hybrid' ? hybridHb : agent.runtime === 'cloud' ? cloudHb : false;
      const lastHeartbeatAt =
        agent.runtime === 'hybrid'
          ? agent.hybridLastHeartbeatAt
          : agent.cloudLastHeartbeatAt;
      const inferenceReady = !!process.env.OPENROUTER_API_KEY?.trim();
      const inferenceError =
        (agent.runtime === 'cloud' || agent.runtime === 'hybrid') &&
        agent.llmMode === 'proxy' &&
        !inferenceReady
          ? 'Inference proxy is not configured: OPENROUTER_API_KEY is missing on backend.'
          : null;

      response.json({
        runtime: agent.runtime,
        provisioningStatus: agent.runtime === 'cloud' ? agent.cloudProvisioningStatus : null,
        runnerId: agent.runtime === 'cloud' ? agent.cloudRunnerId : null,
        lastHeartbeatAt,
        heartbeatFresh,
        lastConnectedAt: agent.lastConnectedAt,
        status: agent.status,
        provisioningError: agent.runtime === 'cloud' ? agent.cloudProvisioningError : null,
        inferenceReady,
        inferenceError,
      });
    } catch (err) {
      console.error('runtime-status error', err);
      response.status(500).json({
        error: { code: 'runtime_status_failed', message: 'Failed to load runtime status' },
      });
    }
  });

  /**
   * Re-issue the hybrid starter pack. The original private signing key is never persisted
   * server-side (security), so we rotate the agent's keypair AND the runner token, then
   * emit a fresh ZIP. The agent's DID, name, scopes, runs and audit history are preserved;
   * the OLD starter pack stops working immediately.
   */
  router.post(
    '/:id/hybrid/reissue-starter',
    authenticateUser(true),
    async (request: Request, response: Response) => {
      try {
        const id = String(request.params.id);
        const agent = await service.getAgent(id);
        if (!agent) {
          response.status(404).json({ error: { code: 'not_found', message: 'Agent not found' } });
          return;
        }
        const auth = request.auth!;
        const ownsAgent =
          agent.userId === auth.userId || (agent.orgId && agent.orgId === auth.orgId);
        if (!ownsAgent) {
          response
            .status(403)
            .json({ error: { code: 'forbidden', message: 'Cannot manage agent' } });
          return;
        }
        if (agent.runtime !== 'hybrid') {
          response.status(400).json({
            error: {
              code: 'invalid_runtime',
              message: 'Re-issue is only available for hybrid agents.',
            },
          });
          return;
        }

        const platformInput =
          typeof request.body?.clientPlatform === 'string'
            ? (request.body.clientPlatform as string)
            : undefined;

        const rotated = await service.rotateAgentKeypair(agent.id);
        const { token: runnerToken, hash: runnerTokenHash } = generateHybridRunnerToken();
        await agentsRepo.updateHybridFields(rotated.agent.id, {
          hybridRunnerTokenHash: runnerTokenHash,
        });

        const backendUrl = resolveHybridRunnerBackendUrl(request);
        const sdkAgentFile = buildSdkAgentJsonHybrid(
          rotated.agent,
          rotated.privateKey,
          runnerToken,
          backendUrl,
        );
        const platform = resolveHybridStarterPlatform(platformInput, request.headers['user-agent']);
        const zip = await buildHybridStarterPackZip(sdkAgentFile, rotated.agent.name, platform);

        response.json({
          ok: true,
          hybridStarterPack: {
            filename: hybridStarterPackFilename(rotated.agent.name, platform),
            base64: zip.toString('base64'),
          },
        });
      } catch (err) {
        console.error('hybrid reissue-starter error', err);
        response.status(500).json({
          error: {
            code: 'reissue_starter_failed',
            message:
              err instanceof Error ? err.message : 'Failed to re-issue hybrid starter pack',
          },
        });
      }
    },
  );

  router.post('/:id/cloud/restart', authenticateUser(true), async (request: Request, response: Response) => {
    try {
      const id = String(request.params.id);
      const agent = await service.getAgent(id);
      if (!agent) {
        response.status(404).json({ error: { code: 'not_found', message: 'Agent not found' } });
        return;
      }
      const auth = request.auth!;
      const ownsAgent = agent.userId === auth.userId || (agent.orgId && agent.orgId === auth.orgId);
      if (!ownsAgent) {
        response.status(403).json({ error: { code: 'forbidden', message: 'Cannot manage agent' } });
        return;
      }
      if (agent.runtime !== 'cloud') {
        response.status(400).json({ error: { code: 'invalid_runtime', message: 'Agent is not cloud runtime' } });
        return;
      }
      const hasSecrets = await agentsRepo.hasCloudRunnerSecrets(agent.id);
      if (!hasSecrets) {
        response.status(400).json({
          error: {
            code: 'cloud_secret_missing',
            message:
              'This agent was created before cloud secrets were persisted. Please recreate the agent to enable runner restart.',
          },
        });
        return;
      }

      const backendUrl = resolveDockerBackendUrl(request);
      await agentsRepo.updateCloudFields(agent.id, {
        cloudProvisioningStatus: 'provisioning',
        cloudProvisioningError: null,
      });
      cloudProvisioner.scheduleRestartCloudRunner({ agentId: agent.id, backendUrl });
      response.status(202).json({ ok: true, status: 'provisioning' });
    } catch (err) {
      console.error('cloud restart error', err);
      response.status(500).json({
        error: { code: 'cloud_restart_failed', message: 'Failed to restart cloud runner' },
      });
    }
  });

  router.post('/:id/cloud/clear-provisioning', authenticateUser(true), async (request: Request, response: Response) => {
    try {
      const id = String(request.params.id);
      const agent = await service.getAgent(id);
      if (!agent) {
        response.status(404).json({ error: { code: 'not_found', message: 'Agent not found' } });
        return;
      }
      const auth = request.auth!;
      const ownsAgent = agent.userId === auth.userId || (agent.orgId && agent.orgId === auth.orgId);
      if (!ownsAgent) {
        response.status(403).json({ error: { code: 'forbidden', message: 'Cannot manage agent' } });
        return;
      }
      if (agent.runtime !== 'cloud') {
        response.status(400).json({ error: { code: 'invalid_runtime', message: 'Agent is not cloud runtime' } });
        return;
      }

      // Clear stuck provisioning status
      await agentsRepo.updateCloudFields(agent.id, {
        cloudProvisioningStatus: null,
        cloudProvisioningError: null,
      });
      response.status(200).json({ ok: true, message: 'Provisioning status cleared' });
    } catch (err) {
      console.error('clear provisioning error', err);
      response.status(500).json({
        error: { code: 'clear_provisioning_failed', message: 'Failed to clear provisioning status' },
      });
    }
  });

  router.get('/:id/cloud/logs', authenticateUser(true), async (request: Request, response: Response) => {
    try {
      const id = String(request.params.id);
      const agent = await service.getAgent(id);
      if (!agent) {
        response.status(404).json({ error: { code: 'not_found', message: 'Agent not found' } });
        return;
      }
      const auth = request.auth!;
      const ownsAgent = agent.userId === auth.userId || (agent.orgId && agent.orgId === auth.orgId);
      if (!ownsAgent) {
        response.status(403).json({ error: { code: 'forbidden', message: 'Cannot view logs' } });
        return;
      }
      if (agent.runtime !== 'cloud') {
        response.status(400).json({ error: { code: 'invalid_runtime', message: 'Agent is not cloud runtime' } });
        return;
      }
      const tailRaw = request.query.tail;
      const tail = typeof tailRaw === 'string' ? Math.min(5000, Math.max(10, Number(tailRaw))) : 200;
      const logTarget = dockerContainerName({ id: agent.id, name: agent.name, did: agent.did });
      let logs = await dockerLogs({ name: logTarget, tail: Number.isFinite(tail) ? tail : 200 }).catch(
        () => '',
      );
      if (!logs.trim()) {
        logs = await dockerLogs({
          name: legacyDockerContainerName(agent.id),
          tail: Number.isFinite(tail) ? tail : 200,
        }).catch(() => '');
      }
      response.json({ logs });
    } catch (err) {
      console.error('cloud logs error', err);
      response.status(500).json({
        error: { code: 'cloud_logs_failed', message: 'Failed to load cloud runner logs' },
      });
    }
  });

  router.patch('/:id/description', authenticateUser(true), async (request: Request, response: Response) => {
    const schema = z.object({ description: z.string().trim().max(10000).nullable() });
    const body = schema.safeParse(request.body);
    if (!body.success) {
      response.status(400).json({ error: { code: 'validation_error', message: 'description must be a string of max 10000 chars or null' } });
      return;
    }
    const agent = await agentsRepo.findById(String(request.params.id));
    if (!agent) {
      response.status(404).json({ error: { code: 'not_found', message: 'Agent not found' } });
      return;
    }
    const auth = request.auth!;
    const ownsAgent = agent.orgId ? agent.orgId === auth.orgId : agent.userId === auth.userId;
    if (!ownsAgent) {
      response.status(403).json({ error: { code: 'forbidden', message: 'Not your agent' } });
      return;
    }
    const updated = await agentsRepo.updateDescription(agent.id, body.data.description);
    response.json({ agent: updated });
  });

  router.patch('/:id/confirm-download', authenticateUser(true), async (request: Request, response: Response) => {
    try {
      const id = String(request.params.id);
      const agent = await service.getAgent(id);
      if (!agent) {
        response.status(404).json({ error: { code: 'not_found', message: 'Agent not found' } });
        return;
      }
      if (agent.userId !== request.auth!.userId) {
        response.status(403).json({ error: { code: 'forbidden', message: 'Not your agent' } });
        return;
      }
      await service.confirmDownload(id);
      response.json({ ok: true });
    } catch (err) {
      console.error('confirmDownload error', err);
      response.status(500).json({
        error: { code: 'confirm_failed', message: 'Failed to confirm download' },
      });
    }
  });

  router.delete('/:id', authenticateUser(true), async (request: Request, response: Response) => {
    const parsedBody = deleteAgentBodySchema.safeParse(
      typeof request.body === 'object' && request.body !== null ? request.body : {},
    );
    if (!parsedBody.success) {
      response.status(400).json({
        error: { code: 'invalid_body', message: 'confirmName is required and must be a non-empty string' },
      });
      return;
    }
    try {
      const id = String(request.params.id);
      const auth = request.auth!;
      await service.deleteAgent(auth.userId, auth.orgId, auth.role, id, parsedBody.data.confirmName);
      response.status(204).send();
    } catch (err) {
      if (err instanceof AgentNotFoundError) {
        response.status(404).json({ error: { code: 'not_found', message: err.message } });
        return;
      }
      if (err instanceof AgentConfirmNameMismatchError) {
        response.status(400).json({
          error: { code: 'confirm_name_mismatch', message: err.message },
        });
        return;
      }
      if (err instanceof AgentDeleteForbiddenError) {
        response.status(403).json({ error: { code: 'forbidden', message: err.message } });
        return;
      }
      console.error('deleteAgent error', err);
      response.status(500).json({
        error: { code: 'agent_delete_failed', message: 'Failed to delete agent' },
      });
    }
  });

  router.delete('/', authenticateUser(true), async (request: Request, response: Response) => {
    const body = typeof request.body === 'object' && request.body !== null ? request.body : {};
    if (body.confirm !== 'DELETE_ALL') {
      response.status(400).json({ error: { code: 'invalid_confirm', message: 'Send { confirm: "DELETE_ALL" } to confirm bulk deletion.' } });
      return;
    }
    try {
      const auth = request.auth!;
      const deleted = await service.deleteAllAgents(auth.userId, auth.orgId, auth.role);
      response.json({ ok: true, deleted });
    } catch (err) {
      if (err instanceof AgentDeleteForbiddenError) {
        response.status(403).json({ error: { code: 'forbidden', message: err.message } });
        return;
      }
      console.error('deleteAllAgents error', err);
      response.status(500).json({ error: { code: 'delete_all_failed', message: 'Failed to delete agents' } });
    }
  });

  const queryService = new BrainQueryService();

  router.post('/:id/brain/query', authenticateUser(true), async (request: Request, response: Response) => {
    const parsed = agentBrainQueryBody.safeParse(request.body ?? {});
    if (!parsed.success) {
      response.status(400).json({
        error: { code: 'invalid_body', message: 'question is required (1-4000 chars)' },
      });
      return;
    }
    try {
      const id = String(request.params.id);
      const auth = request.auth!;
      const agent = await service.getAgent(id);
      if (!agent) {
        response.status(404).json({ error: { code: 'not_found', message: 'Agent not found' } });
        return;
      }
      const ownsAgent = agent.userId === auth.userId || (agent.orgId != null && agent.orgId === auth.orgId);
      if (!ownsAgent) {
        response.status(403).json({ error: { code: 'forbidden', message: 'Cannot use this agent' } });
        return;
      }
      const orgId = agent.orgId ?? auth.orgId;
      if (!orgId) {
        response.status(409).json({
          error: { code: 'brain_org_required', message: 'Agent must belong to an organization to use AI brain' },
        });
        return;
      }
      const access = await assertStandardAgentCanQueryBrain(id, orgId);
      const result = await queryService.queryBrain({
        userId: auth.userId,
        orgId,
        brainAgentId: access.brainAgentId,
        brainModel: access.brainModel,
        question: parsed.data.question,
        collectionIds: parsed.data.collectionIds,
        auditSurface: 'agent_chat',
        callingAgentId: id,
        contextOnly: false,
        writeAudit: true,
      });
      response.json(result);
    } catch (err: unknown) {
      if (err instanceof BrainQueryForbiddenError) {
        response.status(403).json({ error: { code: err.code, message: err.message } });
        return;
      }
      if (err instanceof BrainNotProvisionedError) {
        response.status(409).json({ error: { code: err.code, message: err.message } });
        return;
      }
      if (err instanceof BrainWrongOrgError) {
        response.status(403).json({ error: { code: err.code, message: err.message } });
        return;
      }
      console.error('agent brain/query', err);
      response.status(500).json({ error: { code: 'brain_query_failed', message: 'Brain query failed' } });
    }
  });

  router.post('/:did/ping', async (request: Request, response: Response) => {
    try {
      const did = String(request.params.did);
      await assertRunnerAuthByDidOrId(did, request);
      const agent = await service.ping(did);
      if (!agent) {
        response.status(404).json({ error: { code: 'not_found', message: 'Agent not found' } });
        return;
      }
      response.json({
        did: agent.did,
        status: agent.status,
        lastConnectedAt: agent.lastConnectedAt,
      });
    } catch (err: unknown) {
      if (err instanceof RunnerUnauthorizedError) {
        response.status(401).json({ error: { code: 'runner_unauthorized', message: err.message } });
        return;
      }
      console.error('ping error', err);
      response.status(500).json({
        error: { code: 'ping_failed', message: 'Failed to record ping' },
      });
    }
  });

  return router;
}
