import type { Prisma } from '@prisma/client';

export const GTM_PLUGIN_ID = 'gtm';

export type GtmOperatingMode = 'discovery_only';
export type GtmSetupStatus = 'not_started' | 'in_progress' | 'calibrating' | 'ready';
export type GtmCrmMode = 'undecided' | 'external' | 'qlix_twenty';
export type GtmCrmExternalProvider = 'zoho' | null;
export type GtmChecklistStatus = 'pending' | 'done';

export interface GtmRoadmapStep {
  id: string;
  title: string;
  why: string;
  effort: 'small' | 'medium';
}

export interface GtmSetupConfig {
  version: 1;
  operatingMode: GtmOperatingMode;
  setupStatus: GtmSetupStatus;
  companyDescription: string;
  idealCustomerProfile: string;
  primaryOffer: string;
  targetRegions: string[];
  buyerRolesAndWorkflows: string;
  proofAndCaseStudies: string;
  validityPolicy: string;
  calibrationNotes: string;
  knowledgeCollectionIds: string[];
  completedSteps: string[];
  /** Fields confirmed via proposal workflow or explicit operator confirmation. */
  confirmedFields: string[];
  crmMode: GtmCrmMode;
  crmExternalProvider: GtmCrmExternalProvider;
  qlixCrmRequestedAt: string | null;
  discoveryChecklist: Record<string, GtmChecklistStatus>;
  discoveryRoadmap: GtmRoadmapStep[] | null;
  setupCompletedAt: string | null;
  updatedAt: string | null;
}

export interface GtmSetupPatch {
  companyDescription?: unknown;
  idealCustomerProfile?: unknown;
  primaryOffer?: unknown;
  targetRegions?: unknown;
  buyerRolesAndWorkflows?: unknown;
  proofAndCaseStudies?: unknown;
  validityPolicy?: unknown;
  calibrationNotes?: unknown;
  knowledgeCollectionIds?: unknown;
  completedSteps?: unknown;
  crmMode?: unknown;
  crmExternalProvider?: unknown;
  qlixCrmRequestedAt?: unknown;
  discoveryChecklist?: unknown;
  discoveryRoadmap?: unknown;
  setupCompletedAt?: unknown;
}

export class GtmSetupValidationError extends Error {
  readonly code = 'invalid_gtm_setup';
}

const MAX_LONG_TEXT = 8_000;
const MAX_LIST_ITEMS = 50;
const MAX_LIST_ITEM_LENGTH = 240;
const KNOWN_CONFIRMED_FIELDS = new Set([
  'companyDescription',
  'idealCustomerProfile',
  'primaryOffer',
  'targetRegions',
  'buyerRolesAndWorkflows',
  'proofAndCaseStudies',
  'validityPolicy',
  'calibrationNotes',
]);
const KNOWN_STEPS = new Set([
  'company',
  'market',
  'offer',
  'buyers',
  'proof',
  'connectors',
  'validity_policy',
  'calibration',
]);

export const DEFAULT_GTM_SETUP: GtmSetupConfig = Object.freeze({
  version: 1,
  operatingMode: 'discovery_only',
  setupStatus: 'not_started',
  companyDescription: '',
  idealCustomerProfile: '',
  primaryOffer: '',
  targetRegions: [],
  buyerRolesAndWorkflows: '',
  proofAndCaseStudies: '',
  validityPolicy: '',
  calibrationNotes: '',
  knowledgeCollectionIds: [],
  completedSteps: [],
  confirmedFields: [],
  crmMode: 'undecided',
  crmExternalProvider: null,
  qlixCrmRequestedAt: null,
  discoveryChecklist: {},
  discoveryRoadmap: null,
  setupCompletedAt: null,
  updatedAt: null,
});

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function cleanText(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new GtmSetupValidationError(`${field} must be a string.`);
  const text = value.trim();
  if (text.length > MAX_LONG_TEXT) {
    throw new GtmSetupValidationError(`${field} must be at most ${MAX_LONG_TEXT} characters.`);
  }
  return text;
}

