import type { PermissionScope } from './agents.types.js';
import type { StageChannel, StageKind } from '../teams/stageKind.js';

export interface NLAgentSpec {
  name: string;
  description: string;
  permissionScopes: PermissionScope[];
  /** Subset of permissionScopes that require approval on every invocation. */
  jitScopes: PermissionScope[];
  runtime: 'cloud' | 'hybrid' | 'local';
  model: string;
  llmMode: 'proxy' | 'direct';
  localInferenceMode: 'local_llm' | 'cloud_api' | null;
  rationale: string;
}

export interface NLWorkerSpec extends NLAgentSpec {
  role: string;
  stageOrder: number;
  /** Named job type — scopes come from this, not from the full user paragraph. */
  stageKind?: StageKind;
  /** Extra jobs this same agent also performs (e.g. act + wait + deliver). */
  alsoKinds?: StageKind[];
  /** Outside-world channels for act / wait / deliver. */
  channels?: StageChannel[];
}

export interface NLTeamSpec {
  name: string;
  description: string;
  supervisor: NLAgentSpec;
  workers: NLWorkerSpec[];
  config: {
    maxParallelWorkers: number;
    subtaskTimeoutMs: number;
    retryPolicy: 'none' | 'once' | 'twice';
  };
}

export type AgentCreationPlan =
  | { type: 'single'; agent: NLAgentSpec; rationale: string }
  | { type: 'team'; team: NLTeamSpec; rationale: string };
