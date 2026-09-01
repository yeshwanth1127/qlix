import crypto from 'node:crypto';

export const ASSESSMENT_CONTEXT_VERSION = 1 as const;

export interface AssessmentContextSession {
  id: string;
  teamId: string | null;
  recipeId: string;
  status: string;
  projectDescription: string | null;
  expectedStack: string[];
  aiUsagePolicy: string | null;
  checklist: unknown;
  requiredDeliverables: string[];
  startedAt: Date;
  submittedAt: Date | null;
}

export interface AssessmentContextFramework {
  id: string;
  name: string;
  version: number;
  criteria: unknown;
  integrityPolicy: unknown;
}

export interface AssessmentContextEvidence {
  id: string;
  kind: string;
  source: string;
  occurredAt: Date;
  payload: unknown;
  redacted: boolean;
  contentRef: string | null;
}

export interface AssessmentContextSnapshot {
  id: string;
  label: string;
  fileTreeHash: string;
  fileHashes: unknown;
  contentRef: string | null;
  createdAt: Date;
}

export interface AssessmentContextRecord {
  id: string;
  findings: unknown;
  reviewTranscript: unknown;
  createdAt: Date;
}

export interface AssessmentContextBase {
  session: AssessmentContextSession;
  framework: AssessmentContextFramework;
  evidence: AssessmentContextEvidence[];
  snapshots: AssessmentContextSnapshot[];
}

export interface NormalizedAssessmentContext {
  version: typeof ASSESSMENT_CONTEXT_VERSION;
  contextRef: string;
  scope: {
    role: string;
    criterionCategories: string[];
    evidenceKinds: string[];
  };
  session: Omit<AssessmentContextSession, 'startedAt' | 'submittedAt'> & {
    startedAt: string;
    submittedAt: string | null;
  };
  framework: Omit<AssessmentContextFramework, 'criteria'> & { criteria: unknown[] };
  evidence: Array<{
    id: string;
    kind: string;
    source: string;
    occurredAt: string;
    redacted: boolean;
    hasContent: boolean;
    payload: unknown;
    payloadTruncated: boolean;
  }>;
  snapshots: Array<{
    id: string;
    label: string;
    fileTreeHash: string;
    fileHashes: unknown;
    hasContent: boolean;
    createdAt: string;
  }>;
  sharedState: {
    assessmentRecordId: string | null;
    findings: unknown[];
    reviewTranscript: unknown[];
    versionAt: string | null;
  };
  stats: {
    evidenceAvailable: number;
    evidenceIncluded: number;
    findingsIncluded: number;
  };
}

const ROLE_SCOPE: Record<string, { categories: string[]; kinds: string[]; snapshots: boolean }> = {
  process_integrity: {
    categories: ['process'],
    kinds: ['manual_note', 'file_snapshot', 'git_event', 'terminal_event', 'dependency_event'],
    snapshots: true,
  },
  code_stack: {
    categories: ['code'],
    kinds: ['file_snapshot', 'dependency_event', 'terminal_event', 'artifact_upload'],
    snapshots: true,
  },
  tests_build: {
    categories: ['tests'],
    kinds: ['test_result', 'build_result', 'lint_result', 'terminal_event'],
    snapshots: false,
  },
  security_ai: {
    categories: ['security'],
    kinds: ['file_snapshot', 'terminal_event', 'dependency_event', 'ai_prompt'],
    snapshots: false,
  },
  requirements: {
    categories: ['requirements'],
    kinds: ['file_snapshot', 'git_event', 'test_result', 'build_result', 'lint_result', 'artifact_upload'],
    snapshots: true,
  },
  interviewer: { categories: [], kinds: [], snapshots: false },
  reporter: { categories: [], kinds: [], snapshots: false },
};

function asRecords(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : [];
}

function compactJsonValue(value: unknown, maxChars = 1_200): { value: unknown; truncated: boolean } {
  const text = JSON.stringify(value);
  if (text.length <= maxChars) return { value, truncated: false };
  return {
    value: {
      preview: text.slice(0, maxChars),
      originalChars: text.length,
      truncated: true,
    },
    truncated: true,
  };
}

