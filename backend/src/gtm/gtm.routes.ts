import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { roleCan } from '../lib/orgPermissions.js';
import { authenticateUser } from '../middleware/authenticateUser.js';
import { requireSubscriptionAccess } from '../middleware/requireSubscriptionAccess.js';
import { requireOrganizationPlugin } from '../plugins/requireOrganizationPlugin.js';
import { BrainAgentService } from '../aiBrain/brainAgent.service.js';
import { BrainAgentLoopService } from '../aiBrain/brainAgentLoop.service.js';
import { GTM_DISCOVERY_BRAIN_TOOL_DEFINITIONS, GTM_SETUP_BRAIN_TOOL_DEFINITIONS } from '../aiBrain/brainTools.js';
import {
  bootstrapGtmKnowledge,
  buildGtmSetupRetrievalFilter,
  GtmKnowledgeForbiddenError,
  GTM_SETUP_EXA_PROMPT_APPEND,
  listGtmKnowledgeBindings,
} from './gtmKnowledge.service.js';
import {
  applyGtmSetupPatch,
  fieldsFromSetupPatch,
  GTM_PLUGIN_ID,
  GtmSetupValidationError,
  gtmSetupToJson,
  normalizeGtmSetup,
} from './gtmSetup.js';
import { appendBrainActionLog } from '../aiBrain/brainAudit.service.js';
import {
  confirmGtmSetupProposal,
  createGtmSetupProposal,
  getGtmSetupProposal,
  GtmSetupProposalError,
  listPendingGtmSetupProposals,
  rejectGtmSetupProposal,
} from './gtmSetupProposal.service.js';
import {
  addHypothesisEvidence,
  createDiscoveryProposal,
  getDiscoveryFoundation,
  GtmDiscoveryError,
  ideaPayloadSchema,
  listHypothesisEvidence,
  reviewHypothesis,
  resolveDiscoveryProposal,
} from './discoveryFoundation.service.js';
import {
  GtmDiscoveryPlanError,
  regenerateDiscoveryPlan,
  startDiscoveryPlanPipeline,
} from './gtmDiscoveryPlan.service.js';
import {
  getGtmDiscoveryWorkspace,
  GtmWorkspaceError,
  patchGtmDiscoveryWorkspace,
  requestQlixCrm,
} from './gtmWorkspace.service.js';

function asyncRoute(
  handler: (request: Request, response: Response) => Promise<void>,
): (request: Request, response: Response, next: NextFunction) => void {
  return (request, response, next) => void handler(request, response).catch(next);
}

async function loadPlugin(orgId: string) {
  return prisma.orgPlugin.findUniqueOrThrow({
    where: { orgId_pluginId: { orgId, pluginId: GTM_PLUGIN_ID } },
    select: { config: true, lifecycleState: true, enabledAt: true },
  });
}

const querySchema = z.object({
  question: z.string().trim().min(1).max(4000),
});

const proposalPatchSchema = z.object({
  rationale: z.string().trim().min(1).max(2000),
  companyDescription: z.string().max(8000).optional(),
  idealCustomerProfile: z.string().max(8000).optional(),
  primaryOffer: z.string().max(8000).optional(),
  targetRegions: z.array(z.string().trim().min(1).max(240)).max(50).optional(),
  buyerRolesAndWorkflows: z.string().max(8000).optional(),
  proofAndCaseStudies: z.string().max(8000).optional(),
  validityPolicy: z.string().max(8000).optional(),
  calibrationNotes: z.string().max(8000).optional(),
  completedSteps: z.array(z.string()).max(20).optional(),
  source: z.enum(['exa', 'operator']).optional(),
});

