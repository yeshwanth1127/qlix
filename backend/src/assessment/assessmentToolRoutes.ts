import { Router, type Request, type Response } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { assertRunnerAuth, RunnerUnauthorizedError } from '../agentChat/runnerAuth.js';
import { fetchSandboxFile } from '../sandbox/sandboxClient.js';
import { askReviewQuestion } from './interactiveReview.service.js';
import {
  buildNormalizedAssessmentContext,
  type AssessmentContextBase,
} from './assessmentContext.js';

const MAX_ARTIFACT_TEXT_BYTES = 200_000;

export const ASSESSMENT_EVIDENCE_KINDS = [
  'file_snapshot',
  'git_event',
  'terminal_event',
  'test_result',
  'build_result',
  'lint_result',
  'ai_prompt',
  'artifact_upload',
  'manual_note',
] as const;

const EVIDENCE_KIND_ALIASES: Readonly<Record<string, string>> = {
  artifact: 'artifact_upload',
  artifacts: 'artifact_upload',
  upload: 'artifact_upload',
  uploads: 'artifact_upload',
};

/** Normalize safe model/user aliases and reject unknown filters instead of returning a misleading empty list. */
export function normalizeAssessmentEvidenceKind(value: unknown): string | undefined {
  if (value == null || value === '') return undefined;
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  const aliased = EVIDENCE_KIND_ALIASES[normalized] ?? normalized;
  return (ASSESSMENT_EVIDENCE_KINDS as readonly string[]).includes(aliased)
    ? aliased
    : undefined;
}

type StoredAssessmentFinding = Record<string, unknown>;

/** Replace this agent's prior value for a criterion instead of accumulating duplicates. */
export function mergeAssessmentFindings(
  existing: unknown,
  incoming: StoredAssessmentFinding[],
): unknown[] {
  const incomingByKey = new Map<string, StoredAssessmentFinding>();
  for (const finding of incoming) {
    const key = `${String(finding.evaluator_agent_id ?? '')}\u0000${String(finding.criterion_id ?? '')}`;
    incomingByKey.set(key, finding);
  }
  const deduplicatedIncoming = [...incomingByKey.values()];
  const replacementKeys = new Set(
    incomingByKey.keys(),
  );
  const previous = Array.isArray(existing) ? existing : [];
  const preserved = previous.filter((finding) => {
    if (!finding || typeof finding !== 'object' || Array.isArray(finding)) return true;
    const row = finding as StoredAssessmentFinding;
    return !replacementKeys.has(`${String(row.evaluator_agent_id ?? '')}\u0000${String(row.criterion_id ?? '')}`);
  });
  return [...preserved, ...deduplicatedIncoming];
}

/**
 * Runner-authenticated tool proxy for `assessment.*` scopes, mirroring the shape
 * of the existing `/:agentId/tools/email/*` etc. routes in createAgentChatRouter.ts
 * (same assertRunnerAuth, same runId-derived org/team context — never trust
 * client-supplied orgId), kept in its own file rather than growing that
 * already-large router. Mounted at the same '/api/v1/agents' base path.
 */

class AssessmentToolError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function resolveRunContext(agentId: string, runId: string): Promise<{
  orgId: string;
  teamRunId: string | null;
  teamId: string | null;
  teamRunGoal: string | null;
}> {
  const run = await prisma.agentRun.findUnique({
    where: { id: runId },
    select: {
      agentId: true,
      orgId: true,
      teamRunId: true,
      teamId: true,
      teamRun: { select: { goal: true } },
    },
  });
  if (!run || run.agentId !== agentId) {
    throw new AssessmentToolError('run_not_found', 'Agent run was not found for this agent');
  }
  if (!run.orgId) {
    throw new AssessmentToolError('run_missing_org', 'Agent run has no organization context');
  }
  return {
    orgId: run.orgId,
    teamRunId: run.teamRunId,
    teamId: run.teamId,
    teamRunGoal: run.teamRun?.goal ?? null,
  };
}

