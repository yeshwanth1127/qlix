"""Unit tests for agent-browser driver (mocked subprocess)."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from qlix.luna.browser.agent_browser_driver import AgentBrowserDriver
from qlix.luna.browser.factory import browser_engine_name, get_browser_driver, reset_browser_driver
from qlix.luna.browser.paths import AGENT_BROWSER_NPM_VERSION, resolve_agent_browser_binary


def test_npm_version_pin() -> None:
    assert AGENT_BROWSER_NPM_VERSION == "0.9.4"


def test_resolve_from_path(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    fake = tmp_path / "agent-browser"
    fake.write_text("", encoding="utf-8")
    monkeypatch.setenv("AGENT_BROWSER_BIN", str(fake))
    assert resolve_agent_browser_binary() == fake


def test_agent_browser_driver_navigate(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    fake_bin = tmp_path / "agent-browser-fake"
    fake_bin.write_text("", encoding="utf-8")
    calls: list[list[str]] = []

    def fake_run(cmd, **kwargs):
        calls.append(cmd)
        proc = MagicMock()
        proc.returncode = 0
        if "open" in cmd:
            proc.stdout = '{"success":true,"data":{"url":"https://example.com"}}'
        elif "get" in cmd and "title" in cmd:
            proc.stdout = '{"success":true,"data":{"title":"Example"}}'
        elif "get" in cmd and "text" in cmd:
            proc.stdout = '{"success":true,"data":{"text":"Hello"}}'
        elif "get" in cmd and "url" in cmd:
            proc.stdout = '{"success":true,"data":{"url":"https://example.com"}}'
        else:
            proc.stdout = '{"success":true,"data":{}}'
        proc.stderr = ""
        return proc

    monkeypatch.setattr("qlix.luna.browser.agent_browser_driver.subprocess.run", fake_run)
    drv = AgentBrowserDriver(binary=fake_bin, session="test-agent")
    meta = drv.navigate("https://example.com", wait_for="load")
    assert meta["title"] == "Example"
    assert "Hello" in meta["text"]
    assert any("open" in str(c) for c in calls)


def test_factory_defaults_playwright(monkeypatch: pytest.MonkeyPatch) -> None:
    reset_browser_driver()
    monkeypatch.delenv("LUNA_BROWSER_ENGINE", raising=False)
    assert browser_engine_name() == "playwright"


def test_factory_agent_browser_missing_binary_falls_back(monkeypatch: pytest.MonkeyPatch) -> None:
    reset_browser_driver()
    monkeypatch.setenv("LUNA_BROWSER_ENGINE", "agent_browser")
    monkeypatch.setenv("AGENT_BROWSER_BIN", "/nonexistent/agent-browser")
    with patch("qlix.luna.browser.factory.PlaywrightDriver") as pw:
        pw.return_value = MagicMock()
        drv = get_browser_driver()
        assert drv is pw.return_value
    reset_browser_driver()
