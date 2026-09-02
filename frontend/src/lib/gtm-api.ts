const defaultBase = "http://localhost:4000";

function apiBase(): string {
  return (process.env.NEXT_PUBLIC_API_BASE_URL ?? defaultBase).replace(/\/$/, "");
}

export type GtmSetupStatus = "not_started" | "in_progress" | "calibrating" | "ready";

export interface GtmSetup {
  readonly version: 1;
  readonly operatingMode: "discovery_only";
  readonly setupStatus: GtmSetupStatus;
  readonly companyDescription: string;
  readonly idealCustomerProfile: string;
  readonly primaryOffer: string;
  readonly targetRegions: readonly string[];
  readonly buyerRolesAndWorkflows: string;
  readonly proofAndCaseStudies: string;
  readonly validityPolicy: string;
  readonly calibrationNotes: string;
  readonly knowledgeCollectionIds: readonly string[];
  readonly completedSteps: readonly string[];
  readonly confirmedFields: readonly string[];
  readonly updatedAt: string | null;
}

export interface GtmStatus {
  readonly plugin: {
    readonly id: "gtm";
    readonly lifecycleState: string;
    readonly enabledAt: string;
  };
  readonly operatingMode: "discovery_only";
  readonly setupStatus: GtmSetupStatus;
  readonly brainReady: boolean;
  readonly knowledgeCollectionCount: number;
  readonly pendingProposalCount: number;
  readonly externalWritesEnabled: false;
}

export interface GtmKnowledgeCollection {
  readonly purpose: string;
  readonly collectionId: string;
  readonly name: string;
  readonly description: string;
  readonly documentCount: number;
  readonly reviewedDocumentCount: number;
  readonly pendingReviewCount: number;
  readonly staleDocumentCount: number;
}

export interface GtmKnowledgeState {
  readonly brainReady: boolean;
  readonly collections: readonly GtmKnowledgeCollection[];
}

export interface GtmSetupProposalDiffEntry {
  readonly field: string;
  readonly before: string | readonly string[];
  readonly after: string | readonly string[];
}

export interface GtmSetupProposal {
  readonly id: string;
  readonly status: string;
  readonly rationale: string;
  readonly source: string;
  readonly patch: Record<string, unknown>;
  readonly diff: readonly GtmSetupProposalDiffEntry[];
  readonly createdAt: string;
  readonly resolvedAt: string | null;
}

export interface GtmQueryCitation {
  readonly collectionId: string;
  readonly collectionName: string;
  readonly documentId: string;
  readonly documentTitle: string;
  readonly chunkOrdinal: number;
  readonly excerpt: string;
}

export interface GtmQueryResponse {
  readonly answer: string;
  readonly citations: readonly GtmQueryCitation[];
  readonly setupProposal: GtmSetupProposal | null;
  readonly discoveryProposal: GtmDiscoveryProposal | null;
}

export type GtmHypothesisKind = "problem" | "segment" | "trigger" | "user" | "champion" | "buyer" | "value" | "offer" | "channel" | "price";
export type GtmEvidenceClass = "founder_provided" | "externally_verified" | "inferred" | "prospect_reported" | "experiment_observed" | "unknown";

export interface GtmIdeaContent {
  readonly idea: string;
  readonly problem: string;
  readonly solution: string;
  readonly audience: string;
  readonly outcome: string;
  readonly constraints: string;
}

export interface GtmDiscoveryProposal {
  readonly id: string;
  readonly kind: "idea" | "hypothesis";
  readonly status: string;
  readonly payload: Record<string, unknown>;
  readonly rationale: string;
  readonly source: string;
  readonly createdAt: string;
  readonly resolvedAt: string | null;
}

export type GtmDiscoveryPlanStatus = "generating" | "ready" | "failed";

export type GtmCrmMode = "undecided" | "external" | "qlix_twenty";
export type GtmChecklistStatus = "pending" | "done";

export interface GtmWorkspaceSetup {
  readonly crmMode: GtmCrmMode;
  readonly crmExternalProvider: "zoho" | null;
  readonly qlixCrmRequestedAt: string | null;
  readonly discoveryChecklist: Readonly<Record<string, GtmChecklistStatus>>;
  readonly setupCompletedAt: string | null;
}

export interface GtmAgentMatchReason {
  readonly code: string;
  readonly label: string;
}

export interface GtmAgentRecommendation {
  readonly roleSlug: string;
  readonly label: string;
  readonly mission: string;
  readonly rank: number;
  readonly tier: "primary" | "secondary";
  readonly score: number;
  readonly matchReasons: readonly GtmAgentMatchReason[];
  readonly suggestedPlatforms: readonly string[];
  readonly suggestedPlaybookIds: readonly string[];
  readonly reason: string;
}

