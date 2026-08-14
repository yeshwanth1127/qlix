from qlix.luna_teams import (
    DispatchRequest,
    MailboxKind,
    TeamMember,
    as_payload,
    commander_tool_definitions,
)
from qlix.luna_teams.recipes import CHANNEL_OUTREACH_RECIPE


def test_commander_tools_are_generic_and_roster_scoped() -> None:
    tools = commander_tool_definitions(
        [TeamMember(agent_id="a1", name="Researcher", role="research")]
    )
    names = [tool["function"]["name"] for tool in tools]
    assert names == [
        "dispatch_to",
        "wait_result",
        "interrupt_member",
        "request_wait",
    ]
    dispatch = tools[0]["function"]["parameters"]
    assert dispatch["properties"]["to"]["enum"] == ["Researcher"]
    assert "allowed_scopes" in dispatch["properties"]
    assert "whatsapp" not in str(tools).lower()


def test_payloads_are_serializable_without_luna_runtime() -> None:
    payload = as_payload(
        DispatchRequest(to="Researcher", task="Compare the two documents")
    )
    assert payload == {
        "to": "Researcher",
        "task": "Compare the two documents",
        "contract_id": None,
        "input_refs": (),
        "allowed_sources": ("authoritative_input",),
        "allowed_scopes": (),
        "knowledge_mode": "none",
        "output_contract": {},
    }
    assert MailboxKind.RESULT.value == "result"


def test_channel_outreach_is_a_recipe_not_a_core_tool() -> None:
    assert CHANNEL_OUTREACH_RECIPE["wait"]["kind"] == "channel_inbound"
