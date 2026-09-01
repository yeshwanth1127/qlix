import { prisma } from '../lib/prisma.js';
import { getConversationProcess } from '../conversations/conversationProcess.service.js';
import { signalConversation, startConversation } from '../conversations/conversationEngine.service.js';
import { DEFENSE_INTERVIEW_WORKFLOW_KEY, publishDefenseInterviewWorkflow } from './defenseInterviewWorkflow.js';
import { ASSESSMENT_CONVERSATION_CHANNEL } from './assessmentConversationPlugins.js';

export type AskReviewQuestionInput = {
  orgId: string;
  sessionId: string;
  teamRunId: string;
  criterionId: string;
  questionId: string;
  questionText: string;
  /** 'demonstration' flags a small-live-task ask (Phase 1: answered with a text/paste
   * description; Phase 3 upgrades this to carry real diff evidence via the sandbox). */
  kind?: 'question' | 'demonstration';
};

/**
 * Finds or creates the one ConversationProcess for this TeamRun's review
 * interview, keyed exactly like legacyTeamWait.adapter.ts keys its WhatsApp
 * process (`externalRefType:'team_run'`) — so the orchestrator can discover
 * open review threads for a run the same way it discovers open WaitTriggers,
 * without needing a WorkSession lookup on the pause/resume path.
 */
async function ensureReviewProcess(input: { orgId: string; teamRunId: string; sessionId: string }): Promise<string> {
  const process = await prisma.conversationProcess.upsert({
    where: {
      orgId_externalRefType_externalRefId: {
        orgId: input.orgId,
        externalRefType: 'team_run',
        externalRefId: input.teamRunId,
      },
    },
    update: {},
    create: {
      orgId: input.orgId,
      ownerType: 'team',
      ownerId: input.teamRunId,
      externalRefType: 'team_run',
      externalRefId: input.teamRunId,
      completionMode: 'all_terminal_or_timeout',
      counters: { total: 0, active: 0 },
      metadata: { adapter: 'assessment_review_v1', sessionId: input.sessionId },
    },
  });
  await prisma.workSession.updateMany({
    where: { id: input.sessionId, reviewProcessId: null },
    data: { reviewProcessId: process.id },
  });
  return process.id;
}

/**
 * Starts one defense-interview question as its own ConversationThread under the
 * TeamRun's shared review ConversationProcess — the same "one process per parent
 * job, one thread per exchange" shape legacyTeamWait.adapter.ts already uses for
 * WhatsApp contacts. Fire-and-forget from the calling evaluator agent's
 * perspective; the Team pipeline pauses separately (see teamOrchestrator.ts's
 * review-conversation checkpoint check).
 */
export async function askReviewQuestion(input: AskReviewQuestionInput): Promise<{ processId: string; threadId: string }> {
  const session = await prisma.workSession.findFirst({
    where: { id: input.sessionId, orgId: input.orgId },
  });
  if (!session) throw new Error(`WorkSession ${input.sessionId} was not found`);

  const processId = await ensureReviewProcess({
    orgId: input.orgId,
    teamRunId: input.teamRunId,
    sessionId: input.sessionId,
  });

  const start = () => startConversation({
    orgId: input.orgId,
    processId,
    ownerType: 'team',
    ownerId: input.teamRunId,
    channel: ASSESSMENT_CONVERSATION_CHANNEL,
    workflowKey: DEFENSE_INTERVIEW_WORKFLOW_KEY,
    variables: {
      sessionId: input.sessionId,
      criterionId: input.criterionId,
      questionId: input.questionId,
      questionText: input.questionText,
      kind: input.kind ?? 'question',
    },
  });
  let started: Awaited<ReturnType<typeof start>>;
  try {
    started = await start();
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('Published conversation workflow was not found')) throw error;
    await publishDefenseInterviewWorkflow();
    started = await start();
  }

  return { processId, threadId: started.threadId };
}

export type DefenseInterviewThread = {
  threadId: string;
  status: string;
  criterionId: string;
  questionId: string;
  questionText: string;
  answerText: string | null;
  kind: string;
  createdAt: string;
  completedAt: string | null;
};

export type DefenseInterviewState = {
  processId: string | null;
  active: boolean;
  threads: DefenseInterviewThread[];
};