export interface GtmRoadmapStep {
  readonly id: string;
  readonly title: string;
  readonly why: string;
  readonly effort: "small" | "medium";
}

export interface GtmTeamSlot {
  readonly slotId: "research" | "email" | "outreach" | "support";
  readonly slotLabel: string;
  readonly roleSlug: string;
  readonly roleLabel: string;
  readonly mission: string;
  readonly parallel: true;
  readonly matchReasons: readonly GtmAgentMatchReason[];
  readonly suggestedPlatforms: readonly string[];
  readonly suggestedPlaybookIds: readonly string[];
  readonly suggestedName: string;
}

export interface GtmTeamProgress {
  readonly hiredCount: number;
  readonly totalCount: number;
  readonly nextSlot: GtmTeamSlot | null;
  readonly allHired: boolean;
}

export type GtmWorkspaceNextAction =
  | "build_team"
  | "choose_crm"
  | "connect_zoho"
  | "review_roadmap"
  | "start_discovery"
  | "complete";

export interface GtmWorkspaceReadiness {
  readonly milestones: {
    readonly answersSaved: boolean;
    readonly planReady: boolean;
    readonly teamBuilt: boolean;
    readonly discoveryStarted: boolean;
  };
  readonly nextAction: GtmWorkspaceNextAction;
  readonly nextActionLabel: string;
  readonly checklistDoneCount: number;
  readonly checklistTotalCount: number;
}

export interface GtmDiscoveryWorkspace {
  readonly setup: GtmWorkspaceSetup;
  readonly plan: GtmDiscoveryPlan | null;
  readonly idea: GtmDiscoveryFoundation["idea"];
  readonly connectors: {
    readonly researchConnected: boolean;
    readonly zohoConnected: boolean;
    readonly connectedProviders: readonly string[];
  };
  readonly agentRecommendations: readonly GtmAgentRecommendation[];
  readonly suggestedTeam: readonly GtmTeamSlot[];
  readonly teamProgress: GtmTeamProgress;
  readonly roadmap: readonly GtmRoadmapStep[];
  readonly hiredRoleSlugs: readonly string[];
  readonly readiness: GtmWorkspaceReadiness;
}

export interface GtmSuggestedAgent {
  readonly roleSlug: string;
  readonly label: string;
  readonly reason: string;
  readonly tier?: "primary" | "secondary";
  readonly score?: number;
  readonly matchReasons?: readonly GtmAgentMatchReason[];
}

export interface GtmDiscoveryPlanContent {
  readonly schemaVersion: "gtm.discovery_plan.v1" | "gtm.discovery_plan.v2";
  readonly summary: string;
  readonly focus: {
    readonly audience: string;
    readonly reasons: readonly string[];
    readonly openQuestions: readonly string[];
  };
  readonly suggestedAgents: readonly GtmSuggestedAgent[];
  readonly tools: readonly {
    readonly capabilityId: "research" | "crm" | "email";
    readonly priority: "now" | "later" | "optional";
    readonly reason: string;
  }[];
  readonly planSteps: readonly {
    readonly title: string;
    readonly why: string;
    readonly effort: "small" | "medium";
  }[];
  readonly hypotheses: readonly {
    readonly kind: string;
    readonly statement: string;
  }[];
}