function cleanList(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new GtmSetupValidationError(`${field} must be an array.`);
  if (value.length > MAX_LIST_ITEMS) {
    throw new GtmSetupValidationError(`${field} must contain at most ${MAX_LIST_ITEMS} items.`);
  }
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') throw new GtmSetupValidationError(`${field} items must be strings.`);
    const normalized = item.trim();
    if (!normalized) continue;
    if (normalized.length > MAX_LIST_ITEM_LENGTH) {
      throw new GtmSetupValidationError(
        `${field} items must be at most ${MAX_LIST_ITEM_LENGTH} characters.`,
      );
    }
    if (!result.includes(normalized)) result.push(normalized);
  }
  return result;
}

function cleanSteps(value: unknown): string[] {
  const steps = cleanList(value, 'completedSteps');
  for (const step of steps) {
    if (!KNOWN_STEPS.has(step)) {
      throw new GtmSetupValidationError(`Unknown GTM setup step: ${step}.`);
    }
  }
  return steps;
}

function deriveSetupStatus(config: Pick<
  GtmSetupConfig,
  | 'companyDescription'
  | 'idealCustomerProfile'
  | 'primaryOffer'
  | 'buyerRolesAndWorkflows'
  | 'proofAndCaseStudies'
  | 'validityPolicy'
  | 'calibrationNotes'
  | 'completedSteps'
>): GtmSetupStatus {
  if (
    !config.companyDescription &&
    !config.idealCustomerProfile &&
    !config.primaryOffer &&
    !config.buyerRolesAndWorkflows &&
    !config.proofAndCaseStudies &&
    !config.validityPolicy &&
    !config.calibrationNotes &&
    config.completedSteps.length === 0
  ) return 'not_started';
  if (config.completedSteps.includes('calibration')) return 'ready';
  if (config.completedSteps.includes('validity_policy')) return 'calibrating';
  return 'in_progress';
}

function cleanCrmMode(value: unknown): GtmCrmMode {
  if (value === 'external' || value === 'qlix_twenty' || value === 'undecided') return value;
  throw new GtmSetupValidationError('crmMode must be undecided, external, or qlix_twenty.');
}

function cleanCrmExternalProvider(value: unknown): GtmCrmExternalProvider {
  if (value === null || value === undefined || value === '') return null;
  if (value === 'zoho') return 'zoho';
  throw new GtmSetupValidationError('crmExternalProvider must be zoho or null.');
}

function cleanRoadmap(value: unknown): GtmRoadmapStep[] | null {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) throw new GtmSetupValidationError('discoveryRoadmap must be an array or null.');
  if (value.length > 10) throw new GtmSetupValidationError('discoveryRoadmap must contain at most 10 steps.');
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new GtmSetupValidationError(`discoveryRoadmap[${index}] must be an object.`);
    }
    const row = item as Record<string, unknown>;
    const id = typeof row.id === 'string' && row.id.trim() ? row.id.trim() : `step-${index + 1}`;
    const title = cleanText(row.title, `discoveryRoadmap[${index}].title`);
    const why = cleanText(row.why, `discoveryRoadmap[${index}].why`);
    const effort = row.effort === 'medium' ? 'medium' : 'small';
    return { id, title, why, effort };
  });
}

function cleanChecklist(value: unknown): Record<string, GtmChecklistStatus> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new GtmSetupValidationError('discoveryChecklist must be an object.');
  }
  const result: Record<string, GtmChecklistStatus> = {};
  for (const [key, status] of Object.entries(value as Record<string, unknown>)) {
    if (status !== 'pending' && status !== 'done') {
      throw new GtmSetupValidationError(`Invalid checklist status for ${key}.`);
    }
    result[key] = status;
  }
  return result;
}

