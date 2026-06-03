"""agent-browser CLI driver (npm package binary + JSON output)."""

from __future__ import annotations

import json
import logging
import os
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from qlix.luna.browser.paths import resolve_agent_browser_binary

logger = logging.getLogger("qlix.luna.browser.agent_browser")

_WAIT_LOAD_MAP = {
    "load": "load",
    "domcontentloaded": "domcontentloaded",
    "networkidle": "networkidle",
}


class AgentBrowserDriver:
    """Subprocess bridge to the agent-browser native CLI."""

    def __init__(
        self,
        *,
        session: str | None = None,
        headless: bool = True,
        binary: Path | None = None,
    ) -> None:
        self._binary = binary or resolve_agent_browser_binary()
        self._session = (
            session
            or os.environ.get("AGENT_BROWSER_SESSION", "").strip()
            or "default"
        )
        self._headless = headless

    @property
    def page(self) -> AgentBrowserDriver:
        return self

    def _env(self) -> dict[str, str]:
        env = os.environ.copy()
        env["AGENT_BROWSER_SESSION"] = self._session
        env.setdefault("AGENT_BROWSER_SOCKET_DIR", "/tmp/agent-browser")
        return env

    def _run(self, *args: str, timeout: int = 120) -> dict[str, Any]:
        cmd: list[str] = [str(self._binary), "--json"]
        if not self._headless:
            cmd.append("--headed")
        cmd.extend(args)
        logger.info(
            "agent_browser_invoke binary=%s headless=%s cmd=%s",
            self._binary,
            self._headless,
            " ".join(cmd),
        )
        logger.debug("agent-browser cmd: %s", " ".join(cmd))
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            env=self._env(),
            check=False,
        )
        stdout = (proc.stdout or "").strip()
        stderr = (proc.stderr or "").strip()
        if proc.returncode != 0 and not stdout:
            raise RuntimeError(
                f"agent-browser failed (exit {proc.returncode}): {stderr or 'no output'}"
            )
        if not stdout:
            raise RuntimeError(f"agent-browser returned empty output: {stderr}")
        try:
            payload = json.loads(stdout)
        except json.JSONDecodeError as exc:
            raise RuntimeError(
                f"agent-browser invalid JSON: {stdout[:500]!r}; stderr={stderr!r}"
            ) from exc
        if not isinstance(payload, dict):
            raise RuntimeError(f"agent-browser unexpected JSON type: {type(payload)}")
        if not payload.get("success", False):
            err = payload.get("error") or stderr or "unknown error"
            err_l = err.lower()
            if "daemon" in err_l and "socket" in err_l:
                self._recover_daemon()
                proc2 = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    timeout=timeout,
                    env=self._env(),
                    check=False,
                )
                stdout2 = (proc2.stdout or "").strip()
                stderr2 = (proc2.stderr or "").strip()
                if proc2.returncode == 0 or stdout2:
                    try:
                        payload2 = json.loads(stdout2) if stdout2 else {}
                        if isinstance(payload2, dict) and payload2.get("success", False):
                            return payload2
                    except json.JSONDecodeError:
                        pass
                    if stdout2:
                        raise RuntimeError(f"agent-browser retry invalid JSON: {stdout2[:300]!r}")
                raise RuntimeError(
                    f"agent-browser error (after daemon recovery): {err}; retry: {stderr2 or stdout2}"
                )
            raise RuntimeError(f"agent-browser error: {err}")
        return payload

    def _recover_daemon(self) -> None:
        """Clear stale session sockets and nudge daemon startup."""
        os.makedirs(os.environ.get("AGENT_BROWSER_SOCKET_DIR", "/tmp/agent-browser"), exist_ok=True)
        for extra in (["close", "--all"], ["doctor", "--fix"]):
            try:
                subprocess.run(
                    [str(self._binary), *extra],
                    capture_output=True,
                    text=True,
                    timeout=90,
                    env=self._env(),
                    check=False,
                )
            except Exception as exc:
                logger.debug("agent_browser_recover %s: %s", extra, exc)

    def _data(self, payload: dict[str, Any]) -> dict[str, Any]:
        data = payload.get("data")
        return data if isinstance(data, dict) else {}

    def navigate(self, url: str, wait_for: str = "load") -> dict[str, Any]:
        self._run("open", url)
        load_state = _WAIT_LOAD_MAP.get(wait_for, "load")
        if load_state != "load":
            self._run("wait", "--load", load_state)
        title_payload = self._run("get", "title")
        title = self._data(title_payload).get("title") or title_payload.get("data")
        if isinstance(title, dict):
            title = title.get("title", "")
        if not isinstance(title, str):
            title = str(title) if title is not None else ""

        text_payload = self._run("get", "text", "body")
        text = self._data(text_payload).get("text", "")
        if not isinstance(text, str):
            text = str(text) if text is not None else ""

        url_payload = self._run("get", "url")
        current_url = self._data(url_payload).get("url", url)
        if not isinstance(current_url, str):
            current_url = url

        return {
            "url": current_url,
            "title": title,
            "status": None,
            "text": text,
        }

    def click(self, selector: str, *, by_text: bool = False) -> None:
        if by_text:
            self._run("find", "text", selector, "click")
        else:
            self._run("click", selector)

    def fill(self, selector: str, text: str, *, clear: bool = True) -> None:
        if clear:
            self._run("fill", selector, text)
        else:
            self._run("type", selector, text)

    def screenshot_bytes(self, *, full_page: bool = False) -> bytes:
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
            path = tmp.name
        try:
            args: list[str] = ["screenshot", path]
            if full_page:
                args.insert(1, "--full")
            self._run(*args)
            return Path(path).read_bytes()
        finally:
            try:
                Path(path).unlink(missing_ok=True)
            except OSError:
                pass

    def extract_text(self, selector: str = "body") -> str:
        payload = self._run("get", "text", selector)
        text = self._data(payload).get("text", "")
        return text if isinstance(text, str) else str(text)

    def extract_links(self, selector: str = "body") -> list[dict[str, str]]:
        js = (
            f"() => Array.from(document.querySelectorAll('{selector} a[href]'))"
            ".map(el => ({ href: el.href, text: (el.innerText || '').trim() }))"
        )
        payload = self._run("eval", js)
        data = self._data(payload)
        result = data.get("result", data.get("value"))
        if isinstance(result, list):
            return [x for x in result if isinstance(x, dict)]
        return []

    def extract_tables(self, selector: str = "body") -> list[str]:
        js = (
            f"() => Array.from(document.querySelectorAll('{selector} table'))"
            ".map(el => el.innerText)"
        )
        payload = self._run("eval", js)
        data = self._data(payload)
        result = data.get("result", data.get("value"))
        if isinstance(result, list):
            return [str(x) for x in result]
        return []

    def accessibility_snapshot(self) -> dict[str, Any] | None:
        payload = self._run("snapshot", "-i")
        data = self._data(payload)
        snap = data.get("snapshot")
        if isinstance(snap, str) and snap.strip():
            return {"role": "Root", "name": "", "children": [], "snapshot_text": snap}
        if snap is not None:
            return snap if isinstance(snap, dict) else {"raw": snap}
        return None

    def run_cli(self, argv: list[str], *, timeout: int = 120) -> dict[str, Any]:
        """Run arbitrary agent-browser CLI tokens (after global --json flag)."""
        if not argv:
            raise ValueError("argv must not be empty")
        return self._run(*argv, timeout=timeout)

    def close(self) -> None:
        try:
            self._run("close")
        except Exception as exc:
            logger.debug("agent-browser close: %s", exc)
