import type { PermissionScope } from '../agents/agents.types.js';
import type {
  TeamConfig,
  TeamDTO,
  TeamMemberDTO,
  TeamRunArtifact,
  TeamRunCheckpoint,
  TeamRunDTO,
} from './teams.types.js';
import { TeamsRepository } from './teams.repository.js';
import { TeamAgentRunBridge } from './teamAgentRunBridge.js';
import {
  WaitTriggerService,
  type TeamManagedConversationResult,
  type WaitTriggerInbound,
} from './waitTrigger.service.js';
import {
  classifyReplyInterests,
  formatInterestFindings,
  INTEREST_STAGE_GOAL_MARKER,
  interestStageGoalAppend,
  summarizeInterestCounts,
  type ReplyInterestResult,
} from './replyInterestClassifier.js';
import { deliverTextToWorkspaceWhatsApp } from '../whatsapp/whatsappChannel.service.js';
import { nonReasoningFallbackModel } from '../llm/routing/reasoningBudget.js';
import { goalRequestsWhatsAppDelivery } from '../whatsapp/whatsappDeliveryIntent.js';
import {
  clearNotifierState,
  notifyTeamChannelProgress,
  teamRunShouldReplyWhatsApp,
} from './teamChannelNotifier.js';
import {
  buildWaitPolicySnapshot,
  findWaitStepForStage,
  goalRequestsOutreachPack,
  resolveReplyInclusion,
  resolveWaitStepsForTeam,
} from '../wait/waitPolicy.js';
import {
  deliverWaitResumeSideEffects,
  initializeWaitSideEffects,
  liveArtifactsForResume,
} from '../wait/waitSideEffect.service.js';
import { liveArtifactPreviewPayload } from '../wait/liveArtifact.service.js';
import {
  parseLunaTeamsHandback,
  DEFAULT_RESULT_CONTRACT,
  planLunaTeamsDispatches,
  isEmptyFindings,
  isRowStructuredInput,
  renderLunaTeamsFinal,
  renderResultHandbacks,
  resolveDispatchAllowedScopes,
  skillsForLunaTeamsDispatch,
  TEAM_DISPATCH_ONLY_SKILL,
  validateLunaTeamsResult,
} from './lunaTeamsHost.js';
import { effectiveRunGoal } from './teamIntent.js';
import { repairCityAliasOmissions } from './rowAliasRepair.js';
import { cityAliasHint } from './cityAliases.js';

function runObjective(run: TeamRunDTO): string {
  return effectiveRunGoal(run);
}

/**
 * Structured `findings` out of a completed handback. A validated Result is stored as
 * `{ data, provenance }`, so the payload the next stage consumes sits one level in.
 * `known: false` means the shape was not recognised — callers must not treat that as empty.
 */
export function handbackFindings(result: { payload?: unknown }): { known: boolean; value: unknown } {
  const payload = result.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { known: false, value: undefined };
  }
  const outer = payload as Record<string, unknown>;
  const container =
    outer.data && typeof outer.data === 'object' && !Array.isArray(outer.data)
      ? (outer.data as Record<string, unknown>)
      : outer;
  return 'findings' in container
    ? { known: true, value: container.findings }
    : { known: false, value: undefined };
}

function normalizeFindingsText(findings: unknown): string {
  if (typeof findings === 'string') return findings;
  if (findings == null) return '';
  try {
    return JSON.stringify(findings, null, 2);
  } catch {
    return String(findings);
  }
}

const TRUNCATION_FAILURE_RE =
  /did not return a Result|cut off|No response generated|result\.summary is required|Worker Result JSON was cut off/i;

function isTruncationLikeFailure(message: string): boolean {
  return TRUNCATION_FAILURE_RE.test(message);
}

/** The worker produced a Result envelope and validation rejected it, as opposed to producing none. */
const TEAM_RESULT_REJECTED = 'team_result_rejected';

/** The worker described the work in its Result but never called the tool that performs it. */
const TEAM_STAGE_DID_NOT_ACT = 'team_stage_did_not_act';

/**
 * Scopes whose whole purpose is to change something outside the run. A stage holding one of
 * these has not finished by writing a Result about it — a Result saying "a WhatsApp message was
 * prepared" is not a message anybody received.
 */
const ACTING_SCOPE_RE =
  /^(whatsapp\.(contact_send|send.*)|email\.send|crm\.write|sheets\.write|drive\.write|notion\.write|slack\.(post|send).*)$/i;

export function isActingScope(scope: string): boolean {
  return ACTING_SCOPE_RE.test(scope);
}

function teamRunInferenceModel(
  team: TeamDTO,
  attempt: number,
  lastError: Error | null,
): string | null {
  const requested = (team.config as TeamConfig).defaultModel?.trim() || null;
  if (attempt > 1 && lastError && isTruncationLikeFailure(lastError.message)) {
    return nonReasoningFallbackModel(requested ?? '');
  }
  return requested;
}

function teamRunReasoningEffort(team: TeamDTO): string | null {
  const value = (team.config as TeamConfig).defaultReasoningEffort?.trim();
  return value || null;
}

export interface SubtaskPlan {
  subtaskId: string;
  agentId: string;
  agentName: string;
  agentDescription?: string;
  role: string;
  goal: string;
  delegatedScopes: PermissionScope[];
  allowedScopes: PermissionScope[];
  /**
   * Pipeline stage this subtask belongs to. Subtasks sharing a stage run concurrently;
   * stages themselves run in ascending order, each seeing every earlier stage's output.
   */
  stageOrder: number;
  contractId?: string;
  inputRefs: string[];
  allowedSources: Array<'authoritative_input' | 'reference_asset'>;
  knowledgeMode: 'none' | 'reference_only' | 'required';
  outputContract: Record<string, unknown>;
  /** Intent requirements this dispatch owns. Absent on the fallback plans, which decompose none. */
  requirementIds?: string[];
}

interface WorkerResult {
  subtaskId: string;
  agentId: string;
  agentName: string;
  summary: string;
  findings: string;
  payload?: unknown;
  mailboxMessageId?: string;
  artifacts: TeamRunArtifact[];
  status: 'completed' | 'failed';
  errorMessage?: string;
}

// SSE event emitter type — callers register a callback to forward events to the HTTP response
export type RunEventEmitter = (eventType: string, data: unknown) => void;

/**
 * Split an ordered plan into stage groups. Subtasks sharing a `stageOrder` become one
 * group and run concurrently; groups run in sequence.
 *
 * The plan arrives sorted by stageOrder, so adjacent equal values are the whole group.
 * Teams created through the existing APIs get strictly distinct stages (1..N), which
 * yields one subtask per group — byte-for-byte the previous sequential behaviour.
 * Parallelism only appears once something deliberately assigns two members the same
 * stage (see `reorderMembers` with `stages`).
 */
export function groupSubtasksByStage(plan: SubtaskPlan[]): SubtaskPlan[][] {
  const groups: SubtaskPlan[][] = [];
  for (const subtask of plan) {
    const last = groups[groups.length - 1];
    if (last && last[0]!.stageOrder === subtask.stageOrder) last.push(subtask);
    else groups.push([subtask]);
  }
  return groups;
}

export class TeamOrchestrator {
  private readonly repo = new TeamsRepository();
  private readonly bridge = new TeamAgentRunBridge();
  private readonly waitTriggers = new WaitTriggerService();

