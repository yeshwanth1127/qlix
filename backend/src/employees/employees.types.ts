import type { AgentDTO } from '../agents/agents.types.js';
import type { ConnectorProvider } from '../connectors/connectors.types.js';

export type EmployeeRoleSlug =
  | 'sales-executive'
  | 'accountant'
  | 'receptionist'
  | 'recruiter'
  | 'customer-support'
  | 'hr-manager';

export type EmployeeEngagementStatus = 'active' | 'suspended' | 'replaced' | 'archived';

export type PackReleaseStatus = 'preview' | 'beta' | 'ga' | 'deprecated';

export type PreflightReadiness = 'ready' | 'needs_connector' | 'needs_capability' | 'needs_knowledge';

export interface EmployeeOutcome {
  id: string;
  title: string;
  doneLooksLike: string;
  playbookId?: string;
  /** When false, outcome is unavailable until domain tools exist. */
  available: boolean;
  limitation?: string;
}

export interface EmployeePlaybook {
  id: string;
  title: string;
  steps: string[];
  stopConditions: string[];
  escalation: string;
}

export interface EmployeeKnowledgeRequirement {
  id: string;
  label: string;
  required: boolean;
}

export interface EmployeeMcpRequirement {
  serverSlug: string;
  tools: string[] | '*';
  ensureRegistered: boolean;
}

export interface PlatformSuggestion {
  platformId: string;
  reason: string;
}

export interface EmployeeRoleManifest {
  slug: EmployeeRoleSlug;
  version: string;
  status: PackReleaseStatus;
  label: string;
  mission: string;
  changelog: string;
  outcomes: EmployeeOutcome[];
  permissionScopes: string[];
  jitScopes: string[];
  runtime: 'cloud' | 'hybrid' | 'local';
  model: string;
  mcpRequirements: EmployeeMcpRequirement[];
  connectorsRequired: ConnectorProvider[];
  connectorsOptional: ConnectorProvider[];
  knowledgeRequirements: EmployeeKnowledgeRequirement[];
  playbooks: EmployeePlaybook[];
  platformSuggestions: PlatformSuggestion[];
  allowLimitedHire: boolean;
  /** Scope ids that must be buildable for full (non-limited) hire. */
  minimumCapabilityScopes: string[];
}

export interface EmployeeEngagementDTO {
  id: string;
  agentId: string;
  workspaceOrgId: string;
  hiredByUserId: string;
  roleSlug: EmployeeRoleSlug;
  packVersion: string;
  packHash: string;
  packSnapshot: EmployeeRoleManifest;
  configOverrides: Record<string, unknown>;
  status: EmployeeEngagementStatus;
  hiredAt: string;
  suspendedAt: string | null;
  terminatedAt: string | null;
  replacedById: string | null;
  agent: AgentDTO;
}

export interface RoleCatalogEntry {
  slug: EmployeeRoleSlug;
  version: string;
  status: PackReleaseStatus;
  label: string;
  mission: string;
  outcomes: EmployeeOutcome[];
  connectorsRequired: ConnectorProvider[];
  connectorsOptional: ConnectorProvider[];
  knowledgeRequirements: EmployeeKnowledgeRequirement[];
  platformSuggestions: PlatformSuggestion[];
  hireable: boolean;
  hireMode: 'full' | 'limited' | 'unavailable';
  limitationSummary?: string;
}

export interface PreflightResult {
  readiness: PreflightReadiness;
  roleSlug: EmployeeRoleSlug;
  packVersion: string;
  hireMode: 'full' | 'limited' | 'unavailable';
  resolvedScopes: string[];
  resolvedJitScopes: string[];
  resolvedRuntime: 'cloud' | 'hybrid' | 'local';
  connectorsRequired: ConnectorProvider[];
  connectorsConnected: ConnectorProvider[];
  connectorsMissing: ConnectorProvider[];
  missingCapabilityScopes: string[];
  missingKnowledge: EmployeeKnowledgeRequirement[];
  selectedPlatformIds: string[];
  soonPlatformIds: string[];
  messages: string[];
}
