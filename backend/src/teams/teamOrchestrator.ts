import type { PermissionScope } from '../agents/agents.types.js';
import type { TeamConfig, TeamDTO, TeamMemberDTO, TeamRunArtifact, TeamRunDTO } from './teams.types.js';
import { TeamsRepository } from './teams.repository.js';
import { TeamAgentRunBridge } from './teamAgentRunBridge.js';
import { deliverTextToWorkspaceWhatsApp } from '../whatsapp/whatsappChannel.service.js';
import { goalRequestsWhatsAppDelivery } from '../whatsapp/whatsappDeliveryIntent.js';
import {
  buildLeadGenStageGoal,
  extractCampaignIdFromText,
  findLeadReviewCheckpoint,
  listAgentRunTools,
  memberLeadGenStage,
  normalizeFindingsText,
  parseLeadGenRequest,
  type LeadReviewCheckpoint,
  validateLeadGenWorkerOutput,
} from '../leads/leadGenPipelineGoals.js';
import { LeadsRepository } from '../leads/leads.repository.js';
import { resolveTeamPlaybook } from './teamPlaybook.js';
import {
  clearNotifierState,
  notifyTeamChannelProgress,
  teamRunShouldReplyWhatsApp,
} from './teamChannelNotifier.js';

export interface SubtaskPlan {
  subtaskId: string;
  agentId: string;
  agentName: string;
  agentDescription?: string;
  role: string;
  goal: string;
  delegatedScopes: PermissionScope[];
  /**
   * Pipeline stage this subtask belongs to. Subtasks sharing a stage run concurrently;
   * stages themselves run in ascending order, each seeing every earlier stage's output.
   */
  stageOrder: number;
}

interface WorkerResult {
  subtaskId: string;
  agentId: string;
  agentName: string;
  summary: string;
  findings: string;
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
  private readonly leadsRepo = new LeadsRepository();

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
      await this.emitEvent(run, team, null, 'run_started', { runId: run.id, goal: run.goal }, emit);

      const members = team.members ?? [];
      if (members.length === 0) {
        throw new Error('Team has no worker members');
      }

      // Members come from the repository already sorted by stageOrder (ascending).
      const orderedMembers = [...members].sort((a, b) => {
        if (a.stageOrder !== b.stageOrder) return a.stageOrder - b.stageOrder;
        return a.addedAt.localeCompare(b.addedAt);
      });

      // Decide planning strategy:
      // - autoSequence=true  → supervisor LLM decomposes (free-form, can reorder).
      // - autoSequence=false → deterministic plan: workers run in the team-defined
      //   stageOrder, supervisor never sees a "pick the order" prompt.
      const useDeterministicOrder = !config.autoSequence;

      // Lead-gen teams always use deterministic stage goals (scrape → enrich → outreach)
      // so workers never all receive the full user goal from supervisor decomposition.
      // The playbook is stored on the team (backfilled once for legacy teams) rather than
      // re-inferred from member scopes, so rewiring a team can no longer silently change
      // which stage goals its workers receive.
      const isLeadGen = (await resolveTeamPlaybook(team, orderedMembers, this.repo)) === 'lead_gen';

      const planMessage =
        isLeadGen
          ? `Lead-gen pipeline (${orderedMembers.map((m) => m.agent?.name ?? m.agentId).join(' → ')})`
          : useDeterministicOrder
            ? `Pipeline order locked by team stages (${orderedMembers.map((m) => m.agent?.name ?? m.agentId).join(' → ')})`
            : 'Supervisor is planning subtasks…';
      await this.emitEvent(run, team, supervisorId, 'task_status_update', { message: planMessage }, emit);

      const plan = isLeadGen
        ? this.buildLeadGenPipelinePlan(run, orderedMembers)
        : useDeterministicOrder
          ? this.buildStaticPipelinePlan(run, orderedMembers)
          : await this.supervisorDecompose(
              run,
              team,
              orderedMembers,
              emit,
              timeoutMs,
              maxAttempts,
              !!config.pipelineMode,
            );

