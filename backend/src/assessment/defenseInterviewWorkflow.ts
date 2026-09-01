import type { ConversationWorkflow } from '../conversations/workflow.types.js';
import { publishConversationWorkflow } from '../conversations/conversationWorkflow.service.js';

/**
 * One defense-interview question, start to finish: ask, collect the student's
 * answer, durably record the exchange, done. Deliberately linear — deciding
 * whether to ask a follow-up is an evaluator agent's reasoning between Team
 * pipeline stages (see interactiveReview.service.ts), not workflow branching.
 * Every question is its own thread under one ConversationProcess per
 * WorkSession, the same "one thread per logical exchange" shape
 * legacyTeamWait.adapter.ts already uses for WhatsApp contacts.
 */
export const DEFENSE_INTERVIEW_WORKFLOW_KEY = 'student_defense_interview_question.v1';

export const DEFENSE_INTERVIEW_WORKFLOW: ConversationWorkflow = {
  key: DEFENSE_INTERVIEW_WORKFLOW_KEY,
  version: 1,
  entryNodeId: 'ask_question',
  nodes: [
    {
      id: 'ask_question',
      type: 'ask',
      content: '{{questionText}}',
      variable: 'answerText',
      next: 'record_answer',
    },
    {
      id: 'record_answer',
      type: 'action',
      action: 'assessment.record_review_answer',
      input: {
        sessionId: '{{sessionId}}',
        criterionId: '{{criterionId}}',
        questionId: '{{questionId}}',
        questionText: '{{questionText}}',
        answerText: '{{answerText}}',
      },
      resultVariable: 'recorded',
      next: 'complete_interview',
      onError: 'fail_interview',
    },
    {
      id: 'complete_interview',
      type: 'complete',
      result: {
        criterionId: '{{criterionId}}',
        questionId: '{{questionId}}',
        questionText: '{{questionText}}',
        answerText: '{{answerText}}',
      },
    },
    {
      id: 'fail_interview',
      type: 'fail',
      message: 'Failed to record the defense interview answer: {{lastActionError}}',
    },
  ],
};

/** Publish (or re-publish) the defense-interview workflow. Idempotent: publishing
 * an identical definition creates a new version, which is safe — threads stay
 * pinned to whatever version they started on. Call once at deploy/seed time. */
export async function publishDefenseInterviewWorkflow(): Promise<{ workflowVersionId: string; version: number }> {
  const result = await publishConversationWorkflow({
    orgId: null,
    name: 'Student defense interview — one question',
    description:
      'Ask one defense-interview question, collect the answer, and durably record the exchange for the evaluator team to score.',
    workflow: DEFENSE_INTERVIEW_WORKFLOW,
  });
  return { workflowVersionId: result.workflowVersionId, version: result.version };
}
