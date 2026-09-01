export const BUILDER_PHASES = [
  'discovering',
  'ready',
  'planning',
  'reviewing',
  'creating',
  'completed',
  'archived',
] as const;

export type BuilderPhase = (typeof BUILDER_PHASES)[number];

export const REQUIREMENT_CATEGORIES = [
  'objective',
  'user',
  'trigger',
  'input',
  'workflow',
  'output',
  'integration',
  'constraint',
  'approval',
  'success_criterion',
  'example',
  'assumption',
] as const;

export type RequirementCategory = (typeof REQUIREMENT_CATEGORIES)[number];

export interface RequirementFactView {
  key: string;
  category: RequirementCategory;
  value: unknown;
  confidence: number;
  sourceMessageId: string;
}

export interface BuilderRequirementsState {
  facts: RequirementFactView[];
  unresolved: Array<{ key: string; question: string; blocking: boolean }>;
  assumptions: string[];
}

export interface BuilderReadinessState {
  score: number;
  canPlan: boolean;
  blocking: string[];
}

export interface DiscoveryOperation {
  type: 'set' | 'remove';
  key: string;
  category: RequirementCategory;
  value?: unknown;
  confidence: number;
}

export interface DiscoveryOutcome {
  reply: string;
  operations: DiscoveryOperation[];
  unresolved: Array<{ key: string; question: string; blocking: boolean }>;
  assumptions: string[];
  readiness: BuilderReadinessState;
  action: 'continue' | 'ready' | 'plan';
  summary: string;
  usage: {
    inputTokens: number | null;
    cachedInputTokens: number | null;
    outputTokens: number | null;
  };
  model: string;
  provider: string | null;
  latencyMs: number;
}