  async execute(
    run: TeamRunDTO,
    team: TeamDTO,
    emit: RunEventEmitter,
  ): Promise<void> {
    const config = team.config as TeamConfig;
    const supervisorId = team.supervisorAgentId!;
    const timeoutMs = config.subtaskTimeoutMs ?? 120_000;
    const maxAttempts = config.retryPolicy === 'twice' ? 3 : config.retryPolicy === 'once' ? 2 : 1;

    try {
      await this.repo.updateRunStatus(run.id, 'running', { startedAt: new Date() });
      await this.emitEvent(run, team, null, 'run_started', {
        runId: run.id,
        goal: run.goal,
        ...(((team.config as TeamConfig).defaultModel)
          ? { model: (team.config as TeamConfig).defaultModel }
          : {}),
      }, emit);

      const members = team.members ?? [];
      if (members.length === 0) {
        throw new Error('Team has no worker members');
      }

      // Members come from the repository already sorted by stageOrder (ascending).
      const orderedMembers = [...members].sort((a, b) => {
        if (a.stageOrder !== b.stageOrder) return a.stageOrder - b.stageOrder;
        return a.addedAt.localeCompare(b.addedAt);
      });

      const planMessage = config.autoSequence
        ? 'Luna-Teams is selecting the next specialists…'
        : `Luna-Teams is preparing dispatches in team order (${orderedMembers.map((m) => m.agent?.name ?? m.agentId).join(' → ')})`;
      await this.emitEvent(run, team, supervisorId, 'task_status_update', { message: planMessage }, emit);

      const dispatches = await planLunaTeamsDispatches(run, team, orderedMembers);
      const plan: SubtaskPlan[] = dispatches.map((dispatch) => ({
        subtaskId: dispatch.dispatchId,
        agentId: dispatch.agentId,
        agentName: dispatch.agentName,
        role: dispatch.role,
        goal: dispatch.task,
        delegatedScopes: dispatch.delegatedScopes,
        allowedScopes: dispatch.allowedScopes,
        stageOrder: dispatch.stageOrder,
        ...(dispatch.contractId ? { contractId: dispatch.contractId } : {}),
        inputRefs: dispatch.inputRefs,
        allowedSources: dispatch.allowedSources,
        knowledgeMode: dispatch.knowledgeMode,
        outputContract: dispatch.outputContract,
        requirementIds: dispatch.requirementIds,
      }));

      await this.repo.appendSupervisorTrace(run.id, {
        step: 'dispatch_plan',
        subtasks: plan.map((s) => ({ subtaskId: s.subtaskId, agentId: s.agentId, goal: s.goal })),
        timestampMs: Date.now(),
      });
      await this.emitEvent(run, team, supervisorId, 'supervisor_step', {
        step: 'dispatch_plan',
        subtasks: plan,
      }, emit);

      const results: WorkerResult[] = [];

      if (config.pipelineMode) {
        const stageGroups = groupSubtasksByStage(plan);

        for (let groupIndex = 0; groupIndex < stageGroups.length; groupIndex++) {
          const group = stageGroups[groupIndex]!;
          const current = await this.repo.findRun(run.id);
          if (current?.status === 'canceled') {
            emit('complete', { status: 'canceled', synthesis: 'Run was canceled.' });
            return;
          }

          // Everyone in a stage sees the same context: output from earlier stages only.
          // Peers within a stage run concurrently and cannot read each other's results.
          const priorResults = [...results];
          const groupResults = await this.executeStage(
            run,
            team,
            group,
            emit,
            timeoutMs,
            maxAttempts,
            priorResults,
            config.maxParallelWorkers,
            groupIndex + 1,
            stageGroups.length,
          );
          results.push(...groupResults);

          if ((await this.repo.findRun(run.id))?.status === 'canceled') {
            emit('complete', { status: 'canceled', synthesis: 'Run was canceled.' });
            return;
          }

          const failed = groupResults.find((r) => r.status === 'failed');
          if (failed) {
            await this.abortPipelineRun(run, team, supervisorId, failed, emit);
            return;
          }
          // A wait may intentionally follow the final worker stage (for
          // example, outbound outreach followed by a per-contact workflow).
          // Always inspect durable waits/pending outbounds before finalizing.
          const paused = await this.pauseForOpenWaits(
            run,
            team,
            plan,
            results,
            groupIndex + 1,
            emit,
          );
          if (paused) return;

        }
      } else {
        const batches = this.batchSubtasksAvoidingCollision(plan, config.maxParallelWorkers);
        for (const batch of batches) {
          const current = await this.repo.findRun(run.id);
          if (current?.status === 'canceled') {
            emit('complete', { status: 'canceled', synthesis: 'Run was canceled.' });
            return;
          }
          const batchResults = await Promise.all(
            batch.map((subtask) =>
              this.executeWorkerTask(run, team, subtask, emit, timeoutMs, maxAttempts),
            ),
          );
          results.push(...batchResults);
        }
      }

      await this.finalizeSuccessfulRun(run, team, supervisorId, results, emit, timeoutMs, maxAttempts);
    } catch (err) {
      const current = await this.repo.findRun(run.id);
      if (current?.status === 'canceled') {
        emit('complete', { status: 'canceled', synthesis: 'Run was canceled.' });
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[TeamOrchestrator] run ${run.id} failed:`, message);
      await this.repo.updateRunStatus(run.id, 'failed', { errorMessage: message });
      await this.emitEvent(run, team, null, 'run_failed', { error: message }, emit);
      if (teamRunShouldReplyWhatsApp(run, runObjective(run))) {
        void deliverTextToWorkspaceWhatsApp(team.orgId, {
          title: team.name,
          body: message,
          level: 'error',
        });
      }
      if (run.sourceConnectorId) {
        await this.repo.clearChannelSession(run.sourceConnectorId);
      }
      clearNotifierState(run.id);
      emit('error', { message });
    }
  }

  /**
   * Resume only the unexecuted pipeline stages after a durable external wait
   * was fulfilled. It deliberately does not re-plan or replay completed work.
   */
  async resume(run: TeamRunDTO, team: TeamDTO, emit: RunEventEmitter): Promise<void> {
    const checkpoint = run.checkpointJson as TeamRunCheckpoint | null | undefined;
    if (!checkpoint || !Array.isArray(checkpoint.plan) || !Array.isArray(checkpoint.completedResults)) {
      throw new Error('Paused team run has no valid continuation checkpoint');
    }
    if (run.status !== 'paused') {
      throw new Error(`Team run ${run.id} is not paused`);
    }

    const config = team.config as TeamConfig;
    const supervisorId = team.supervisorAgentId!;
    const timeoutMs = config.subtaskTimeoutMs ?? 120_000;
    const maxAttempts = config.retryPolicy === 'twice' ? 3 : config.retryPolicy === 'once' ? 2 : 1;
    const plan = checkpoint.plan as SubtaskPlan[];
    const results = checkpoint.completedResults as WorkerResult[];

    try {
      const inbound = await this.waitTriggers.loadFulfilledInbound(run.id, checkpoint.waitTriggerIds);
      const managedConversations = await this.waitTriggers.loadManagedConversationResults(
        run.id,
        checkpoint.waitTriggerIds,
      );
      const allTerminal = await this.waitTriggers.areAllCheckpointTriggersTerminal(
        run.id,
        checkpoint.waitTriggerIds,
      );
      if (inbound.length === 0 && !allTerminal) {
        throw new Error('Wait trigger was resumed without an inbound response');
      }

      const statuses = await this.waitTriggers.listCheckpointTriggerStatuses(
        run.id,
        checkpoint.waitTriggerIds,
      );
      const expiredCount = statuses.filter((row) => row.status === 'expired').length;
      const timedOut = expiredCount > 0;
      const totalContacts = checkpoint.waitTriggerIds.length;

      const classifications = managedConversations.length === 0
        ? await classifyReplyInterests(
            inbound.map((reply) => ({ jid: reply.jid, text: reply.text })),
            { userGoal: run.goal, model: checkpoint.inferenceModel },
          )
        : [];
      // Read the policy back off the run's own wait snapshot so the artifact, the resumed
      // worker prompt and the run summary cannot drift apart.
      const replyInclusion = resolveReplyInclusion(checkpoint.waitPolicySnapshot);
      const interestSummary = summarizeInterestCounts(classifications, replyInclusion);
      const liveArtifacts = liveArtifactsForResume(checkpoint);
      const liveArtifactContext =
        liveArtifacts.length > 0
          ? `\n\n--- Live artifacts (use these URLs; do not recreate) ---\n${liveArtifacts
              .map(
                (artifact) =>
                  `- ${artifact.fileName}: ${artifact.url} (${artifact.rowCount} row${artifact.rowCount === 1 ? '' : 's'})`,
              )
              .join('\n')}\n--- End live artifacts ---\n`
          : '';

      const waitResult = managedConversations.length > 0
        ? this.managedConversationResult(managedConversations, checkpoint)
        : this.externalReplyResult(inbound, classifications, {
            timedOut,
            totalContacts,
            repliedCount: inbound.length,
            liveArtifactContext,
            replyInclusion,
          });
      const waitPayload = {
        kind: 'external_wait_result',
        triggerKind: 'whatsapp_inbound',
        timedOut,
        totalContacts,
        replies: inbound,
        conversations: managedConversations,
        classifications,
        interestSummary,
        replyInclusion,
        liveArtifacts,
      };
      const waitMailbox = await this.repo.appendMailboxResult({
        runId: run.id,
        teamId: team.id,
        senderAgentId: null,
        recipientAgentId: supervisorId,
        contractId: 'qlix.wait.result.v1',
        payload: waitPayload,
      });
      waitResult.payload = waitPayload;
      waitResult.mailboxMessageId = waitMailbox.id;
      results.push(waitResult);

      // Direct the first resumed stage to sheet exactly the leads this run's policy includes.
      const stageGroups = groupSubtasksByStage(plan);
      const resumeGroup = stageGroups[checkpoint.nextStageIndex];
      if (resumeGroup && managedConversations.length === 0) {
        const stageAppend = interestStageGoalAppend(replyInclusion);
        for (const subtask of resumeGroup) {
          if (!subtask.goal.includes(INTEREST_STAGE_GOAL_MARKER)) {
            subtask.goal = `${subtask.goal}\n\n${stageAppend}`;
          }
        }
      }

      const claimed = await this.repo.claimRunStatus(run.id, 'paused', 'running', {
        checkpointJson: null,
      });
      if (!claimed) return;
      const activeWaitStep = checkpoint.waitPolicySnapshot?.waitSteps.find(
        (step) => step.id === checkpoint.waitPolicySnapshot?.activeWaitStepId,
      );
      await this.emitEvent(run, team, supervisorId, 'wait_fulfilled', {
        triggerIds: checkpoint.waitTriggerIds,
        responderCount: inbound.length,
        responders: inbound.map((reply) => ({ jid: reply.jid, text: reply.text })),
        classifications: classifications.map((row) => ({
          jid: row.jid,
          label: row.label,
          method: row.method,
        })),
        interestSummary,
        timedOut,
        totalContacts,
        continuePipeline: activeWaitStep?.resume.continuePipeline !== false,
      }, emit);

      const resumeDeliveries = await deliverWaitResumeSideEffects({
        checkpoint,
        orgId: team.orgId,
      });
      for (const delivery of resumeDeliveries) {
        await this.emitEvent(run, team, supervisorId, 'result_delivered', {
          boundary: 'wait_resume',
          ...delivery,
        }, emit);
      }

      if (activeWaitStep?.resume.continuePipeline === false) {
        await this.finalizeSuccessfulRun(
          run,
          team,
          supervisorId,
          results,
          emit,
          timeoutMs,
          maxAttempts,
        );
        return;
      }

      for (let groupIndex = checkpoint.nextStageIndex; groupIndex < stageGroups.length; groupIndex++) {
        const current = await this.repo.findRun(run.id);
        if (current?.status === 'canceled') {
          emit('complete', { status: 'canceled', synthesis: 'Run was canceled.' });
          return;
        }

        const group = stageGroups[groupIndex]!;
        const groupResults = await this.executeStage(
          run,
          team,
          group,
          emit,
          timeoutMs,
          maxAttempts,
          [...results],
          config.maxParallelWorkers,
          groupIndex + 1,
          stageGroups.length,
        );
        results.push(...groupResults);

        if ((await this.repo.findRun(run.id))?.status === 'canceled') {
          emit('complete', { status: 'canceled', synthesis: 'Run was canceled.' });
          return;
        }

        const failed = groupResults.find((result) => result.status === 'failed');
        if (failed) {
          await this.abortPipelineRun(run, team, supervisorId, failed, emit);
          return;
        }
        if (groupIndex < stageGroups.length - 1) {
          const paused = await this.pauseForOpenWaits(
            run,
            team,
            plan,
            results,
            groupIndex + 1,
            emit,
          );
          if (paused) return;
        }
      }

      await this.finalizeSuccessfulRun(run, team, supervisorId, results, emit, timeoutMs, maxAttempts);
    } catch (err) {
      const current = await this.repo.findRun(run.id);
      if (current?.status === 'canceled') {
        emit('complete', { status: 'canceled', synthesis: 'Run was canceled.' });
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[TeamOrchestrator] resume ${run.id} failed:`, message);
      await this.repo.updateRunStatus(run.id, 'failed', { errorMessage: message });
      await this.emitEvent(run, team, null, 'run_failed', { error: message }, emit);
      emit('error', { message });
    }
  }

