/**
 * Resolution of a team's deterministic stage-goal playbook.
 *
 * Previously the orchestrator called `isLeadGenPipelineTeam(members)` on every run,
 * inferring the playbook from delegated scopes. That made execution strategy an
 * invisible, unstable property: adding a member or narrowing a delegated scope could
 * flip a team between the lead-gen stage goals and the generic pipeline goals with no
 * record of it, so the pipeline the user saw no longer described the one that ran.
 *
 * The playbook now lives in `Team.config.playbook`, written once and never inferred
 * again. Teams created before the field existed are detected on their next run and
 * the result is persisted, so each team is sniffed at most once in its lifetime.
 */
import type { PermissionScope } from '../agents/agents.types.js';
import { isLeadGenScopeShape } from '../leads/leadGenPipelineGoals.js';
import type { TeamsRepository } from './teams.repository.js';
import type { TeamConfig, TeamDTO, TeamMemberDTO, TeamPlaybook } from './teams.types.js';

const VALID_PLAYBOOKS: readonly TeamPlaybook[] = ['lead_gen', 'none'];

function isPlaybook(value: unknown): value is TeamPlaybook {
  return typeof value === 'string' && (VALID_PLAYBOOKS as readonly string[]).includes(value);
}

/**
 * Pick the playbook for a team being created, from the scope sets its agents will hold.
 * Called at creation time so the value is explicit from the team's first run onward.
 */
export function detectPlaybookFromScopeSets(scopeSets: PermissionScope[][]): TeamPlaybook {
  return isLeadGenScopeShape(scopeSets) ? 'lead_gen' : 'none';
}

/**
 * Read the team's playbook, backfilling it once for teams that predate the field.
 *
 * Returns the stored value when present. Otherwise detects from current members,
 * persists the result, and returns it — so a legacy team's behaviour is pinned to
 * whatever it was already doing rather than drifting on the next edit.
 */
export async function resolveTeamPlaybook(
  team: TeamDTO,
  members: TeamMemberDTO[],
  repo: TeamsRepository,
): Promise<TeamPlaybook> {
  const stored = (team.config as TeamConfig).playbook;
  if (isPlaybook(stored)) return stored;

  const detected = detectPlaybookFromScopeSets(members.map((m) => m.delegatedScopes ?? []));
  try {
    await repo.updateConfig(team.id, { playbook: detected });
    console.info(
      `[teamPlaybook] backfilled playbook="${detected}" for legacy team ${team.id} (${team.name})`,
    );
  } catch (err) {
    // A failed backfill must not fail the run — we still use the detected value for
    // this run and will try again on the next one.
    console.warn(`[teamPlaybook] failed to persist playbook for team ${team.id}:`, err);
  }
  return detected;
}
