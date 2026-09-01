/** Phase 0 success-quality rates. These are measurement guardrails, not enforcement. */

export const TERMINAL_RUN_STATUSES = ['completed', 'failed', 'canceled'] as const;
export const FAILED_RUN_STATUSES = ['failed', 'canceled'] as const;

export type QualityRate = {
  passed: number;
  total: number;
  rate: number;
};

export type SuccessQuality = {
  completion: QualityRate;
  contractPass: QualityRate;
  artifactValidity: QualityRate;
  userRetry: QualityRate;
};

export function qualityRate(passed: number, total: number): QualityRate {
  const safeTotal = Math.max(0, total);
  const safePassed = Math.max(0, passed);
  return {
    passed: safePassed,
    total: safeTotal,
    rate: safeTotal > 0 ? Math.min(1, safePassed / safeTotal) : 1,
  };
}

export function isValidTeamArtifact(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const artifact = value as Record<string, unknown>;
  const type = artifact.type;
  const content = artifact.content;
  const hasContent = content != null && !(typeof content === 'string' && content.trim().length === 0);
  return (
    typeof artifact.id === 'string' &&
    artifact.id.length > 0 &&
    (type === 'text' || type === 'json' || type === 'file') &&
    typeof artifact.name === 'string' &&
    artifact.name.trim().length > 0 &&
    hasContent &&
    typeof artifact.agentId === 'string' &&
    artifact.agentId.length > 0
  );
}

export function completionFromStatuses(statuses: string[]): QualityRate {
  const terminal = statuses.filter((status) => (TERMINAL_RUN_STATUSES as readonly string[]).includes(status));
  const completed = terminal.filter((status) => status === 'completed').length;
  return qualityRate(completed, terminal.length);
}

export function contractPassFromMailbox(statuses: string[]): QualityRate {
  const checked = statuses.filter((status) => status !== 'pending');
  const passed = checked.filter((status) => status === 'completed').length;
  return qualityRate(passed, checked.length);
}

export function artifactValidityFromLists(lists: unknown[]): QualityRate {
  const artifacts = lists.flatMap((list) => (Array.isArray(list) ? list : []));
  const valid = artifacts.filter((item) => isValidTeamArtifact(item)).length;
  return qualityRate(valid, artifacts.length);
}

export function userRetryFromRuns(
  runs: Array<{
    conversationId: string;
    createdAt: string | Date;
    status: string;
    teamRunId?: string | null;
    invocationKind?: string | null;
    continuesRunId?: string | null;
  }>,
): QualityRate {
  const followUps = runs.filter((run) => Boolean(run.continuesRunId)).length;
  const userRuns = runs.filter((run) => {
    if (run.continuesRunId) return true;
    if (run.teamRunId) return false;
    return run.invocationKind !== 'subagent' && run.invocationKind !== 'team_worker';
  });
  const byConversation = new Map<string, typeof userRuns>();
  for (const run of userRuns) {
    if (run.continuesRunId) continue;
    const list = byConversation.get(run.conversationId) ?? [];
    list.push(run);
    byConversation.set(run.conversationId, list);
  }
  let conversationRetries = 0;
  for (const list of byConversation.values()) {
    list.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    for (let index = 1; index < list.length; index += 1) {
      const previous = list[index - 1];
      if ((FAILED_RUN_STATUSES as readonly string[]).includes(previous.status)) {
        conversationRetries += 1;
      }
    }
  }
  const started = userRuns.length;
  const retried = followUps + conversationRetries;
  return {
    passed: retried,
    total: started,
    rate: started > 0 ? Math.min(1, retried / started) : 0,
  };
}

export function summarizeSuccessQuality(input: {
  runStatuses: string[];
  mailboxStatuses: string[];
  artifactLists: unknown[];
  retryRuns: Array<{
    conversationId: string;
    createdAt: string | Date;
    status: string;
    teamRunId?: string | null;
    invocationKind?: string | null;
    continuesRunId?: string | null;
  }>;
}): SuccessQuality {
  return {
    completion: completionFromStatuses(input.runStatuses),
    contractPass: contractPassFromMailbox(input.mailboxStatuses),
    artifactValidity: artifactValidityFromLists(input.artifactLists),
    userRetry: userRetryFromRuns(input.retryRuns),
  };
}