export function createGtmRouter(): Router {
  const router = Router();
  const brainAgents = new BrainAgentService();
  const agentLoop = new BrainAgentLoopService();
  router.use(authenticateUser(true), requireSubscriptionAccess, requireOrganizationPlugin(GTM_PLUGIN_ID));

  router.get('/status', asyncRoute(async (request, response) => {
    const plugin = await loadPlugin(request.auth!.orgId);
    const setup = normalizeGtmSetup(plugin.config);
    const [brain, knowledge] = await Promise.all([
      brainAgents.normalizeOrgBrain(request.auth!.orgId),
      listGtmKnowledgeBindings(request.auth!.orgId),
    ]);
    response.json({
      plugin: {
        id: GTM_PLUGIN_ID,
        lifecycleState: plugin.lifecycleState,
        enabledAt: plugin.enabledAt.toISOString(),
      },
      operatingMode: setup.operatingMode,
      setupStatus: setup.setupStatus,
      brainReady: Boolean(brain),
      knowledgeCollectionCount: knowledge.length,
      pendingProposalCount: await prisma.gtmSetupProposal.count({
        where: { orgId: request.auth!.orgId, status: 'pending' },
      }),
      externalWritesEnabled: false,
    });
  }));

  router.get('/knowledge', asyncRoute(async (request, response) => {
    const [brain, collections] = await Promise.all([
      brainAgents.normalizeOrgBrain(request.auth!.orgId),
      listGtmKnowledgeBindings(request.auth!.orgId),
    ]);
    response.json({ brainReady: Boolean(brain), collections });
  }));

  router.post('/knowledge/bootstrap', asyncRoute(async (request, response) => {
    const brain = await brainAgents.normalizeOrgBrain(request.auth!.orgId);
    if (!brain) {
      response.status(409).json({
        error: {
          code: 'brain_required',
          message: 'Create the organization AI Brain before initializing GTM knowledge.',
        },
      });
      return;
    }
    try {
      const collections = await bootstrapGtmKnowledge({
        orgId: request.auth!.orgId,
        userId: request.auth!.userId,
        role: request.auth!.role,
        brainAgentId: brain.id,
      });
      const plugin = await loadPlugin(request.auth!.orgId);
      const setup = applyGtmSetupPatch(plugin.config, {
        knowledgeCollectionIds: collections.map((collection) => collection.collectionId),
      });
      await prisma.orgPlugin.update({
        where: { orgId_pluginId: { orgId: request.auth!.orgId, pluginId: GTM_PLUGIN_ID } },
        data: { config: gtmSetupToJson(setup) },
      });
      response.json({ brainReady: true, collections, setup });
    } catch (error) {
      if (error instanceof GtmKnowledgeForbiddenError) {
        response.status(403).json({ error: { code: error.code, message: error.message } });
        return;
      }
      throw error;
    }
  }));

  router.get('/setup', asyncRoute(async (request, response) => {
    const plugin = await loadPlugin(request.auth!.orgId);
    response.json({ setup: normalizeGtmSetup(plugin.config) });
  }));

  router.get('/discovery/foundation', asyncRoute(async (request, response) => {
    response.json(await getDiscoveryFoundation(request.auth!.orgId));
  }));

  router.get('/discovery/plan', asyncRoute(async (request, response) => {
    response.json(await getGtmDiscoveryWorkspace(request.auth!.orgId));
  }));

  router.get('/discovery/workspace', asyncRoute(async (request, response) => {
    response.json(await getGtmDiscoveryWorkspace(request.auth!.orgId));
  }));

  router.patch('/discovery/workspace', asyncRoute(async (request, response) => {
    if (!roleCan(request.auth!.role, 'manage_brain')) {
      response.status(403).json({ error: { code: 'forbidden', message: 'Only organization owners and admins can update the GTM workspace.' } });
      return;
    }
    const brain = await brainAgents.normalizeOrgBrain(request.auth!.orgId);
    try {
      response.json(await patchGtmDiscoveryWorkspace({
        orgId: request.auth!.orgId,
        userId: request.auth!.userId,
        role: request.auth!.role,
        brainAgentId: brain?.id,
        body: request.body ?? {},
      }));
    } catch (error) {
      if (error instanceof GtmWorkspaceError) {
        const status = error.code === 'forbidden' ? 403 : error.code === 'not_found' ? 404 : 400;
        response.status(status).json({ error: { code: error.code, message: error.message } });
        return;
      }
      throw error;
    }
  }));

  router.post('/discovery/crm/request-qlix', asyncRoute(async (request, response) => {
    const brain = await brainAgents.normalizeOrgBrain(request.auth!.orgId);
    if (!brain) {
      response.status(409).json({ error: { code: 'brain_required', message: 'Create Exa before requesting Qlix CRM.' } });
      return;
    }
    try {
      response.json(await requestQlixCrm({
        orgId: request.auth!.orgId,
        userId: request.auth!.userId,
        role: request.auth!.role,
        brainAgentId: brain.id,
      }));
    } catch (error) {
      if (error instanceof GtmWorkspaceError) {
        response.status(error.code === 'forbidden' ? 403 : 400).json({ error: { code: error.code, message: error.message } });
        return;
      }
      throw error;
    }
  }));

  router.post('/discovery/plan/regenerate', asyncRoute(async (request, response) => {
    const brain = await brainAgents.normalizeOrgBrain(request.auth!.orgId);
    if (!brain) {
      response.status(409).json({ error: { code: 'brain_required', message: 'Create Exa before regenerating your discovery plan.' } });
      return;
    }
    try {
      const plan = await regenerateDiscoveryPlan({
        orgId: request.auth!.orgId,
        userId: request.auth!.userId,
        role: request.auth!.role,
        brainAgentId: brain.id,
        brainModel: brain.model,
      });
      response.status(201).json({ plan });
    } catch (error) {
      if (error instanceof GtmDiscoveryPlanError) {
        const status = error.code === 'forbidden' ? 403 : error.code === 'not_found' ? 404 : 400;
        response.status(status).json({ error: { code: error.code, message: error.message } });
        return;
      }
      throw error;
    }
  }));

  router.post('/discovery/proposals', asyncRoute(async (request, response) => {
    const brain = await brainAgents.normalizeOrgBrain(request.auth!.orgId);
    if (!brain) {
      response.status(409).json({ error: { code: 'brain_required', message: 'Create Exa before starting guided discovery.' } });
      return;
    }
    try {
      const proposal = await createDiscoveryProposal({
        orgId: request.auth!.orgId, userId: request.auth!.userId, role: request.auth!.role,
        brainAgentId: brain.id, body: request.body ?? {}, source: 'operator',
      });
      response.status(201).json({ proposal });
    } catch (error) {
      if (error instanceof GtmDiscoveryError) {
        const status = error.code === 'forbidden' ? 403 : error.code === 'not_found' ? 404 : 400;
        response.status(status).json({ error: { code: error.code, message: error.message } });
        return;
      }
      throw error;
    }
  }));

  router.post('/discovery/proposals/:proposalId/:decision', asyncRoute(async (request, response) => {
    const decision = String(request.params.decision);
    if (decision !== 'confirm' && decision !== 'reject') {
      response.status(404).json({ error: { code: 'not_found', message: 'Unknown proposal action.' } });
      return;
    }
    const brain = await brainAgents.normalizeOrgBrain(request.auth!.orgId);
    if (!brain) {
      response.status(409).json({ error: { code: 'brain_required', message: 'Create Exa before reviewing discovery changes.' } });
      return;
    }
    try {
      const result = await resolveDiscoveryProposal({
        orgId: request.auth!.orgId, userId: request.auth!.userId, role: request.auth!.role,
        brainAgentId: brain.id, proposalId: String(request.params.proposalId), decision,
      });
      let plan = null;
      if (decision === 'confirm' && result.ideaConfirmed && result.foundation.idea) {
        const parsedIdea = ideaPayloadSchema.safeParse(result.foundation.idea.content);
        if (parsedIdea.success) {
          plan = await startDiscoveryPlanPipeline({
            orgId: request.auth!.orgId,
            userId: request.auth!.userId,
            role: request.auth!.role,
            brainAgentId: brain.id,
            brainModel: brain.model,
            ideaVersion: result.foundation.idea.version,
            content: parsedIdea.data,
          });
        }
      }
      response.json({ ...result, plan });
    } catch (error) {
      if (error instanceof GtmDiscoveryError) {
        const status = error.code === 'forbidden' ? 403 : error.code === 'not_found' ? 404 : 400;
        response.status(status).json({ error: { code: error.code, message: error.message } });
        return;
      }
      throw error;
    }
  }));

  router.get('/discovery/hypotheses/:hypothesisId/evidence', asyncRoute(async (request, response) => {
    try {
      response.json({ evidence: await listHypothesisEvidence(request.auth!.orgId, String(request.params.hypothesisId)) });
    } catch (error) {
      if (error instanceof GtmDiscoveryError && error.code === 'not_found') {
        response.status(404).json({ error: { code: error.code, message: error.message } });
        return;
      }
      throw error;
    }
  }));

  router.post('/discovery/hypotheses/:hypothesisId/evidence', asyncRoute(async (request, response) => {
    const brain = await brainAgents.normalizeOrgBrain(request.auth!.orgId);
    if (!brain) { response.status(409).json({ error: { code: 'brain_required', message: 'Create Exa before recording discovery learning.' } }); return; }
    try {
      const evidence = await addHypothesisEvidence({
        orgId: request.auth!.orgId, userId: request.auth!.userId, role: request.auth!.role,
        brainAgentId: brain.id, hypothesisId: String(request.params.hypothesisId), body: request.body ?? {},
      });
      response.status(201).json({ evidence, foundation: await getDiscoveryFoundation(request.auth!.orgId) });
    } catch (error) {
      if (error instanceof GtmDiscoveryError) {
        response.status(error.code === 'forbidden' ? 403 : error.code === 'not_found' ? 404 : 400).json({ error: { code: error.code, message: error.message } });
        return;
      }
      throw error;
    }
  }));

  router.post('/discovery/hypotheses/:hypothesisId/review', asyncRoute(async (request, response) => {
    const brain = await brainAgents.normalizeOrgBrain(request.auth!.orgId);
    if (!brain) { response.status(409).json({ error: { code: 'brain_required', message: 'Create Exa before reviewing discovery conclusions.' } }); return; }
    try {
      await reviewHypothesis({
        orgId: request.auth!.orgId, userId: request.auth!.userId, role: request.auth!.role,
        brainAgentId: brain.id, hypothesisId: String(request.params.hypothesisId), body: request.body ?? {},
      });
      response.json({ foundation: await getDiscoveryFoundation(request.auth!.orgId) });
    } catch (error) {
      if (error instanceof GtmDiscoveryError) {
        response.status(error.code === 'forbidden' ? 403 : error.code === 'not_found' ? 404 : 400).json({ error: { code: error.code, message: error.message } });
        return;
      }
      throw error;
    }
  }));

  router.patch('/setup', asyncRoute(async (request, response) => {
    if (!roleCan(request.auth!.role, 'manage_brain')) {
      response.status(403).json({
        error: { code: 'forbidden', message: 'Only organization owners and admins can configure GTM.' },
      });
      return;
    }
    const plugin = await loadPlugin(request.auth!.orgId);
    const before = normalizeGtmSetup(plugin.config);
    try {
      const setup = applyGtmSetupPatch(plugin.config, request.body ?? {});
      await prisma.orgPlugin.update({
        where: { orgId_pluginId: { orgId: request.auth!.orgId, pluginId: GTM_PLUGIN_ID } },
        data: { config: gtmSetupToJson(setup) },
      });
      const brain = await brainAgents.normalizeOrgBrain(request.auth!.orgId);
      if (brain) {
        const changedFields = fieldsFromSetupPatch(request.body ?? {});
        await appendBrainActionLog({
          brainAgentId: brain.id,
          userId: request.auth!.userId,
          actionType: 'gtm.setup_draft_save',
          payload: {
            description: `Saved GTM setup drafts (${changedFields.join(', ') || 'no field changes'})`,
            fields: changedFields,
            setupStatus: setup.setupStatus,
            previousSetupStatus: before.setupStatus,
          },
          status: 'success',
          riskLevel: 'low',
        });
      }
      response.json({ setup });
    } catch (error) {
      if (error instanceof GtmSetupValidationError) {
        response.status(400).json({ error: { code: error.code, message: error.message } });
        return;
      }
      throw error;
    }
  }));

  router.get('/setup/proposals', asyncRoute(async (request, response) => {
    const proposals = await listPendingGtmSetupProposals(request.auth!.orgId);
    response.json({ proposals });
  }));

  router.get('/setup/proposals/:proposalId', asyncRoute(async (request, response) => {
    try {
      const proposal = await getGtmSetupProposal(
        request.auth!.orgId,
        String(request.params.proposalId),
      );
      response.json({ proposal });
    } catch (error) {
      if (error instanceof GtmSetupProposalError && error.code === 'not_found') {
        response.status(404).json({ error: { code: error.code, message: error.message } });
        return;
      }
      throw error;
    }
  }));

  router.post('/setup/proposals', asyncRoute(async (request, response) => {
    const brain = await brainAgents.normalizeOrgBrain(request.auth!.orgId);
    if (!brain) {
      response.status(409).json({ error: { code: 'brain_required', message: 'Provision the org AI Brain first.' } });
      return;
    }
    const parsed = proposalPatchSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid proposal payload.' } });
      return;
    }
    try {
      const proposal = await createGtmSetupProposal({
        orgId: request.auth!.orgId,
        userId: request.auth!.userId,
        role: request.auth!.role,
        brainAgentId: brain.id,
        rationale: parsed.data.rationale,
        source: parsed.data.source ?? 'operator',
        patch: {
          companyDescription: parsed.data.companyDescription,
          idealCustomerProfile: parsed.data.idealCustomerProfile,
          primaryOffer: parsed.data.primaryOffer,
          targetRegions: parsed.data.targetRegions,
          buyerRolesAndWorkflows: parsed.data.buyerRolesAndWorkflows,
          proofAndCaseStudies: parsed.data.proofAndCaseStudies,
          validityPolicy: parsed.data.validityPolicy,
          calibrationNotes: parsed.data.calibrationNotes,
          completedSteps: parsed.data.completedSteps,
        },
      });
      response.status(201).json({ proposal });
    } catch (error) {
      if (error instanceof GtmSetupProposalError) {
        const status = error.code === 'forbidden' ? 403 : 400;
        response.status(status).json({ error: { code: error.code, message: error.message } });
        return;
      }
      throw error;
    }
  }));

  router.post('/setup/proposals/:proposalId/confirm', asyncRoute(async (request, response) => {
    const brain = await brainAgents.normalizeOrgBrain(request.auth!.orgId);
    if (!brain) {
      response.status(409).json({ error: { code: 'brain_required', message: 'Provision the org AI Brain first.' } });
      return;
    }
    try {
      const result = await confirmGtmSetupProposal({
        orgId: request.auth!.orgId,
        userId: request.auth!.userId,
        role: request.auth!.role,
        brainAgentId: brain.id,
        proposalId: String(request.params.proposalId),
      });
      response.json(result);
    } catch (error) {
      if (error instanceof GtmSetupProposalError) {
        const status = error.code === 'not_found' ? 404 : error.code === 'forbidden' ? 403 : 400;
        response.status(status).json({ error: { code: error.code, message: error.message } });
        return;
      }
      throw error;
    }
  }));

  router.post('/setup/proposals/:proposalId/reject', asyncRoute(async (request, response) => {
    const brain = await brainAgents.normalizeOrgBrain(request.auth!.orgId);
    if (!brain) {
      response.status(409).json({ error: { code: 'brain_required', message: 'Provision the org AI Brain first.' } });
      return;
    }
    try {
      const result = await rejectGtmSetupProposal({
        orgId: request.auth!.orgId,
        userId: request.auth!.userId,
        role: request.auth!.role,
        brainAgentId: brain.id,
        proposalId: String(request.params.proposalId),
      });
      response.json(result);
    } catch (error) {
      if (error instanceof GtmSetupProposalError) {
        const status = error.code === 'not_found' ? 404 : error.code === 'forbidden' ? 403 : 400;
        response.status(status).json({ error: { code: error.code, message: error.message } });
        return;
      }
      throw error;
    }
  }));

  router.post('/query', asyncRoute(async (request, response) => {
    const orgId = request.auth!.orgId;
    const userId = request.auth!.userId;
    const brain = await brainAgents.normalizeOrgBrain(orgId);
    if (!brain) {
      response.status(409).json({ error: { code: 'brain_required', message: 'Provision the org AI Brain first.' } });
      return;
    }

    const parsed = querySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      response.status(400).json({ error: { code: 'invalid_body', message: 'question is required (1-4000 chars)' } });
      return;
    }

    const retrievalFilter = await buildGtmSetupRetrievalFilter(orgId);
    let gtmSetupProposalId: string | null = null;
    let gtmDiscoveryProposalId: string | null = null;

    const result = await agentLoop.run({
      userId,
      orgId,
      brainAgentId: brain.id,
      brainModel: brain.model,
      question: parsed.data.question,
      retrievalFilter,
      systemPromptAppend: GTM_SETUP_EXA_PROMPT_APPEND,
      extraTools: [...GTM_SETUP_BRAIN_TOOL_DEFINITIONS, ...GTM_DISCOVERY_BRAIN_TOOL_DEFINITIONS],
      auditActionType: 'brain.gtm_query',
      toolContext: {
        proposeGtmSetup: async ({ patch, rationale }) => {
          const created = await createGtmSetupProposal({
            orgId,
            userId,
            role: request.auth!.role,
            brainAgentId: brain.id,
            patch,
            rationale,
            source: 'exa',
          });
          gtmSetupProposalId = created.id;
          return { proposalId: created.id };
        },
        proposeGtmDiscovery: async ({ kind, payload, rationale }) => {
          const created = await createDiscoveryProposal({
            orgId, userId, role: request.auth!.role, brainAgentId: brain.id,
            body: { kind, payload, rationale }, source: 'exa',
          });
          gtmDiscoveryProposalId = created.id;
          return { proposalId: created.id };
        },
      },
    });

    let setupProposal = null;
    if (gtmSetupProposalId) {
      setupProposal = await getGtmSetupProposal(orgId, gtmSetupProposalId);
    }
    const discoveryProposal = gtmDiscoveryProposalId
      ? (await getDiscoveryFoundation(orgId)).proposals.find((proposal) => proposal.id === gtmDiscoveryProposalId) ?? null
      : null;

    response.json({
      answer: result.answer,
      citations: result.citations,
      setupProposal,
      discoveryProposal,
      agentProposal: result.proposal,
    });
  }));

  return router;
}