export interface GtmDiscoveryPlan {
  readonly id: string;
  readonly ideaVersion: number;
  readonly version: number;
  readonly status: GtmDiscoveryPlanStatus;
  readonly content: GtmDiscoveryPlanContent | null;
  readonly errorMessage: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface GtmDiscoveryFoundation {
  readonly idea: null | {
    readonly id: string;
    readonly version: number;
    readonly status: string;
    readonly content: GtmIdeaContent;
    readonly source: string;
    readonly createdAt: string;
  };
  readonly hypotheses: readonly {
    readonly id: string;
    readonly kind: GtmHypothesisKind;
    readonly status: string;
    readonly current: null | {
      readonly id: string;
      readonly version: number;
      readonly statement: string;
      readonly evidenceClass: GtmEvidenceClass;
      readonly evidenceCount: number;
      readonly createdAt: string;
    };
  }[];
  readonly proposals: readonly GtmDiscoveryProposal[];
}

type ApiError = { error?: { message?: string; code?: string } };

export async function getGtmDiscoveryFoundation(): Promise<
  { ok: true; foundation: GtmDiscoveryFoundation } | { ok: false; message: string }
> {
  const response = await fetch(`${apiBase()}/api/v1/gtm/discovery/foundation`, { credentials: "include" });
  const body = (await response.json().catch(() => null)) as (GtmDiscoveryFoundation & ApiError) | null;
  if (!response.ok || !body) return { ok: false, message: body?.error?.message ?? "Could not load discovery." };
  return { ok: true, foundation: body };
}

export async function createGtmDiscoveryProposal(body: {
  readonly kind: "idea" | "hypothesis";
  readonly rationale: string;
  readonly payload: Record<string, unknown>;
}): Promise<{ ok: true; proposal: GtmDiscoveryProposal } | { ok: false; message: string }> {
  const response = await fetch(`${apiBase()}/api/v1/gtm/discovery/proposals`, {
    method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const result = (await response.json().catch(() => null)) as ({ proposal?: GtmDiscoveryProposal } & ApiError) | null;
  if (!response.ok || !result?.proposal) return { ok: false, message: result?.error?.message ?? "Could not prepare this change." };
  return { ok: true, proposal: result.proposal };
}

export async function resolveGtmDiscoveryProposal(
  proposalId: string,
  decision: "confirm" | "reject",
): Promise<
  | { ok: true; foundation: GtmDiscoveryFoundation; plan: GtmDiscoveryPlan | null }
  | { ok: false; message: string }
> {
  const response = await fetch(`${apiBase()}/api/v1/gtm/discovery/proposals/${encodeURIComponent(proposalId)}/${decision}`, {
    method: "POST", credentials: "include",
  });
  const body = (await response.json().catch(() => null)) as
    ({ foundation?: GtmDiscoveryFoundation; plan?: GtmDiscoveryPlan | null } & ApiError) | null;
  if (!response.ok || !body?.foundation) return { ok: false, message: body?.error?.message ?? "Could not review this change." };
  return { ok: true, foundation: body.foundation, plan: body.plan ?? null };
}

export type GtmDiscoveryEntryView = "questions" | "workspace";

export interface GtmDiscoveryEntry {
  readonly view: GtmDiscoveryEntryView;
  readonly planStatus: GtmDiscoveryPlanStatus | null;
  readonly hasConfirmedIdea: boolean;
  readonly pendingIdeaReview: boolean;
}

export async function getGtmDiscoveryEntry(): Promise<
  | { ok: true; entry: GtmDiscoveryEntry }
  | { ok: false; message: string }
> {
  const response = await fetch(`${apiBase()}/api/v1/gtm/discovery/entry`, { credentials: "include" });
  const body = (await response.json().catch(() => null)) as (GtmDiscoveryEntry & ApiError) | null;
  if (!response.ok || !body) return { ok: false, message: body?.error?.message ?? "Could not load GTM entry." };
  return { ok: true, entry: body };
}

export async function getGtmDiscoveryWorkspace(): Promise<
  | { ok: true; workspace: GtmDiscoveryWorkspace }
  | { ok: false; message: string }
> {
  const response = await fetch(`${apiBase()}/api/v1/gtm/discovery/workspace`, { credentials: "include" });
  const body = (await response.json().catch(() => null)) as (GtmDiscoveryWorkspace & ApiError) | null;
  if (!response.ok || !body) return { ok: false, message: body?.error?.message ?? "Could not load your GTM workspace." };
  return { ok: true, workspace: body };
}

/** @deprecated Use getGtmDiscoveryWorkspace */
export async function getGtmDiscoveryPlan(): Promise<
  | {
    ok: true;
    plan: GtmDiscoveryPlan | null;
    idea: GtmDiscoveryFoundation["idea"];
  }
  | { ok: false; message: string }
> {
  const response = await fetch(`${apiBase()}/api/v1/gtm/discovery/plan`, { credentials: "include" });
  const body = (await response.json().catch(() => null)) as
    (GtmDiscoveryWorkspace & ApiError) | null;
  if (!response.ok || !body) return { ok: false, message: body?.error?.message ?? "Could not load your discovery plan." };
  return { ok: true, plan: body.plan ?? null, idea: body.idea ?? null };
}

export async function patchGtmDiscoveryWorkspace(body: {
  readonly crmMode?: GtmCrmMode;
  readonly crmExternalProvider?: "zoho" | null;
  readonly checklistStepKey?: string;
  readonly checklistStatus?: GtmChecklistStatus;
  readonly discoveryRoadmap?: readonly GtmRoadmapStep[];
}): Promise<{ ok: true; workspace: GtmDiscoveryWorkspace } | { ok: false; message: string }> {
  const response = await fetch(`${apiBase()}/api/v1/gtm/discovery/workspace`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = (await response.json().catch(() => null)) as (GtmDiscoveryWorkspace & ApiError) | null;
  if (!response.ok || !result) {
    return { ok: false, message: result?.error?.message ?? "Could not update your GTM workspace." };
  }
  return { ok: true, workspace: result };
}

export async function requestQlixCrm(): Promise<
  { ok: true; workspace: GtmDiscoveryWorkspace } | { ok: false; message: string }
> {
  const response = await fetch(`${apiBase()}/api/v1/gtm/discovery/crm/request-qlix`, {
    method: "POST",
    credentials: "include",
  });
  const result = (await response.json().catch(() => null)) as (GtmDiscoveryWorkspace & ApiError) | null;
  if (!response.ok || !result) {
    return { ok: false, message: result?.error?.message ?? "Could not request Qlix CRM." };
  }
  return { ok: true, workspace: result };
}

export async function regenerateGtmDiscoveryPlan(): Promise<
  { ok: true; plan: GtmDiscoveryPlan } | { ok: false; message: string }
> {
  const response = await fetch(`${apiBase()}/api/v1/gtm/discovery/plan/regenerate`, {
    method: "POST",
    credentials: "include",
  });
  const body = (await response.json().catch(() => null)) as ({ plan?: GtmDiscoveryPlan } & ApiError) | null;
  if (!response.ok || !body?.plan) {
    return { ok: false, message: body?.error?.message ?? "Could not regenerate your discovery plan." };
  }
  return { ok: true, plan: body.plan };
}

export async function addGtmHypothesisEvidence(
  hypothesisId: string,
  input: { readonly relationship: "supports" | "contradicts" | "qualifies" | "unknown"; readonly note: string },
): Promise<{ ok: true; foundation: GtmDiscoveryFoundation } | { ok: false; message: string }> {
  const response = await fetch(`${apiBase()}/api/v1/gtm/discovery/hypotheses/${encodeURIComponent(hypothesisId)}/evidence`, {
    method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...input, evidenceType: "founder_statement" }),
  });
  const body = (await response.json().catch(() => null)) as ({ foundation?: GtmDiscoveryFoundation } & ApiError) | null;
  if (!response.ok || !body?.foundation) return { ok: false, message: body?.error?.message ?? "Could not add this learning." };
  return { ok: true, foundation: body.foundation };
}

export async function reviewGtmHypothesis(
  hypothesisId: string,
  status: "active" | "supported" | "contradicted" | "validated" | "rejected",
): Promise<{ ok: true; foundation: GtmDiscoveryFoundation } | { ok: false; message: string }> {
  const response = await fetch(`${apiBase()}/api/v1/gtm/discovery/hypotheses/${encodeURIComponent(hypothesisId)}/review`, {
    method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
  });
  const body = (await response.json().catch(() => null)) as ({ foundation?: GtmDiscoveryFoundation } & ApiError) | null;
  if (!response.ok || !body?.foundation) return { ok: false, message: body?.error?.message ?? "Could not update this conclusion." };
  return { ok: true, foundation: body.foundation };
}

export async function getGtmStatus(): Promise<
  { ok: true; status: GtmStatus } | { ok: false; message: string; pluginInactive?: boolean }
> {
  const response = await fetch(`${apiBase()}/api/v1/gtm/status`, { credentials: "include" });
  const body = (await response.json().catch(() => null)) as (GtmStatus & ApiError) | null;
  if (!response.ok) {
    return {
      ok: false,
      message: body?.error?.message ?? "Could not load GTM status.",
      pluginInactive: body?.error?.code === "plugin_not_active",
    };
  }
  return { ok: true, status: body as GtmStatus };
}

export async function getGtmSetup(): Promise<
  { ok: true; setup: GtmSetup } | { ok: false; message: string }
> {
  const response = await fetch(`${apiBase()}/api/v1/gtm/setup`, { credentials: "include" });
  const body = (await response.json().catch(() => null)) as ({ setup?: GtmSetup } & ApiError) | null;
  if (!response.ok || !body?.setup) {
    return { ok: false, message: body?.error?.message ?? "Could not load GTM setup." };
  }
  return { ok: true, setup: body.setup };
}

export async function getGtmKnowledge(): Promise<
  { ok: true; knowledge: GtmKnowledgeState } | { ok: false; message: string }
> {
  const response = await fetch(`${apiBase()}/api/v1/gtm/knowledge`, { credentials: "include" });
  const body = (await response.json().catch(() => null)) as (GtmKnowledgeState & ApiError) | null;
  if (!response.ok || !body) {
    return { ok: false, message: body?.error?.message ?? "Could not load GTM knowledge." };
  }
  return { ok: true, knowledge: body };
}

export async function bootstrapGtmKnowledge(): Promise<
  { ok: true; knowledge: GtmKnowledgeState; setup: GtmSetup } | { ok: false; message: string; brainRequired?: boolean }
> {
  const response = await fetch(`${apiBase()}/api/v1/gtm/knowledge/bootstrap`, {
    method: "POST",
    credentials: "include",
  });
  const body = (await response.json().catch(() => null)) as
    ({ brainReady?: boolean; collections?: readonly GtmKnowledgeCollection[]; setup?: GtmSetup } & ApiError) | null;
  if (!response.ok || !body?.collections || !body.setup) {
    return {
      ok: false,
      message: body?.error?.message ?? "Could not initialize GTM knowledge.",
      brainRequired: body?.error?.code === "brain_required",
    };
  }
  return {
    ok: true,
    knowledge: { brainReady: body.brainReady === true, collections: body.collections },
    setup: body.setup,
  };
}

export async function updateGtmSetup(patch: Partial<Pick<
  GtmSetup,
  | "companyDescription"
  | "idealCustomerProfile"
  | "primaryOffer"
  | "targetRegions"
  | "buyerRolesAndWorkflows"
  | "proofAndCaseStudies"
  | "validityPolicy"
  | "calibrationNotes"
  | "knowledgeCollectionIds"
  | "completedSteps"
>>): Promise<{ ok: true; setup: GtmSetup } | { ok: false; message: string }> {
  const response = await fetch(`${apiBase()}/api/v1/gtm/setup`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const body = (await response.json().catch(() => null)) as ({ setup?: GtmSetup } & ApiError) | null;
  if (!response.ok || !body?.setup) {
    return { ok: false, message: body?.error?.message ?? "Could not save GTM setup." };
  }
  return { ok: true, setup: body.setup };
}

export async function getGtmSetupProposals(): Promise<
  { ok: true; proposals: readonly GtmSetupProposal[] } | { ok: false; message: string }
> {
  const response = await fetch(`${apiBase()}/api/v1/gtm/setup/proposals`, { credentials: "include" });
  const body = (await response.json().catch(() => null)) as ({ proposals?: readonly GtmSetupProposal[] } & ApiError) | null;
  if (!response.ok || !body?.proposals) {
    return { ok: false, message: body?.error?.message ?? "Could not load GTM proposals." };
  }
  return { ok: true, proposals: body.proposals };
}

export async function confirmGtmSetupProposal(proposalId: string): Promise<
  { ok: true; setup: GtmSetup; proposal: GtmSetupProposal } | { ok: false; message: string }
> {
  const response = await fetch(`${apiBase()}/api/v1/gtm/setup/proposals/${encodeURIComponent(proposalId)}/confirm`, {
    method: "POST",
    credentials: "include",
  });
  const body = (await response.json().catch(() => null)) as
    ({ setup?: GtmSetup; proposal?: GtmSetupProposal } & ApiError) | null;
  if (!response.ok || !body?.setup || !body.proposal) {
    return { ok: false, message: body?.error?.message ?? "Could not confirm proposal." };
  }
  return { ok: true, setup: body.setup, proposal: body.proposal };
}

export async function rejectGtmSetupProposal(proposalId: string): Promise<
  { ok: true; setup: GtmSetup; proposal: GtmSetupProposal } | { ok: false; message: string }
> {
  const response = await fetch(`${apiBase()}/api/v1/gtm/setup/proposals/${encodeURIComponent(proposalId)}/reject`, {
    method: "POST",
    credentials: "include",
  });
  const body = (await response.json().catch(() => null)) as
    ({ setup?: GtmSetup; proposal?: GtmSetupProposal } & ApiError) | null;
  if (!response.ok || !body?.setup || !body.proposal) {
    return { ok: false, message: body?.error?.message ?? "Could not reject proposal." };
  }
  return { ok: true, setup: body.setup, proposal: body.proposal };
}

export async function queryGtmExa(question: string): Promise<
  { ok: true; data: GtmQueryResponse } | { ok: false; message: string }
> {
  const response = await fetch(`${apiBase()}/api/v1/gtm/query`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
  });
  const body = (await response.json().catch(() => null)) as (GtmQueryResponse & ApiError) | null;
  if (!response.ok || !body?.answer) {
    return { ok: false, message: body?.error?.message ?? "GTM query failed." };
  }
  return {
    ok: true,
    data: {
      answer: body.answer,
      citations: body.citations ?? [],
      setupProposal: body.setupProposal ?? null,
      discoveryProposal: body.discoveryProposal ?? null,
    },
  };
}
