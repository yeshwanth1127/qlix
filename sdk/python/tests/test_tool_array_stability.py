"""The tool array must depend on scopes, not on how the prompt is worded.

Prompt-dependent tool arrays cost a cache miss on every run (the tool schema sits in
the cached prompt prefix) and made tool availability non-deterministic for a fixed set
of scopes. These tests pin the invariant down.
"""

from __future__ import annotations

import hashlib
import json

import pytest

from qlix.agents3_runtime import WRITE_LUNA_LOCAL_TOOLS, build_agents3_executors
from qlix.identity import AgentIdentity
from qlix.tool_router import ToolRouter, scope_groups, tool_preference_text

HYBRID_SCOPES = (
    "system.file_read",
    "system.file_write",
    "system.gui_control",
    "whatsapp.send",
)

PROMPTS = [
    "summarize the log file on my desktop",
    "make a pdf report of my sales file and send it on whatsapp",
    "open notepad and type the meeting notes",
    "run the build script and show me the errors",
    "hi",
    "list the files in my documents folder",
]


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


def _tools_hash(router: ToolRouter, prompt: str, description: str = "") -> str:
    plan = router.plan_run(prompt, skill_filter=None, context=description)
    tools = router.build_tool_definitions(plan)
    return hashlib.md5(json.dumps(tools, sort_keys=True).encode()).hexdigest()[:8]


def test_tool_array_is_identical_across_prompts() -> None:
    router = ToolRouter(_identity(HYBRID_SCOPES), runner_runtime="hybrid")
    hashes = {_tools_hash(router, p, "Local PC assistant") for p in PROMPTS}
    assert len(hashes) == 1, f"tool array varied by prompt: {hashes}"


def test_read_only_prompt_still_offers_write_tools_in_schema() -> None:
    """Write tools stay callable in the schema; the gate moved to the executor.

    Removing them from the schema is what made the array prompt-dependent.
    """
    router = ToolRouter(_identity(HYBRID_SCOPES), runner_runtime="hybrid")
    plan = router.plan_run("summarize the log file on my desktop", context="")
    assert plan.read_only_intent is True
    names = {t["function"]["name"] for t in router.build_tool_definitions(plan)}
    assert "luna_local_write_file" in names
    assert "luna_local_create_pdf" in names


@pytest.mark.parametrize("tool_id", sorted(WRITE_LUNA_LOCAL_TOOLS))
def test_write_tools_are_refused_at_execution_on_read_only_runs(tool_id: str) -> None:
    """The safety property is now enforced where it cannot be bypassed.

    Previously a write tool omitted from the schema was still reachable via call_tool.
    """
    executors = build_agents3_executors(
        _identity(HYBRID_SCOPES),
        groups=("files", "code", "gui"),
        qlix_sdk=None,
        read_only_run=True,
    )
    executor = executors.get(tool_id)
    if executor is None:
        pytest.skip(f"{tool_id} not offered for these scopes")
    import asyncio

    result = asyncio.run(executor(json.dumps({"path": "/tmp/x", "content": "y"})))
    assert result.startswith("[failed] blocked:"), result


def test_read_only_run_allows_read_tools() -> None:
    executors = build_agents3_executors(
        _identity(HYBRID_SCOPES),
        groups=("files", "code", "gui"),
        qlix_sdk=None,
        read_only_run=True,
    )
    assert "luna_local_read_file" in executors
    assert "luna_local_list_dir" in executors


def test_scope_groups_ignore_prompt_but_honour_scopes() -> None:
    """Scopes are still the ceiling — an agent is never offered tools it lacks."""
    reader = _identity(("system.file_read",))
    groups = scope_groups(reader, runner_runtime="hybrid")
    assert "files" in groups
    assert "comms" not in groups  # no email/whatsapp/crm/slack scope
    assert "gui" not in groups  # no system.gui_control

    router = ToolRouter(reader, runner_runtime="hybrid")
    plan = router.plan_run("send this on whatsapp and control my desktop", context="")
    names = {t["function"]["name"] for t in router.build_tool_definitions(plan)}
    assert "gui_control" not in names
    assert not any(n.startswith("whatsapp_") for n in names)


def test_skill_filter_still_narrows_the_array() -> None:
    """An explicit user selection is a deliberate choice, not a guess — keep honouring it."""
    router = ToolRouter(_identity(HYBRID_SCOPES), runner_runtime="hybrid")
    unfiltered = router.plan_run("do the thing", context="")
    filtered = router.plan_run("do the thing", skill_filter=["system.file_read"], context="")
    assert len(router.build_tool_definitions(filtered)) < len(
        router.build_tool_definitions(unfiltered)
    )