const assessmentBaseCache = new Map<string, { expiresAt: number; value: Promise<AssessmentContextBase> }>();

async function loadAssessmentContextBase(orgId: string, sessionId: string): Promise<AssessmentContextBase> {
  const key = `${orgId}:${sessionId}`;
  const cached = assessmentBaseCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const value = (async () => {
    const [session, evidence, snapshots] = await Promise.all([
      prisma.workSession.findFirst({
        where: { id: sessionId, orgId },
        select: {
          id: true,
          teamId: true,
          recipeId: true,
          status: true,
          projectDescription: true,
          expectedStack: true,
          aiUsagePolicy: true,
          checklist: true,
          requiredDeliverables: true,
          startedAt: true,
          submittedAt: true,
          framework: {
            select: { id: true, name: true, version: true, criteria: true, integrityPolicy: true },
          },
        },
      }),
      prisma.evidenceRecord.findMany({ where: { sessionId }, orderBy: { occurredAt: 'asc' } }),
      prisma.projectSnapshot.findMany({ where: { sessionId }, orderBy: { createdAt: 'asc' } }),
    ]);
    if (!session) throw new AssessmentToolError('not_found', 'Work session not found');
    if (!session.framework) throw new AssessmentToolError('not_found', 'Work session has no assigned framework');
    const { framework, ...sessionFields } = session;
    return { session: sessionFields, framework, evidence, snapshots } as AssessmentContextBase;
  })();
  assessmentBaseCache.set(key, { value, expiresAt: Date.now() + 5 * 60_000 });
  try {
    return await value;
  } catch (error) {
    assessmentBaseCache.delete(key);
    throw error;
  }
}

export function clearAssessmentContextBaseCache(): void {
  assessmentBaseCache.clear();
}

function asyncRoute(
  handler: (request: Request, response: Response) => Promise<void>,
): (request: Request, response: Response) => void {
  return (request, response) => {
    void handler(request, response).catch((err) => {
      if (err instanceof RunnerUnauthorizedError) {
        response.status(401).json({ error: { code: 'runner_unauthorized', message: err.message } });
        return;
      }
      if (err instanceof AssessmentToolError) {
        response.status(400).json({ error: { code: err.code, message: err.message } });
        return;
      }
      console.error('[assessmentToolRoutes]', err);
      response.status(500).json({
        error: { code: 'assessment_tool_failed', message: err instanceof Error ? err.message : 'Assessment tool failed' },
      });
    });
  };
}

const sessionGetBody = z.object({
  runId: z.string().trim().min(1),
  sessionId: z.string().trim().min(1),
});

const frameworkReadBody = z.object({
  runId: z.string().trim().min(1),
  sessionId: z.string().trim().min(1),
});

const contextGetBody = z.object({
  runId: z.string().trim().min(1),
  sessionId: z.string().trim().min(1),
});