function cleanOptionalTimestamp(value: unknown, field: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw new GtmSetupValidationError(`${field} must be an ISO timestamp or null.`);
  return value;
}

export function normalizeGtmSetup(value: unknown): GtmSetupConfig {
  const row = objectValue(value);
  const companyDescription = typeof row.companyDescription === 'string' ? row.companyDescription : '';
  const idealCustomerProfile = typeof row.idealCustomerProfile === 'string' ? row.idealCustomerProfile : '';
  const primaryOffer = typeof row.primaryOffer === 'string' ? row.primaryOffer : '';
  const buyerRolesAndWorkflows = typeof row.buyerRolesAndWorkflows === 'string' ? row.buyerRolesAndWorkflows : '';
  const proofAndCaseStudies = typeof row.proofAndCaseStudies === 'string' ? row.proofAndCaseStudies : '';
  const validityPolicy = typeof row.validityPolicy === 'string' ? row.validityPolicy : '';
  const calibrationNotes = typeof row.calibrationNotes === 'string' ? row.calibrationNotes : '';
  const targetRegions = Array.isArray(row.targetRegions)
    ? row.targetRegions.filter((item): item is string => typeof item === 'string')
    : [];
  const knowledgeCollectionIds = Array.isArray(row.knowledgeCollectionIds)
    ? row.knowledgeCollectionIds.filter((item): item is string => typeof item === 'string')
    : [];
  const completedSteps = Array.isArray(row.completedSteps)
    ? row.completedSteps.filter((item): item is string => typeof item === 'string' && KNOWN_STEPS.has(item))
    : [];
  const confirmedFields = Array.isArray(row.confirmedFields)
    ? row.confirmedFields.filter((item): item is string => typeof item === 'string' && KNOWN_CONFIRMED_FIELDS.has(item))
    : [];
  const crmMode = row.crmMode === 'external' || row.crmMode === 'qlix_twenty' || row.crmMode === 'undecided'
    ? row.crmMode
    : 'undecided';
  const crmExternalProvider = row.crmExternalProvider === 'zoho' ? 'zoho' : null;
  const qlixCrmRequestedAt = typeof row.qlixCrmRequestedAt === 'string' ? row.qlixCrmRequestedAt : null;
  const discoveryChecklist: Record<string, GtmChecklistStatus> = {};
  if (row.discoveryChecklist && typeof row.discoveryChecklist === 'object' && !Array.isArray(row.discoveryChecklist)) {
    for (const [key, status] of Object.entries(row.discoveryChecklist as Record<string, unknown>)) {
      if (status === 'pending' || status === 'done') discoveryChecklist[key] = status;
    }
  }
  const setupCompletedAt = typeof row.setupCompletedAt === 'string' ? row.setupCompletedAt : null;
  let discoveryRoadmap: GtmRoadmapStep[] | null = null;
  if (row.discoveryRoadmap !== undefined && row.discoveryRoadmap !== null) {
    discoveryRoadmap = cleanRoadmap(row.discoveryRoadmap);
  }
  const config: GtmSetupConfig = {
    version: 1,
    operatingMode: 'discovery_only',
    setupStatus: 'not_started',
    companyDescription,
    idealCustomerProfile,
    primaryOffer,
    targetRegions,
    buyerRolesAndWorkflows,
    proofAndCaseStudies,
    validityPolicy,
    calibrationNotes,
    knowledgeCollectionIds,
    completedSteps,
    confirmedFields,
    crmMode,
    crmExternalProvider,
    qlixCrmRequestedAt,
    discoveryChecklist,
    discoveryRoadmap,
    setupCompletedAt,
    updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : null,
  };
  config.setupStatus = deriveSetupStatus(config);
  return config;
}

