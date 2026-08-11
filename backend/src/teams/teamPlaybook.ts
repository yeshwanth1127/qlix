/**
 * Resolution of a team's deterministic stage-goal playbook.
 *
 * Specialized playbooks (e.g. lead_gen) have been removed; all teams use `none`.
 */
import type { PermissionScope } from '../agents/agents.types.js';
import type { TeamPlaybook } from './teams.types.js';

/**
 * Pick the playbook for a team being created.
 * Always `none` — specialized playbooks have been removed.
 */
export function detectPlaybookFromScopeSets(_scopeSets: PermissionScope[][]): TeamPlaybook {
  return 'none';
}
