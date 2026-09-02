import type { ReasoningEffort } from '../llm/routing/reasoningBudget.js';

/** Built-in SDK / connector scopes (static catalog). */
export type BuiltinPermissionScope =
  | 'web.read'
  | 'web.click'
  | 'web.transaction'
  | 'web.research'
  /** Cloud/hybrid sandbox PDF + spreadsheet generation (create_report_pdf / create_xlsx). */
  | 'files.create'
  | 'system.file_read'
  | 'system.file_write'
  | 'system.gui_control'
  | 'finance.spend_50'
  | 'finance.spend_100'
  | 'brain.query'
  | 'brain.knowledge_read'
  | 'email.read'
  | 'email.send'
  | 'drive.read'
  | 'drive.write'
  | 'docs.read'
  | 'docs.write'
  | 'sheets.read'
  | 'sheets.write'
  | 'slides.read'
  | 'slides.write'
  | 'forms.read'
  | 'forms.write'
  | 'calendar.read'
  | 'calendar.write'
  | 'meet.manage'
  | 'youtube.read'
  | 'youtube.publish'
  | 'whatsapp.send'
  | 'whatsapp.read'
  | 'whatsapp.contact_send'
  | 'whatsapp.auto_reply'
  /** Parallel conversation threads (Outreach plugin). `whatsapp.auto_reply` is a compatibility alias. */
  | 'conversation'
  | 'social.read'
  | 'social.publish'
  | 'crm.read'
  | 'crm.write'
  | 'crm.delete'
  | 'slack.read'
  | 'slack.send'
  | 'notion.read'
  | 'notion.write'
  | 'assessment.session.get'
  | 'assessment.evidence.search'
  | 'assessment.evidence.read'
  | 'assessment.artifact.read'
  | 'assessment.snapshot.read'
  | 'assessment.snapshot.compare'
  | 'assessment.framework.read'
  | 'assessment.record'
  | 'assessment.review.ask'
  | 'assessment.review.request_demonstration'
  | 'assessment.report.create';

/** Per-org MCP tool scopes (`mcp.<server-slug>.<tool-name>`). */
export type McpPermissionScope = `mcp.${string}`;

/**
 * Per-target permission to hand work to another agent (`agent.ask.<agentId>`).
 * A capability grant like any other, so it flows through JIT, audit, and delegation unchanged.
 */
export type AgentAskPermissionScope = `agent.ask.${string}`;

export type PermissionScope =
  | BuiltinPermissionScope
  | McpPermissionScope
  | AgentAskPermissionScope;

// Derived from the canonical catalog (single source of truth). Re-exported here so
// existing importers keep working.
export { ALL_PERMISSION_SCOPES } from './scopeCatalog.js';

export type AgentRuntime = 'cloud' | 'local' | 'hybrid';

/** Where inference runs when `runtime` is `local`; omitted when `runtime` is `cloud`. */
export type LocalInferenceMode = 'local_llm' | 'cloud_api';

/** Where LLM calls go: straight to local engine (`direct`) or via Qlix backend (`proxy`). */
export type LlmMode = 'direct' | 'proxy';

export type LlmProvider = 'exora' | 'openrouter';

export type { ReasoningEffort };

/** `standard` | `org_brain` — enforced uniquely per org in brain agent service. */
export type AgentKind = 'standard' | 'org_brain';

export interface CreateAgentInput {
  name: string;
  description?: string | null;
  permissionScopes: PermissionScope[];
  jitScopes: PermissionScope[];
  runtime: AgentRuntime;
  model: string;
  /** Required when `runtime` is `local`; must be null when `runtime` is `cloud`. */
  localInferenceMode: LocalInferenceMode | null;
  /** `direct` = local engine / OpenRouter; `proxy` = Qlix backend. cloud+direct is rejected. */
  llmMode: LlmMode;
  llmProvider?: LlmProvider;
  orgId: string | null;
}

export interface AgentDTO {
  id: string;
  userId: string;
  orgId: string | null;
  did: string;
  publicKey: string;
  name: string;
  description?: string | null;
  status: string;
  runtime: AgentRuntime;
  model: string;
  localInferenceMode: LocalInferenceMode | null;
  llmMode: LlmMode;
  llmProvider: LlmProvider;
  /**
   * How much of the completion budget a thinking model may spend reasoning.
   * Null means Qlix picks a small share, which keeps room for the visible answer.
   */
  reasoningEffort: ReasoningEffort | null;
  permissionScopes: PermissionScope[];
  jitScopes: PermissionScope[];
  alwaysScopes: PermissionScope[];
  webauthnCredentialId: string | null;
  keypairDeliveredAt: string | null;
  lastConnectedAt: string | null;
  lastActive: string | null;
  createdAt: string;
  cloudProvisioningStatus: string | null;
  cloudRunnerId: string | null;
  cloudLastHeartbeatAt: string | null;
  cloudProvisioningError: string | null;
  /** Hybrid runner: last heartbeat from the user's local daemon. Null for cloud/local agents. */
  hybridLastHeartbeatAt: string | null;
  agentKind: AgentKind;
  /** OpenClaw-style tool visibility: minimal | coding | full */
  toolProfile: 'minimal' | 'coding' | 'full';
}

export interface AgentWithKeypairDTO extends AgentDTO {
  privateKey: string;
}
