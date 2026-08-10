"""Cloudflare Browser Run failover for cloud agent browser tools.

Primary path stays local agent-browser/Chromium. On retryable infra failures,
activate a Playwright session against Cloudflare Browser Run CDP and retry.
Once activated, the rest of the run stays on Cloudflare (no flapping).
"""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any

logger = logging.getLogger(__name__)

_failover_active = False
_last_url: str | None = None

# Infra / session failures — not selector or model mistakes.
_RETRYABLE_PATTERNS: tuple[re.Pattern[str], ...] = tuple(
    re.compile(p, re.I)
    for p in (
        r"daemon",
        r"socket",
        r"browser has been closed",
        r"target closed",
        r"target page.*closed",
        r"chromium",
        r"chrome.*not found",
        r"failed to launch",
        r"executable doesn.?t exist",
        r"connection refused",
        r"econnrefused",
        r"browserType\.launch",
        r"timeout.*browser",
        r"waiting for browser",
        r"agent-browser failed \(exit",
        r"protocol error",
        r"websocket",
        r"browser.*crash",
        r"session.*(closed|disconnected|expired)",
        r"no such file",
        r"connect.*cdp",
        r"browser driver does not support",
    )
)

_NON_RETRYABLE_PATTERNS: tuple[re.Pattern[str], ...] = tuple(
    re.compile(p, re.I)
    for p in (
        r"^denied:",
        r"missing permission scope",
        r"ssrf blocked",
        r"invalid parameters",
        r"unknown (agent-browser )?tool",
        r"unknown browser action",
        r"element (not found|is not)",
        r"strict mode violation",
        r"no element found",
        r"timeout \d+ms exceeded",
        r"waiting for (locator|selector|get_by)",
        r"no url provided",
        r"no selector provided",
    )
)


def reset_failover_state() -> None:
    """Test helper — clear in-process failover state."""
    global _failover_active, _last_url
    _failover_active = False
    _last_url = None


def failover_active() -> bool:
    return _failover_active


def last_browser_url() -> str | None:
    return _last_url


def remember_url_from_params(tool_id: str, params: dict[str, Any]) -> None:
    global _last_url
    if tool_id in ("browser_ab_open", "browser_navigate"):
        url = str(params.get("url") or "").strip()
        if url:
            _last_url = url


def is_retryable_browser_failure(message: str) -> bool:
    text = (message or "").strip()
    if not text:
        return False
    if any(p.search(text) for p in _NON_RETRYABLE_PATTERNS):
        return False
    return any(p.search(text) for p in _RETRYABLE_PATTERNS)


def activate_cloudflare_failover(*, reason: str) -> bool:
    """Switch the process browser driver to Cloudflare Playwright CDP."""
    global _failover_active
    if _failover_active:
        return True

    from qlix.browser_pool import cloudflare_failover_enabled, resolve_cloudflare_failover
    from qlix.luna.browser.factory import set_browser_driver
    from qlix.luna.browser.playwright_driver import PlaywrightDriver

    if not cloudflare_failover_enabled():
        return False
    cfg = resolve_cloudflare_failover()
    if not cfg:
        return False

    url = str(cfg["url"])
    headers = dict(cfg.get("headers") or {})
    os.environ["QLIX_BROWSER_CDP_URL"] = url
    os.environ["QLIX_BROWSER_CDP_HEADERS_JSON"] = json.dumps(headers)
    # Prefer playwright for the remainder of the run so header auth works.
    os.environ["LUNA_BROWSER_ENGINE"] = "playwright"

    driver = PlaywrightDriver(cdp_url=url, cdp_headers=headers)
    # Force-connect now so a dead CF session fails here, not mid-tool.
    try:
        _ = driver.page
    except Exception as exc:  # noqa: BLE001
        logger.warning("browser_failover_cloudflare_connect_failed reason=%s error=%s", reason, exc)
        return False

    set_browser_driver(driver)
    _failover_active = True
    logger.info(
        "browser_failover_cloudflare reason=%s keep_alive_ms=%s",
        reason[:200],
        cfg.get("keep_alive_ms"),
    )
    return True


