"""Generalised tool-budget policy.

The policy must (a) cut real tokens, (b) never depend on the prompt — otherwise it
breaks the cached prefix it exists to protect — and (c) never leave a tool callable in
the schema with no executor behind it, or vice versa in a way that breaks a run.
"""

from __future__ import annotations

import json

import pytest

from qlix.identity import AgentIdentity
from qlix.tool_budget import (
    ADMIN_TOOLS,
    DELEGATION_TOOLS,
    META_TOOLS,
    NO_OP_TOOLS,
    SUBAGENT_TOOLS,
    apply_tool_budget,
    budget_report,
)
from qlix.tool_router import ToolRouter


def _identity(scopes: tuple[str, ...]) -> AgentIdentity:
    return AgentIdentity(
        did="did:qlix:test",
        agent_id="agent_test",
        private_key_hex="00" * 32,
        public_key_hex="11" * 32,
        permission_scopes=scopes,
        jit_scopes=(),
        always_scopes=(),
        backend_url="http://localhost:8080",
        llm_mode="proxy",
        raw={},
    )


def _tool(name: str) -> dict:
    return {"type": "function", "function": {"name": name, "description": "x", "parameters": {}}}


def _names(tools: list[dict]) -> set[str]:
    return {t["function"]["name"] for t in tools}


# --- 1. round tax -----------------------------------------------------------------


def test_no_op_tools_are_dropped() -> None:
    """`done` and the brain stub cost a full round each and do no work."""
    tools = [_tool(n) for n in ("slack_post_message", "done", "brain_query", "think")]
    kept = _names(apply_tool_budget(tools, tool_profile="full"))
    assert "done" not in kept
    assert "brain_query" not in kept
    assert "slack_post_message" in kept


def test_think_is_kept_by_default() -> None:
    """think is not a no-op: it is the only way to reason without ending the loop.

    Content without tool calls terminates the run, so removing think risks agents
    stopping early — which the empty-response nudge then pays for with more rounds.
    """
    tools = [_tool("think"), _tool("slack_post_message")]
    assert "think" in _names(apply_tool_budget(tools, tool_profile="full"))


def test_think_can_be_disabled_by_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("QLIX_ENABLE_THINK_TOOL", "0")
    tools = [_tool("think"), _tool("slack_post_message")]
    assert "think" not in _names(apply_tool_budget(tools, tool_profile="full"))


# --- 2. discovery tools -----------------------------------------------------------


def test_meta_tools_dropped_on_small_catalog() -> None:
    """find_tools/call_tool page through a catalog that already fits in the schema."""
    tools = [_tool(f"t{i}") for i in range(10)] + [_tool(n) for n in META_TOOLS]
    kept = _names(apply_tool_budget(tools, tool_profile="full"))
    assert not (META_TOOLS & kept)


def test_meta_tools_kept_on_large_catalog() -> None:
    tools = [_tool(f"t{i}") for i in range(60)] + [_tool(n) for n in META_TOOLS]
    kept = _names(apply_tool_budget(tools, tool_profile="full"))
    assert META_TOOLS <= kept


def test_meta_tools_kept_when_mcp_servers_bound() -> None:
    """MCP catalogs are large and dynamic — discovery earns its cost there."""
    tools = [_tool(f"t{i}") for i in range(5)] + [_tool(n) for n in META_TOOLS]
    kept = _names(apply_tool_budget(tools, tool_profile="full", has_mcp_servers=True))
    assert META_TOOLS <= kept


def test_delegation_is_opt_in(monkeypatch: pytest.MonkeyPatch) -> None:
    tools = [_tool(n) for n in DELEGATION_TOOLS] + [_tool("x")]
    assert not (DELEGATION_TOOLS & _names(apply_tool_budget(tools, tool_profile="full")))
    monkeypatch.setenv("QLIX_ENABLE_DELEGATION", "1")
    assert DELEGATION_TOOLS <= _names(apply_tool_budget(tools, tool_profile="full"))