  private externalReplyResult(
    inbound: WaitTriggerInbound[],
    classifications: ReplyInterestResult[],
    meta?: {
      timedOut?: boolean;
      totalContacts?: number;
      repliedCount?: number;
      liveArtifactContext?: string;
      replyInclusion?: import('../wait/waitPolicy.types.js').ReplyInterestLabel[];
    },
  ): WorkerResult {
    const findingsParts: string[] = [];
    if (meta?.timedOut) {
      findingsParts.push(
        `Wait timed out; ${meta.repliedCount ?? inbound.length} of ${meta.totalContacts ?? '?'} contacted leads replied.`,
      );
    } else if (meta?.totalContacts != null) {
      findingsParts.push(
        `${meta.repliedCount ?? inbound.length} of ${meta.totalContacts} contacted leads replied.`,
      );
    }
    if (meta?.liveArtifactContext?.trim()) {
      findingsParts.push(meta.liveArtifactContext.trim());
    }
    findingsParts.push(formatInterestFindings(classifications, meta?.replyInclusion));
    const interestSummary = summarizeInterestCounts(classifications, meta?.replyInclusion);
    return {
      subtaskId: 'external_whatsapp_reply',
      agentId: '',
      agentName: 'WhatsApp replies',
      summary:
        `${inbound.length} contact${inbound.length === 1 ? '' : 's'} replied` +
        (meta?.timedOut ? ' (wait timed out)' : '') +
        ` (${interestSummary.included} included for sheet, ${interestSummary.notInterested} declined).`,
      findings: findingsParts.join('\n\n'),
      artifacts: [],
      status: 'completed',
    };
  }