      await this.repo.appendSupervisorTrace(run.id, {
        step: 'decompose',
        subtasks: plan.map((s) => ({ subtaskId: s.subtaskId, agentId: s.agentId, goal: s.goal })),
        timestampMs: Date.now(),
      });
      await this.emitEvent(run, team, supervisorId, 'supervisor_step', {
        step: 'decompose',
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

          const failed = groupResults.find((r) => r.status === 'failed');
          if (failed) {
            await this.abortPipelineRun(run, team, supervisorId, failed, emit);
            return;
          }

          const remainingSubtasks = stageGroups.slice(groupIndex + 1).flat();
          const groupHasEnrich = group.some((s) => {
            const m = orderedMembers.find((x) => x.agentId === s.agentId);
            return m != null && memberLeadGenStage(m) === 'enrich';
          });
          const hasOutreachRemaining = remainingSubtasks.some((s) => {
            const m = orderedMembers.find((x) => x.agentId === s.agentId);
            return m != null && memberLeadGenStage(m) === 'outreach';
          });
          if (isLeadGen && groupHasEnrich && hasOutreachRemaining) {
            let campaignId =
              groupResults
                .map((r) => extractCampaignIdFromText(r.findings))
                .find((id): id is string => Boolean(id)) ??
              results
                .map((r) => extractCampaignIdFromText(r.findings))
                .find((id): id is string => Boolean(id));
            if (!campaignId && run.startedAt) {
              campaignId =
                (await this.leadsRepo.findLatestCampaignSince(
                  team.orgId,
                  new Date(run.startedAt),
                )) ?? undefined;
            }
            if (campaignId) {
              await this.pauseForLeadReview(
                run,
                team,
                supervisorId,
                {
                  campaignId,
                  completedResults: results,
                  remainingSubtasks,
                },
                emit,
              );
              emit('paused', { status: 'paused', campaignId, teamRunId: run.id });
              return;
            }
          }
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
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[TeamOrchestrator] run ${run.id} failed:`, message);
      await this.repo.updateRunStatus(run.id, 'failed', { errorMessage: message });
      await this.emitEvent(run, team, null, 'run_failed', { error: message }, emit);
      if (teamRunShouldReplyWhatsApp(run, run.goal)) {
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

  /** Resume a paused lead-gen run after the user approves outreach in the UI. */
  async resumeFromCheckpoint(
    run: TeamRunDTO,
    team: TeamDTO,
    emit: RunEventEmitter,
  ): Promise<void> {
    const config = team.config as TeamConfig;
    const supervisorId = team.supervisorAgentId!;
    const timeoutMs = config.subtaskTimeoutMs ?? 120_000;
    const maxAttempts = config.retryPolicy === 'twice' ? 3 : config.retryPolicy === 'once' ? 2 : 1;

    const checkpoint = findLeadReviewCheckpoint(run.supervisorTrace);
    if (!checkpoint) {
      throw new Error('No lead review checkpoint found for this run');
    }

    const completedResults: WorkerResult[] = checkpoint.completedResults.map((r) => ({
      ...r,
      artifacts: [],
    }));

    try {
      await this.repo.updateRunStatus(run.id, 'running');
      await this.emitEvent(run, team, supervisorId, 'task_status_update', {
        message: 'Outreach approved — continuing pipeline…',
      }, emit);

      // Checkpoints written before stage grouping have no stageOrder — fall back to one
      // stage per subtask, which reproduces the original strictly-sequential resume.
      const remainingPlan: SubtaskPlan[] = checkpoint.remainingSubtasks.map((s, i) => ({
        ...s,
        stageOrder: s.stageOrder ?? i + 1,
      }));
      const stageGroups = groupSubtasksByStage(remainingPlan);

      for (let groupIndex = 0; groupIndex < stageGroups.length; groupIndex++) {
        const group = stageGroups[groupIndex]!;
        const current = await this.repo.findRun(run.id);
        if (current?.status === 'canceled') {
          emit('complete', { status: 'canceled', synthesis: 'Run was canceled.' });
          return;
        }
        const groupResults = await this.executeStage(
          run,
          team,
          group,
          emit,
          timeoutMs,
          maxAttempts,
          [...completedResults],
          config.maxParallelWorkers,
          groupIndex + 1,
          stageGroups.length,
        );
        completedResults.push(...groupResults);

        const failed = groupResults.find((r) => r.status === 'failed');
        if (failed) {
          await this.abortPipelineRun(run, team, supervisorId, failed, emit);
          return;
        }
      }

      await this.finalizeSuccessfulRun(
        run,
        team,
        supervisorId,
        completedResults,
        emit,
        timeoutMs,
        maxAttempts,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[TeamOrchestrator] resume run ${run.id} failed:`, message);
      await this.repo.updateRunStatus(run.id, 'failed', { errorMessage: message });
      await this.emitEvent(run, team, null, 'run_failed', { error: message }, emit);
      clearNotifierState(run.id);
      emit('error', { message });
    }
  }

  /** Re-run the enrich worker to visit lead websites and find emails before outreach approval. */
  async retryLeadEnrichment(
    run: TeamRunDTO,
    team: TeamDTO,
    emit: RunEventEmitter,
  ): Promise<void> {
    const config = team.config as TeamConfig;
    const supervisorId = team.supervisorAgentId!;
    const timeoutMs = config.subtaskTimeoutMs ?? 120_000;
    const maxAttempts = config.retryPolicy === 'twice' ? 3 : config.retryPolicy === 'once' ? 2 : 1;

    const checkpoint = findLeadReviewCheckpoint(run.supervisorTrace);
    if (!checkpoint) {
      throw new Error('No lead review checkpoint found for this run');
    }

    const enrichMember = (team.members ?? []).find((m) => memberLeadGenStage(m) === 'enrich');
    if (!enrichMember) {
      throw new Error('Team has no email enricher worker');
    }

    const scrapeResults = checkpoint.completedResults.filter((r) => {
      const member = team.members?.find((m) => m.agentId === r.agentId);
      return member != null && memberLeadGenStage(member) === 'scrape';
    });

    try {
      await this.leadsRepo.resetBrowserEnrichmentAttempts(team.orgId, checkpoint.campaignId);
      await this.repo.updateRunStatus(run.id, 'running');
      await this.emitEvent(run, team, supervisorId, 'task_status_update', {
        message: 'Retrying email enrichment — visiting lead websites with browser tools…',
      }, emit);

      const parsed = parseLeadGenRequest(run.goal);
      const baseGoal = buildLeadGenStageGoal('enrich', run.goal, parsed, checkpoint.campaignId);
      const description = (enrichMember.agent as { description?: string } | undefined)?.description;
      const descPart = description?.trim() ? `\n\nRole description: ${description.trim()}` : '';
      const retryGoal = [
        baseGoal,
        descPart,
        '',
        'RETRY PASS: A previous enrichment pass did not find enough emails.',
        'Call list_leads with includeAll=true and visit EVERY lead in needsBrowserEnrichment.',
        'Use browser_ab_open on each website, check /contact and footer mailto links, then update_lead_email or record_lead_enrichment(no_email_on_site).',
        'Do not invent emails. Do not skip leads that were marked no_email_on_site before — try again.',
      ].filter(Boolean).join('\n');

      const enrichSubtask: SubtaskPlan = {
        subtaskId: `leadgen_retry_enrich_${Date.now()}`,
        agentId: enrichMember.agentId,
        agentName: enrichMember.agent?.name ?? enrichMember.agentId,
        agentDescription: description,
        role: enrichMember.role,
        goal: retryGoal,
        delegatedScopes: enrichMember.delegatedScopes,
        stageOrder: enrichMember.stageOrder,
      };

      const priorResults: WorkerResult[] = scrapeResults.map((r) => ({
        ...r,
        artifacts: [],
      }));

      const result = await this.executeWorkerTask(
        run,
        team,
        enrichSubtask,
        emit,
        timeoutMs,
        maxAttempts,
        priorResults,
      );

      const completedResults =
        result.status === 'completed'
          ? [...priorResults, result]
          : priorResults;

      if (result.status === 'failed') {
        await this.emitEvent(run, team, supervisorId, 'task_status_update', {
          message: 'Enrichment retry did not complete — review leads and retry or approve outreach.',
          error: result.errorMessage,
        }, emit);
      }

      await this.pauseForLeadReview(
        run,
        team,
        supervisorId,
        {
          campaignId: checkpoint.campaignId,
          completedResults,
          remainingSubtasks: checkpoint.remainingSubtasks,
        },
        emit,
      );
      emit('paused', { status: 'paused', campaignId: checkpoint.campaignId, teamRunId: run.id });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[TeamOrchestrator] retry enrichment run ${run.id} failed:`, message);
      await this.repo.updateRunStatus(run.id, 'paused');
      await this.emitEvent(run, team, supervisorId, 'task_status_update', {
        message: 'Enrichment retry failed — review leads and try again.',
        error: message,
      }, emit);
      emit('error', { message });
    }
  }

  private async finalizeSuccessfulRun(
    run: TeamRunDTO,
    team: TeamDTO,
    supervisorId: string,
    results: WorkerResult[],
    emit: RunEventEmitter,
    timeoutMs: number,
    maxAttempts: number,
  ): Promise<void> {
    await this.emitEvent(
      run,
      team,
      supervisorId,
      'task_status_update',
      { message: 'Supervisor is synthesizing results…' },
      emit,
    );
    const synthesis = await this.supervisorSynthesize(
      run,
      team,
      run.goal,
      results,
      emit,
      timeoutMs,
      maxAttempts,
    );

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

    await this.repo.updateRunStatus(run.id, 'completed', {
      completedAt: new Date(),
      result: { synthesis, artifactCount: allArtifacts.length },
    });

    if (teamRunShouldReplyWhatsApp(run, run.goal)) {
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

  private async pauseForLeadReview(
    run: TeamRunDTO,
    team: TeamDTO,
    supervisorId: string,
    params: {
      campaignId: string;
      completedResults: WorkerResult[];
      // Persisted shape, not SubtaskPlan: checkpoints written before stage grouping
      // existed have no stageOrder, and resume has to keep reading those.
      remainingSubtasks: LeadReviewCheckpoint['remainingSubtasks'];
    },
    emit: RunEventEmitter,
  ): Promise<void> {
    const checkpoint: LeadReviewCheckpoint = {
      step: 'lead_review_checkpoint',
      campaignId: params.campaignId,
      completedResults: params.completedResults.map((r) => ({
        subtaskId: r.subtaskId,
        agentId: r.agentId,
        agentName: r.agentName,
        summary: r.summary,
        findings: r.findings,
        status: r.status,
      })),
      remainingSubtasks: params.remainingSubtasks.map((s) => ({
        subtaskId: s.subtaskId,
        agentId: s.agentId,
        agentName: s.agentName,
        role: s.role,
        goal: s.goal,
        delegatedScopes: s.delegatedScopes,
        stageOrder: s.stageOrder,
      })),
      timestampMs: Date.now(),
    };

    await this.repo.appendSupervisorTrace(run.id, checkpoint);
    await this.repo.updateRunLeadReview(run.id, {
      status: 'paused',
      leadCampaignId: params.campaignId,
    });
    await this.emitEvent(run, team, supervisorId, 'lead_review_required', {
      campaignId: params.campaignId,
      teamRunId: run.id,
      message: 'Review scraped leads and approve outreach to continue.',
    }, emit);
    await this.emitEvent(run, team, supervisorId, 'task_status_update', {
      message: 'Waiting for you to review leads and approve outreach…',
    }, emit);
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
          inferenceModel: (team.config as TeamConfig).defaultModel ?? null,
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
      return {
        subtaskId: `stage_${stage}_${m.agentId.slice(0, 8)}`,
        agentId: m.agentId,
        agentName: m.agent?.name ?? m.agentId,
        agentDescription: description,
        role: m.role,
        goal: `Stage ${stage} of ${total} in the "${this.pipelineName(orderedMembers)}" pipeline.${descPart}\n\nUser goal: ${run.goal}`,
        delegatedScopes: m.delegatedScopes,
        stageOrder: m.stageOrder,
      };
    });
  }

  private buildLeadGenPipelinePlan(
    run: TeamRunDTO,
    orderedMembers: TeamMemberDTO[],
  ): SubtaskPlan[] {
    const parsed = parseLeadGenRequest(run.goal);
    return orderedMembers.map((m, i) => {
      const stageNum = i + 1;
      const lgStage = memberLeadGenStage(m);
      const description = (m.agent as { description?: string } | undefined)?.description;
      const stageGoal =
        lgStage != null
          ? buildLeadGenStageGoal(lgStage, run.goal, parsed, null)
          : `Stage ${stageNum}: contribute to lead generation.\n\nUser goal: ${run.goal}`;
      const descPart = description?.trim() ? `\n\nRole description: ${description.trim()}` : '';
      return {
        subtaskId: `leadgen_${stageNum}_${m.agentId.slice(0, 8)}`,
        agentId: m.agentId,
        agentName: m.agent?.name ?? m.agentId,
        agentDescription: description,
        role: m.role,
        goal: `${stageGoal}${descPart}`,
        delegatedScopes: m.delegatedScopes,
        stageOrder: m.stageOrder,
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
      ? `\n- This is a PIPELINE team: assign tasks in the order they should execute (output of step N feeds into step N+1)\n- Preserve natural dependency order (e.g. lead generation → research → compliance → reporting)`
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

User goal: ${run.goal}`;

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
          return {
            subtaskId: s.subtaskId ?? `st_${i}_${Date.now()}`,
            agentId: member.agentId,
            agentName: member.agent?.name ?? member.agentId,
            agentDescription: (member.agent as any)?.description as string | undefined,
            role: member.role,
            goal: s.goal ?? run.goal,
            delegatedScopes: member.delegatedScopes,
            // A supervisor-decomposed plan carries no stage semantics — the LLM chose an
            // order, not a set of concurrent layers. Give each subtask its own stage so
            // decomposed runs stay strictly sequential, as they were before grouping.
            stageOrder: i + 1,
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
      goal: run.goal,
      delegatedScopes: m.delegatedScopes,
      stageOrder: i + 1,
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

    await this.repo.updateA2ATask(a2aTask.id, { status: 'working', startedAt: new Date() });
    await this.emitEvent(run, team, subtask.agentId, 'task_delegated', {
      taskId: a2aTask.id,
      subtaskId: subtask.subtaskId,
      agentId: subtask.agentId,
      agentName: subtask.agentName,
      goal: subtask.goal,
    }, emit);

    await this.emitEvent(
      run,
      team,
      subtask.agentId,
      'task_status_update',
      {
        message: `${subtask.agentName} (${subtask.role}) is working on: ${subtask.goal.slice(0, 80)}…`,
        taskId: a2aTask.id,
      },
      emit,
    );

    const completedPrior = priorResults.filter((r) => r.status === 'completed');
    const priorContext =
      completedPrior.length > 0
        ? `\n\n--- Context from prior pipeline stages ---\n${completedPrior
            .map((r) => `[${r.agentName}]:\n${r.findings}`)
            .join('\n\n')}\n--- End prior context ---\n`
        : '';

    const member = team.members?.find((m) => m.agentId === subtask.agentId);
    const leadGenStage = member ? memberLeadGenStage(member) : null;
    const agentHasBrain = member?.agent?.permissionScopes?.includes('brain.query') ?? false;
    const useBrain =
      subtask.delegatedScopes.includes('brain.query') || agentHasBrain;

    const needsBrowser =
      leadGenStage === 'enrich' ||
      /\bhttps?:\/\//i.test(subtask.goal) ||
      /\b(browse|navigate|scrape|visit|open\s+url|website|web\s+page)\b/i.test(subtask.goal);
    const browserGuidance = needsBrowser
      ? '- Browser tools are allowed if needed; use at most 3 browser actions per lead, then return your JSON answer.\n'
      : leadGenStage === 'scrape'
        ? '- Do NOT use browser tools — call gmb_search_leads MCP tool only.\n'
        : '- Do NOT use browser tools for this subtask unless explicitly required.\n';

    const leadScrapeGuidance =
      subtask.delegatedScopes.includes('mcp.qlix-leads.gmb_search_leads')
        ? `- Lead scraping: call mcp__qlix-leads__gmb_search_leads as your FIRST action (not think). Use searchQuery, location, maxResults from the subtask. Then list_leads includeAll=true. Return campaignId and leads in JSON.\n`
        : '';

    const leadEnrichGuidance =
      leadGenStage === 'enrich'
        ? `- Email enrichment: call list_leads FIRST. For each lead with a website, browser_ab_open then update_lead_email or record_lead_enrichment. Never call update_lead_email without a real leadId from list_leads.\n`
        : '';

    const leadOutreachGuidance =
      leadGenStage === 'outreach'
        ? `- Outreach: call list_leads for contactable leads only. email_send requires verified emails and campaignId + leadId metadata from prior stages.\n`
        : '';

    const workerPrompt =
      leadGenStage != null
        ? `${subtask.goal}
${browserGuidance}${leadScrapeGuidance}${leadEnrichGuidance}${leadOutreachGuidance}${priorContext}
When finished, reply with JSON:
{
  "summary": "<concise 2-3 sentence summary>",
  "findings": "<detailed output, include campaignId and lead data>",
  "artifacts": []
}`
        : `Complete this subtask thoroughly. Return a JSON object:
{
  "summary": "<concise 2-3 sentence summary>",
  "findings": "<detailed output, include all relevant data>",
  "artifacts": []
}
${browserGuidance}${leadScrapeGuidance}${priorContext}
Subtask: ${subtask.goal}`;

    const workerSkills: PermissionScope[] =
      leadGenStage === 'outreach'
        ? [...new Set([...subtask.delegatedScopes, 'mcp.qlix-leads.list_leads' as PermissionScope])]
        : subtask.delegatedScopes;

    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const { runId: agentRunId } = await this.bridge.enqueue({
          team,
          teamRun: run,
          agentId: subtask.agentId,
          userId: run.startedByUserId,
          role: 'worker',
          prompt: workerPrompt,
          skills: workerSkills,
          a2aTaskId: a2aTask.id,
          useBrain,
          inferenceModel: (team.config as TeamConfig).defaultModel ?? null,
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
          throw new Error(outcome.errorMessage ?? `Worker run ${outcome.status}`);
        }

        const raw = TeamAgentRunBridge.extractResultText(outcome.result);
        let summary = raw.slice(0, 200);
        let findings = raw;
        try {
          const jsonMatch = raw.match(/\{[\s\S]*\}/);
          const parsed = JSON.parse(jsonMatch?.[0] ?? '{}') as {
            summary?: string;
            findings?: unknown;
          };
          summary = typeof parsed.summary === 'string' ? parsed.summary : summary;
          findings = normalizeFindingsText(parsed.findings ?? findings);
        } catch {
          // use raw text
        }

        if (leadGenStage != null) {
          const toolsUsed = await listAgentRunTools(agentRunId);
          const validationError = validateLeadGenWorkerOutput({
            stage: leadGenStage,
            toolsUsed,
            findings,
            pipelineMode: !!(team.config as TeamConfig).pipelineMode,
          });
          if (validationError) {
            throw new Error(validationError);
          }
        }

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
        }, emit);

        await this.emitEvent(run, team, subtask.agentId, 'artifact_produced', { artifact }, emit);

        return {
          subtaskId: subtask.subtaskId,
          agentId: subtask.agentId,
          agentName: subtask.agentName,
          summary,
          findings,
          artifacts: [artifact],
          status: 'completed',
        };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < maxAttempts) {
          await this.emitEvent(
            run,
            team,
            subtask.agentId,
            'task_status_update',
            { message: `Retrying ${subtask.agentName} (${attempt}/${maxAttempts - 1})…` },
            emit,
          );
        }
      }
    }

    const message = lastError?.message ?? 'Worker subtask failed';
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
