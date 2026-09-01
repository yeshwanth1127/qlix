"""Assessment ADK contracts.

This module is the evidence-based evaluation control plane: a generalized
platform capability for observing authorized work, collecting evidence,
evaluating it against a customer-defined framework, conducting an adaptive
interactive review, and producing a traceable report.

It is intentionally independent from ``qlix.luna_teams`` — evaluator agents
are ordinary Luna-Teams team members, dispatched the normal way. This module
supplies the domain contracts they read and write; ``qlix.luna_teams``
supplies the dispatch/mailbox/wait mechanics. Nothing here is student- or
project-specific — see ``qlix.assessment.recipes`` for the first concrete
configuration.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Mapping

from qlix.luna_teams.core import as_payload as as_payload  # explicit re-export

JsonSchema = Mapping[str, Any]


class WorkSessionStatus(str, Enum):
    ACTIVE = "active"
    SUBMITTED = "submitted"
    EVALUATING = "evaluating"
    REVIEWING = "reviewing"
    REPORTED = "reported"
    CLOSED = "closed"


class EvidenceKind(str, Enum):
    FILE_SNAPSHOT = "file_snapshot"
    GIT_EVENT = "git_event"
    TERMINAL_EVENT = "terminal_event"
    TEST_RESULT = "test_result"
    BUILD_RESULT = "build_result"
    LINT_RESULT = "lint_result"
    AI_PROMPT = "ai_prompt"
    ARTIFACT_UPLOAD = "artifact_upload"
    MANUAL_NOTE = "manual_note"


class EvidenceSource(str, Enum):
    VSCODE_EXTENSION = "vscode_extension"
    GIT_CONNECT = "git_connect"
    MANUAL_UPLOAD = "manual_upload"
    SANDBOX_RUN = "sandbox_run"


class CriterionVerdict(str, Enum):
    MET = "met"
    PARTIALLY_MET = "partially_met"
    NOT_MET = "not_met"
    UNCLEAR = "unclear"
    NEEDS_REVIEW = "needs_review"


class OverallReadiness(str, Enum):
    READY = "ready"
    NOT_READY = "not_ready"
    NEEDS_HUMAN_REVIEW = "needs_human_review"


class HumanDecision(str, Enum):
    PENDING = "pending"
    CONFIRMED = "confirmed"
    OVERRIDDEN = "overridden"


@dataclass(frozen=True)
class WorkSession:
    session_id: str
    org_id: str
    subject_ref: str
    recipe_id: str
    status: WorkSessionStatus = WorkSessionStatus.ACTIVE
    started_at: str | None = None
    submitted_at: str | None = None
    metadata: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class EvidenceRecord:
    evidence_id: str
    session_id: str
    kind: EvidenceKind
    occurred_at: str
    source: EvidenceSource
    payload: Mapping[str, Any] = field(default_factory=dict)
    content_ref: str | None = None
    redaction_applied: bool = False


@dataclass(frozen=True)
class CriterionRef:
    """One rubric item. ``category`` is a free string so each recipe defines its own."""

    criterion_id: str
    text: str
    category: str


@dataclass(frozen=True)
class IntegrityPolicy:
    """Structural guardrails for how integrity signals may be used.

    ``never_auto_accuse`` defaults true so every recipe inherits the rule that
    an integrity reviewer flags inconsistencies for human attention rather
    than issuing an accusation itself.
    """

    never_auto_accuse: bool = True
    escalate_to_human_on_suspicion: bool = True


@dataclass(frozen=True)
class EvaluationFramework:
    framework_id: str
    version: int
    recipe_id: str
    criteria: tuple[CriterionRef, ...]
    integrity_policy: IntegrityPolicy = field(default_factory=IntegrityPolicy)


@dataclass(frozen=True)
class CriterionFinding:
    criterion_id: str
    evaluator_agent_id: str
    verdict: CriterionVerdict
    confidence: float
    evidence_refs: tuple[str, ...] = ()
    rationale: str = ""


@dataclass(frozen=True)
class ReviewQuestion:
    question_id: str
    criterion_id: str
    text: str
    asked_by_agent_id: str


@dataclass(frozen=True)
class ReviewAnswer:
    question_id: str
    text: str
    answered_at: str
    attachments: tuple[str, ...] = ()


@dataclass(frozen=True)
class DemonstrationRequest:
    demo_id: str
    criterion_id: str
    instructions: str
    expected_evidence_kind: EvidenceKind = EvidenceKind.ARTIFACT_UPLOAD


@dataclass(frozen=True)
class DemonstrationResult:
    demo_id: str
    evidence_refs: tuple[str, ...]
    completed_at: str


@dataclass(frozen=True)
class AssessmentRecord:
    session_id: str
    framework_id: str
    findings: tuple[CriterionFinding, ...] = ()
    review_transcript: tuple[ReviewQuestion | ReviewAnswer, ...] = ()
    overall_readiness: OverallReadiness = OverallReadiness.NEEDS_HUMAN_REVIEW


@dataclass(frozen=True)
class AssessmentReport:
    report_id: str
    session_id: str
    assessment_record_ref: str
    summary: str
    human_reviewer_id: str | None = None
    human_decision: HumanDecision = HumanDecision.PENDING
    confirmed_at: str | None = None
