from qlix.luna_teams import (
    DispatchRequest,
    IntentPatch,
    IntentRequirement,
    MailboxKind,
    TeamMember,
    ResolvedIntent,
    apply_intent_patches,
    as_payload,
    commander_tool_definitions,
    missing_requirement_ids,
    repeat_intent,
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
        "requirement_ids": (),
    }
    assert MailboxKind.RESULT.value == "result"


def test_channel_outreach_is_a_recipe_not_a_core_tool() -> None:
    assert CHANNEL_OUTREACH_RECIPE["wait"]["kind"] == "channel_inbound"


def test_repeat_intent_preserves_every_requirement() -> None:
    base = ResolvedIntent(
        effective_goal="Filter Bangalore leads. Then send a brochure",
        requirements=(
            IntentRequirement("filter", "Filter Bangalore leads"),
            IntentRequirement("brochure", "Send a brochure"),
        ),
        user_message="original",
    )
    repeated = repeat_intent(base, "do it again", "run-1")
    assert repeated.effective_goal == base.effective_goal
    assert repeated.requirements == base.requirements
    assert repeated.mode.value == "repeat"


def test_modify_intent_changes_only_the_named_requirement() -> None:
    base = ResolvedIntent(
        effective_goal="Filter Bangalore leads. Then send a brochure",
        requirements=(
            IntentRequirement("filter", "Filter Bangalore leads"),
            IntentRequirement("brochure", "Send a brochure"),
        ),
        user_message="original",
    )
    modified = apply_intent_patches(
        base,
        [IntentPatch("replace", "filter", "Filter Chennai leads")],
        "same but Chennai",
        "run-1",
    )
    assert [item.text for item in modified.requirements] == [
        "Filter Chennai leads",
        "Send a brochure",
    ]


def test_dispatch_coverage_reports_missing_requirements() -> None:
    intent = ResolvedIntent(
        effective_goal="Filter and message",
        requirements=(
            IntentRequirement("filter", "Filter leads"),
            IntentRequirement("message", "Message leads"),
        ),
        user_message="Filter and message",
    )
    dispatches = [DispatchRequest(to="Filter", task="Filter", requirement_ids=("filter",))]
    assert missing_requirement_ids(intent, dispatches) == ("message",)
