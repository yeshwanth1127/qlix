from qlix.assessment import (
    AssessmentRecord,
    CriterionFinding,
    CriterionRef,
    CriterionVerdict,
    EvaluationFramework,
    EvidenceKind,
    EvidenceRecord,
    EvidenceSource,
    HumanDecision,
    IntegrityPolicy,
    OverallReadiness,
    WorkSession,
    WorkSessionStatus,
    as_payload,
)
from qlix.assessment.recipes import STUDENT_PROJECT_ASSESSMENT_RECIPE
from qlix.identity import AgentIdentity


def test_work_session_payload_is_serializable_without_luna_runtime() -> None:
    session = WorkSession(
        session_id="s1",
        org_id="o1",
        subject_ref="student-1",
        recipe_id="student_project_assessment.v1",
    )
    assert as_payload(session) == {
        "session_id": "s1",
        "org_id": "o1",
        "subject_ref": "student-1",
        "recipe_id": "student_project_assessment.v1",
        "status": WorkSessionStatus.ACTIVE,
        "started_at": None,
        "submitted_at": None,
        "metadata": {},
    }
    assert WorkSessionStatus.ACTIVE.value == "active"


def test_evidence_record_defaults() -> None:
    evidence = EvidenceRecord(
        evidence_id="e1",
        session_id="s1",
        kind=EvidenceKind.TEST_RESULT,
        occurred_at="2026-01-01T00:00:00Z",
        source=EvidenceSource.VSCODE_EXTENSION,
    )
    payload = as_payload(evidence)
    assert payload["redaction_applied"] is False
    assert payload["content_ref"] is None


def test_integrity_policy_never_auto_accuses_by_default() -> None:
    framework = EvaluationFramework(
        framework_id="f1",
        version=1,
        recipe_id="student_project_assessment.v1",
        criteria=(CriterionRef("c1", "Has passing tests", "testing"),),
    )
    assert framework.integrity_policy == IntegrityPolicy()
    assert framework.integrity_policy.never_auto_accuse is True
    assert framework.integrity_policy.escalate_to_human_on_suspicion is True


def test_assessment_record_never_defaults_to_a_bare_pass_fail() -> None:
    record = AssessmentRecord(session_id="s1", framework_id="f1")
    assert record.overall_readiness == OverallReadiness.NEEDS_HUMAN_REVIEW
    assert record.findings == ()


def test_criterion_finding_round_trips() -> None:
    finding = CriterionFinding(
        criterion_id="c1",
        evaluator_agent_id="a1",
        verdict=CriterionVerdict.NEEDS_REVIEW,
        confidence=0.4,
        evidence_refs=("evidence:e1",),
        rationale="Test coverage for auth module is missing.",
    )
    payload = as_payload(finding)
    assert payload["verdict"] == CriterionVerdict.NEEDS_REVIEW
    assert payload["evidence_refs"] == ("evidence:e1",)


def test_human_decision_defaults_to_pending() -> None:
    assert HumanDecision.PENDING.value == "pending"


def test_assessment_runtime_tools_and_scopes_are_consistent() -> None:
    from qlix.assessment_runtime import ASSESSMENT_TOOL_DEFINITIONS, ASSESSMENT_TOOL_SCOPES

    assert set(ASSESSMENT_TOOL_SCOPES.keys()) == set(ASSESSMENT_TOOL_DEFINITIONS.keys())
    assert len(ASSESSMENT_TOOL_SCOPES) == 13
    for name, definition in ASSESSMENT_TOOL_DEFINITIONS.items():
        assert definition["function"]["name"] == name


def test_assessment_record_schema_batches_findings_without_model_supplied_agent_id() -> None:
    from qlix.assessment_runtime import ASSESSMENT_TOOL_DEFINITIONS

    schema = ASSESSMENT_TOOL_DEFINITIONS["assessment_record"]["function"]["parameters"]
    assert schema["required"] == ["sessionId", "findings"]
    assert schema["properties"]["findings"]["maxItems"] == 100
    item = schema["properties"]["findings"]["items"]
    assert "criterionId" in item["properties"]
    assert "evaluatorAgentId" not in item["properties"]
    assert "evidenceRefs" in item["required"]
    assert item["properties"]["evidenceRefs"]["minItems"] == 1