def test_subagents_are_opt_in(monkeypatch: pytest.MonkeyPatch) -> None:
    tools = [_tool(n) for n in SUBAGENT_TOOLS] + [_tool("x")]
    assert not (SUBAGENT_TOOLS & _names(apply_tool_budget(tools, tool_profile="full")))
    monkeypatch.setenv("QLIX_ENABLE_SUBAGENTS", "1")
    assert SUBAGENT_TOOLS <= _names(apply_tool_budget(tools, tool_profile="full"))


# --- 3. usage tiers ---------------------------------------------------------------


def test_lean_profile_drops_admin_tools_only() -> None:
    tools = [_tool(n) for n in ("slack_create_channel", "slack_post_message", "crm_bulk_create", "crm_get")]
    full = _names(apply_tool_budget(tools, tool_profile="full"))
    lean = _names(apply_tool_budget(tools, tool_profile="lean"))
    assert "slack_create_channel" in full and "slack_create_channel" not in lean
    assert "crm_bulk_create" in full and "crm_bulk_create" not in lean
    # Tools the agent actually works with survive both.
    assert {"slack_post_message", "crm_get"} <= lean


def test_discovery_tools_are_not_classed_as_admin() -> None:
    """Removing these breaks real flows (field names, channel ids), so they must stay."""
    for essential in ("crm_describe_module", "crm_list_modules", "slack_list_channels",
                      "slack_list_list_items", "slack_find_channel_lists"):
        assert essential not in ADMIN_TOOLS


# --- 4. cache safety --------------------------------------------------------------


def test_budget_is_prompt_independent() -> None:
    """The budget must not reintroduce prompt-dependence into the tool array."""
    import hashlib

    identity = _identity(("slack.read", "slack.send"))
    router = ToolRouter(identity, runner_runtime="cloud")
    hashes = set()
    for prompt in ("what are my open tasks?", "post a message to #general",
                   "create a channel called x", "hi"):
        plan = router.plan_run(prompt, context="Slack assistant")
        tools = router.build_tool_definitions(plan, tool_profile="lean")
        hashes.add(hashlib.md5(json.dumps(tools, sort_keys=True).encode()).hexdigest())
    assert len(hashes) == 1


def test_profiles_produce_stable_but_distinct_prefixes() -> None:
    """Each profile is its own stable cache variant — narrowing per agent is free."""
    import hashlib

    identity = _identity(("slack.read", "slack.send"))
    router = ToolRouter(identity, runner_runtime="cloud")
    plan = router.plan_run("anything", context="Slack assistant")

    def h(profile: str) -> str:
        tools = router.build_tool_definitions(plan, tool_profile=profile)
        return hashlib.md5(json.dumps(tools, sort_keys=True).encode()).hexdigest()

    assert h("lean") == h("lean")
    assert h("full") == h("full")
    assert h("lean") != h("full")


# --- 5. executors must survive schema removal -------------------------------------


def test_hidden_tools_still_have_executors() -> None:
    """A model that hallucinates a dropped tool must get a real result, not a crash.

    The budget filters the SCHEMA only; build_executor_map is untouched, so call_tool
    and any stray call still resolve.
    """
    identity = _identity(("slack.read", "slack.send"))
    router = ToolRouter(identity, runner_runtime="cloud")
    plan = router.plan_run("anything", context="Slack assistant")
    schema = _names(router.build_tool_definitions(plan, tool_profile="lean"))
    executors = set(
        router.build_executor_map(
            plan, agent_id="a", run_id="r", backend_url="http://x", runner_token="t"
        ).keys()
    )
    for dropped in ("done", "find_tools", "call_tool"):
        assert dropped not in schema
        assert dropped in executors, f"{dropped} hidden from schema but has no executor"


# --- 6. telemetry -----------------------------------------------------------------


def test_budget_report_quantifies_the_saving() -> None:
    before = [_tool(n) for n in ("a", "done", "brain_query")]
    after = apply_tool_budget(before, tool_profile="full")
    report = budget_report(before, after)
    assert report["toolsBefore"] == 3
    assert report["toolsAfter"] == 1
    assert set(report["removed"]) == {"done", "brain_query"}
    assert report["schemaTokensSavedPerRound"] > 0


def test_no_op_set_does_not_include_think() -> None:
    assert "think" not in NO_OP_TOOLS