function findingEvidenceRefs(findings: Array<Record<string, unknown>>): Set<string> {
  const refs = new Set<string>();
  for (const finding of findings) {
    const value = finding.evidence_refs ?? finding.evidenceRefs;
    if (!Array.isArray(value)) continue;
    for (const ref of value) {
      if (typeof ref === 'string' && ref.trim()) refs.add(ref);
    }
  }
  return refs;
}

function criterionCategory(criterion: Record<string, unknown>): string {
  return typeof criterion.category === 'string' ? criterion.category : '';
}

function stableHash(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/**
 * Build the minimum deterministic context for one assessment role.
 *
 * The source objects are loaded once by the route-level single-flight cache. This
 * function only selects and bounds them; agents receive opaque ids plus compact
 * payloads and can progressively disclose a large artifact with artifact-read.
 */
export function buildNormalizedAssessmentContext(input: {
  role: string;
  base: AssessmentContextBase;
  record: AssessmentContextRecord | null;
}): NormalizedAssessmentContext {
  const roleScope = ROLE_SCOPE[input.role] ?? {
    categories: [],
    kinds: [],
    snapshots: false,
  };
  const allCriteria = asRecords(input.base.framework.criteria);
  const criteria = roleScope.categories.length > 0
    ? allCriteria.filter((criterion) => roleScope.categories.includes(criterionCategory(criterion)))
    : allCriteria;
  const allFindings = asRecords(input.record?.findings);
  const findings = input.role === 'reporter' || input.role === 'interviewer'
    ? allFindings
    : allFindings.filter((finding) => {
        const criterionId = finding.criterion_id ?? finding.criterionId;
        return criteria.some((criterion) => (criterion.criterion_id ?? criterion.criterionId) === criterionId);
      });
  const referencedIds = findingEvidenceRefs(findings);
  const evidence = input.base.evidence.filter((item) => {
    if (input.role === 'reporter') return false;
    if (input.role === 'interviewer') return referencedIds.has(item.id);
    return roleScope.kinds.includes(item.kind);
  });

  const body = {
    version: ASSESSMENT_CONTEXT_VERSION,
    scope: {
      role: input.role,
      criterionCategories: roleScope.categories,
      evidenceKinds: roleScope.kinds,
    },
    session: {
      ...input.base.session,
      startedAt: input.base.session.startedAt.toISOString(),
      submittedAt: input.base.session.submittedAt?.toISOString() ?? null,
    },
    framework: {
      ...input.base.framework,
      criteria,
    },
    evidence: evidence.map((item) => {
      const compact = compactJsonValue(item.payload);
      return {
        id: item.id,
        kind: item.kind,
        source: item.source,
        occurredAt: item.occurredAt.toISOString(),
        redacted: item.redacted,
        hasContent: Boolean(item.contentRef),
        payload: compact.value,
        payloadTruncated: compact.truncated,
      };
    }),
    snapshots: roleScope.snapshots
      ? input.base.snapshots.map((snapshot) => ({
          id: snapshot.id,
          label: snapshot.label,
          fileTreeHash: snapshot.fileTreeHash,
          fileHashes: snapshot.fileHashes,
          hasContent: Boolean(snapshot.contentRef),
          createdAt: snapshot.createdAt.toISOString(),
        }))
      : [],
    sharedState: {
      assessmentRecordId: input.record?.id ?? null,
      findings,
      reviewTranscript: Array.isArray(input.record?.reviewTranscript) ? input.record.reviewTranscript : [],
      versionAt: input.record?.createdAt.toISOString() ?? null,
    },
    stats: {
      evidenceAvailable: input.base.evidence.length,
      evidenceIncluded: evidence.length,
      findingsIncluded: findings.length,
    },
  };
  return {
    ...body,
    contextRef: `assessment-context:sha256:${stableHash(body)}`,
  };
}

export function assessmentContextRoleScope(role: string): { categories: string[]; kinds: string[] } {
  const scope = ROLE_SCOPE[role] ?? { categories: [], kinds: [], snapshots: false };
  return { categories: [...scope.categories], kinds: [...scope.kinds] };
}
