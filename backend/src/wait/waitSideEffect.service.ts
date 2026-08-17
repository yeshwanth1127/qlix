import type { TeamRunArtifact, TeamRunCheckpoint } from '../teams/teams.types.js';
import type { ReplyInterestResult } from '../teams/replyInterestClassifier.js';
import { classifyReplyInterestByKeywords } from '../teams/replyInterestClassifier.js';
import type { WaitTriggerInbound } from '../teams/waitTrigger.service.js';
import { TeamsRepository } from '../teams/teams.repository.js';
import {
  buildReplyRow,
  createLiveArtifact,
  findLiveArtifact,
  liveArtifactPreviewPayload,
  rowContactJid,
  upsertLiveArtifactList,
  upsertLiveArtifactRow,
} from './liveArtifact.service.js';
import { withRunCheckpointLock } from './runCheckpointLock.js';
import {
  customLiveSheetColumns,
  inferLiveSheetColumnsFromGoal,
} from './liveSheetColumns.js';
import { extractReplyFields } from './replyFieldExtraction.js';
import {
  DEFAULT_REPLY_INCLUSION,
  normalizeReplyInclusion,
  replyIncluded,
} from './replyInclusion.js';
import { lookupWaitContact } from './waitContacts.js';
import {
  getActiveWaitStep,
  liveArtifactSideEffects,
  resolveContactAck,
} from './waitPolicy.js';
import type {
  LiveArtifactState,
  WaitPolicySnapshot,
  WaitSideEffect,
} from './waitPolicy.types.js';
import { deliverSandboxFileToWorkspaceWhatsApp } from '../whatsapp/whatsappChannel.service.js';

export type WaitSideEffectInitResult = {
  checkpoint: TeamRunCheckpoint;
  artifacts: TeamRunArtifact[];
  liveArtifacts: LiveArtifactState[];
};

export type WaitInboundSideEffectResult = {
  checkpoint: TeamRunCheckpoint;
  artifacts: TeamRunArtifact[];
  events: Array<{
    type: 'live_artifact_updated';
    payload: {
      artifactId: string;
      sideEffectId: string;
      url: string;
      rowCount: number;
      jid: string;
      interest: string;
      included: boolean;
    };
  }>;
  classifications: ReplyInterestResult[];
};

async function classifyInboundReply(
  inbound: WaitTriggerInbound,
  userGoal?: string | null,
  model?: string | null,
): Promise<ReplyInterestResult> {
  const text = String(inbound.text ?? '');
  const byKeyword = classifyReplyInterestByKeywords(text);
  if (byKeyword) {
    return { jid: inbound.jid, text, ...byKeyword };
  }
  const { classifyReplyInterests } = await import('../teams/replyInterestClassifier.js');
  const [classified] = await classifyReplyInterests(
    [{ jid: inbound.jid, text }],
    { userGoal, model },
  );
  return (
    classified ?? {
      jid: inbound.jid,
      text,
      label: 'unclear',
      reason: 'classifier unavailable; default include',
      method: 'default',
    }
  );
}

function passesSideEffectFilter(
  effect: WaitSideEffect,
  classification: ReplyInterestResult,
): boolean {
  if (!effect.filter) return true;
  if (effect.filter.classifier === 'reply_interest') {
    const include = normalizeReplyInclusion(effect.filter.include) ?? DEFAULT_REPLY_INCLUSION;
    return replyIncluded(classification.label, include);
  }
  return true;
}

function toRunArtifact(
  live: LiveArtifactState,
  agentId: string | null,
): TeamRunArtifact {
  return {
    id: live.id,
    type: 'file',
    name: live.fileName,
    content: {
      url: live.url,
      sandboxId: live.sandboxId,
      format: live.format,
      rowCount: live.rowCount,
      sideEffectId: live.sideEffectId,
      columns: live.columns,
      rows: live.rows,
    },
    agentId: agentId ?? '',
    createdAt: live.updatedAt,
  };
}