  private managedConversationResult(
    conversations: TeamManagedConversationResult[],
    checkpoint: TeamRunCheckpoint,
  ): WorkerResult {
    const internalKeys = new Set([
      'connectorId',
      'contactJid',
      'teamRunId',
      'waitTriggerId',
      'pushName',
    ]);
    const preferredOrder = ['interest', 'preference', 'city', 'degree', 'experience'];
    const contacts = conversations.map((conversation) => {
      const responses = Object.fromEntries(
        Object.entries(conversation.variables)
          .filter(([key]) => !internalKeys.has(key) && !key.endsWith('Classification'))
          .sort(([left], [right]) => {
            const leftIndex = preferredOrder.indexOf(left);
            const rightIndex = preferredOrder.indexOf(right);
            return (leftIndex < 0 ? 999 : leftIndex) - (rightIndex < 0 ? 999 : rightIndex);
          }),
      );
      const contact = checkpoint.waitContacts?.[conversation.contactJid];
      return {
        contact: {
          name: contact?.name ?? null,
          phone: contact?.phone ?? conversation.contactJid.split('@')[0],
          jid: conversation.contactJid,
        },
        status: conversation.status,
        responses,
        outcome: conversation.result,
      };
    });
    const formatLabel = (value: string) =>
      value
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/_/g, ' ')
        .replace(/^./, (character) => character.toUpperCase());
    const findings = contacts
      .map((entry) => {
        const responseLines = Object.entries(entry.responses)
          .map(([key, value]) => `- **${formatLabel(key)}:** ${String(value)}`)
          .join('\n');
        const nextAction = entry.outcome.nextAction;
        return [
          `### ${entry.contact.name || 'WhatsApp contact'}`,
          `- **Phone:** +${entry.contact.phone.replace(/^\+/, '')}`,
          `- **Status:** ${formatLabel(entry.status)}`,
          '',
          '**Responses**',
          responseLines || '- No responses collected',
          ...(typeof nextAction === 'string'
            ? ['', `**Next step:** ${formatLabel(nextAction)}`]
            : []),
        ].join('\n');
      })
      .join('\n\n');
    return {
      subtaskId: 'external_whatsapp_conversations',
      agentId: '',
      agentName: 'WhatsApp conversations',
      summary: `${contacts.length} contact conversation${contacts.length === 1 ? '' : 's'} completed with collected responses.`,
      findings,
      artifacts: [],
      status: 'completed',
    };
  }

  private async pauseForOpenWaits(
    run: TeamRunDTO,
    team: TeamDTO,
    plan: SubtaskPlan[],
    results: WorkerResult[],
    nextStageIndex: number,
    emit: RunEventEmitter,
  ): Promise<boolean> {
    const waits = await this.waitTriggers.listOpenTeamWaits(run.id);
    const freshRun = await this.repo.findRun(run.id);
    const priorCheckpoint =
      ((freshRun?.checkpointJson ?? run.checkpointJson) as TeamRunCheckpoint | null) ?? null;
    const { distinctPendingContactCount, fillMissingOutreachPack } = await import('../wait/pendingWaitOutbound.js');
    const rawPending = priorCheckpoint?.pendingWaitOutbounds ?? [];
    if (waits.length === 0 && rawPending.length === 0) return false;
    const pendingOutbounds = await fillMissingOutreachPack({
      teamRunId: run.id,
      orgId: team.orgId,
      goal: runObjective(run),
      pending: rawPending,
    });
    const pendingContactCount = distinctPendingContactCount(pendingOutbounds);
    const contactCount = Math.max(waits.length, pendingContactCount);
    const pendingSendCount = pendingOutbounds.length;
    const stageGroups = groupSubtasksByStage(plan);
    const completedStageOrder =
      nextStageIndex > 0
        ? stageGroups[nextStageIndex - 1]?.[0]?.stageOrder ?? nextStageIndex
        : nextStageIndex;

    let checkpoint: TeamRunCheckpoint = {
      plan,
      completedResults: results,
      nextStageIndex,
      waitTriggerIds: waits.map((wait) => wait.id),
      waitReason:
        pendingSendCount > 0
          ? `Ready to send ${pendingSendCount} WhatsApp message${pendingSendCount === 1 ? '' : 's'} to ${pendingContactCount} lead${pendingContactCount === 1 ? '' : 's'} — pick a wait duration, then Qlix will send in order and listen for replies.`
          : `Waiting for a WhatsApp reply from ${waits.length} contacted lead${waits.length === 1 ? '' : 's'}.`,
      awaitingTtlSelection: true,
      waitExpiresAt: null,
      waitTtlHours: null,
      inferenceModel: (team.config as TeamConfig).defaultModel?.trim() || null,
      ...(priorCheckpoint?.waitContacts ? { waitContacts: priorCheckpoint.waitContacts } : {}),
      ...(pendingOutbounds.length > 0 ? { pendingWaitOutbounds: pendingOutbounds } : {}),
    };

    const waitSteps = resolveWaitStepsForTeam(team.config, runObjective(run), completedStageOrder);
    const waitStep = findWaitStepForStage(waitSteps, completedStageOrder);
    let liveArtifactsForEvent: ReturnType<typeof liveArtifactPreviewPayload>[] = [];

    if (waitStep) {
      const waitPolicy = buildWaitPolicySnapshot(waitSteps, waitStep.id);
      try {
        const init = await initializeWaitSideEffects({
          checkpoint,
          waitPolicy,
          runId: run.id,
          teamName: team.name,
          supervisorAgentId: team.supervisorAgentId,
          runGoal: runObjective(run),
        });
        checkpoint = init.checkpoint;
        liveArtifactsForEvent = init.liveArtifacts.map((artifact) => liveArtifactPreviewPayload(artifact));
        for (const artifact of init.artifacts) {
          await this.repo.upsertArtifactById(run.id, artifact);
          await this.emitEvent(run, team, team.supervisorAgentId, 'artifact_produced', { artifact }, emit);
        }
      } catch (err) {
        console.warn(
          '[TeamOrchestrator] wait side-effect init failed:',
          err instanceof Error ? err.message : err,
        );
        checkpoint = { ...checkpoint, waitPolicySnapshot: waitPolicy };
      }
    }

    await this.repo.updateRunStatus(run.id, 'paused', { checkpointJson: checkpoint });
    await this.emitEvent(run, team, team.supervisorAgentId, 'wait_armed', {
      triggerKind: 'whatsapp_inbound',
      triggerIds: checkpoint.waitTriggerIds,
      contactCount,
      pendingSendCount,
      expiresAt: waits.map((wait) => wait.expiresAt.toISOString()),
      reason: checkpoint.waitReason,
      nextStage: nextStageIndex + 1,
      awaitingTtlSelection: true,
      liveArtifacts: liveArtifactsForEvent,
      messagesDeferred: pendingSendCount > 0,
    }, emit);
    await this.emitEvent(run, team, team.supervisorAgentId, 'wait_ttl_requested', {
      optionsHours: [1, 6, 24, 48],
      allowCustom: true,
      safetyCapHours: 168,
      contactCount,
      pendingSendCount,
      reason:
        pendingSendCount > 0
          ? 'How long should we wait for WhatsApp replies? Messages are sent only after you pick a duration.'
          : 'How long should we wait for WhatsApp replies before continuing with whoever has responded?',
    }, emit);
    emit('paused', { status: 'paused', teamRunId: run.id, reason: checkpoint.waitReason });
    return true;
  }

  private async finalizeSuccessfulRun(
    run: TeamRunDTO,
    team: TeamDTO,
    supervisorId: string,
    results: WorkerResult[],
    emit: RunEventEmitter,
    _timeoutMs: number,
    _maxAttempts: number,
  ): Promise<void> {
    await this.emitEvent(
      run,
      team,
      supervisorId,
      'task_status_update',
      { message: 'Luna-Teams is preparing the final result…' },
      emit,
    );
    const synthesis = renderLunaTeamsFinal(results);

    await this.repo.appendSupervisorTrace(run.id, {
      step: 'synthesize',
      synthesis,
      timestampMs: Date.now(),
    });

    const allArtifacts = results.flatMap((r) => r.artifacts);
    const finalArtifact: TeamRunArtifact = {
      id: `artifact_final_${Date.now()}`,
      type: 'text',
      name: 'Final Result',
      content: synthesis,
      agentId: supervisorId,
      createdAt: new Date().toISOString(),
    };
    allArtifacts.push(finalArtifact);

    for (const artifact of allArtifacts) {
      await this.repo.appendArtifact(run.id, artifact);
      await this.emitEvent(run, team, supervisorId, 'artifact_produced', { artifact }, emit);
    }

    await this.emitEvent(run, team, supervisorId, 'run_completed', {
      synthesis,
      artifactCount: allArtifacts.length,
    }, emit);

    // Terminal Team runs must never retain an inbound route. Otherwise later
    // casual replies can be consumed by an old run and repeat its final ack.
    await this.waitTriggers.cancelForTeamRun(run.id);
    await this.repo.updateRunStatus(run.id, 'completed', {
      completedAt: new Date(),
      result: { synthesis, artifactCount: allArtifacts.length },
    });

    if (teamRunShouldReplyWhatsApp(run, runObjective(run))) {
      const delivery = await deliverTextToWorkspaceWhatsApp(team.orgId, {
        title: team.name,
        body: synthesis,
      });
      await this.emitEvent(run, team, supervisorId, 'result_delivered', {
        channel: 'whatsapp',
        sent: delivery.sent,
        reason: delivery.reason,
      }, emit);
      if (!delivery.sent) {
        console.warn('[TeamOrchestrator] WhatsApp result delivery skipped:', delivery.reason);
      }
    }

    if (run.sourceConnectorId) {
      await this.repo.clearChannelSession(run.sourceConnectorId);
    }
    clearNotifierState(run.id);

    emit('complete', { status: 'completed', synthesis });
  }

  private async runSupervisorLlm(
    run: TeamRunDTO,
    team: TeamDTO,
    taskPrompt: string,
    emit: RunEventEmitter,
    timeoutMs: number,
    maxAttempts: number,
  ): Promise<string> {
    const supervisorId = team.supervisorAgentId!;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const { runId } = await this.bridge.enqueue({
          team,
          teamRun: run,
          agentId: supervisorId,
          userId: run.startedByUserId,
          role: 'supervisor',
          prompt: taskPrompt,
          skills: [],
          inferenceModel: teamRunInferenceModel(team, attempt, lastError),
          reasoningEffort: teamRunReasoningEffort(team),
        });

        const outcome = await this.bridge.waitAndBridgeEvents({
          agentRunId: runId,
          teamRun: run,
          team,
          agentId: supervisorId,
          timeoutMs,
          emit,
        });

        if (outcome.status !== 'success') {
          throw new Error(outcome.errorMessage ?? `Supervisor run ${outcome.status}`);
        }

        return TeamAgentRunBridge.extractResultText(outcome.result);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < maxAttempts) {
          await this.emitEvent(
            run,
            team,
            supervisorId,
            'task_status_update',
            { message: `Supervisor retry ${attempt}/${maxAttempts - 1}…` },
            emit,
          );
        }
      }
    }

    throw lastError ?? new Error('Supervisor run failed');
  }

  /**
   * Build the pipeline plan directly from the team's stage_order without involving the
   * supervisor LLM. Used whenever `autoSequence=false` (the default). Each member becomes
   * exactly one subtask, in stage order; the goal is the user's original request plus the
   * agent's description so it knows its role.
   */
  private buildStaticPipelinePlan(
    run: TeamRunDTO,
    orderedMembers: TeamMemberDTO[],
  ): SubtaskPlan[] {
    const total = orderedMembers.length;
    return orderedMembers.map((m, i) => {
      const stage = i + 1;
      const description = (m.agent as any)?.description as string | undefined;
      const descPart = description?.trim()
        ? `\n\nYour role: ${description.trim()}`
        : '';
      const goal = `Stage ${stage} of ${total} in the "${this.pipelineName(orderedMembers)}" pipeline.${descPart}\n\nUser goal: ${runObjective(run)}`;
      return {
        subtaskId: `stage_${stage}_${m.agentId.slice(0, 8)}`,
        agentId: m.agentId,
        agentName: m.agent?.name ?? m.agentId,
        agentDescription: description,
        role: m.role,
        goal,
        delegatedScopes: m.delegatedScopes,
        allowedScopes: resolveDispatchAllowedScopes({
          role: m.role,
          task: goal,
          agentName: m.agent?.name ?? m.agentId,
          delegatedScopes: m.delegatedScopes,
          knowledgeMode: 'none',
        }),
        stageOrder: m.stageOrder,
        inputRefs: run.inputs.filter((input) => input.purpose === 'authoritative_input').map((input) => input.ref),
        allowedSources: ['authoritative_input'],
        knowledgeMode: 'none',
        outputContract: DEFAULT_RESULT_CONTRACT,
      };
    });
  }

  private async abortPipelineRun(
    run: TeamRunDTO,
    team: TeamDTO,
    supervisorId: string,
    failed: WorkerResult,
    emit: RunEventEmitter,
  ): Promise<void> {
    const current = await this.repo.findRun(run.id);
    if (current?.status === 'canceled') {
      emit('complete', { status: 'canceled', synthesis: 'Run was canceled.' });
      return;
    }
    const synthesis = `Pipeline aborted: stage "${failed.agentName}" failed — ${failed.errorMessage ?? 'no output produced'}. Downstream stages were skipped.`;
    await this.repo.updateRunStatus(run.id, 'failed', {
      completedAt: new Date(),
      errorMessage: synthesis,
      result: { synthesis },
    });
    await this.emitEvent(run, team, supervisorId, 'run_failed', { error: synthesis }, emit);
    if (run.sourceConnectorId) {
      await this.repo.clearChannelSession(run.sourceConnectorId);
    }
    clearNotifierState(run.id);
    emit('complete', { status: 'failed', synthesis });
  }

  private pipelineName(members: TeamMemberDTO[]): string {
    return members.map((m) => m.agent?.name ?? m.agentId.slice(0, 6)).join(' → ');
  }

  /**
   * Run one pipeline stage. A single-member stage is awaited directly; a shared stage
   * runs its members concurrently, capped at `maxParallelWorkers` so a wide stage cannot
   * outrun the team's configured concurrency budget.
   *
   * Results are returned in plan order regardless of completion order, so downstream
   * context stays deterministic across runs.
   */
  private async executeStage(
    run: TeamRunDTO,
    team: TeamDTO,
    group: SubtaskPlan[],
    emit: RunEventEmitter,
    timeoutMs: number,
    maxAttempts: number,
    priorResults: WorkerResult[],
    maxParallelWorkers: number,
    stageNumber: number,
    stageCount: number,
  ): Promise<WorkerResult[]> {
    if (group.length === 1) {
      return [
        await this.executeWorkerTask(
          run, team, group[0]!, emit, timeoutMs, maxAttempts, priorResults,
        ),
      ];
    }

    const limit = Math.max(1, maxParallelWorkers || 1);
    await this.emitEvent(run, team, team.supervisorAgentId, 'supervisor_step', {
      step: 'stage_started',
      stage: stageNumber,
      stageCount,
      parallel: true,
      agentIds: group.map((s) => s.agentId),
      agentNames: group.map((s) => s.agentName),
    }, emit);
    await this.emitEvent(run, team, team.supervisorAgentId, 'task_status_update', {
      message: `Stage ${stageNumber} of ${stageCount} — ${group.map((s) => s.agentName).join(', ')} working in parallel…`,
    }, emit);

    const results: WorkerResult[] = new Array(group.length);
    let cursor = 0;
    const lanes = Array.from({ length: Math.min(limit, group.length) }, async () => {
      for (;;) {
        const index = cursor++;
        if (index >= group.length) return;
        results[index] = await this.executeWorkerTask(
          run, team, group[index]!, emit, timeoutMs, maxAttempts, priorResults,
        );
      }
    });
    await Promise.all(lanes);
    return results;
  }

  private async supervisorDecompose(
    run: TeamRunDTO,
    team: TeamDTO,
    members: TeamMemberDTO[],
    emit: RunEventEmitter,
    timeoutMs: number,
    maxAttempts: number,
    pipelineMode: boolean,
  ): Promise<SubtaskPlan[]> {
    const rosterText = members
      .map((m, i) => {
        const desc = (m.agent as any)?.description as string | null | undefined;
        const descPart = desc?.trim() ? ` — ${desc.trim()}` : '';
        return `${i + 1}. Agent "${m.agent?.name ?? m.agentId}" id=${m.agentId} (role: ${m.role}, scopes: ${m.delegatedScopes.join(', ')})${descPart}`;
      })
      .join('\n');

    const pipelineNote = pipelineMode
      ? `\n- This is a PIPELINE team: assign tasks in the order they should execute (output of step N feeds into step N+1)\n- Preserve natural dependency order (e.g. research → analysis → reporting)`
      : '';

    const taskPrompt = `You are the supervisor of an agent team named "${team.name}".
Decompose the user goal into concrete subtasks and assign each to exactly one worker agent.

Worker agents available:
${rosterText}

Rules:
- Each subtask must be assigned to exactly one worker (use agent id from the list)
- The subtask goal must be self-contained${pipelineNote}
- Do NOT change or “improve” the user goal (business type, location, counts). Preserve these constraints exactly; only split them into steps.
- When workers have both email.read and email.send scopes, assign reading and sending to different agents; only assign email.send when the subtask explicitly requires sending mail
- Do NOT create subtasks to send WhatsApp/SMS messages — Qlix delivers results to WhatsApp automatically when the user goal mentions WhatsApp
- For conceptual research (no explicit URLs in the user goal), assign one research subtask that asks for a written answer; do not assign separate "send to WhatsApp" steps
- Workers with brain.query scope must query company brain for official policy and cite it in their output
- Return ONLY a JSON array with this exact shape:
[{"subtaskId":"<unique>","agentId":"<agent_id>","goal":"<subtask_goal>"}]

User goal: ${runObjective(run)}`;

    try {
      const raw = await this.runSupervisorLlm(run, team, taskPrompt, emit, timeoutMs, maxAttempts);
      const jsonMatch = raw.match(/\[[\s\S]*\]/);
      const parsed = JSON.parse(jsonMatch?.[0] ?? '[]') as Array<{
        subtaskId?: string;
        agentId?: string;
        goal?: string;
      }>;

      const memberMap = new Map(members.map((m) => [m.agentId, m]));
      const mapped = parsed
        .filter((s) => s.agentId && memberMap.has(s.agentId))
        .map((s, i) => {
          const member = memberMap.get(s.agentId!)!;
          const goal = s.goal ?? runObjective(run);
          return {
            subtaskId: s.subtaskId ?? `st_${i}_${Date.now()}`,
            agentId: member.agentId,
            agentName: member.agent?.name ?? member.agentId,
            agentDescription: (member.agent as any)?.description as string | undefined,
            role: member.role,
            goal,
            delegatedScopes: member.delegatedScopes,
            allowedScopes: resolveDispatchAllowedScopes({
              role: member.role,
              task: goal,
              delegatedScopes: member.delegatedScopes,
              knowledgeMode: 'none',
            }),
            // A supervisor-decomposed plan carries no stage semantics — the LLM chose an
            // order, not a set of concurrent layers. Give each subtask its own stage so
            // decomposed runs stay strictly sequential, as they were before grouping.
            stageOrder: i + 1,
            inputRefs: run.inputs.filter((input) => input.purpose === 'authoritative_input').map((input) => input.ref),
            allowedSources: ['authoritative_input'] as Array<'authoritative_input' | 'reference_asset'>,
            knowledgeMode: 'none' as const,
            outputContract: DEFAULT_RESULT_CONTRACT,
          };
        });

      if (mapped.length > 0) return mapped;
    } catch (err) {
      console.warn('[TeamOrchestrator] decompose parse failed, using fallback', err);
    }

    return members.map((m, i) => ({
      subtaskId: `st_${i}_${Date.now()}`,
      agentId: m.agentId,
      agentName: m.agent?.name ?? m.agentId,
      agentDescription: (m.agent as any)?.description as string | undefined,
      role: m.role,
      goal: runObjective(run),
      delegatedScopes: m.delegatedScopes,
      allowedScopes: resolveDispatchAllowedScopes({
        role: m.role,
        task: runObjective(run),
        delegatedScopes: m.delegatedScopes,
        knowledgeMode: 'none',
      }),
      stageOrder: i + 1,
      inputRefs: run.inputs.filter((input) => input.purpose === 'authoritative_input').map((input) => input.ref),
      allowedSources: ['authoritative_input'],
      knowledgeMode: 'none',
      outputContract: DEFAULT_RESULT_CONTRACT,
    }));
  }

  private async executeWorkerTask(
    run: TeamRunDTO,
    team: TeamDTO,
    subtask: SubtaskPlan,
    emit: RunEventEmitter,
    timeoutMs: number,
    maxAttempts: number,
    priorResults: WorkerResult[] = [],
  ): Promise<WorkerResult> {
    const a2aTask = await this.repo.createA2ATask(
      run.id,
      team.id,
      team.supervisorAgentId!,
      subtask.agentId,
      subtask.goal,
    );
    const mailbox = await this.repo.createMailboxDispatch({
      runId: run.id,
      teamId: team.id,
      senderAgentId: team.supervisorAgentId,
      recipientAgentId: subtask.agentId,
      a2aTaskId: a2aTask.id,
      contractId: subtask.contractId,
      task: subtask.goal,
    });

    await this.repo.updateA2ATask(a2aTask.id, { status: 'working', startedAt: new Date() });
    await this.emitEvent(run, team, subtask.agentId, 'task_delegated', {
      taskId: a2aTask.id,
      subtaskId: subtask.subtaskId,
      agentId: subtask.agentId,
      agentName: subtask.agentName,
      goal: subtask.goal,
      mailboxMessageId: mailbox.id,
      contractId: subtask.contractId ?? null,
    }, emit);

    await this.emitEvent(
      run,
      team,
      subtask.agentId,
      'task_status_update',
      {
        message: `${subtask.agentName} started`,
        taskId: a2aTask.id,
      },
      emit,
    );

    const completedPrior = priorResults.filter((r) => r.status === 'completed');
    const priorContext = renderResultHandbacks(
      completedPrior.map((result) => ({
        agentName: result.agentName,
        payload: result.payload ?? { summary: result.summary, findings: result.findings },
      })),
    );

    const inputRefs = subtask.inputRefs ?? [];
    const allowedSources = subtask.allowedSources ?? ['authoritative_input'];
    const knowledgeMode = subtask.knowledgeMode ?? 'none';
    const outputContract = subtask.outputContract ?? DEFAULT_RESULT_CONTRACT;
    const inputByRef = new Map(run.inputs.map((input) => [input.ref, input]));
    const selectedInputs = inputRefs.map((ref) => {
      const input = inputByRef.get(ref);
      if (!input) throw new Error(`Dispatch references unknown immutable input: ${ref}`);
      if (!allowedSources.includes(input.purpose)) {
        throw new Error(`Dispatch is not allowed to use ${input.purpose}: ${ref}`);
      }
      return input;
    });
    if (
      selectedInputs.length === 0 &&
      /\b(provided|attached|uploaded|input)\s+(file|sheet|spreadsheet|document)\b/i.test(subtask.goal)
    ) {
      throw new Error('Dispatch refers to a provided file but has no valid input reference');
    }
    const inputContext = selectedInputs.length > 0
      ? [
          'Immutable dispatch inputs (use only for the purpose shown):',
          ...selectedInputs.map((input) =>
            [
              `--- ${input.ref} | ${input.purpose} | ${input.fileName} | sha256:${input.sha256}`,
              `Download: ${input.url}`,
              input.extractedText ? `Exact extracted content:\n${input.extractedText}` : '[Binary input; use the download URL.]',
            ].join('\n'),
          ),
        ].join('\n\n')
      : '';
    if (selectedInputs.length > 0) {
      const sourceLabels = selectedInputs.map((input) => {
        // Line count is only a row count for a sheet. On a deck or a PDF it counted
        // paragraphs and called them rows.
        const rows =
          input.extractedText && isRowStructuredInput(input)
            ? Math.max(0, input.extractedText.split(/\r?\n/).filter(Boolean).length - 1)
            : 0;
        return `${input.fileName}${rows > 0 ? ` (${rows} rows)` : ''}`;
      });
      await this.emitEvent(run, team, subtask.agentId, 'task_status_update', {
        message: `${subtask.agentName} used ${sourceLabels.join(', ')}`,
        provenance: true,
      }, emit);
    }
    // A stage with no file of its own is told to continue from the handbacks alone. If every
    // one of them is empty there is nothing to continue from, and running anyway invites the
    // worker to fill the gap from its own priors. Fail here rather than pay for that inference.
    const priorFindings = completedPrior.map(handbackFindings);
    if (
      selectedInputs.length === 0 &&
      priorFindings.length > 0 &&
      priorFindings.every((found) => found.known && isEmptyFindings(found.value))
    ) {
      throw new Error(
        `No usable output from the previous stage${completedPrior.length === 1 ? '' : 's'} to continue from`,
      );
    }
    const validatedPriorRecords = completedPrior.reduce((count, result) => {
      const payload = result.payload as { provenance?: { recordRefs?: unknown[] } } | undefined;
      return count + (Array.isArray(payload?.provenance?.recordRefs) ? payload.provenance.recordRefs.length : 0);
    }, 0);
    if (validatedPriorRecords > 0) {
      await this.emitEvent(run, team, subtask.agentId, 'task_status_update', {
        message: `${subtask.agentName} received ${validatedPriorRecords} validated record${validatedPriorRecords === 1 ? '' : 's'}`,
        provenance: true,
      }, emit);
    }
    // reference_only means the immutable reference assets above; unrestricted
    // org Brain retrieval is enabled only by an explicit "required" contract.
    const useBrain = knowledgeMode === 'required';

    const needsBrowser =
      (() => {
        // Attachment / sandbox download links must not force browser tools.
        const goalSansSandbox = subtask.goal.replace(
          /https?:\/\/[^\s)\]]+\/api\/v1\/sandbox\/[^\s)\]]+/gi,
          '',
        );
        return (
          /\bhttps?:\/\//i.test(goalSansSandbox) ||
          /\b(browse|navigate|scrape|visit|open\s+url|website|web\s+page)\b/i.test(subtask.goal)
        );
      })();
    const browserGuidance = needsBrowser
      ? '- Browser tools are allowed if needed; use at most 3 browser actions, then return your JSON answer.\n'
      : '- Do NOT use browser tools for this subtask unless explicitly required.\n';
    const workerSkills = skillsForLunaTeamsDispatch({
      allowedScopes: subtask.allowedScopes,
      role: subtask.role,
      task: subtask.goal,
      agentName: subtask.agentName,
      delegatedScopes: subtask.delegatedScopes,
      knowledgeMode,
    });
    const toolsEnabled = workerSkills.some((scope) => scope !== TEAM_DISPATCH_ONLY_SKILL);
    const conversationWorkflowEnabled = Boolean(
      (team.config as TeamConfig).conversationWorkflowVersionId,
    );
    const replyWaitGuidance =
      conversationWorkflowEnabled && workerSkills.includes('whatsapp.contact_send')
        ? '- This Team uses a managed per-contact conversation workflow. Send exactly one initial message per validated lead asking the first question only.\n' +
          '- Do NOT send later branch messages, collect later answers, set auto-reply instructions, or delegate follow-up work. The conversation middleware owns every reply and next step.\n' +
          '- Message only contacts present in the authoritative Luna-Teams Result handback, using the full phone number including country code.\n'
        : workerSkills.includes('whatsapp.contact_send') &&
      workerSkills.includes('whatsapp.auto_reply') &&
      (goalRequestsOutreachPack(runObjective(run)) ||
        (Array.isArray((team.config as TeamConfig).waitSteps) &&
          ((team.config as TeamConfig).waitSteps?.length ?? 0) > 0))
        ? '- This stage queues WhatsApp outreach with the **full phone number including country code** from prior stage context — one number per lead, never reuse.\n' +
          '- REQUIRED tool sequence when the goal asks for greeting + brochure + poll (per lead, in order):\n' +
          '  1) whatsapp_send_message for the greeting only — do not put the word "brochure" or a poll question in this text\n' +
          '  2) whatsapp_send_document with brain_document_id (from brain context documentId=… or brain_find_documents query \"brochure\") — NEVER send a URL/link/placeholder text instead of the file\n' +
          '  3) whatsapp_send_poll with clear Yes/No (or Interest) options — NEVER replace the poll with a text asking them to type Interested/Not Interested\n' +
          '- If you skip the document or poll tools, Qlix will still attach the brochure file and a Yes/No poll before sending.\n' +
          '- Messages are NOT delivered yet; Qlix enters wait mode, you pick a duration, then they go out in that order and replies/votes are captured live. Do NOT create a responder sheet or deliver anything yet.\n' +
          '- Message only contacts present in the authoritative Luna-Teams Result handback. Never broaden or re-read the original source list.\n'
        : '';
    const filterGuidance =
      subtask.role === 'filtering' ||
      /\bfilter\b/i.test(subtask.goal) ||
      /\bqualified\s+lead/i.test(subtask.goal)
        ? '- When filtering by city/region, treat common aliases as the SAME place (Bangalore = Bengaluru, Bombay = Mumbai, Madras = Chennai, Calcutta = Kolkata, Poona = Pune). Keep EVERY row that matches the intent — never drop a lead only because of alternate spelling or casing.\n' +
          cityAliasHint(`${subtask.goal} ${runObjective(run)}`) +
          '- In findings, list every kept lead with **Name + full phone with country code + city** so the next stage can message all of them.\n'
        : '';

    const extractedReady = selectedInputs.some((input) => Boolean(input.extractedText?.trim()));
    const extractedGuidance = extractedReady
      ? '- Exact extracted content is already below. Do NOT call find_tools, call_tool, or any other tool to re-read the file. Filter from that text and return the JSON Result immediately.\n'
      : selectedInputs.length === 0
        ? '- This dispatch has no attached source file. Copy provenance.inputRefs and recordRefs from the prior Result handback. Do not invent a new source file.\n'
        : '';
    const workerPrompt = `You are completing one Luna-Teams dispatch. Stay inside this task.

Rules:
- Do only what this dispatch asks. Do NOT invent side work (CRM writes, outreach, research, scheduling, etc.) unless the dispatch explicitly requires it.
- Prefer tools that are necessary for this stage. Having a tool available is not permission to use it.
${toolsEnabled ? '' : '- No connector tools are enabled for this dispatch. Do not call find_tools, call_tool, or any permission/scope name. Return the JSON Result from the dispatch text only.\n'}
- Treat Luna-Teams Result handbacks as authoritative. Do not re-read or broaden their source data unless this dispatch explicitly asks you to.
- Put all handoff data in the returned JSON. Do not write it externally unless this dispatch explicitly requires it.
- Operational values must come from authoritative_input or validated Result handbacks. reference_asset and Brain are context only.
- Knowledge policy for this dispatch: ${knowledgeMode}. Do not use Brain unless it is "required".
${extractedGuidance}- Keep the Result JSON compact (summary <= 2 sentences). Do not include chain-of-thought in the Result.
- Return a JSON object:
{
  "summary": "<concise 2-3 sentence summary>",
  "findings": <structured JSON or detailed text needed by the next specialist>,
  "artifacts": [],
  "provenance": {
    "inputRefs": ["team-input:..."],
    "recordRefs": ["<input ref>:row:<1-based row>"],
    "knowledgeRefs": []
  }
}
${browserGuidance}${inputContext ? `\n${inputContext}\n` : ''}${priorContext ? `\n${priorContext}\n` : ''}
${filterGuidance}${replyWaitGuidance}
Dispatch: ${subtask.goal}`;

    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const requestedModel = (team.config as TeamConfig).defaultModel ?? null;
        const inferenceModel = teamRunInferenceModel(team, attempt, lastError);
        const attemptPrompt =
          attempt === 1
            ? workerPrompt
            : lastError && isTruncationLikeFailure(lastError.message) && toolsEnabled
              ? `Previous attempt was cut off while thinking. Call the required tools, then return the compact JSON Result.\n\n${workerPrompt}`
              : lastError && (lastError as { code?: string }).code === TEAM_STAGE_DID_NOT_ACT
                ? `Your previous attempt returned a Result describing work that never happened: ` +
                  `you called no tool, so nothing was sent. Call find_tools to get the exact tool ` +
                  `name, then call it once per record, and only then return the JSON Result.\n\n${workerPrompt}`
              : lastError && (lastError as { code?: string }).code === TEAM_RESULT_REJECTED
                ? `Your previous Result was returned but rejected by Qlix for this reason:\n` +
                  `${lastError.message}\n\n` +
                  `Fix exactly that and return the corrected JSON Result. Keep every other part of ` +
                  `your previous answer. Do not drop content to get past the check, and do not ` +
                  `invent provenance you cannot support.\n\n${workerPrompt}`
                : `Previous attempt returned no Result. Do not call find_tools, call_tool, or any other tool. Return only the JSON Result object.\n\n${workerPrompt}`;
        if (attempt > 1 && inferenceModel && inferenceModel !== requestedModel) {
          await this.emitEvent(
            run,
            team,
            subtask.agentId,
            'task_status_update',
            {
              message: `Retrying ${subtask.agentName} on ${inferenceModel.replace(/^openrouter\//, '')} — previous model ran out of output budget while thinking`,
            },
            emit,
          );
        }
        const { runId: agentRunId } = await this.bridge.enqueue({
          team,
          teamRun: run,
          agentId: subtask.agentId,
          userId: run.startedByUserId,
          role: 'worker',
          prompt: attemptPrompt,
          skills: workerSkills,
          a2aTaskId: a2aTask.id,
          dispatchId: subtask.subtaskId,
          useBrain,
          inferenceModel,
          reasoningEffort: teamRunReasoningEffort(team),
        });

        const outcome = await this.bridge.waitAndBridgeEvents({
          agentRunId,
          teamRun: run,
          team,
          agentId: subtask.agentId,
          timeoutMs,
          emit,
        });

        if (outcome.status !== 'success') {
          const current = await this.repo.findRun(run.id);
          if (current?.status === 'canceled' || outcome.status === 'canceled') {
            throw Object.assign(new Error('Run was canceled.'), { code: 'team_run_canceled' });
          }
          throw new Error(outcome.errorMessage ?? `Worker run ${outcome.status}`);
        }

        const raw = TeamAgentRunBridge.extractResultText(outcome.result);
        const handback = parseLunaTeamsHandback(raw);
        if (handback.truncated) {
          throw new Error('Worker Result JSON was cut off');
        }
        // A filter stage that kept "Bangalore" and dropped "Bengaluru" split one city in two.
        // The rows come back from the authoritative source here rather than from a retry —
        // the prompt already asks for alias-aware matching and small models still miss it.
        const repair =
          selectedInputs.length > 0
            ? repairCityAliasOmissions({ payload: handback.payload, inputs: selectedInputs })
            : { payload: handback.payload, restored: [] };
        if (repair.restored.length > 0) {
          await this.emitEvent(run, team, subtask.agentId, 'task_status_update', {
            message:
              `Also kept ${repair.restored
                .map((item) => `${item.label || `row ${item.row}`} (${item.city})`)
                .join(', ')} — same city, different spelling`,
            provenance: true,
          }, emit);
        }
        const handbackRecord =
          repair.payload && typeof repair.payload === 'object' && !Array.isArray(repair.payload)
            ? repair.payload as Record<string, unknown>
            : null;
        const summary = handback.summary;
        const findings = normalizeFindingsText(handbackRecord?.findings ?? repair.payload);
        let validatedResult: ReturnType<typeof validateLunaTeamsResult>;
        try {
          validatedResult = validateLunaTeamsResult({
            payload: repair.payload,
            dispatch: {
              inputRefs,
              allowedSources,
              knowledgeMode,
              outputContract,
              allowedScopes: subtask.allowedScopes,
              requirementIds: subtask.requirementIds ?? [],
            },
            run,
            priorHandbacks: completedPrior.map((result) => result.payload),
            toolUrls: outcome.toolUrls,
          });
        } catch (err) {
          // The worker answered; we rejected the answer. Marked so the retry can say why
          // instead of telling a worker that produced a full Result it produced none.
          throw Object.assign(err instanceof Error ? err : new Error(String(err)), {
            code: TEAM_RESULT_REJECTED,
          });
        }
        // A stage that holds a sending tool and never called one did not do its job, however
        // well it wrote the Result up. Completing here is worse than failing: the run reports
        // success, the pipeline moves on, and nothing was ever sent.
        const actingScopes = workerSkills.filter(isActingScope);
        if (
          actingScopes.length > 0 &&
          outcome.actingTools.size === 0 &&
          !isEmptyFindings(handbackFindings({ payload: validatedResult }).value)
        ) {
          throw Object.assign(
            new Error(
              `${subtask.agentName} finished without sending anything — it holds ` +
                `${actingScopes.join(', ')} but called no tool that acts on it`,
            ),
            { code: TEAM_STAGE_DID_NOT_ACT },
          );
        }
        if (validatedResult.provenance.recordRefs.length > 0) {
          await this.emitEvent(run, team, subtask.agentId, 'task_status_update', {
            message:
              `Result: ${validatedResult.provenance.recordRefs.length} matching record` +
              `${validatedResult.provenance.recordRefs.length === 1 ? '' : 's'} with source lineage`,
            provenance: true,
          }, emit);
        }
        await this.repo.completeMailboxDispatch(mailbox.id, {
          status: 'completed',
          payload: validatedResult,
          agentRunId,
        });

        const artifact: TeamRunArtifact = {
          id: `artifact_${subtask.subtaskId}_${Date.now()}`,
          type: 'text',
          name: `${subtask.agentName} — ${subtask.role} output`,
          content: findings,
          agentId: subtask.agentId,
          createdAt: new Date().toISOString(),
        };

        await this.repo.updateA2ATask(a2aTask.id, {
          status: 'completed',
          completedAt: new Date(),
          agentRunId,
          artifacts: [artifact],
          messages: [{ role: 'assistant', content: summary, timestampMs: Date.now() }],
        });

        await this.emitEvent(run, team, subtask.agentId, 'subtask_completed', {
          taskId: a2aTask.id,
          subtaskId: subtask.subtaskId,
          agentId: subtask.agentId,
          agentName: subtask.agentName,
          agentRunId,
          summary,
          status: 'completed',
          mailboxMessageId: mailbox.id,
        }, emit);

        await this.emitEvent(run, team, subtask.agentId, 'artifact_produced', { artifact }, emit);

        return {
          subtaskId: subtask.subtaskId,
          agentId: subtask.agentId,
          agentName: subtask.agentName,
          summary,
          findings,
          payload: validatedResult,
          mailboxMessageId: mailbox.id,
          artifacts: [artifact],
          status: 'completed',
        };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const current = await this.repo.findRun(run.id);
        if (current?.status === 'canceled' || (err as { code?: string }).code === 'team_run_canceled') {
          break;
        }
        if (attempt < maxAttempts) {
          console.warn(
            `[team-run] run=${run.id} stage="${subtask.agentName}" attempt ${attempt}/${maxAttempts} ` +
              `failed: ${lastError.message}`,
          );
          await this.emitEvent(
            run,
            team,
            subtask.agentId,
            'task_status_update',
            {
              message: `Retrying ${subtask.agentName} (${attempt}/${maxAttempts - 1})…`,
              retry: true,
              reason: lastError.message,
            },
            emit,
          );
        } else {
          console.warn(
            `[team-run] run=${run.id} stage="${subtask.agentName}" gave up after ${maxAttempts} ` +
              `attempt(s): ${lastError.message}`,
          );
        }
      }
    }

    const canceled = (await this.repo.findRun(run.id))?.status === 'canceled';
    if (canceled) {
      await this.repo.completeMailboxDispatch(mailbox.id, {
        status: 'canceled',
        payload: { error: 'Run was canceled.' },
        errorMessage: 'Run was canceled.',
      });
      return {
        subtaskId: subtask.subtaskId,
        agentId: subtask.agentId,
        agentName: subtask.agentName,
        summary: '',
        findings: '',
        artifacts: [],
        status: 'failed',
        errorMessage: 'Run was canceled.',
      };
    }

    const message = lastError?.message ?? 'Worker subtask failed';
    await this.repo.completeMailboxDispatch(mailbox.id, {
      status: 'failed',
      payload: { error: message },
      errorMessage: message,
    });
    await this.repo.updateA2ATask(a2aTask.id, {
      status: 'failed',
      errorMessage: message,
      completedAt: new Date(),
    });
    await this.emitEvent(run, team, subtask.agentId, 'task_status_update', {
      taskId: a2aTask.id,
      status: 'failed',
      error: message,
    }, emit);

    return {
      subtaskId: subtask.subtaskId,
      agentId: subtask.agentId,
      agentName: subtask.agentName,
      summary: '',
      findings: '',
      artifacts: [],
      status: 'failed',
      errorMessage: message,
    };
  }

  private async supervisorSynthesize(
    run: TeamRunDTO,
    team: TeamDTO,
    originalGoal: string,
    results: WorkerResult[],
    emit: RunEventEmitter,
    timeoutMs: number,
    maxAttempts: number,
  ): Promise<string> {
    const completedResults = results.filter((r) => r.status === 'completed');
    if (completedResults.length === 0) {
      throw new Error('All worker subtasks failed — cannot synthesize result');
    }

    const summariesText = completedResults
      .map((r, i) => `Worker ${i + 1} — ${r.agentName} (agent ${r.agentId}):\n${r.findings || r.summary}`)
      .join('\n\n---\n\n');

    const whatsappHint = goalRequestsWhatsAppDelivery(originalGoal)
      ? '\nThe user asked for WhatsApp delivery: keep the final answer concise, bullet-friendly, under 1500 characters.'
      : '';

    const taskPrompt = `You are the supervisor of agent team "${team.name}".
Synthesize worker results into a coherent final answer for the user.

Original goal: ${originalGoal}

Worker summaries:
${summariesText}

Provide the final synthesized result as plain text.${whatsappHint}`;

    try {
      return await this.runSupervisorLlm(run, team, taskPrompt, emit, timeoutMs, maxAttempts);
    } catch {
      return completedResults.map((r) => r.summary).join('\n\n');
    }
  }

  private async emitEvent(
    run: TeamRunDTO,
    team: TeamDTO,
    agentId: string | null,
    eventType: string,
    payload: unknown,
    emit: RunEventEmitter,
  ): Promise<void> {
    try {
      const event = await this.repo.appendEvent(
        run.id,
        team.id,
        agentId,
        eventType as Parameters<TeamsRepository['appendEvent']>[3],
        payload,
      );
      emit('event', event);
      void notifyTeamChannelProgress(
        run,
        team,
        eventType as Parameters<typeof notifyTeamChannelProgress>[2],
        (payload ?? {}) as Record<string, unknown>,
      );
    } catch (err) {
      console.warn('[TeamOrchestrator] failed to persist event:', err);
    }
  }

  /** Batch subtasks so no batch contains duplicate agentId (one queue per container). */
  private batchSubtasksAvoidingCollision(
    subtasks: SubtaskPlan[],
    maxParallel: number,
  ): SubtaskPlan[][] {
    const batches: SubtaskPlan[][] = [];
    let remaining = [...subtasks];

    while (remaining.length > 0) {
      const batch: SubtaskPlan[] = [];
      const usedAgents = new Set<string>();
      const nextRemaining: SubtaskPlan[] = [];

      for (const st of remaining) {
        if (batch.length < maxParallel && !usedAgents.has(st.agentId)) {
          batch.push(st);
          usedAgents.add(st.agentId);
        } else {
          nextRemaining.push(st);
        }
      }

      if (batch.length === 0 && nextRemaining.length > 0) {
        batch.push(nextRemaining.shift()!);
        batches.push(batch);
        remaining = nextRemaining;
      } else {
        batches.push(batch);
        remaining = nextRemaining;
      }
    }

    return batches;
  }
}