def test_tool_preference_text_forbids_writes_on_read_only() -> None:
    text = tool_preference_text(("files",), ("files", "always"), read_only=True)
    assert "read-only" in text.lower()
    assert "not" in text.lower()


def test_tool_preference_text_is_empty_for_plain_run() -> None:
    assert tool_preference_text((), ("always",), read_only=False) == ""


def test_cached_prefix_is_byte_identical_across_runs() -> None:
    """The whole point: tools + Tier A system prompt must not vary between runs.

    Providers cache on an exact prefix match, so a single varying byte anywhere in
    here means every run pays full price for the fixed overhead.
    """
    from qlix.hybrid_runner import _build_system_prompt
    from qlix.local_environment import configure_local_environment

    configure_local_environment(
        {
            "username": "y",
            "home": r"C:\Users\y",
            "documents": r"C:\Users\y\Documents",
            "desktop": r"C:\Users\y\Desktop",
            "cwd": r"C:\Users\y",
            "os": "Windows 11",
        }
    )
    identity = _identity(HYBRID_SCOPES)
    router = ToolRouter(identity, runner_runtime="hybrid")
    prefixes = set()
    for prompt in PROMPTS:
        plan = router.plan_run(prompt, context="Local PC assistant")
        tools = router.build_tool_definitions(plan)
        system = _build_system_prompt("You are a local PC assistant.", "", identity)
        prefixes.add(
            hashlib.sha256(
                (json.dumps(tools, sort_keys=True) + "\x00" + system).encode()
            ).hexdigest()
        )
    assert len(prefixes) == 1, "cached prefix varies between runs; caching will not engage"


def test_tier_a_excludes_everything_that_varies_per_run() -> None:
    """Guards against someone re-adding the clock or run guidance to the system prompt."""
    from qlix.hybrid_runner import _build_system_prompt

    system = _build_system_prompt("desc", "", _identity(HYBRID_SCOPES))
    for forbidden in (
        "Current date and time",       # clock -> changes every minute
        "Current working directory",   # session cwd -> changes via luna_local_cd
        "## Lead generation",          # intent guidance -> per run
        "## CRM actions",
    ):
        assert forbidden not in system, f"per-run content leaked into cached prefix: {forbidden}"


def test_cached_prefix_clears_provider_minimum() -> None:
    """OpenAI and Gemini only cache prefixes above ~1024 tokens."""
    from qlix.hybrid_runner import _build_system_prompt

    identity = _identity(HYBRID_SCOPES)
    router = ToolRouter(identity, runner_runtime="hybrid")
    plan = router.plan_run("anything", context="Local PC assistant")
    tools = router.build_tool_definitions(plan)
    system = _build_system_prompt("desc", "", identity)
    approx_tokens = (len(json.dumps(tools)) + len(system)) // 4
    assert approx_tokens >= 1024, f"prefix too small to cache: {approx_tokens} tok"


def test_read_only_file_warning_not_emitted_without_file_tools() -> None:
    """Regression: a Slack/CRM agent must never be told its write tools are blocked.

    is_read_only_file_intent matches verbs like "open" and "list", so
    "what are my open tasks?" set read_only=True. Emitting the file warning for an
    agent with no file tools falsely claims its write tools are blocked, which can
    make it refuse to create a task.
    """
    text = tool_preference_text(("comms",), ("comms", "always"), read_only=True)
    assert "blocked" not in text.lower()
    assert "file" not in text.lower()


def test_read_only_file_warning_is_emitted_when_file_tools_present() -> None:
    text = tool_preference_text(("files",), ("files", "code", "always"), read_only=True)
    assert "read-only" in text.lower()
    assert "file" in text.lower()


def test_preference_text_uses_plain_language_not_internal_group_ids() -> None:
    text = tool_preference_text(("comms",), ("comms", "always"), read_only=False)
    assert "comms" not in text
    assert "messaging" in text.lower()


def test_identity_line_is_not_double_prefixed() -> None:
    """AI-builder descriptions already start with "You are ..."."""
    from qlix.cloud_runner import _build_system_prompt as cloud_system_prompt

    system = cloud_system_prompt("You are a Slack assistant.", _identity(("slack.read",)))
    assert "You are You are" not in system
    assert system.startswith("You are a Slack assistant.")

    system2 = cloud_system_prompt("a Slack assistant", _identity(("slack.read",)))
    assert system2.startswith("You are a Slack assistant.")