/** Initialize live artifacts declared on the active wait step when a run enters wait. */
export async function initializeWaitSideEffects(input: {
  checkpoint: TeamRunCheckpoint;
  waitPolicy: WaitPolicySnapshot;
  runId: string;
  teamName: string;
  supervisorAgentId: string | null;
  runGoal?: string | null;
}): Promise<WaitSideEffectInitResult> {
  const step = getActiveWaitStep(input.waitPolicy);
  const effects = liveArtifactSideEffects(step);
  let liveArtifacts = [...(input.checkpoint.liveArtifacts ?? [])];
  const artifacts: TeamRunArtifact[] = [];

  for (const effect of effects) {
    if (findLiveArtifact(liveArtifacts, effect.id)) continue;
    try {
      const legacyPreset =
        effect.columns?.includes('JID') &&
        effect.columns?.includes('Phone') &&
        effect.columns?.includes('Name');
      const columns =
        effect.columns?.length && !legacyPreset
          ? effect.columns
          : await inferLiveSheetColumnsFromGoal(
              input.runGoal ?? '',
              input.checkpoint.inferenceModel,
            );
      const created = await createLiveArtifact({
        sideEffect: { ...effect, columns },
        runId: input.runId,
        teamName: input.teamName,
        runGoal: input.runGoal,
      });
      liveArtifacts = upsertLiveArtifactList(liveArtifacts, created);
      artifacts.push(toRunArtifact(created, input.supervisorAgentId));
    } catch (err) {
      console.warn(
        '[wait-side-effect] live artifact init failed:',
        err instanceof Error ? err.message : err,
      );
    }
  }

  return {
    checkpoint: { ...input.checkpoint, liveArtifacts, waitPolicySnapshot: input.waitPolicy },
    artifacts,
    liveArtifacts,
  };
}

type PreparedLiveSheetRow = {
  effect: WaitSideEffect;
  row: ReturnType<typeof buildReplyRow>;
};

/** Apply configured side effects for one inbound WhatsApp reply. */
export async function applyWaitInboundSideEffects(input: {
  checkpoint: TeamRunCheckpoint;
  inbound: WaitTriggerInbound;
  runId: string;
  userGoal?: string | null;
  supervisorAgentId: string | null;
}): Promise<WaitInboundSideEffectResult> {
  const waitPolicy = input.checkpoint.waitPolicySnapshot;
  const step = getActiveWaitStep(waitPolicy);
  const effects = liveArtifactSideEffects(step);
  const empty: WaitInboundSideEffectResult = {
    checkpoint: input.checkpoint,
    artifacts: [],
    events: [],
    classifications: [],
  };

  if (effects.length === 0) return empty;

  // Model work stays parallel across contacts. Only the sheet write is serialized.
  const runModel = input.checkpoint.inferenceModel;
  const classification = await classifyInboundReply(input.inbound, input.userGoal, runModel);
  const prepared: PreparedLiveSheetRow[] = [];

  for (const effect of effects) {
    if (!passesSideEffectFilter(effect, classification)) continue;

    const snapshot = findLiveArtifact(input.checkpoint.liveArtifacts, effect.id);
    const columns = snapshot?.columns?.length
      ? snapshot.columns
      : effect.columns?.length
        ? effect.columns
        : ['Name', 'Phone', 'Reply', 'Interest', 'Replied at'];
    const knownRow =
      snapshot?.rows.find((existing) => rowContactJid(existing) === input.inbound.jid) ?? null;
    const extracted = await extractReplyFields({
      columns: customLiveSheetColumns(columns),
      text: input.inbound.text,
      goal: input.userGoal,
      known: knownRow ?? undefined,
      model: runModel,
    });

    prepared.push({
      effect,
      row: buildReplyRow({
        columns,
        jid: input.inbound.jid,
        text: input.inbound.text,
        pushName: input.inbound.pushName,
        interest: classification.label,
        contactHint: lookupWaitContact(input.checkpoint, input.inbound.jid) ?? undefined,
        extracted,
      }),
    });
  }

  if (prepared.length === 0) {
    return { ...empty, classifications: [classification] };
  }

  return commitPreparedLiveSheetRows({
    runId: input.runId,
    fallbackCheckpoint: input.checkpoint,
    classification,
    prepared,
    userGoal: input.userGoal,
    supervisorAgentId: input.supervisorAgentId,
  });
}

/**
 * Re-read the paused run, merge this contact's row into the latest sheet, rematerialize,
 * and persist. Serialized per run so parallel inbound replies cannot clobber each other.
 */