def test_reference_tools_are_bounded_batches() -> None:
    from qlix.assessment_runtime import ASSESSMENT_TOOL_DEFINITIONS

    list_schema = ASSESSMENT_TOOL_DEFINITIONS["assessment_reference_list"]["function"]["parameters"]
    batch_schema = ASSESSMENT_TOOL_DEFINITIONS["assessment_reference_batch_read"]["function"]["parameters"]
    assert list_schema["properties"]["limit"]["maximum"] == 200
    assert batch_schema["properties"]["referenceIds"]["maxItems"] == 25
    assert batch_schema["properties"]["maxCharsPerReference"]["maximum"] == 8000


def test_reference_tools_replace_legacy_search_and_single_read_for_models() -> None:
    from qlix.assessment_runtime import openai_assessment_tool_definitions
    from qlix.identity import AgentIdentity

    identity = AgentIdentity(
        did="did:qlix:test",
        agent_id="agent",
        private_key_hex="00" * 32,
        public_key_hex="11" * 32,
        permission_scopes=("assessment.evidence.search", "assessment.evidence.read"),
        jit_scopes=(),
        always_scopes=(),
        backend_url="http://localhost",
        llm_mode="proxy",
        raw={},
    )
    names = {
        definition["function"]["name"]
        for definition in openai_assessment_tool_definitions(
            identity,
            ["assessment.evidence.search", "assessment.evidence.read"],
        )
    }
    assert "assessment_reference_list" in names
    assert "assessment_reference_batch_read" in names
    assert "assessment_evidence_search" not in names
    assert "assessment_evidence_read" not in names


def test_assessment_record_executor_rejects_empty_evidence_before_http(monkeypatch) -> None:
    import qlix.assessment_runtime as runtime

    identity = AgentIdentity(
        did="did:qlix:test",
        agent_id="agent",
        private_key_hex="00" * 32,
        public_key_hex="11" * 32,
        permission_scopes=("assessment.record",),
        jit_scopes=(),
        always_scopes=(),
        backend_url="http://localhost",
        llm_mode="proxy",
        raw={},
    )
    posted: list[dict] = []
    monkeypatch.setattr(
        runtime,
        "_post_assessment_tool",
        lambda **kwargs: posted.append(kwargs) or '{"ok":true}',
    )
    executors = runtime.build_assessment_tool_executors(
        identity=identity,
        skill_filter=["assessment.record"],
        agent_id="agent",
        run_id="run",
        backend_url="http://localhost",
        runner_token="token",
    )
    output = executors["assessment_record"](
        '{"sessionId":"session","findings":[{"criterionId":"c1",'
        '"verdict":"needs_review","confidence":0.5,"evidenceRefs":[],'
        '"rationale":"Unclear"}]}'
    )
    assert output.startswith("[failed] assessment_record requires")
    assert posted == []


def test_student_project_assessment_is_a_recipe_not_a_core_tool() -> None:
    assert STUDENT_PROJECT_ASSESSMENT_RECIPE["id"] == "student_project_assessment.v1"
    assert STUDENT_PROJECT_ASSESSMENT_RECIPE["review"]["workflow_key"] == "student_defense_interview.v1"
    assert "test_result" in STUDENT_PROJECT_ASSESSMENT_RECIPE["observation"]["kinds"]


def test_core_module_stays_domain_free() -> None:
    import dataclasses

    import qlix.assessment.core as core_module

    for name in core_module.__dict__:
        obj = getattr(core_module, name)
        if not dataclasses.is_dataclass(obj):
            continue
        for f in dataclasses.fields(obj):
            assert "student" not in f.name.lower()
            assert "vscode" not in f.name.lower()
