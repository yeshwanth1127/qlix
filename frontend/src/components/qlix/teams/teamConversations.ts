import type { TeamRunDTO } from "@/lib/teams-api";

export interface TeamConversation {
  rootId: string;
  root: TeamRunDTO;
  latest: TeamRunDTO;
  runs: TeamRunDTO[];
}

export function conversationRootId(
  run: TeamRunDTO,
  byId: Map<string, TeamRunDTO>,
): string {
  let current = run;
  const seen = new Set<string>();
  while (current.continuesRunId && !seen.has(current.id)) {
    seen.add(current.id);
    const prior = byId.get(current.continuesRunId);
    if (!prior) break;
    current = prior;
  }
  return current.id;
}

export function conversationRunsFor(
  runs: TeamRunDTO[],
  runId: string,
): TeamRunDTO[] {
  const byId = new Map(runs.map((run) => [run.id, run]));
  const target = byId.get(runId);
  if (!target) return [];
  const rootId = conversationRootId(target, byId);
  return runs
    .filter((run) => conversationRootId(run, byId) === rootId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function conversationTitle(goal: string): string {
  const marker = "\n\n---\nAttached files";
  const idx = goal.indexOf(marker);
  const text = (idx >= 0 ? goal.slice(0, idx) : goal).trim() || "New chat";
  return text.split("\n")[0]!.slice(0, 72);
}

export function groupTeamConversations(runs: TeamRunDTO[]): TeamConversation[] {
  const byId = new Map(runs.map((run) => [run.id, run]));
  const groups = new Map<string, TeamRunDTO[]>();
  for (const run of runs) {
    const rootId = conversationRootId(run, byId);
    const list = groups.get(rootId) ?? [];
    list.push(run);
    groups.set(rootId, list);
  }
  return [...groups.entries()]
    .map(([rootId, groupRuns]) => {
      const sorted = [...groupRuns].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      return {
        rootId,
        root: sorted[0]!,
        latest: sorted[sorted.length - 1]!,
        runs: sorted,
      };
    })
    .sort((a, b) => b.latest.createdAt.localeCompare(a.latest.createdAt));
}
