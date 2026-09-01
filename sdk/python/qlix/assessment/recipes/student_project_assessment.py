"""Recipe: final-project assessment for a job-readiness platform's students.

Recipes are optional composition metadata, exactly like
``qlix.luna_teams.recipes.channel_outreach``. This is where "student" lives —
the ``qlix.assessment`` core module above stays domain-free so the same
observe/evaluate/review platform can support other recipes (technical hiring,
employee certification, compliance review, contractor assessment, AI-agent
evaluation) without changing the underlying contracts.
"""

from __future__ import annotations

from typing import Any


FINDING_SCHEMA: dict[str, Any] = {
    "$id": "qlix.recipe.student_project_assessment.finding.v1",
    "type": "object",
    "additionalProperties": False,
    "required": ["criterion_id", "verdict", "confidence", "rationale"],
    "properties": {
        "criterion_id": {"type": "string"},
        "verdict": {
            "enum": ["met", "partially_met", "not_met", "unclear", "needs_review"],
        },
        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        "evidence_refs": {"type": "array", "items": {"type": "string"}},
        "rationale": {"type": "string"},
    },
}


REPORT_SCHEMA: dict[str, Any] = {
    "$id": "qlix.recipe.student_project_assessment.report.v1",
    "type": "object",
    "additionalProperties": False,
    "required": ["session_id", "assessment_record_ref", "summary", "human_decision"],
    "properties": {
        "session_id": {"type": "string"},
        "assessment_record_ref": {"type": "string"},
        "summary": {"type": "string"},
        "human_decision": {"enum": ["pending", "confirmed", "overridden"]},
    },
}


STUDENT_PROJECT_ASSESSMENT_RECIPE: dict[str, Any] = {
    "id": "student_project_assessment.v1",
    "description": (
        "Evaluate a student's final-level software project: process, code, tests, "
        "security, requirements coverage, and integrity, then run an adaptive "
        "defense interview for unclear areas before a human confirms the report."
    ),
    "contracts": [FINDING_SCHEMA, REPORT_SCHEMA],
    "observation": {
        "kinds": [
            "file_snapshot",
            "git_event",
            "terminal_event",
            "test_result",
            "build_result",
            "lint_result",
            "ai_prompt",
        ],
    },
    "framework_ref": "job_readiness_checklist",
    "review": {
        "workflow_key": "student_defense_interview.v1",
        "question_budget": 5,
        "demo_allowed": True,
    },
}
