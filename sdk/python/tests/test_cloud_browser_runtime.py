"""Tests for cloud browser tool definitions (scope gating)."""

from __future__ import annotations

from qlix.cloud_browser_runtime import (
    browser_action_label,
    browser_tool_scopes,
    live_browser_view_enabled,
    openai_browser_tool_definitions,
    tool_allowed_for_identity,
)
from qlix.identity import AgentIdentity


def _id(**kwargs: object) -> AgentIdentity:
    base = {
        "did": "did:t:1",
        "agent_id": "a1",
        "private_key_hex": "0" * 64,
        "public_key_hex": "1" * 64,
        "permission_scopes": (),
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


def test_no_scopes_returns_empty_tools() -> None:
    ident = _id(permission_scopes=("system.file_read",))
    tools = openai_browser_tool_definitions(ident, None)
    assert tools == []


def test_navigate_requires_web_read(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LUNA_BROWSER_ENGINE", "playwright")
    assert browser_tool_scopes()["browser_navigate"] == ("web.read",)


def test_tool_allowed_for_identity() -> None:
    ident = _id(permission_scopes=("web.read", "web.click"))
    assert tool_allowed_for_identity("browser_navigate", ident) is True
    assert tool_allowed_for_identity("browser_click", ident) is True


def test_browser_action_label() -> None:
    assert "example.com" in browser_action_label(
        "browser_navigate", {"url": "https://example.com"}
    )
    assert "Submit" in browser_action_label("browser_click", {"selector": "Submit", "by_text": True})
    assert "contact@" in browser_action_label(
        "browser_ab_find",
        {"locator": "text", "value": "contact@", "action": "text"},
    )


def test_live_browser_view_default_on(monkeypatch) -> None:
    monkeypatch.delenv("QLIX_BROWSER_LIVE_VIEW", raising=False)
    assert live_browser_view_enabled() is True
    monkeypatch.setenv("QLIX_BROWSER_LIVE_VIEW", "0")
    assert live_browser_view_enabled() is False
