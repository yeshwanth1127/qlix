import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { getPlanConfig } from '../billings/lib/subscriptionPlans.js';
import { parseAgentCreationPrompt } from '../agents/nlParse.js';
import {
  applyRedesignIntent,
  enforceDiscoveryBoundary,
  runBuilderDiscovery,
} from './discovery.service.js';
import { normalizeDiscoveryOutcome } from './discoveryNormalize.js';
import {
  requirementsToPlanningBrief,
  buildScopeIntentText,
  topicSummariesFromFacts,
  type ContextMessage,
} from './contextCompiler.js';
import { emitBuilderAnalytics } from './builderAnalytics.js';
import {
  acquireBuilderSessionLock,
  BuilderSessionBusyError,
} from './builderLock.js';
import type {
  BuilderReadinessState,
  BuilderRequirementsState,
  DiscoveryOutcome,
  RequirementFactView,
} from './discovery.types.js';
import type { AgentCreationPlan } from '../agents/nlTypes.js';

export { BuilderSessionBusyError };

const EMPTY_REQUIREMENTS: BuilderRequirementsState = {
  facts: [],
  unresolved: [],
  assumptions: [],
};
const EMPTY_READINESS: BuilderReadinessState = {
  score: 0,
  canPlan: false,
  blocking: [],
};
const RECENT_MESSAGE_LIMIT = 12;
const MAX_LEGACY_TRANSCRIPT_ITEMS = 500;

export class BuilderSessionConflictError extends Error {
  constructor() {
    super('This conversation changed in another tab. Please send your message again.');
    this.name = 'BuilderSessionConflictError';
  }
}

export class BuilderSessionNotFoundError extends Error {
  constructor() {
    super('Builder conversation not found');
    this.name = 'BuilderSessionNotFoundError';
  }
}

function jsonValue<T>(value: unknown, fallback: T): T {
  return value && typeof value === 'object' ? value as T : fallback;
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function legacyTranscript(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object');
}

async function allowedTiers(orgId: string): Promise<string[]> {
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { plan: true } });
  return getPlanConfig(org?.plan ?? 'free').allowedModelTiers;
}

function activeFactsFromRows(rows: Array<{
  key: string;
  category: string;
  value: Prisma.JsonValue;
  confidence: number;
  sourceMessageId: string;
}>): RequirementFactView[] {
  return rows.map((row) => ({
    key: row.key,
    category: row.category as RequirementFactView['category'],
    value: row.value,
    confidence: row.confidence,
    sourceMessageId: row.sourceMessageId,
  }));
}

function applyOutcomeToFacts(
  current: RequirementFactView[],
  outcome: DiscoveryOutcome,
  sourceMessageId: string,
): RequirementFactView[] {
  const byKey = new Map(current.map((fact) => [fact.key, fact]));
  for (const operation of outcome.operations) {
    if (operation.type === 'remove') {
      byKey.delete(operation.key);
      continue;
    }
    byKey.set(operation.key, {
      key: operation.key,
      category: operation.category,
      value: operation.value ?? null,
      confidence: operation.confidence,
      sourceMessageId,
    });
  }
  return [...byKey.values()].sort(
    (a, b) => a.category.localeCompare(b.category) || a.key.localeCompare(b.key),
  );
}

async function reserveTurn(input: {
  sessionId: string;
  userId: string;
  orgId: string;
  content: string;
}) {
  return prisma.$transaction(async (tx) => {
    const session = await tx.nlBuilderSession.findFirst({
      where: { id: input.sessionId, userId: input.userId, orgId: input.orgId },
    });
    if (!session) throw new BuilderSessionNotFoundError();

    // Reserve both the user and assistant sequence numbers. This prevents a
    // second tab from taking the assistant's slot while inference is running.
    const userSequence = session.latestMessageSequence + 1;
    const assistantSequence = userSequence + 1;
    const claimed = await tx.nlBuilderSession.updateMany({
      where: { id: session.id, latestMessageSequence: session.latestMessageSequence },
      data: { latestMessageSequence: assistantSequence },
    });
    if (claimed.count !== 1) throw new BuilderSessionConflictError();

    const message = await tx.nlBuilderMessage.create({
      data: {
        sessionId: session.id,
        sequence: userSequence,
        role: 'user',
        content: input.content,
        status: 'completed',
        completedAt: new Date(),
      },
    });

    return { session, message, userSequence, assistantSequence };
  });
}

