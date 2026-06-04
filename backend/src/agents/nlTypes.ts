import type { PermissionScope } from './agents.types.js';

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