def _map_ab_tool_to_playwright(
    tool_id: str, params: dict[str, Any]
) -> tuple[str, dict[str, Any]] | None:
    """Map agent-browser tool ids onto Luna Playwright ToolRegistry tools."""
    if tool_id in ("browser_ab_open", "browser_navigate"):
        url = str(params.get("url") or "").strip()
        if not url:
            return None
        return "browser_navigate", {"url": url, "wait_for": params.get("wait_for", "load")}

    if tool_id in ("browser_ab_click", "browser_ab_dblclick", "browser_click"):
        sel = str(params.get("selector") or params.get("value") or "").strip()
        if not sel:
            return None
        return "browser_click", {"selector": sel, "by_text": bool(params.get("by_text", False))}

    if tool_id in ("browser_ab_fill", "browser_ab_type", "browser_type"):
        sel = str(params.get("selector") or "").strip()
        text = str(params.get("text") or params.get("value") or "").strip()
        if not sel or not text:
            return None
        clear = True if tool_id == "browser_ab_fill" else bool(params.get("clear", True))
        return "browser_type", {"selector": sel, "text": text, "clear": clear}

    if tool_id in ("browser_ab_screenshot", "browser_screenshot"):
        return "browser_screenshot", {
            "path": params.get("path"),
            "full_page": bool(params.get("full_page", False)),
        }

    if tool_id in ("browser_ab_get", "browser_ab_snapshot", "browser_extract", "browser_axtree"):
        sel = str(params.get("selector") or "body").strip() or "body"
        extract_type = "text"
        what = str(params.get("what") or "").strip().lower()
        if what in ("links", "tables"):
            extract_type = what
        return "browser_extract", {"selector": sel, "extract_type": extract_type}

    return None


def _execute_playwright_mapped(tool_id: str, params: dict[str, Any]) -> tuple[bool, str]:
    import qlix.luna.tools.browser  # noqa: F401 — register tools
    from qlix.luna.core.registry import ToolRegistry

    mapped = _map_ab_tool_to_playwright(tool_id, params)
    if mapped is None:
        return (
            False,
            (
                f"[cloudflare failover active] Unsupported action on backup browser: {tool_id}. "
                "Retry with navigate/open, click, fill/type, screenshot, or extract/get."
            ),
        )

    legacy_id, legacy_params = mapped
    # Restore page context after a fresh CF session when possible.
    if legacy_id != "browser_navigate" and _last_url:
        try:
            from qlix.luna.browser.factory import get_browser_driver

            get_browser_driver().navigate(_last_url)
        except Exception as exc:  # noqa: BLE001
            logger.warning("browser_failover_renavigate_failed url=%s error=%s", _last_url, exc)

    try:
        cls = ToolRegistry.get(legacy_id)
        result = cls().execute(**legacy_params)
        return bool(result.success), result.content or ""
    except Exception as exc:  # noqa: BLE001
        logger.exception("browser_failover_playwright_execute tool=%s", tool_id)
        return False, f"Cloudflare failover tool error ({tool_id}): {exc}"


def run_agent_browser_tool_with_failover(
    tool_id: str,
    params: dict[str, Any],
    *,
    granted_scopes: set[str] | None = None,
) -> tuple[bool, str]:
    """Run agent-browser tool; on infra failure, failover to Cloudflare once."""
    from qlix.browser_pool import cloudflare_failover_enabled
    from qlix.luna.browser.agent_browser_cli import run_agent_browser_tool

    remember_url_from_params(tool_id, params)

    if _failover_active:
        return _execute_playwright_mapped(tool_id, params)

    ok, content = run_agent_browser_tool(tool_id, params, granted_scopes=granted_scopes)
    if ok:
        remember_url_from_params(tool_id, params)
        return ok, content

    if not cloudflare_failover_enabled() or not is_retryable_browser_failure(content):
        return ok, content

    if not activate_cloudflare_failover(reason=content):
        return ok, content

    # Fresh CF session: prefer replaying navigate with known URL first.
    retry_params = dict(params)
    if tool_id not in ("browser_ab_open", "browser_navigate") and _last_url:
        # Context restore happens inside _execute_playwright_mapped.
        pass
    elif tool_id in ("browser_ab_open", "browser_navigate"):
        url = str(retry_params.get("url") or _last_url or "").strip()
        if url:
            retry_params["url"] = url

    ok2, content2 = _execute_playwright_mapped(tool_id, retry_params)
    prefix = "[cloudflare failover] "
    return ok2, (prefix + content2) if content2 else prefix + "(empty)"
