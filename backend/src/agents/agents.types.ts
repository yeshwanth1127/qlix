export type PermissionScope =
  | 'web.read'
  | 'web.click'
  | 'web.transaction'
  | 'system.file_read'
  | 'system.file_write'
  | 'system.gui_control'
  | 'finance.spend_50'
  | 'finance.spend_100'
  | 'brain.query'
  | 'brain.knowledge_read'
  | 'email.read'
  | 'email.send';

export const ALL_PERMISSION_SCOPES: PermissionScope[] = [
  'web.read',
  'web.click',
  'web.transaction',
  'system.file_read',
  'system.file_write',
  'system.gui_control',
  'finance.spend_50',
  'finance.spend_100',
  'brain.query',
  'brain.knowledge_read',
  'email.read',
  'email.send',
];

export type AgentRuntime = 'cloud' | 'local' | 'hybrid';

/** Where inference runs when `runtime` is `local`; omitted when `runtime` is `cloud`. */
export type LocalInferenceMode = 'local_llm' | 'cloud_api';

/** Where LLM calls go: straight to local engine (`direct`) or via Qlix backend (`proxy`). */
export type LlmMode = 'direct' | 'proxy';

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
}

export interface AgentWithKeypairDTO extends AgentDTO {
  privateKey: string;
}