async function persistDiscovery(input: {
  session: Awaited<ReturnType<typeof reserveTurn>>['session'];
  userMessageId: string;
  userContent: string;
  assistantSequence: number;
  currentFacts: RequirementFactView[];
  outcome: DiscoveryOutcome;
}) {
  const nextVersion = input.session.stateVersion + 1;
  const nextFacts = applyOutcomeToFacts(input.currentFacts, input.outcome, input.userMessageId);
  const requirements: BuilderRequirementsState = {
    facts: nextFacts,
    unresolved: input.outcome.unresolved,
    assumptions: input.outcome.assumptions,
  };
  const phase = input.outcome.action === 'continue' ? 'discovering' : 'ready';
  const oldTranscript = legacyTranscript(input.session.transcript);
  const transcript = [
    ...oldTranscript,
    { id: input.assistantSequence - 1, kind: 'user', text: input.userContent },
    { id: input.assistantSequence, kind: 'info', text: input.outcome.reply },
  ].slice(-MAX_LEGACY_TRANSCRIPT_ITEMS);

  await prisma.$transaction(async (tx) => {
    for (const operation of input.outcome.operations) {
      const previous = await tx.nlBuilderRequirementFact.findFirst({
        where: { sessionId: input.session.id, key: operation.key, status: 'active' },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      if (previous) {
        await tx.nlBuilderRequirementFact.updateMany({
          where: { sessionId: input.session.id, key: operation.key, status: 'active' },
          data: { status: operation.type === 'remove' ? 'rejected' : 'superseded' },
        });
      }
      if (operation.type === 'set') {
        await tx.nlBuilderRequirementFact.create({
          data: {
            sessionId: input.session.id,
            key: operation.key,
            category: operation.category,
            value: toJson(operation.value ?? null),
            confidence: operation.confidence,
            sourceMessageId: input.userMessageId,
            supersedesFactId: previous?.id,
          },
        });
      }
      await tx.nlBuilderStateEvent.create({
        data: {
          sessionId: input.session.id,
          messageId: input.userMessageId,
          eventType: operation.type === 'set'
            ? previous ? 'fact_superseded' : 'fact_added'
            : 'fact_rejected',
          payload: toJson(operation),
          fromVersion: input.session.stateVersion,
          toVersion: nextVersion,
        },
      });
    }

    await tx.nlBuilderMessage.create({
      data: {
        sessionId: input.session.id,
        sequence: input.assistantSequence,
        role: 'assistant',
        content: input.outcome.reply,
        status: 'completed',
        model: input.outcome.model,
        provider: input.outcome.provider,
        inputTokens: input.outcome.usage.inputTokens,
        cachedInputTokens: input.outcome.usage.cachedInputTokens,
        outputTokens: input.outcome.usage.outputTokens,
        latencyMs: input.outcome.latencyMs,
        completedAt: new Date(),
      },
    });
    await tx.nlBuilderStateSnapshot.create({
      data: {
        sessionId: input.session.id,
        version: nextVersion,
        requirements: toJson(requirements),
        readiness: toJson(input.outcome.readiness),
        derivedThroughSequence: input.assistantSequence,
      },
    });

    const updated = await tx.nlBuilderSession.updateMany({
      where: { id: input.session.id, stateVersion: input.session.stateVersion },
      data: {
        phase,
        stateVersion: nextVersion,
        requirements: toJson(requirements),
        readiness: toJson(input.outcome.readiness),
        rollingSummary: input.outcome.summary,
        transcript: toJson(transcript),
      },
    });
    if (updated.count !== 1) throw new BuilderSessionConflictError();

    const existingSummary = await tx.nlBuilderMemorySummary.findFirst({
      where: { sessionId: input.session.id, type: 'rolling' },
      select: { id: true, coveredFromSequence: true },
    });
    if (existingSummary) {
      await tx.nlBuilderMemorySummary.update({
        where: { id: existingSummary.id },
        data: {
          content: input.outcome.summary,
          coveredThroughSequence: input.assistantSequence,
          tokenCount: Math.ceil(input.outcome.summary.length / 4),
        },
      });
    } else if (input.outcome.summary.trim()) {
      await tx.nlBuilderMemorySummary.create({
        data: {
          sessionId: input.session.id,
          type: 'rolling',
          content: input.outcome.summary,
          coveredFromSequence: 1,
          coveredThroughSequence: input.assistantSequence,
          tokenCount: Math.ceil(input.outcome.summary.length / 4),
        },
      });
    }

    const topics = topicSummariesFromFacts(nextFacts);
    for (const topic of topics) {
      const existingTopic = await tx.nlBuilderMemorySummary.findFirst({
        where: { sessionId: input.session.id, type: 'topic', topic: topic.topic },
        select: { id: true, coveredFromSequence: true },
      });
      if (existingTopic) {
        await tx.nlBuilderMemorySummary.update({
          where: { id: existingTopic.id },
          data: {
            content: topic.content,
            coveredThroughSequence: input.assistantSequence,
            tokenCount: Math.ceil(topic.content.length / 4),
          },
        });
      } else {
        await tx.nlBuilderMemorySummary.create({
          data: {
            sessionId: input.session.id,
            type: 'topic',
            topic: topic.topic,
            content: topic.content,
            coveredFromSequence: input.assistantSequence,
            coveredThroughSequence: input.assistantSequence,
            tokenCount: Math.ceil(topic.content.length / 4),
          },
        });
      }
    }
  });

  return { requirements, version: nextVersion, phase };
}

async function persistPlan(input: {
  sessionId: string;
  requirementsVersion: number;
  plan: AgentCreationPlan;
  legacyItem: Record<string, unknown>;
}) {
  return prisma.$transaction(async (tx) => {
    await tx.nlBuilderPlan.updateMany({
      where: { sessionId: input.sessionId, status: { in: ['draft', 'confirmed'] } },
      data: { status: 'stale' },
    });
    const aggregate = await tx.nlBuilderPlan.aggregate({
      where: { sessionId: input.sessionId },
      _max: { planVersion: true },
    });
    const planVersion = (aggregate._max.planVersion ?? 0) + 1;
    const created = await tx.nlBuilderPlan.create({
      data: {
        sessionId: input.sessionId,
        requirementsVersion: input.requirementsVersion,
        planVersion,
        plan: toJson(input.plan),
        status: 'draft',
      },
    });
    const session = await tx.nlBuilderSession.findUniqueOrThrow({
      where: { id: input.sessionId },
      select: { transcript: true },
    });
    const transcript = [...legacyTranscript(session.transcript), input.legacyItem]
      .slice(-MAX_LEGACY_TRANSCRIPT_ITEMS);
    await tx.nlBuilderSession.update({
      where: { id: input.sessionId },
      data: { phase: 'reviewing', transcript: toJson(transcript) },
    });
    return created;
  });
}

/** Leaves a durable failed assistant row so reserved sequences are never silent gaps. */
async function markTurnFailed(input: {
  sessionId: string;
  assistantSequence: number;
  errorMessage: string;
}) {
  await prisma.nlBuilderMessage.upsert({
    where: {
      sessionId_sequence: {
        sessionId: input.sessionId,
        sequence: input.assistantSequence,
      },
    },
    create: {
      sessionId: input.sessionId,
      sequence: input.assistantSequence,
      role: 'assistant',
      content: input.errorMessage.slice(0, 2_000),
      status: 'failed',
      completedAt: new Date(),
    },
    update: {
      content: input.errorMessage.slice(0, 2_000),
      status: 'failed',
      completedAt: new Date(),
    },
  });
}

export interface ProcessBuilderTurnResult {
  message: { role: 'assistant'; content: string };
  phase: string;
  requirements: BuilderRequirementsState;
  readiness: BuilderReadinessState;
  plan: AgentCreationPlan | null;
  planId: string | null;
  planningBrief: string | null;
  stateVersion: number;
}

export async function processBuilderTurn(input: {
  sessionId: string;
  userId: string;
  orgId: string;
  content: string;
  model?: string;
  /** Redesign after a plan card: keep discovery memory, force plan when ready. */
  intent?: 'message' | 'redesign';
}): Promise<ProcessBuilderTurnResult> {
  const lock = await acquireBuilderSessionLock(input.sessionId);
  try {
    const reserved = await reserveTurn(input);
    try {
      const [factRows, recentRows, topicRows, messageCount, userTurnCount, tiers] = await Promise.all([
        prisma.nlBuilderRequirementFact.findMany({
          where: { sessionId: input.sessionId, status: 'active' },
          orderBy: [{ category: 'asc' }, { key: 'asc' }],
          select: { key: true, category: true, value: true, confidence: true, sourceMessageId: true },
        }),
        prisma.nlBuilderMessage.findMany({
          where: { sessionId: input.sessionId, sequence: { lt: reserved.userSequence } },
          orderBy: { sequence: 'desc' },
          take: RECENT_MESSAGE_LIMIT,
          select: { role: true, content: true, sequence: true },
        }),
        prisma.nlBuilderMemorySummary.findMany({
          where: { sessionId: input.sessionId, type: 'topic' },
          orderBy: { updatedAt: 'desc' },
          take: 8,
          select: { topic: true, content: true },
        }),
        prisma.nlBuilderMessage.count({ where: { sessionId: input.sessionId } }),
        prisma.nlBuilderMessage.count({ where: { sessionId: input.sessionId, role: 'user' } }),
        allowedTiers(input.orgId),
      ]);
      const currentFacts = activeFactsFromRows(factRows);
      const priorRequirements = jsonValue<BuilderRequirementsState>(
        reserved.session.requirements,
        EMPTY_REQUIREMENTS,
      );
      const priorReadiness = jsonValue<BuilderReadinessState>(reserved.session.readiness, EMPTY_READINESS);
      const recentMessages: ContextMessage[] = recentRows.reverse();
      const topicSummaries = topicRows
        .filter((row): row is { topic: string; content: string } => Boolean(row.topic))
        .map((row) => ({ topic: row.topic, content: row.content }));

      const rawOutcome = await runBuilderDiscovery({
        phase: reserved.session.phase,
        facts: currentFacts,
        unresolved: priorRequirements.unresolved ?? [],
        assumptions: priorRequirements.assumptions ?? [],
        readiness: priorReadiness,
        rollingSummary: reserved.session.rollingSummary,
        topicSummaries,
        recentMessages,
        currentMessage: input.content,
        messageCount,
      }, { model: input.model, planAllowedTiers: tiers });

      const factsAfterOps = applyOutcomeToFacts(currentFacts, rawOutcome, reserved.message.id);
      const lastAssistantReply = [...recentMessages]
        .reverse()
        .find((message) => message.role === 'assistant')
        ?.content;

      let outcome = normalizeDiscoveryOutcome({
        outcome: rawOutcome,
        factsAfterOps,
        priorUnresolved: priorRequirements.unresolved ?? [],
        priorAssumptions: priorRequirements.assumptions ?? [],
        currentMessage: input.content,
        lastAssistantReply,
        userTurnNumber: userTurnCount,
      });
      outcome = enforceDiscoveryBoundary(outcome, userTurnCount);
      if (input.intent === 'redesign') {
        outcome = applyRedesignIntent(outcome);
      }
      const persisted = await persistDiscovery({
        session: reserved.session,
        userMessageId: reserved.message.id,
        userContent: input.content,
        assistantSequence: reserved.assistantSequence,
        currentFacts,
        outcome,
      });

      void emitBuilderAnalytics({
        type: 'discovery_turn',
        sessionId: input.sessionId,
        messageId: reserved.message.id,
        phase: persisted.phase,
        action: outcome.action,
        canPlan: outcome.readiness.canPlan,
        factOps: outcome.operations.length,
        unresolved: outcome.unresolved.length,
        inputTokens: outcome.usage.inputTokens,
        outputTokens: outcome.usage.outputTokens,
        latencyMs: outcome.latencyMs,
        intent: input.intent ?? 'message',
      }, persisted.version);

      if (outcome.action !== 'plan') {
        return {
          message: { role: 'assistant', content: outcome.reply },
          phase: persisted.phase,
          requirements: persisted.requirements,
          readiness: outcome.readiness,
          plan: null,
          planId: null,
          planningBrief: null,
          stateVersion: persisted.version,
        };
      }

      await prisma.nlBuilderSession.update({
        where: { id: input.sessionId },
        data: { phase: 'planning' },
      });
      const planningBrief = requirementsToPlanningBrief(
        persisted.requirements.facts,
        outcome.summary,
        persisted.requirements.assumptions,
        input.intent === 'redesign' ? { redesignNote: input.content } : undefined,
      );
      const scopeIntent = buildScopeIntentText({
        summary: outcome.summary,
        redesignNote: input.intent === 'redesign' ? input.content : undefined,
        currentMessage: input.intent !== 'redesign' ? input.content : undefined,
      });
      try {
        const plan = await parseAgentCreationPrompt(
          planningBrief,
          input.orgId,
          input.model,
          scopeIntent,
        );
        const planRow = await persistPlan({
          sessionId: input.sessionId,
          requirementsVersion: persisted.version,
          plan,
          legacyItem: {
            id: reserved.assistantSequence + 1,
            kind: 'plan',
            plan,
            consumed: false,
            guestNote: null,
            sourceText: planningBrief,
            revisions: [],
            superseded: false,
          },
        });
        void emitBuilderAnalytics({
          type: 'plan_generated',
          sessionId: input.sessionId,
          planId: planRow.id,
          requirementsVersion: persisted.version,
          planType: plan.type,
        }, persisted.version);

        return {
          message: { role: 'assistant', content: outcome.reply },
          phase: 'reviewing',
          requirements: persisted.requirements,
          readiness: outcome.readiness,
          plan,
          planId: planRow.id,
          planningBrief,
          stateVersion: persisted.version,
        };
      } catch (planErr) {
        await prisma.nlBuilderSession.update({
          where: { id: input.sessionId },
          data: { phase: 'ready' },
        });
        throw planErr;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Builder turn failed';
      void emitBuilderAnalytics({
        type: 'turn_failed',
        sessionId: input.sessionId,
        reason: message.slice(0, 500),
      });
      await markTurnFailed({
        sessionId: input.sessionId,
        assistantSequence: reserved.assistantSequence,
        errorMessage: message,
      }).catch(() => undefined);
      throw err;
    }
  } finally {
    await lock.release().catch(() => undefined);
  }
}
