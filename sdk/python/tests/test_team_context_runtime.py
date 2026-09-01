from __future__ import annotations

from qlix.identity import AgentIdentity
from qlix.assessment_runtime import openai_assessment_tool_definitions
from qlix.team_context_runtime import openai_team_context_tool_definitions


def _identity() -> AgentIdentity:
    return AgentIdentity(
        agent_id="agent-1",
        did="did:qlix:test",
        private_key_hex="11" * 32,
        public_key_hex="22" * 32,
        permission_scopes=(
            "assessment.session.get",
            "assessment.framework.read",
            "assessment.evidence.search",
            "assessment.evidence.read",
            "assessment.record",
        ),
        jit_scopes=(),
        always_scopes=(),
        backend_url="http://localhost:8080",
        llm_mode="proxy",
        raw={},
    )


def test_generic_context_tool_is_team_scoped() -> None:
    assert openai_team_context_tool_definitions(["team.dispatch"])[0]["function"]["name"] == "context_get"
    names = {tool["function"]["name"] for tool in openai_team_context_tool_definitions(["team.dispatch"])}
    assert names == {"context_get", "context_search", "state_read", "state_patch"}
    assert openai_team_context_tool_definitions(["brain.query"]) == []


def test_context_get_is_available_when_pack_has_references() -> None:
    tools = openai_team_context_tool_definitions(["brain.query"], enable=True)
    assert [tool["function"]["name"] for tool in tools] == ["context_get", "context_search"]


def test_context_search_is_available_for_brain_runs_without_refs() -> None:
    tools = openai_team_context_tool_definitions(["brain.query"], enable_search=True)
    assert [tool["function"]["name"] for tool in tools] == ["context_search"]


def test_assessment_adapter_replaces_low_level_read_schemas() -> None:
    tools = openai_assessment_tool_definitions(
        _identity(),
        [
            "assessment.session.get",
            "assessment.framework.read",
            "assessment.evidence.search",
            "assessment.evidence.read",
            "assessment.record",
            "team.dispatch",
        ],
    )
    names = {tool["function"]["name"] for tool in tools}
    assert "assessment_context_get" in names
    assert "assessment_record" in names
    assert "assessment_session_get" not in names
    assert "assessment_reference_list" not in names