async function commitPreparedLiveSheetRows(input: {
  runId: string;
  fallbackCheckpoint: TeamRunCheckpoint;
  classification: ReplyInterestResult;
  prepared: PreparedLiveSheetRow[];
  userGoal?: string | null;
  supervisorAgentId: string | null;
}): Promise<WaitInboundSideEffectResult> {
  return withRunCheckpointLock(input.runId, async () => {
    const repo = new TeamsRepository();
    const run = await repo.findRun(input.runId);
    const latest =
      run?.status === 'paused'
        ? ((run.checkpointJson ?? null) as TeamRunCheckpoint | null)
        : null;
    const checkpoint = latest ?? input.fallbackCheckpoint;
    let liveArtifacts = [...(checkpoint.liveArtifacts ?? [])];
    const artifacts: TeamRunArtifact[] = [];
    const events: WaitInboundSideEffectResult['events'] = [];

    for (const { effect, row } of input.prepared) {
      let artifact = findLiveArtifact(liveArtifacts, effect.id);
      if (!artifact) {
        try {
          artifact = await createLiveArtifact({
            sideEffect: effect,
            runId: input.runId,
            teamName: effect.title,
            runGoal: input.userGoal,
          });
          liveArtifacts = upsertLiveArtifactList(liveArtifacts, artifact);
        } catch (err) {
          console.warn(
            '[wait-side-effect] lazy live artifact create failed:',
            err instanceof Error ? err.message : err,
          );
          continue;
        }
      }

      try {
        const updated = await upsertLiveArtifactRow({ artifact, sideEffect: effect, row });
        liveArtifacts = upsertLiveArtifactList(liveArtifacts, updated);
        artifacts.push(toRunArtifact(updated, input.supervisorAgentId));
        events.push({
          type: 'live_artifact_updated',
          payload: {
            ...liveArtifactPreviewPayload(updated),
            jid: rowContactJid(row) ?? input.classification.jid,
            interest: input.classification.label,
            included: true,
          },
        });
      } catch (err) {
        console.warn(
          '[wait-side-effect] live artifact append failed:',
          err instanceof Error ? err.message : err,
        );
      }
    }

    const nextCheckpoint: TeamRunCheckpoint = { ...checkpoint, liveArtifacts };
    if (run?.status === 'paused') {
      await repo.updateRunStatus(run.id, 'paused', { checkpointJson: nextCheckpoint });
      for (const artifact of artifacts) {
        await repo.upsertArtifactById(run.id, artifact);
      }
    }

    return {
      checkpoint: nextCheckpoint,
      artifacts,
      events,
      classifications: [input.classification],
    };
  });
}

export function resolveWaitContactAck(
  checkpoint: TeamRunCheckpoint | null | undefined,
): 'fixed' | 'none' | 'auto_reply' {
  return resolveContactAck(getActiveWaitStep(checkpoint?.waitPolicySnapshot));
}

export function liveArtifactsForResume(checkpoint: TeamRunCheckpoint | null | undefined): LiveArtifactState[] {
  return checkpoint?.liveArtifacts ?? [];
}

export type WaitResumeDelivery = {
  sideEffectId: string;
  channel: string;
  artifactId: string;
  sent: boolean;
  reason?: string;
};

/** Execute adapter-owned deliveries declared for the generic on-resume boundary. */
export async function deliverWaitResumeSideEffects(input: {
  checkpoint: TeamRunCheckpoint;
  orgId: string;
}): Promise<WaitResumeDelivery[]> {
  const step = getActiveWaitStep(input.checkpoint.waitPolicySnapshot);
  if (!step) return [];
  const artifacts = input.checkpoint.liveArtifacts ?? [];
  const deliveries: WaitResumeDelivery[] = [];

  for (const effect of step.sideEffects) {
    if (effect.deliver?.when !== 'on_resume') continue;
    const artifact = findLiveArtifact(artifacts, effect.id);
    if (!artifact || artifact.rowCount === 0) continue;
    if (effect.deliver.channel === 'whatsapp') {
      const delivery = await deliverSandboxFileToWorkspaceWhatsApp(input.orgId, {
        sandboxId: artifact.sandboxId,
        fileName: artifact.fileName,
      });
      deliveries.push({
        sideEffectId: effect.id,
        channel: effect.deliver.channel,
        artifactId: artifact.id,
        ...delivery,
      });
    }
  }
  return deliveries;
}
