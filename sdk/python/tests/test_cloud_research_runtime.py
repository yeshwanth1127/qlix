"""Tests for cloud research tool definitions and executors."""

from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import pytest

from qlix.cloud_research_runtime import (
    PLATFORM_SESSION_USER_MESSAGE,
    execute_research_read_url,
    execute_research_web_search,
    openai_research_tool_definitions,
    parse_research_tool_result,
)
from qlix.identity import AgentIdentity


def _id(**kwargs: object) -> AgentIdentity:
    base = {
        "did": "did:t:1",
        "agent_id": "a1",
        "private_key_hex": "0" * 64,
        "public_key_hex": "1" * 64,
        "permission_scopes": ("web.research",),
        "jit_scopes": (),
        "always_scopes": (),
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


def test_no_web_research_scope_returns_empty() -> None:
    ident = _id(permission_scopes=("web.read",))
    tools = openai_research_tool_definitions(ident, None)
    assert tools == []


def test_web_research_scope_returns_five_tools() -> None:
    ident = _id()
    tools = openai_research_tool_definitions(ident, None)
    names = {t["function"]["name"] for t in tools}
    assert names == {
        "research_web_search",
        "research_read_url",
        "research_social_search",
        "research_video",
        "research_github",
    }


def test_skill_filter_by_scope() -> None:
    ident = _id()
    tools = openai_research_tool_definitions(ident, ["web.research"])
    assert len(tools) == 5


def test_skill_filter_by_tool_id() -> None:
    ident = _id()
    tools = openai_research_tool_definitions(ident, ["research_github"])
    assert [t["function"]["name"] for t in tools] == ["research_github"]


@patch("qlix.cloud_research_runtime.shutil.which")
@patch("qlix.cloud_research_runtime._run_cmd")
def test_research_web_search_mcporter(mock_run: MagicMock, mock_which: MagicMock) -> None:
    mock_which.return_value = "/usr/bin/mcporter"
    mock_run.return_value = (True, '{"results": []}')
    out = execute_research_web_search({"query": "LLM frameworks", "num_results": 3})
    assert "results" in out
    mock_run.assert_called_once()


@patch("qlix.cloud_research_runtime.shutil.which")
@patch("qlix.cloud_research_runtime._run_cmd")
def test_research_read_url_jina(mock_run: MagicMock, mock_which: MagicMock) -> None:
    def _which(cmd: str) -> str | None:
        return "/usr/bin/curl" if cmd == "curl" else None

    mock_which.side_effect = _which
    mock_run.return_value = (True, "Article body text")
    out = execute_research_read_url({"url": "https://example.com/post"})
    assert "Article body" in out


def test_research_read_url_missing_url() -> None:
    out = execute_research_read_url({"url": "not-a-url"})
    assert out.startswith("[failed]")


@patch("qlix.cloud_research_runtime.shutil.which", return_value=None)
def test_research_web_search_blocked_without_mcporter(mock_which: MagicMock) -> None:
    out = execute_research_web_search({"query": "test"})
    data = json.loads(out)
    assert data["status"] == "blocked"


def test_parse_research_platform_session_blocked() -> None:
    payload = json.dumps(
        {
            "status": "blocked",
            "code": "platform_session_expired",
            "hint": "bot check",
            "user_message": PLATFORM_SESSION_USER_MESSAGE,
        }
    )
    ok, err = parse_research_tool_result(payload)
    assert ok is False
    assert err == PLATFORM_SESSION_USER_MESSAGE


def test_parse_research_success() -> None:
    ok, err = parse_research_tool_result('{"title": "hello"}')
    assert ok is True
    assert err is None
