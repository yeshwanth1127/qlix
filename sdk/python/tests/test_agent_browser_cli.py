"""Tests for agent-browser CLI manifest and argv builders."""

from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import pytest

from qlix.luna.browser.agent_browser_cli import (
    AGENT_BROWSER_TOOL_IDS,
    _build_exec,
    _build_find,
    format_cli_result,
    run_agent_browser_tool,
    tool_def_by_id,
)


def test_manifest_has_core_tools() -> None:
    assert "browser_ab_open" in AGENT_BROWSER_TOOL_IDS
    assert "browser_ab_snapshot" in AGENT_BROWSER_TOOL_IDS
    assert "browser_ab_click" in AGENT_BROWSER_TOOL_IDS
    assert "browser_exec" in AGENT_BROWSER_TOOL_IDS
    assert len(AGENT_BROWSER_TOOL_IDS) >= 30


def test_build_find_argv() -> None:
    argv = _build_find(
        {"locator": "role", "value": "button", "action": "click", "name": "Submit"}
    )
    assert argv == ["find", "role", "button", "click", "--name", "Submit"]


def test_build_exec_blocks_install() -> None:
    with pytest.raises(ValueError, match="not allowed"):
        _build_exec({"argv": ["install"]})


def test_format_cli_result_snapshot() -> None:
    text = format_cli_result(
        {"success": True, "data": {"snapshot": "- button Submit @e2"}},
        argv=["snapshot", "-i"],
    )
    assert "OK" in text
    assert "@e2" in text


def test_run_agent_browser_tool_requires_engine(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LUNA_BROWSER_ENGINE", "playwright")
    ok, msg = run_agent_browser_tool("browser_ab_open", {"url": "https://example.com"})
    assert not ok
    assert "agent_browser" in msg


def test_run_agent_browser_tool_open(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LUNA_BROWSER_ENGINE", "agent_browser")
    payload = {"success": True, "data": {"title": "Example"}}

    class FakeDriver:
        def run_cli(self, argv: list[str]) -> dict:
            assert argv[0] == "open"
            return payload

    monkeypatch.setattr(
        "qlix.luna.browser.factory.get_browser_driver",
        lambda: FakeDriver(),
    )
    monkeypatch.setattr(
        "qlix.luna.browser.factory.browser_engine_name",
        lambda: "agent_browser",
    )
    ok, content = run_agent_browser_tool(
        "browser_ab_open",
        {"url": "https://example.com"},
        granted_scopes={"web.read", "web.click"},
    )
    assert ok
    assert "OK" in content


def test_tool_def_by_id() -> None:
    d = tool_def_by_id("browser_ab_wait")
    assert d is not None
    assert d.tool_id == "browser_ab_wait"
