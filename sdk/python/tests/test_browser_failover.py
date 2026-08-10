"""Unit tests for Cloudflare browser failover helpers."""

from __future__ import annotations

import json
import os

import pytest

from qlix.browser_failover import (
    activate_cloudflare_failover,
    failover_active,
    is_retryable_browser_failure,
    reset_failover_state,
    run_agent_browser_tool_with_failover,
)
from qlix.browser_pool import (
    cloudflare_failover_enabled,
    resolve_cloudflare_failover,
    resolve_managed_cdp_url,
)


@pytest.fixture(autouse=True)
def _reset_state(monkeypatch: pytest.MonkeyPatch):
    reset_failover_state()
    monkeypatch.delenv("CLOUDFLARE_ACCOUNT_ID", raising=False)
    monkeypatch.delenv("CLOUDFLARE_API_TOKEN", raising=False)
    monkeypatch.delenv("CF_ACCOUNT_ID", raising=False)
    monkeypatch.delenv("CF_API_TOKEN", raising=False)
    monkeypatch.delenv("QLIX_BROWSER_CF_FAILOVER", raising=False)
    monkeypatch.delenv("QLIX_BROWSER_CDP_URL", raising=False)
    monkeypatch.delenv("QLIX_BROWSER_CDP_HEADERS_JSON", raising=False)
    yield
    reset_failover_state()


def test_resolve_cloudflare_failover_builds_url_and_headers(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CLOUDFLARE_ACCOUNT_ID", "acc123")
    monkeypatch.setenv("CLOUDFLARE_API_TOKEN", "tok_secret")
    cfg = resolve_cloudflare_failover()
    assert cfg is not None
    assert "acc123" in cfg["url"]
    assert "browser-rendering/devtools/browser" in cfg["url"]
    assert "keep_alive=600000" in cfg["url"]
    assert cfg["headers"]["Authorization"] == "Bearer tok_secret"
    assert cfg["provider"] == "cloudflare"


def test_cloudflare_not_in_managed_primary_url(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CLOUDFLARE_ACCOUNT_ID", "acc123")
    monkeypatch.setenv("CLOUDFLARE_API_TOKEN", "tok_secret")
    assert resolve_managed_cdp_url() is None


def test_cloudflare_failover_kill_switch(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CLOUDFLARE_ACCOUNT_ID", "acc123")
    monkeypatch.setenv("CLOUDFLARE_API_TOKEN", "tok_secret")
    monkeypatch.setenv("QLIX_BROWSER_CF_FAILOVER", "0")
    assert cloudflare_failover_enabled() is False


def test_retryable_infra_failures() -> None:
    assert is_retryable_browser_failure("agent-browser failed (exit 1): daemon socket gone")
    assert is_retryable_browser_failure("Failed to launch chromium: executable doesn't exist")
    assert is_retryable_browser_failure("browser has been closed")
    assert is_retryable_browser_failure("WebSocket connection refused")


def test_non_retryable_tool_errors() -> None:
    assert is_retryable_browser_failure("Denied: browser tools require web.read scope") is False
    assert is_retryable_browser_failure("SSRF blocked: private IP") is False
    assert is_retryable_browser_failure("Invalid parameters: selector required") is False
    assert is_retryable_browser_failure("Timeout 30000ms exceeded waiting for selector #x") is False
    assert is_retryable_browser_failure("No element found for text Submit") is False


def test_failover_wrapper_retries_on_infra_error(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CLOUDFLARE_ACCOUNT_ID", "acc123")
    monkeypatch.setenv("CLOUDFLARE_API_TOKEN", "tok_secret")

    calls = {"primary": 0}

    def _fake_primary(tool_id, params, *, granted_scopes=None):
        calls["primary"] += 1
        return False, "agent-browser failed (exit 1): daemon socket missing"

    class _FakePage:
        pass

    class _FakeDriver:
        def __init__(self, *args, **kwargs):
            pass

        @property
        def page(self):
            return _FakePage()

        def navigate(self, url, wait_for="load"):
            return {"url": url, "title": "t", "status": 200, "text": "ok"}

        def close(self):
            pass

    monkeypatch.setattr(
        "qlix.luna.browser.agent_browser_cli.run_agent_browser_tool",
        _fake_primary,
    )
    monkeypatch.setattr("qlix.luna.browser.playwright_driver.PlaywrightDriver", _FakeDriver)

    # Avoid real ToolRegistry browser tools — stub mapped execute.
    def _fake_mapped(tool_id, params):
        return True, "navigated via cloudflare"

    monkeypatch.setattr(
        "qlix.browser_failover._execute_playwright_mapped",
        _fake_mapped,
    )

    ok, content = run_agent_browser_tool_with_failover(
        "browser_ab_open",
        {"url": "https://example.com"},
        granted_scopes={"web.read"},
    )
    assert ok is True
    assert "cloudflare failover" in content
    assert failover_active() is True
    assert calls["primary"] == 1


def test_failover_skips_selector_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CLOUDFLARE_ACCOUNT_ID", "acc123")
    monkeypatch.setenv("CLOUDFLARE_API_TOKEN", "tok_secret")

    def _fake_primary(tool_id, params, *, granted_scopes=None):
        return False, "Timeout 30000ms exceeded waiting for selector #missing"

    monkeypatch.setattr(
        "qlix.luna.browser.agent_browser_cli.run_agent_browser_tool",
        _fake_primary,
    )

    ok, content = run_agent_browser_tool_with_failover(
        "browser_ab_click",
        {"selector": "#missing"},
        granted_scopes={"web.read", "web.click"},
    )
    assert ok is False
    assert "waiting for selector" in content
    assert failover_active() is False


def test_activate_sets_cdp_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CLOUDFLARE_ACCOUNT_ID", "acc123")
    monkeypatch.setenv("CLOUDFLARE_API_TOKEN", "tok_secret")

    class _FakeDriver:
        def __init__(self, *args, **kwargs):
            self.kwargs = kwargs

        @property
        def page(self):
            return object()

        def close(self):
            pass

    monkeypatch.setattr("qlix.luna.browser.playwright_driver.PlaywrightDriver", _FakeDriver)
    assert activate_cloudflare_failover(reason="test") is True
    assert failover_active() is True
    assert "acc123" in os.environ["QLIX_BROWSER_CDP_URL"]
    headers = json.loads(os.environ["QLIX_BROWSER_CDP_HEADERS_JSON"])
    assert headers["Authorization"].startswith("Bearer ")