const evidenceSearchBody = z.object({
  runId: z.string().trim().min(1),
  sessionId: z.string().trim().min(1),
  kind: z.string().trim().min(1).optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

const referenceListBody = z.object({
  runId: z.string().trim().min(1),
  sessionId: z.string().trim().min(1),
  kinds: z.array(z.string().trim().min(1)).max(9).optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

const referenceBatchReadBody = z.object({
  runId: z.string().trim().min(1),
  sessionId: z.string().trim().min(1),
  referenceIds: z.array(z.string().trim().min(1)).min(1).max(25),
  maxCharsPerReference: z.number().int().min(500).max(8_000).optional(),
});

const criterionFindingBody = z.object({
  criterionId: z.string().trim().min(1),
  verdict: z.enum(['met', 'partially_met', 'not_met', 'unclear', 'needs_review']),
  confidence: z.number().min(0).max(1),
  evidenceRefs: z.array(z.string().trim().min(1)).min(1),
  rationale: z.string().trim().min(1).max(4000),
});

const recordBody = z.union([
  z.object({
    runId: z.string().trim().min(1),
    sessionId: z.string().trim().min(1),
    findings: z.array(criterionFindingBody).min(1).max(100),
  }),
  // Accept the legacy single-finding request during rolling runner deployments.
  z.object({
    runId: z.string().trim().min(1),
    sessionId: z.string().trim().min(1),
    criterionId: z.string().trim().min(1),
    evaluatorAgentId: z.string().trim().min(1).optional(),
    verdict: z.enum(['met', 'partially_met', 'not_met', 'unclear', 'needs_review']),
    confidence: z.number().min(0).max(1),
    evidenceRefs: z.array(z.string().trim().min(1)).min(1),
    rationale: z.string().trim().min(1).max(4000),
  }),
]);

export function parseAssessmentRecordBody(payload: unknown) {
  return recordBody.safeParse(payload);
}

const reviewAskBody = z.object({
  runId: z.string().trim().min(1),
  sessionId: z.string().trim().min(1),
  criterionId: z.string().trim().min(1),
  questionId: z.string().trim().min(1),
  questionText: z.string().trim().min(1).max(2000),
});

const evidenceReadBody = z.object({
  runId: z.string().trim().min(1),
  sessionId: z.string().trim().min(1),
  evidenceId: z.string().trim().min(1),
});

const artifactReadBody = z.object({
  runId: z.string().trim().min(1),
  sessionId: z.string().trim().min(1),
  evidenceId: z.string().trim().min(1),
});

const snapshotReadBody = z.object({
  runId: z.string().trim().min(1),
  sessionId: z.string().trim().min(1),
  label: z.string().trim().min(1).optional(),
});

const snapshotCompareBody = z.object({
  runId: z.string().trim().min(1),
  sessionId: z.string().trim().min(1),
  labelA: z.string().trim().min(1),
  labelB: z.string().trim().min(1),
});

const reportCreateBody = z.object({
  runId: z.string().trim().min(1),
  sessionId: z.string().trim().min(1),
  assessmentRecordId: z.string().trim().min(1),
  summary: z.string().trim().min(1).max(20_000),
});

const demonstrationRequestBody = z.object({
  runId: z.string().trim().min(1),
  sessionId: z.string().trim().min(1),
  criterionId: z.string().trim().min(1),
  questionId: z.string().trim().min(1),
  instructions: z.string().trim().min(1).max(2000),
});

function compactJson(value: unknown, maxChars: number): { text: string; truncated: boolean } {
  const text = JSON.stringify(value);
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: `${text.slice(0, Math.max(0, maxChars - 1))}…`, truncated: true };
}

export function createAssessmentToolRoutes(): Router {
  const router = Router();

  router.post('/:agentId/tools/assessment/session-get', asyncRoute(async (request, response) => {
    const agentId = String(request.params.agentId);
    await assertRunnerAuth(agentId, request);
    const parsed = sessionGetBody.safeParse(request.body ?? {});
    if (!parsed.success) return void response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid session-get payload' } });
    const { orgId } = await resolveRunContext(agentId, parsed.data.runId);
    const session = await prisma.workSession.findFirst({
      where: { id: parsed.data.sessionId, orgId },
      select: { id: true, recipeId: true, status: true, startedAt: true, submittedAt: true, metadata: true },
    });
    if (!session) return void response.status(404).json({ error: { code: 'not_found', message: 'Work session not found' } });
    response.json({ session });
  }));

  router.post('/:agentId/tools/assessment/framework-read', asyncRoute(async (request, response) => {
    const agentId = String(request.params.agentId);
    await assertRunnerAuth(agentId, request);
    const parsed = frameworkReadBody.safeParse(request.body ?? {});
    if (!parsed.success) return void response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid framework-read payload' } });
    const { orgId } = await resolveRunContext(agentId, parsed.data.runId);
    const session = await prisma.workSession.findFirst({
      where: { id: parsed.data.sessionId, orgId },
      select: { frameworkId: true },
    });
    if (!session?.frameworkId) return void response.status(404).json({ error: { code: 'not_found', message: 'Work session has no assigned framework' } });
    const framework = await prisma.evaluationFramework.findFirst({
      where: { id: session.frameworkId, orgId },
      select: { id: true, name: true, version: true, criteria: true, integrityPolicy: true, status: true },
    });
    if (!framework) return void response.status(404).json({ error: { code: 'not_found', message: 'Evaluation framework not found' } });
    response.json({ framework });
  }));

  /** Domain adapter over the generic Context Plane: one normalized, role-scoped pack. */
  router.post('/:agentId/tools/assessment/context-get', asyncRoute(async (request, response) => {
    const agentId = String(request.params.agentId);
    await assertRunnerAuth(agentId, request);
    const parsed = contextGetBody.safeParse(request.body ?? {});
    if (!parsed.success) return void response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid context-get payload' } });
    const { orgId, teamId, teamRunId, teamRunGoal } = await resolveRunContext(agentId, parsed.data.runId);
    if (!teamId || !teamRunId || !teamRunGoal?.includes(parsed.data.sessionId)) {
      throw new AssessmentToolError('session_outside_run', 'Work session is not bound to this Team run');
    }
    const member = await prisma.teamMember.findUnique({
      where: { teamId_agentId: { teamId, agentId } },
      select: { role: true },
    });
    if (!member) throw new AssessmentToolError('agent_outside_team', 'Agent is not a member of this Team');
    const [base, record] = await Promise.all([
      loadAssessmentContextBase(orgId, parsed.data.sessionId),
      prisma.assessmentRecord.findFirst({
        where: { sessionId: parsed.data.sessionId },
        orderBy: { createdAt: 'desc' },
        select: { id: true, findings: true, reviewTranscript: true, createdAt: true },
      }),
    ]);
    if (base.session.teamId !== teamId) {
      throw new AssessmentToolError('session_outside_team', 'Work session is not assigned to this Team');
    }
    response.json({ context: buildNormalizedAssessmentContext({ role: member.role, base, record }) });
  }));

  router.post('/:agentId/tools/assessment/evidence-search', asyncRoute(async (request, response) => {
    const agentId = String(request.params.agentId);
    await assertRunnerAuth(agentId, request);
    const parsed = evidenceSearchBody.safeParse(request.body ?? {});
    if (!parsed.success) return void response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid evidence-search payload' } });
    const requestedKind = parsed.data.kind;
    const kind = normalizeAssessmentEvidenceKind(requestedKind);
    if (requestedKind && !kind) {
      return void response.status(400).json({
        error: {
          code: 'invalid_evidence_kind',
          message: `Unknown evidence kind. Expected one of: ${ASSESSMENT_EVIDENCE_KINDS.join(', ')}`,
        },
      });
    }
    const { orgId } = await resolveRunContext(agentId, parsed.data.runId);
    const session = await prisma.workSession.findFirst({ where: { id: parsed.data.sessionId, orgId }, select: { id: true } });
    if (!session) return void response.status(404).json({ error: { code: 'not_found', message: 'Work session not found' } });
    const evidence = await prisma.evidenceRecord.findMany({
      where: { sessionId: session.id, ...(kind ? { kind } : {}) },
      orderBy: { occurredAt: 'asc' },
      take: parsed.data.limit ?? 50,
      select: { id: true, kind: true, source: true, occurredAt: true, payload: true, redacted: true },
    });
    response.json({
      evidence,
      query: {
        sessionId: session.id,
        kind: kind ?? null,
        limit: parsed.data.limit ?? 50,
        count: evidence.length,
      },
    });
  }));

  /** Compact, collection-agnostic index. Payloads are previews only; ids remain opaque. */
  router.post('/:agentId/tools/assessment/reference-list', asyncRoute(async (request, response) => {
    const agentId = String(request.params.agentId);
    await assertRunnerAuth(agentId, request);
    const parsed = referenceListBody.safeParse(request.body ?? {});
    if (!parsed.success) return void response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid reference-list payload' } });
    const requestedKinds = parsed.data.kinds ?? [];
    const kinds = requestedKinds.map(normalizeAssessmentEvidenceKind);
    if (kinds.some((kind) => !kind)) {
      return void response.status(400).json({ error: { code: 'invalid_evidence_kind', message: `Unknown evidence kind. Expected one of: ${ASSESSMENT_EVIDENCE_KINDS.join(', ')}` } });
    }
    const { orgId } = await resolveRunContext(agentId, parsed.data.runId);
    const session = await prisma.workSession.findFirst({ where: { id: parsed.data.sessionId, orgId }, select: { id: true } });
    if (!session) return void response.status(404).json({ error: { code: 'not_found', message: 'Work session not found' } });
    const rows = await prisma.evidenceRecord.findMany({
      where: { sessionId: session.id, ...(kinds.length > 0 ? { kind: { in: kinds as string[] } } : {}) },
      orderBy: { occurredAt: 'asc' },
      take: parsed.data.limit ?? 100,
      select: { id: true, kind: true, source: true, occurredAt: true, payload: true, redacted: true, contentRef: true },
    });
    response.json({
      references: rows.map((row) => {
        const preview = compactJson(row.payload, 500);
        return {
          id: row.id,
          kind: row.kind,
          source: row.source,
          occurredAt: row.occurredAt,
          redacted: row.redacted,
          hasContent: Boolean(row.contentRef),
          preview: preview.text,
          previewTruncated: preview.truncated,
        };
      }),
      count: rows.length,
    });
  }));

  /** Read several chosen references in one bounded response to avoid N model/tool rounds. */
  router.post('/:agentId/tools/assessment/reference-batch-read', asyncRoute(async (request, response) => {
    const agentId = String(request.params.agentId);
    await assertRunnerAuth(agentId, request);
    const parsed = referenceBatchReadBody.safeParse(request.body ?? {});
    if (!parsed.success) return void response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid reference-batch-read payload' } });
    const { orgId } = await resolveRunContext(agentId, parsed.data.runId);
    const session = await prisma.workSession.findFirst({ where: { id: parsed.data.sessionId, orgId }, select: { id: true } });
    if (!session) return void response.status(404).json({ error: { code: 'not_found', message: 'Work session not found' } });
    const ids = [...new Set(parsed.data.referenceIds)];
    const rows = await prisma.evidenceRecord.findMany({ where: { sessionId: session.id, id: { in: ids } } });
    const byId = new Map(rows.map((row) => [row.id, row]));
    const perReference = parsed.data.maxCharsPerReference ?? 6_000;
    let remaining = 40_000;
    const references = ids.flatMap((id) => {
      const row = byId.get(id);
      if (!row || remaining <= 0) return [];
      const budget = Math.min(perReference, remaining);
      const compact = compactJson(row.payload, budget);
      remaining -= compact.text.length;
      return [{
        id: row.id,
        kind: row.kind,
        source: row.source,
        occurredAt: row.occurredAt,
        redacted: row.redacted,
        payload: compact.text,
        truncated: compact.truncated,
        contentRef: row.contentRef ? 'available_via_artifact_read' : null,
      }];
    });
    response.json({ references, missingIds: ids.filter((id) => !byId.has(id)), responseTruncated: remaining <= 0 });
  }));

  router.post('/:agentId/tools/assessment/record', asyncRoute(async (request, response) => {
    const agentId = String(request.params.agentId);
    await assertRunnerAuth(agentId, request);
    const parsed = parseAssessmentRecordBody(request.body ?? {});
    if (!parsed.success) return void response.status(400).json({ error: { code: 'invalid_body', message: 'Every finding must include at least one evidenceRefs id' } });
    const { orgId } = await resolveRunContext(agentId, parsed.data.runId);
    const session = await prisma.workSession.findFirst({ where: { id: parsed.data.sessionId, orgId }, select: { id: true, frameworkId: true } });
    if (!session) return void response.status(404).json({ error: { code: 'not_found', message: 'Work session not found' } });
    if (!session.frameworkId) return void response.status(400).json({ error: { code: 'no_framework', message: 'Work session has no assigned framework' } });
    const requestedFindings = 'findings' in parsed.data
      ? parsed.data.findings
      : [{
          criterionId: parsed.data.criterionId,
          verdict: parsed.data.verdict,
          confidence: parsed.data.confidence,
          evidenceRefs: parsed.data.evidenceRefs,
          rationale: parsed.data.rationale,
        }];
    const evidenceRefs = [...new Set(requestedFindings.flatMap((finding) => finding.evidenceRefs))];
    if (evidenceRefs.length > 0) {
      const evidence = await prisma.evidenceRecord.findMany({
        where: { sessionId: session.id, id: { in: evidenceRefs } },
        select: { id: true },
      });
      const found = new Set(evidence.map((item) => item.id));
      const missing = evidenceRefs.filter((ref) => !found.has(ref));
      if (missing.length > 0) {
        throw new AssessmentToolError(
          'invalid_evidence_refs',
          `Finding cites evidence outside this Work Session: ${missing.join(', ')}`,
        );
      }
    }

    const findings = requestedFindings.map((finding) => ({
      criterion_id: finding.criterionId,
      // The authenticated runner is authoritative; never trust a model-supplied id.
      evaluator_agent_id: agentId,
      verdict: finding.verdict,
      confidence: finding.confidence,
      evidence_refs: [...new Set(finding.evidenceRefs)],
      rationale: finding.rationale,
    }));
    // Parallel examiner stages update one shared record. The transaction-scoped
    // advisory lock prevents lost updates across backend processes without making
    // agents inherit each other's transcripts.
    const record = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`assessment:${session.id}`}))`;
      const existing = await tx.assessmentRecord.findFirst({
        where: { sessionId: session.id },
        orderBy: { createdAt: 'desc' },
      });
      const mergedFindings = mergeAssessmentFindings(existing?.findings, findings);
      return existing
        ? tx.assessmentRecord.update({
            where: { id: existing.id },
            data: { findings: mergedFindings as Prisma.InputJsonValue },
          })
        : tx.assessmentRecord.create({
            data: { sessionId: session.id, frameworkId: session.frameworkId!, findings },
          });
    });
    response.json({
      assessmentRecordId: record.id,
      recorded: findings.length,
      criterionIds: findings.map((finding) => finding.criterion_id),
    });
  }));

  router.post('/:agentId/tools/assessment/review-ask', asyncRoute(async (request, response) => {
    const agentId = String(request.params.agentId);
    await assertRunnerAuth(agentId, request);
    const parsed = reviewAskBody.safeParse(request.body ?? {});
    if (!parsed.success) return void response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid review-ask payload' } });
    const { orgId, teamRunId } = await resolveRunContext(agentId, parsed.data.runId);
    if (!teamRunId) return void response.status(400).json({ error: { code: 'not_a_team_run', message: 'review.ask requires a Team run context' } });
    const { processId, threadId } = await askReviewQuestion({
      orgId,
      sessionId: parsed.data.sessionId,
      teamRunId,
      criterionId: parsed.data.criterionId,
      questionId: parsed.data.questionId,
      questionText: parsed.data.questionText,
    });
    response.json({ processId, threadId });
  }));

  router.post('/:agentId/tools/assessment/review-request-demonstration', asyncRoute(async (request, response) => {
    const agentId = String(request.params.agentId);
    await assertRunnerAuth(agentId, request);
    const parsed = demonstrationRequestBody.safeParse(request.body ?? {});
    if (!parsed.success) return void response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid demonstration-request payload' } });
    const { orgId, teamRunId } = await resolveRunContext(agentId, parsed.data.runId);
    if (!teamRunId) return void response.status(400).json({ error: { code: 'not_a_team_run', message: 'review.request_demonstration requires a Team run context' } });
    // JIT already gated this call before it reached the backend (assessment.review.request_demonstration
    // is forceJit:true — see scopeCatalog.ts). No additional approval code needed here.
    const { processId, threadId } = await askReviewQuestion({
      orgId,
      sessionId: parsed.data.sessionId,
      teamRunId,
      criterionId: parsed.data.criterionId,
      questionId: parsed.data.questionId,
      questionText: parsed.data.instructions,
      kind: 'demonstration',
    });
    response.json({ processId, threadId });
  }));

  router.post('/:agentId/tools/assessment/evidence-read', asyncRoute(async (request, response) => {
    const agentId = String(request.params.agentId);
    await assertRunnerAuth(agentId, request);
    const parsed = evidenceReadBody.safeParse(request.body ?? {});
    if (!parsed.success) return void response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid evidence-read payload' } });
    const { orgId } = await resolveRunContext(agentId, parsed.data.runId);
    const session = await prisma.workSession.findFirst({ where: { id: parsed.data.sessionId, orgId }, select: { id: true } });
    if (!session) return void response.status(404).json({ error: { code: 'not_found', message: 'Work session not found' } });
    const evidence = await prisma.evidenceRecord.findFirst({ where: { id: parsed.data.evidenceId, sessionId: session.id } });
    if (!evidence) return void response.status(404).json({ error: { code: 'not_found', message: 'Evidence record not found' } });
    response.json({ evidence });
  }));

  router.post('/:agentId/tools/assessment/artifact-read', asyncRoute(async (request, response) => {
    const agentId = String(request.params.agentId);
    await assertRunnerAuth(agentId, request);
    const parsed = artifactReadBody.safeParse(request.body ?? {});
    if (!parsed.success) return void response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid artifact-read payload' } });
    const { orgId } = await resolveRunContext(agentId, parsed.data.runId);
    const session = await prisma.workSession.findFirst({ where: { id: parsed.data.sessionId, orgId }, select: { id: true } });
    if (!session) return void response.status(404).json({ error: { code: 'not_found', message: 'Work session not found' } });
    const evidence = await prisma.evidenceRecord.findFirst({ where: { id: parsed.data.evidenceId, sessionId: session.id } });
    if (!evidence) return void response.status(404).json({ error: { code: 'not_found', message: 'Evidence record not found' } });
    if (!evidence.contentRef) {
      response.json({ evidenceId: evidence.id, inline: true, payload: evidence.payload });
      return;
    }
    const file = await fetchSandboxFile(evidence.contentRef);
    if (!file) return void response.status(404).json({ error: { code: 'not_found', message: 'Artifact content is no longer available' } });
    const isTextLike = /^text\/|json|xml/.test(file.contentType);
    if (!isTextLike) {
      response.json({ evidenceId: evidence.id, inline: false, fileName: file.fileName, contentType: file.contentType, sizeBytes: file.body.length });
      return;
    }
    const truncated = file.body.length > MAX_ARTIFACT_TEXT_BYTES;
    const text = file.body.subarray(0, MAX_ARTIFACT_TEXT_BYTES).toString('utf-8');
    response.json({ evidenceId: evidence.id, inline: true, fileName: file.fileName, contentType: file.contentType, text, truncated });
  }));

  router.post('/:agentId/tools/assessment/snapshot-read', asyncRoute(async (request, response) => {
    const agentId = String(request.params.agentId);
    await assertRunnerAuth(agentId, request);
    const parsed = snapshotReadBody.safeParse(request.body ?? {});
    if (!parsed.success) return void response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid snapshot-read payload' } });
    const { orgId } = await resolveRunContext(agentId, parsed.data.runId);
    const session = await prisma.workSession.findFirst({ where: { id: parsed.data.sessionId, orgId }, select: { id: true } });
    if (!session) return void response.status(404).json({ error: { code: 'not_found', message: 'Work session not found' } });
    const snapshot = await prisma.projectSnapshot.findFirst({
      where: { sessionId: session.id, ...(parsed.data.label ? { label: parsed.data.label } : {}) },
      orderBy: { createdAt: 'desc' },
    });
    if (!snapshot) return void response.status(404).json({ error: { code: 'not_found', message: 'Project snapshot not found' } });
    response.json({ snapshot });
  }));

  router.post('/:agentId/tools/assessment/snapshot-compare', asyncRoute(async (request, response) => {
    const agentId = String(request.params.agentId);
    await assertRunnerAuth(agentId, request);
    const parsed = snapshotCompareBody.safeParse(request.body ?? {});
    if (!parsed.success) return void response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid snapshot-compare payload' } });
    const { orgId } = await resolveRunContext(agentId, parsed.data.runId);
    const session = await prisma.workSession.findFirst({ where: { id: parsed.data.sessionId, orgId }, select: { id: true } });
    if (!session) return void response.status(404).json({ error: { code: 'not_found', message: 'Work session not found' } });
    const [snapshotA, snapshotB] = await Promise.all([
      prisma.projectSnapshot.findFirst({ where: { sessionId: session.id, label: parsed.data.labelA }, orderBy: { createdAt: 'desc' } }),
      prisma.projectSnapshot.findFirst({ where: { sessionId: session.id, label: parsed.data.labelB }, orderBy: { createdAt: 'desc' } }),
    ]);
    if (!snapshotA || !snapshotB) return void response.status(404).json({ error: { code: 'not_found', message: 'One or both snapshots were not found' } });
    type FileHash = { path: string; sha256: string; sizeBytes?: number };
    const hashesA = (Array.isArray(snapshotA.fileHashes) ? snapshotA.fileHashes : []) as unknown as FileHash[];
    const hashesB = (Array.isArray(snapshotB.fileHashes) ? snapshotB.fileHashes : []) as unknown as FileHash[];
    const byPathA = new Map(hashesA.map((f) => [f.path, f.sha256]));
    const byPathB = new Map(hashesB.map((f) => [f.path, f.sha256]));
    const added = [...byPathB.keys()].filter((path) => !byPathA.has(path));
    const removed = [...byPathA.keys()].filter((path) => !byPathB.has(path));
    const changed = [...byPathB.keys()].filter((path) => byPathA.has(path) && byPathA.get(path) !== byPathB.get(path));
    response.json({
      labelA: parsed.data.labelA,
      labelB: parsed.data.labelB,
      added,
      removed,
      changed,
      unchangedCount: byPathB.size - added.length - changed.length,
    });
  }));

  router.post('/:agentId/tools/assessment/report-create', asyncRoute(async (request, response) => {
    const agentId = String(request.params.agentId);
    await assertRunnerAuth(agentId, request);
    const parsed = reportCreateBody.safeParse(request.body ?? {});
    if (!parsed.success) return void response.status(400).json({ error: { code: 'invalid_body', message: 'Invalid report-create payload' } });
    const { orgId } = await resolveRunContext(agentId, parsed.data.runId);
    const record = await prisma.assessmentRecord.findFirst({
      where: { id: parsed.data.assessmentRecordId, sessionId: parsed.data.sessionId },
      include: { session: { select: { orgId: true } } },
    });
    if (!record || record.session.orgId !== orgId) {
      return void response.status(404).json({ error: { code: 'not_found', message: 'Assessment record not found' } });
    }
    // JIT already gated this call before it reached the backend (assessment.report.create is
    // forceJit:true — see scopeCatalog.ts). This creates a DRAFT report; a human reviewer still
    // has to confirm or override it via the dashboard before it's final (see assessment.routes.ts).
    const report = await prisma.assessmentReport.upsert({
      where: { assessmentRecordId: record.id },
      update: { summary: parsed.data.summary },
      create: { assessmentRecordId: record.id, summary: parsed.data.summary },
    });
    response.json({ reportId: report.id, humanDecision: report.humanDecision });
  }));

  return router;
}
