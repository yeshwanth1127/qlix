"""Cloud Slack tool schema and executor tests."""

from __future__ import annotations

import json
import asyncio

from qlix.cloud_slack_runtime import (
    SLACK_TOOL_PATHS,
    build_slack_tool_executors,
    openai_slack_tool_definitions,
)
from qlix.identity import AgentIdentity
from qlix.runner_common import is_acknowledgement_only


def _identity(**kwargs: object) -> AgentIdentity:
    base = {
        "did": "did:t:1",
        "agent_id": "a1",
        "private_key_hex": "0" * 64,
        "public_key_hex": "1" * 64,
        "permission_scopes": ("slack.read", "slack.send"),
        "jit_scopes": (),
        "always_scopes": ("slack.send",),
        "backend_url": "http://localhost",
        "llm_mode": "proxy",
        "raw": {},
    }
    base.update(kwargs)
    return AgentIdentity(
        did=str(base["did"]),
        agent_id=str(base["agent_id"]),
        private_key_hex=str(base["private_key_hex"]),
        public_key_hex=str(base["public_key_hex"]),
        permission_scopes=tuple(base["permission_scopes"]),  # type: ignore[arg-type]
        jit_scopes=tuple(base["jit_scopes"]),  # type: ignore[arg-type]
        always_scopes=tuple(base["always_scopes"]),  # type: ignore[arg-type]
        backend_url=str(base["backend_url"]),
        llm_mode=str(base["llm_mode"]),
        raw=dict(base["raw"]),  # type: ignore[arg-type]
    )


def test_tracker_tools_are_scope_gated() -> None:
    read_names = {
        tool["function"]["name"]
        for tool in openai_slack_tool_definitions(
            _identity(permission_scopes=("slack.read",), always_scopes=()),
            None,
        )
    }
    assert "slack_list_list_items" in read_names
    assert "slack_create_list_item" not in read_names


def test_tracker_tool_schema_is_channel_first() -> None:
    definitions = openai_slack_tool_definitions(_identity(), None)
    by_name = {tool["function"]["name"]: tool["function"] for tool in definitions}
    update = by_name["slack_update_list_item"]
    assert set(update["parameters"]["required"]) == {"channel", "taskTitle"}
    assert "status" in update["parameters"]["properties"]
    assert "slack_delete_list_item" in by_name
    assert "slack_set_list_task_completion" in by_name


def test_acknowledgements_never_require_tools() -> None:
    assert is_acknowledgement_only("good job")
    assert is_acknowledgement_only(
        "## Active Slack task context\nTask: Build homepage\n\n---\n\ngood job"
    )
    assert not is_acknowledgement_only("good job, mark the task done")


def test_executor_routes_delete_to_backend(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def fake_post(**kwargs):
        captured.update(kwargs)
        return json.dumps({"ok": True})

    monkeypatch.setattr("qlix.cloud_slack_runtime._post_slack_tool", fake_post)
    executors = build_slack_tool_executors(
        identity=_identity(),
        skill_filter=None,
        agent_id="a1",
        run_id="r1",
        backend_url="http://backend",
        runner_token="token",
    )
    result = asyncio.run(
        executors["slack_delete_list_item"](
            json.dumps({"channel": "todo", "taskTitle": "Old task"})
        )
    )
    assert json.loads(result) == {"ok": True}
    assert str(captured["path"]).endswith("/slack/delete-list-item")
    assert captured["body"] == {
        "runId": "r1",
        "channel": "todo",
        "taskTitle": "Old task",
    }
    assert SLACK_TOOL_PATHS["slack_set_list_task_completion"] == "set-list-task-completion"
