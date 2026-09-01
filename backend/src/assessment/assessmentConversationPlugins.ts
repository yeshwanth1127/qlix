import { prisma } from '../lib/prisma.js';
import type {
  ConversationActionPlugin,
  ConversationChannelAdapter,
  ConversationPluginContext,
  ConversationPluginRegistry,
} from '../conversations/conversationPlugins.js';

export const ASSESSMENT_CONVERSATION_CHANNEL = 'assessment';

type RecordReviewAnswerInput = {
  sessionId: string;
  criterionId: string;
  questionId: string;
  questionText: string;
  answerText: string;
};

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`assessment.record_review_answer: ${field} is required`);
  }
  return value.trim();
}

/**
 * Durably appends one asked/answered exchange to the current AssessmentRecord's
 * reviewTranscript. Deliberately does not score the answer — verdict/confidence
 * is an evaluator agent's job in the next Team pipeline stage, which reads this
 * transcript as prior-stage context (see interactiveReview.service.ts).
 */
const recordReviewAnswerPlugin: ConversationActionPlugin = {
  name: 'assessment.record_review_answer',
  validate(raw): Record<string, unknown> {
    const value = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    return {
      sessionId: requireString(value.sessionId, 'sessionId'),
      criterionId: requireString(value.criterionId, 'criterionId'),
      questionId: requireString(value.questionId, 'questionId'),
      questionText: requireString(value.questionText, 'questionText'),
      answerText: requireString(value.answerText, 'answerText'),
    };
  },
  async authorize(): Promise<void> {
    // Internal system action driven by the workflow engine, not a user request.
  },
  async execute(_context: ConversationPluginContext, raw: Record<string, unknown>): Promise<unknown> {
    const input = raw as unknown as RecordReviewAnswerInput;
    const now = new Date().toISOString();
    const exchange = [
      { type: 'question', question_id: input.questionId, criterion_id: input.criterionId, text: input.questionText, asked_by_agent_id: null },
      { type: 'answer', question_id: input.questionId, text: input.answerText, answered_at: now, attachments: [] },
    ];

    const existing = await prisma.assessmentRecord.findFirst({
      where: { sessionId: input.sessionId },
      orderBy: { createdAt: 'desc' },
    });

    if (existing) {
      const transcript = Array.isArray(existing.reviewTranscript) ? existing.reviewTranscript : [];
      await prisma.assessmentRecord.update({
        where: { id: existing.id },
        data: { reviewTranscript: [...transcript, ...exchange] },
      });
      return { assessmentRecordId: existing.id, recorded: true };
    }

    const session = await prisma.workSession.findUnique({ where: { id: input.sessionId } });
    if (!session) throw new Error(`assessment.record_review_answer: WorkSession ${input.sessionId} was not found`);
    if (!session.frameworkId) {
      throw new Error(`assessment.record_review_answer: WorkSession ${input.sessionId} has no evaluation framework assigned`);
    }
    const created = await prisma.assessmentRecord.create({
      data: {
        sessionId: input.sessionId,
        frameworkId: session.frameworkId,
        reviewTranscript: exchange,
      },
    });
    return { assessmentRecordId: created.id, recorded: true };
  },
};

/** No external push provider for the review channel — the dashboard/extension
 * reads the current question via the existing GET /api/v1/conversations/threads/:id.
 * The outbox row already durably holds the interpolated question text. */
const assessmentChannelAdapter: ConversationChannelAdapter = {
  channel: ASSESSMENT_CONVERSATION_CHANNEL,
  sendScope: null,
  async send(): Promise<unknown> {
    return { delivered: 'dashboard_poll' };
  },
};

export function registerAssessmentConversationPlugins(registry: ConversationPluginRegistry): void {
  const owner = { id: 'assessment', kind: 'organization' } as const;
  registry.registerAction(recordReviewAnswerPlugin, owner);
  registry.registerChannel(assessmentChannelAdapter, owner);
}