export function fieldsFromSetupPatch(patch: GtmSetupPatch): string[] {
  const fields: string[] = [];
  if (patch.companyDescription !== undefined) fields.push('companyDescription');
  if (patch.idealCustomerProfile !== undefined) fields.push('idealCustomerProfile');
  if (patch.primaryOffer !== undefined) fields.push('primaryOffer');
  if (patch.targetRegions !== undefined) fields.push('targetRegions');
  if (patch.buyerRolesAndWorkflows !== undefined) fields.push('buyerRolesAndWorkflows');
  if (patch.proofAndCaseStudies !== undefined) fields.push('proofAndCaseStudies');
  if (patch.validityPolicy !== undefined) fields.push('validityPolicy');
  if (patch.calibrationNotes !== undefined) fields.push('calibrationNotes');
  if (patch.crmMode !== undefined) fields.push('crmMode');
  if (patch.discoveryChecklist !== undefined) fields.push('discoveryChecklist');
  if (patch.discoveryRoadmap !== undefined) fields.push('discoveryRoadmap');
  return fields;
}

export function applyGtmSetupPatch(current: unknown, patch: GtmSetupPatch): GtmSetupConfig {
  const next = normalizeGtmSetup(current);
  if (patch.companyDescription !== undefined) {
    next.companyDescription = cleanText(patch.companyDescription, 'companyDescription');
  }
  if (patch.idealCustomerProfile !== undefined) {
    next.idealCustomerProfile = cleanText(patch.idealCustomerProfile, 'idealCustomerProfile');
  }
  if (patch.primaryOffer !== undefined) {
    next.primaryOffer = cleanText(patch.primaryOffer, 'primaryOffer');
  }
  if (patch.targetRegions !== undefined) next.targetRegions = cleanList(patch.targetRegions, 'targetRegions');
  if (patch.buyerRolesAndWorkflows !== undefined) {
    next.buyerRolesAndWorkflows = cleanText(patch.buyerRolesAndWorkflows, 'buyerRolesAndWorkflows');
  }
  if (patch.proofAndCaseStudies !== undefined) {
    next.proofAndCaseStudies = cleanText(patch.proofAndCaseStudies, 'proofAndCaseStudies');
  }
  if (patch.validityPolicy !== undefined) {
    next.validityPolicy = cleanText(patch.validityPolicy, 'validityPolicy');
  }
  if (patch.calibrationNotes !== undefined) {
    next.calibrationNotes = cleanText(patch.calibrationNotes, 'calibrationNotes');
  }
  if (patch.knowledgeCollectionIds !== undefined) {
    next.knowledgeCollectionIds = cleanList(patch.knowledgeCollectionIds, 'knowledgeCollectionIds');
  }
  if (patch.completedSteps !== undefined) next.completedSteps = cleanSteps(patch.completedSteps);
  if (patch.crmMode !== undefined) next.crmMode = cleanCrmMode(patch.crmMode);
  if (patch.crmExternalProvider !== undefined) {
    next.crmExternalProvider = cleanCrmExternalProvider(patch.crmExternalProvider);
  }
  if (patch.qlixCrmRequestedAt !== undefined) {
    next.qlixCrmRequestedAt = cleanOptionalTimestamp(patch.qlixCrmRequestedAt, 'qlixCrmRequestedAt');
  }
  if (patch.discoveryChecklist !== undefined) {
    next.discoveryChecklist = cleanChecklist(patch.discoveryChecklist);
  }
  if (patch.discoveryRoadmap !== undefined) {
    next.discoveryRoadmap = cleanRoadmap(patch.discoveryRoadmap);
  }
  if (patch.setupCompletedAt !== undefined) {
    next.setupCompletedAt = cleanOptionalTimestamp(patch.setupCompletedAt, 'setupCompletedAt');
  }
  next.updatedAt = new Date().toISOString();
  next.setupStatus = deriveSetupStatus(next);
  return next;
}

export function gtmSetupToJson(config: GtmSetupConfig): Prisma.InputJsonValue {
  return { ...config } as unknown as Prisma.InputJsonValue;
}
