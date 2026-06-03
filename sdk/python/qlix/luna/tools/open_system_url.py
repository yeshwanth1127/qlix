"""Open URLs in the user's real desktop browser (not Playwright)."""

from __future__ import annotations

import os
import subprocess
import sys
import webbrowser
from typing import Any
from urllib.parse import urlparse

from qlix.luna.core.registry import ToolRegistry
from qlix.luna.core.types import ToolResult
from qlix.luna.tools._stubs import BaseTool, ToolSpec


def _normalize_url(raw: str) -> str:
    u = (raw or "").strip()
    if not u:
        return ""
    # Handle common "open youtube" style inputs (bare site name).
    # If there's no scheme and no dot, assume ".com".
    if "://" not in u and "." not in u and " " not in u:
        u = f"{u}.com"
    parsed = urlparse(u)
    if not parsed.scheme:
        return f"https://{u}"
    return u


def _windows_chrome_exe() -> str | None:
    candidates = []
    pf = os.environ.get("PROGRAMFILES", "")
    pf86 = os.environ.get("PROGRAMFILES(X86)", "")
    la = os.environ.get("LOCALAPPDATA", "")
    if pf:
        candidates.append(os.path.join(pf, "Google", "Chrome", "Application", "chrome.exe"))
    if pf86:
        candidates.append(os.path.join(pf86, "Google", "Chrome", "Application", "chrome.exe"))
    if la:
        candidates.append(
            os.path.join(la, "Google", "Chrome", "Application", "chrome.exe")
        )
    for p in candidates:
        if p and os.path.isfile(p):
            return p
    return None


def _open_desktop_url(url: str, *, prefer_chrome: bool) -> tuple[bool, str, str]:
    """Return (ok, message, how_opened)."""
    if sys.platform == "win32" and prefer_chrome:
        exe = _windows_chrome_exe()
        if exe:
            try:
                subprocess.Popen([exe, url], close_fds=True)  # noqa: S603
                return True, f"Opened in Google Chrome: {url}", "chrome"
            except OSError as exc:
                return False, f"Could not start Chrome: {exc}", ""

    if sys.platform == "darwin" and prefer_chrome:
        try:
            subprocess.Popen(["open", "-a", "Google Chrome", url])  # noqa: S603, S607
            return True, f"Opened in Google Chrome: {url}", "chrome"
        except OSError:
            pass

    try:
        webbrowser.open(url, new=2)
        return True, f"Opened in default browser: {url}", "default_browser"
    except Exception as exc:
        return False, f"Could not open URL: {exc}", ""


@ToolRegistry.register("open_system_url")
class OpenSystemUrlTool(BaseTool):
    """Launch the system browser so the user actually sees the page."""

    tool_id = "open_system_url"
    is_local = True

    @property
    def spec(self) -> ToolSpec:
        return ToolSpec(
            name="open_system_url",
            description=(
                "Open a web URL in the user's desktop browser. "
                "Prefer this when the user asks to open a website, link, or "
                "'open X in Chrome' — it uses their real Google Chrome when "
                "available (otherwise the default browser). "
                "This is not the Playwright automation browser."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "URL or hostname (e.g. https://news.ycombinator.com or ycombinator.com).",
                    },
                    "prefer_chrome": {
                        "type": "boolean",
                        "description": "If true (default), try Google Chrome first when installed.",
                    },
                },
                "required": ["url"],
            },
            category="system",
            cost_estimate=0.0,
            latency_estimate=0.1,
        )

    def execute(self, **params: Any) -> ToolResult:
        raw = params.get("url", "")
        url = _normalize_url(str(raw))
        prefer_chrome = params.get("prefer_chrome", True)
        if prefer_chrome is None:
            prefer_chrome = True

        if not url:
            return ToolResult(
                tool_name="open_system_url",
                content="No URL provided.",
                success=False,
            )

        scheme = urlparse(url).scheme.lower()
        if scheme not in ("http", "https"):
            return ToolResult(
                tool_name="open_system_url",
                content=f"Only http(s) URLs are allowed, got scheme: {scheme!r}",
                success=False,
            )

        try:
            from qlix.luna.security.ssrf import check_ssrf

            ssrf_error = check_ssrf(url)
            if ssrf_error:
                return ToolResult(
                    tool_name="open_system_url",
                    content=f"Blocked URL: {ssrf_error}",
                    success=False,
                )
        except ImportError:
            pass

        ok, msg, how = _open_desktop_url(url, prefer_chrome=bool(prefer_chrome))
        return ToolResult(
            tool_name="open_system_url",
            content=msg,
            success=ok,
            metadata={"url": url, "opened_with": how},
        )


__all__ = ["OpenSystemUrlTool"]
