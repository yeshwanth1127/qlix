import type { TeamRunArtifact, TeamRunCheckpoint } from '../teams/teams.types.js';
import type { ReplyInterestResult } from '../teams/replyInterestClassifier.js';
import {
  classifyReplyInterestByKeywords,
  shouldIncludeOnSheet,
} from '../teams/replyInterestClassifier.js';
import type { WaitTriggerInbound } from '../teams/waitTrigger.service.js';
import {
  appendLiveArtifactRow,
  buildWhatsAppReplyRow,
  createLiveArtifact,
  findLiveArtifact,
  liveArtifactPreviewPayload,
  upsertLiveArtifactList,
} from './liveArtifact.service.js';
import { inferLiveSheetColumnsFromGoal } from './liveSheetColumns.js';
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
): Promise<ReplyInterestResult> {
  const text = String(inbound.text ?? '');
  const byKeyword = classifyReplyInterestByKeywords(text);
  if (byKeyword) {
    return { jid: inbound.jid, text, ...byKeyword };
  }
  const { classifyReplyInterests } = await import('../teams/replyInterestClassifier.js');
  const [classified] = await classifyReplyInterests(
    [{ jid: inbound.jid, text }],
    { userGoal },
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
    return shouldIncludeOnSheet(classification.label);
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
          : await inferLiveSheetColumnsFromGoal(input.runGoal ?? '');
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
  const events: WaitInboundSideEffectResult['events'] = [];

  if (effects.length === 0) {
    return {
      checkpoint: input.checkpoint,
      artifacts: [],
      events,
      classifications: [],
    };
  }

  const classification = await classifyInboundReply(input.inbound, input.userGoal);
  let liveArtifacts = [...(input.checkpoint.liveArtifacts ?? [])];
  const artifacts: TeamRunArtifact[] = [];

  for (const effect of effects) {
    const included = passesSideEffectFilter(effect, classification);
    if (!included) continue;

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

    const row = buildWhatsAppReplyRow({
      columns: artifact.columns,
      jid: input.inbound.jid,
      text: input.inbound.text,
      pushName: input.inbound.pushName,
      interest: classification.label,
      contactHint: lookupWaitContact(input.checkpoint, input.inbound.jid) ?? undefined,
    });

    try {
      const updated = await appendLiveArtifactRow({ artifact, sideEffect: effect, row });
      liveArtifacts = upsertLiveArtifactList(liveArtifacts, updated);
      artifacts.push(toRunArtifact(updated, input.supervisorAgentId));
      events.push({
        type: 'live_artifact_updated',
        payload: {
          ...liveArtifactPreviewPayload(updated),
          jid: input.inbound.jid,
          interest: classification.label,
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

  return {
    checkpoint: { ...input.checkpoint, liveArtifacts },
    artifacts,
    events,
    classifications: [classification],
  };
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