/** Dashboard-safe transcript for the Team Run defense chat. */
export async function loadDefenseInterviewForTeamRun(
  orgId: string,
  teamRunId: string,
): Promise<DefenseInterviewState> {
  const process = await prisma.conversationProcess.findUnique({
    where: { orgId_externalRefType_externalRefId: { orgId, externalRefType: 'team_run', externalRefId: teamRunId } },
    select: { id: true, counters: true },
  });
  if (!process) return { processId: null, active: false, threads: [] };
  const threads = await prisma.conversationThread.findMany({
    where: { processId: process.id },
    select: { id: true, status: true, stateJson: true, resultJson: true, createdAt: true, completedAt: true },
    orderBy: { createdAt: 'asc' },
  });
  const counters = process.counters as Record<string, unknown>;
  return {
    processId: process.id,
    active: Number(counters.active ?? 0) > 0,
    threads: threads.map((thread) => {
      const state = thread.stateJson as Record<string, unknown>;
      const variables = (state.variables ?? {}) as Record<string, unknown>;
      const result = (thread.resultJson ?? {}) as Record<string, unknown>;
      return {
        threadId: thread.id,
        status: thread.status,
        criterionId: String(result.criterionId ?? variables.criterionId ?? ''),
        questionId: String(result.questionId ?? variables.questionId ?? ''),
        questionText: String(result.questionText ?? variables.questionText ?? ''),
        answerText: String(result.answerText ?? variables.answerText ?? '').trim() || null,
        kind: String(variables.kind ?? 'question'),
        createdAt: thread.createdAt.toISOString(),
        completedAt: thread.completedAt?.toISOString() ?? null,
      };
    }),
  };
}

export async function answerDefenseInterviewQuestion(input: {
  orgId: string;
  teamRunId: string;
  threadId: string;
  text: string;
  userId: string;
}): Promise<{ status: string }> {
  const process = await prisma.conversationProcess.findUnique({
    where: { orgId_externalRefType_externalRefId: { orgId: input.orgId, externalRefType: 'team_run', externalRefId: input.teamRunId } },
    select: { id: true },
  });
  if (!process) throw new Error('Defense interview was not found');
  const thread = await prisma.conversationThread.findFirst({
    where: {
      id: input.threadId,
      orgId: input.orgId,
      processId: process.id,
    },
    select: { id: true, status: true },
  });
  if (!thread) throw new Error('Defense interview question was not found');
  if (thread.status !== 'waiting_input') throw new Error('This defense interview question is not awaiting an answer');
  const result = await signalConversation({
    threadId: thread.id,
    signal: { type: 'inbound', text: input.text, payload: { answeredByUserId: input.userId } },
    idempotencyKey: `${thread.id}:dashboard-answer:${input.userId}`,
  });
  return { status: result.status };
}

/** The review ConversationProcess for this run, if any question has been asked. */
export async function findReviewProcessForTeamRun(
  orgId: string,
  teamRunId: string,
): Promise<{ id: string } | null> {
  const process = await prisma.conversationProcess.findUnique({
    where: {
      orgId_externalRefType_externalRefId: {
        orgId,
        externalRefType: 'team_run',
        externalRefId: teamRunId,
      },
    },
    select: { id: true },
  });
  return process;
}

/** True while at least one question thread under this run's review process is
 * still open — what the orchestrator's checkpoint check pauses the Team run on. */
export async function reviewProcessHasOpenThreads(processId: string): Promise<boolean> {
  const process = await getConversationProcess(processId);
  return (process.counters.active ?? 0) > 0;
}

export type ReviewTranscriptEntry = {
  criterionId: string;
  questionId: string;
  questionText: string;
  answerText: string;
};

/** Completed question/answer exchanges for this run's review process, read from
 * each thread's terminal result — the resume-time context injected for the next
 * pipeline stage, analogous to WhatsApp's externalReplyResult(). */
export async function loadCompletedReviewExchanges(processId: string): Promise<ReviewTranscriptEntry[]> {
  const threads = await prisma.conversationThread.findMany({
    where: { processId, status: 'completed' },
    select: { resultJson: true },
    orderBy: { completedAt: 'asc' },
  });
  return threads
    .map((thread) => thread.resultJson as Record<string, unknown> | null)
    .filter((result): result is Record<string, unknown> => Boolean(result))
    .map((result) => ({
      criterionId: String(result.criterionId ?? ''),
      questionId: String(result.questionId ?? ''),
      questionText: String(result.questionText ?? ''),
      answerText: String(result.answerText ?? ''),
    }));
}
